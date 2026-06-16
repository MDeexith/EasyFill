import { applyHeuristics, scoreField } from './heuristics.js';
import { llmMatch } from './llmClient.js';
import { getCachedMapping, saveMappingCacheEntry } from '../storage.js';

const AI_THRESHOLD = 0.6;
const AI_DEFAULT_CONFIDENCE = 0.7;

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
  if (regexDecision && (regexDecision.source === 'autocomplete' || regexDecision.source === 'type')) {
    return regexDecision;
  }
  if (aiDecision && aiDecision.confidence >= AI_THRESHOLD) return aiDecision;
  if (regexDecision) return regexDecision;
  if (aiDecision) return { ...aiDecision, source: 'ai-low' };
  return null;
}

function dedupe(decisions, fieldsById) {
  const byKey = {};
  for (const [fieldId, dec] of Object.entries(decisions)) {
    if (!dec || !dec.key || !SINGLETON_KEYS.has(dec.key)) continue;
    if (!byKey[dec.key]) byKey[dec.key] = [];
    byKey[dec.key].push({ fieldId, decision: dec });
  }
  for (const [key, claimants] of Object.entries(byKey)) {
    if (claimants.length < 2) continue;
    claimants.sort((a, b) => b.decision.confidence - a.decision.confidence);
    for (let i = 1; i < claimants.length; i++) {
      const { fieldId } = claimants[i];
      const field = fieldsById[fieldId];
      if (!field) { decisions[fieldId] = null; continue; }
      const next = scoreField(field);
      decisions[fieldId] = (next && next.key !== key) ? next : null;
    }
  }
}

// Identical logic to the mobile version; storage calls are now awaited.
export async function matchFieldsToProfile(fields, profile, useLlmFallback = true, hostname = null) {
  const cached = hostname ? ((await getCachedMapping(hostname, fields, profile)) || {}) : {};
  const cachedCount = Object.keys(cached).length;
  const uncoveredFields = fields.filter(f => !cached[f.id]);

  const { decisions: regexDecisions } = applyHeuristics(uncoveredFields);

  let aiDecisions = {};
  if (useLlmFallback && uncoveredFields.length > 0) {
    try {
      const raw = await llmMatch(uncoveredFields, profile);
      aiDecisions = normaliseAi(raw);
    } catch (err) {
      console.warn('[EasyFill matcher] LLM call failed, using regex only:', err?.message ?? err);
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

  if (hostname && Object.keys(mapping).length >= 3) {
    await saveMappingCacheEntry(hostname, mapping, fields, profile);
  }

  return { mapping, decisions };
}
