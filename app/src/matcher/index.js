import { applyHeuristics, scoreField } from './heuristics';
import { llmMatch } from './llmClient';
import { getCachedMapping, saveMappingCacheEntry } from '../profile/store';

// AI confidence required to override a regex match. Below this, AI is treated
// as a last-resort suggestion (still applied if regex returns nothing).
const AI_THRESHOLD = 0.6;
// Confidence assumed when the LLM doesn't return one (older /match versions).
const AI_DEFAULT_CONFIDENCE = 0.7;

// Profile keys whose semantics force one-field-per-profile-key (singletons).
// Multi-value keys (skills, languages, references, coverLetter) may be reused.
const SINGLETON_KEYS = new Set([
  'firstName', 'middleName', 'lastName', 'preferredName', 'name',
  'pronouns', 'dateOfBirth', 'gender',
  'email', 'phone',
  'address', 'city', 'state', 'zipCode', 'country',
  'linkedIn', 'portfolio', 'github',
  'currentTitle', 'currentCompany', 'yearsExperience',
  'workAuthorization', 'willingToRelocate', 'noticePeriod',
  'currentSalary', 'expectedSalary', 'salary', 'startDate',
]);

function normaliseAi(raw) {
  // Accept both legacy shape `{id: "key"}` and new shape
  // `{id: {key, confidence}}`. Normalise to `{id: {key, confidence, source}}`.
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, val] of Object.entries(raw)) {
    if (val == null) continue;
    if (typeof val === 'string') {
      out[id] = { key: val, confidence: AI_DEFAULT_CONFIDENCE, source: 'ai' };
    } else if (typeof val === 'object' && val.key) {
      const c = typeof val.confidence === 'number' ? val.confidence : AI_DEFAULT_CONFIDENCE;
      out[id] = { key: val.key, confidence: c, source: 'ai' };
    }
  }
  return out;
}

function decideForField(field, regexDecision, aiDecision) {
  // Priority pipeline (per /plan §4):
  //   1. autocomplete token (deterministic)
  //   2. semantic type (deterministic)
  //   3. AI mapping with confidence ≥ AI_THRESHOLD
  //   4. regex on label/name/placeholder/aria/nearbyText
  //   5. AI mapping with confidence < AI_THRESHOLD (last resort)
  if (regexDecision && (regexDecision.source === 'autocomplete' || regexDecision.source === 'type')) {
    return regexDecision;
  }
  if (aiDecision && aiDecision.confidence >= AI_THRESHOLD) {
    return aiDecision;
  }
  if (regexDecision) {
    return regexDecision;
  }
  if (aiDecision) {
    return { ...aiDecision, source: 'ai-low' };
  }
  return null;
}

// Keys whose values are typed, never picked from a list. Used only as a
// dedupe tie-breaker between a text control and a dropdown trigger.
const FREE_TEXT_KEYS = new Set(['phone', 'email', 'firstName', 'lastName', 'name', 'address', 'zipCode']);

function isTextControl(field) {
  if (!field) return false;
  const w = field.widget || '';
  return w === 'text' || w === 'textarea' || w === 'contenteditable' || w === 'combobox-input';
}

