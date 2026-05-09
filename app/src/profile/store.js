import { createMMKV } from 'react-native-mmkv';
import { EMPTY_PROFILE } from './schema';

const storage = createMMKV({ id: 'jobautofill-profile' });
const PROFILE_KEY = 'profile';

export function saveProfile(profile) {
  storage.set(PROFILE_KEY, JSON.stringify(profile));
}

export function loadProfile() {
  const raw = storage.getString(PROFILE_KEY);
  if (!raw) return { ...EMPTY_PROFILE };
  try {
    return JSON.parse(raw);
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function clearProfile() {
  storage.remove(PROFILE_KEY);
}

const HISTORY_KEY = 'job_history';

export function saveHistory(entries) {
  storage.set(HISTORY_KEY, JSON.stringify(entries));
}

export function loadHistory() {
  const raw = storage.getString(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function addHistoryEntry(entry) {
  const list = loadHistory();
  list.unshift({
    id: String(Date.now()),
    appliedAt: Date.now(),
    status: 'submitted',
    ...entry,
  });
  saveHistory(list.slice(0, 50));
}

export function updateHistoryEntry(id, patch) {
  const list = loadHistory().map(e => (e.id === id ? { ...e, ...patch } : e));
  saveHistory(list);
}

export function deleteHistoryEntry(id) {
  saveHistory(loadHistory().filter(e => e.id !== id));
}

// ─── Scraped Jobs (legacy — kept for backward compat) ──────────────
const JOBS_KEY = 'scraped_jobs';

export function saveJobs(jobs) {
  storage.set(JOBS_KEY, JSON.stringify(jobs));
}

export function loadJobs() {
  const raw = storage.getString(JOBS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function addJobs(newJobs) {
  const existing = loadJobs();
  const byId = {};
  existing.forEach(j => { byId[j.id] = j; });
  newJobs.forEach(j => {
    byId[j.id] = { ...j, scrapedAt: j.scrapedAt || Date.now() };
  });
  const merged = Object.values(byId)
    .sort((a, b) => (b.scrapedAt || 0) - (a.scrapedAt || 0))
    .slice(0, 200);
  saveJobs(merged);
  return merged;
}

export function clearJobs() {
  storage.remove(JOBS_KEY);
}

// ─── API Feed Jobs (from official APIs) ────────────────────────────
const FEED_KEY = 'api_feed_jobs';
const FEED_TS_KEY = 'api_feed_ts';

export function saveFeedJobs(jobs) {
  storage.set(FEED_KEY, JSON.stringify(jobs));
  storage.set(FEED_TS_KEY, String(Date.now()));
}

export function loadFeedJobs() {
  const raw = storage.getString(FEED_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function getFeedAge() {
  const ts = storage.getString(FEED_TS_KEY);
  if (!ts) return Infinity;
  return Date.now() - parseInt(ts, 10);
}

export function clearFeedJobs() {
  storage.remove(FEED_KEY);
  storage.remove(FEED_TS_KEY);
}

const ONBOARDED_KEY = 'onboarded';
export function isOnboarded() {
  return !!storage.getBoolean(ONBOARDED_KEY);
}
export function setOnboarded(v) {
  storage.set(ONBOARDED_KEY, !!v);
}

// ─── Per-site mapping cache ─────────────────────────────────────────
// Stores hostname → { version, savedAt, profileHash, mapping: { fingerprint: profileKey } }
// Fingerprint: `${field.name}|${field.label}|${field.type}|${field.autocomplete}`
// (stable across page loads, unlike af_N synthetic ids)

const MAPPING_CACHE_KEY = 'mapping_cache';
const MAPPING_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAPPING_CACHE_MAX_HOSTS = 100;

function djb2Hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16);
}

function profileHashStr(profile) {
  const str = Object.keys(profile).sort()
    .map(k => k + '=' + (profile[k] || ''))
    .join('&');
  return djb2Hash(str);
}

function fieldFingerprint(f) {
  return [f.name || '', f.label || '', f.type || '', f.autocomplete || ''].join('|');
}

function loadMappingCacheRaw() {
  const raw = storage.getString(MAPPING_CACHE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function getCachedMapping(hostname, fields, profile) {
  const cache = loadMappingCacheRaw();
  const entry = cache[hostname];
  if (!entry) return null;
  if (Date.now() - entry.savedAt > MAPPING_CACHE_MAX_AGE_MS) return null;
  if (entry.profileHash !== profileHashStr(profile)) return null;
  const result = {};
  for (const f of fields) {
    const fp = fieldFingerprint(f);
    if (entry.mapping[fp]) result[f.id] = entry.mapping[fp];
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function saveMappingCacheEntry(hostname, mapping, fields, profile) {
  const cache = loadMappingCacheRaw();
  const fpById = {};
  for (const f of fields) fpById[f.id] = fieldFingerprint(f);
  const fpMapping = {};
  for (const [fieldId, profileKey] of Object.entries(mapping)) {
    if (!profileKey) continue;
    const fp = fpById[fieldId];
    if (fp) fpMapping[fp] = profileKey;
  }
  cache[hostname] = { version: 1, savedAt: Date.now(), profileHash: profileHashStr(profile), mapping: fpMapping };
  const hosts = Object.keys(cache).sort((a, b) => cache[a].savedAt - cache[b].savedAt);
  while (hosts.length > MAPPING_CACHE_MAX_HOSTS) delete cache[hosts.shift()];
  storage.set(MAPPING_CACHE_KEY, JSON.stringify(cache));
}

export function clearMappingCache() {
  storage.remove(MAPPING_CACHE_KEY);
}

// ─── Field corrections (autofill memory) ───────────────────────────
// Stores fingerprint → direct value for fields autofill couldn't map.
// Applied automatically on future fills before profile-based matching.

const CORRECTIONS_KEY = 'field_corrections';

export function loadFieldCorrections() {
  const raw = storage.getString(CORRECTIONS_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function mergeFieldCorrections(entries) {
  const existing = loadFieldCorrections();
  storage.set(CORRECTIONS_KEY, JSON.stringify({ ...existing, ...entries }));
}

export function clearFieldCorrections() {
  storage.remove(CORRECTIONS_KEY);
}

