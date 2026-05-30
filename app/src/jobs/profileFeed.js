import { enrichProfile } from '../profile/enrich';

const SENIORITY_PREFIX_RE = /^(senior|sr\.?|junior|jr\.?|lead|staff|principal|associate|entry[\s-]?level|mid[\s-]?level)\s+/i;

export function stripSeniorityPrefix(title) {
  let t = (title || '').trim();
  let prev;
  do {
    prev = t;
    t = t.replace(SENIORITY_PREFIX_RE, '').trim();
  } while (t !== prev && t.length > 0);
  return t;
}

/** Primary profile search: current job title only (no skills). */
export function buildProfileSearchQuery(rawProfile) {
  const title = enrichProfile(rawProfile).currentTitle?.trim();
  return title || null;
}

/**
 * Ordered search attempts for profile-based feed: full title, without seniority prefix, last two words.
 * @returns {string[]}
 */
export function buildProfileSearchAttempts(rawProfile) {
  const title = buildProfileSearchQuery(rawProfile);
  if (!title) return [];

  const attempts = [title];
  const stripped = stripSeniorityPrefix(title);
  if (stripped && stripped !== title) attempts.push(stripped);

  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length > 2) {
    attempts.push(words.slice(-2).join(' '));
  }

  const seen = new Set();
  return attempts.filter(q => {
    const key = q.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
