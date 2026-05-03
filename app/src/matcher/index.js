import { applyHeuristics, scoreField } from './heuristics';
import { llmMatch } from './llmClient';

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
    claimants.sort((a, b) => b.decision.confidence - a.decision.confidence);
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
export async function matchFieldsToProfile(fields, profile, useLlmFallback = true) {
  const { decisions: regexDecisions } = applyHeuristics(fields);

  let aiDecisions = {};
  if (useLlmFallback) {
    try {
      const raw = await llmMatch(fields, profile);
      aiDecisions = normaliseAi(raw);
    } catch {
      // AI unavailable — regex decisions used as-is
    }
  }

  const fieldsById = {};
  for (const f of fields) fieldsById[f.id] = f;

  const decisions = {};
  for (const f of fields) {
    decisions[f.id] = decideForField(f, regexDecisions[f.id] || null, aiDecisions[f.id] || null);
  }

  dedupe(decisions, fieldsById);

  const mapping = {};
  for (const [id, dec] of Object.entries(decisions)) {
    if (dec && dec.key) mapping[id] = dec.key;
  }

  return { mapping, decisions };
}