function dedupe(decisions, fieldsById) {
  // For each singleton profile key, if multiple fields claim it, keep the
  // highest-confidence claimant; demote the rest to their next-best
  // non-conflicting candidate.
  const byKey = {};
  for (const [fieldId, dec] of Object.entries(decisions)) {
    if (!dec || !dec.key || !SINGLETON_KEYS.has(dec.key)) continue;
    if (!byKey[dec.key]) byKey[dec.key] = [];
    byKey[dec.key].push({ fieldId, decision: dec });
  }

  for (const [key, claimants] of Object.entries(byKey)) {
    if (claimants.length < 2) continue;
    // Visible field beats hidden regardless of confidence: custom dropdown
    // widgets keep a display:none native <select> in sync, and filling that
    // select changes nothing on screen. `!== false` keeps old scans (no
    // visible flag) treated as visible.
    claimants.sort((a, b) => {
      const va = fieldsById[a.fieldId]?.visible !== false;
      const vb = fieldsById[b.fieldId]?.visible !== false;
      if (va !== vb) return va ? -1 : 1;
      const dc = b.decision.confidence - a.decision.confidence;
      if (dc !== 0) return dc;
      // Confidence tie on a free-text key: the value can only be typed, so a
      // text control beats a dropdown trigger (Workday: button name="phoneType"
      // ties input name="phoneNumber" — the button must not steal the number).
      if (FREE_TEXT_KEYS.has(key)) {
        const ta = isTextControl(fieldsById[a.fieldId]);
        const tb = isTextControl(fieldsById[b.fieldId]);
        if (ta !== tb) return ta ? -1 : 1;
      }
      return 0;
    });
    // Winner keeps the key; losers fall back to their next-best candidate.
    for (let i = 1; i < claimants.length; i++) {
      const { fieldId } = claimants[i];
      const field = fieldsById[fieldId];
      if (!field) { decisions[fieldId] = null; continue; }
      // Re-score and pick the best decision whose key isn't already taken.
      const next = scoreField(field);
      if (next && next.key !== key) {
        decisions[fieldId] = next;
      } else {
        decisions[fieldId] = null;
      }
    }
  }
}

// Returns { mapping, decisions } where:
//   mapping[fieldId]   = profile key (or undefined if unmapped)
//   decisions[fieldId] = { key, confidence, source } | null
export async function matchFieldsToProfile(fields, profile, useLlmFallback = true, hostname = null) {
  // Look up any cached per-host mapping. Cache may cover only a subset of
  // fields (page version drift, new questions added, etc.) — uncovered fields
  // still need to flow through regex + AI, otherwise we'd silently leave them
  // empty and never re-train the cache.
  const cached = hostname ? (getCachedMapping(hostname, fields, profile) || {}) : {};
  const cachedCount = Object.keys(cached).length;

  // Fields that still need a fresh decision from regex / AI.
  const uncoveredFields = fields.filter(f => !cached[f.id]);

  if (cachedCount > 0) {
    console.log(
      '[matcher] cache hit for', hostname,
      '— covered', cachedCount, '/', fields.length,
      'fields; AI will run on the remaining', uncoveredFields.length,
    );
  }

  const { decisions: regexDecisions } = applyHeuristics(uncoveredFields);

  let aiDecisions = {};
  if (useLlmFallback && uncoveredFields.length > 0) {
    try {
      console.log('[matcher] calling AI /match for', uncoveredFields.length, 'field(s)');
      const raw = await llmMatch(uncoveredFields, profile);
      aiDecisions = normaliseAi(raw);
      console.log('[matcher] AI /match returned', Object.keys(aiDecisions).length, 'decision(s)');
    } catch (err) {
      // AI unavailable — regex decisions used as-is. Surface the reason so
      // "AI: 0" in the UI doesn't mask a backend connectivity problem.
      const msg = err && err.message ? err.message : String(err);
      console.warn('[matcher] AI /match call failed, falling back to regex only:', msg);
    }
  }

  const fieldsById = {};
  for (const f of fields) fieldsById[f.id] = f;

  const decisions = {};
  for (const f of fields) {
    if (cached[f.id]) {
      decisions[f.id] = { key: cached[f.id], confidence: 1.0, source: 'cache' };
    } else {
      decisions[f.id] = decideForField(f, regexDecisions[f.id] || null, aiDecisions[f.id] || null);
    }
  }

  dedupe(decisions, fieldsById);

  const mapping = {};
  for (const [id, dec] of Object.entries(decisions)) {
    if (dec && dec.key) mapping[id] = dec.key;
  }

  console.log('[matcher] decisions:', JSON.stringify(
    Object.fromEntries(Object.entries(decisions).map(([id, d]) =>
      [id, d ? `${d.key}@${d.confidence}(${d.source})` : null]))
  ));

  // Persist to cache if enough fields matched (skips single-field login boxes)
  if (hostname && Object.keys(mapping).length >= 3) {
    saveMappingCacheEntry(hostname, mapping, fields, profile);
  }

  return { mapping, decisions };
}
