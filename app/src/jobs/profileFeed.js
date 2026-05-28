import { enrichProfile } from '../profile/enrich';

export function buildProfileSearchQuery(rawProfile) {
  const p = enrichProfile(rawProfile);
  const parts = [];
  if (p.currentTitle?.trim()) parts.push(p.currentTitle.trim());
  if (p.skills?.trim()) {
    p.skills.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5).forEach(s => parts.push(s));
  }
  const query = parts.join(' ').trim();
  return query || null;
}
