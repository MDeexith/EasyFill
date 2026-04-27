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
