import { EMPTY_PROFILE } from './schema.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function get(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function remove(key) {
  await chrome.storage.local.remove(key);
}

// ─── Profile ────────────────────────────────────────────────────────────────

export async function saveProfile(profile) {
  await set('profile', profile);
}

export async function loadProfile() {
  const p = await get('profile');
  return p ?? { ...EMPTY_PROFILE };
}

export async function clearProfile() {
  await remove('profile');
}

// ─── Onboarding ─────────────────────────────────────────────────────────────

export async function isOnboarded() {
  return !!(await get('onboarded'));
}

export async function setOnboarded(v) {
  await set('onboarded', !!v);
}

// ─── Application history ─────────────────────────────────────────────────────

export async function loadHistory() {
  return (await get('job_history')) ?? [];
}

export async function addHistoryEntry(entry) {
  const list = await loadHistory();
  list.unshift({ id: String(Date.now()), appliedAt: Date.now(), status: 'submitted', ...entry });
  await set('job_history', list.slice(0, 50));
}

// ─── Per-site mapping cache ──────────────────────────────────────────────────
// Identical logic to store.js — only the I/O calls are async.

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

export async function getCachedMapping(hostname, fields, profile) {
  const cache = (await get('mapping_cache')) ?? {};
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

export async function saveMappingCacheEntry(hostname, mapping, fields, profile) {
  const cache = (await get('mapping_cache')) ?? {};
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
  await set('mapping_cache', cache);
}

export async function clearMappingCache() {
  await remove('mapping_cache');
}

// ─── Field corrections ───────────────────────────────────────────────────────

export async function loadFieldCorrections() {
  return (await get('field_corrections')) ?? {};
}

export async function mergeFieldCorrections(entries) {
  const existing = await loadFieldCorrections();
  await set('field_corrections', { ...existing, ...entries });
}

export async function clearFieldCorrections() {
  await remove('field_corrections');
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getBackendUrl() {
  return (await get('backend_url')) ?? 'https://easyfill.onrender.com';
}

export async function setBackendUrl(url) {
  await set('backend_url', url.replace(/\/$/, ''));
}

export async function getAiEnabled() {
  const v = await get('ai_enabled');
  return v === null ? true : !!v;
}

export async function setAiEnabled(v) {
  await set('ai_enabled', !!v);
}
