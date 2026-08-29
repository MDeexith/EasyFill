// Dropdown option resolver.
//
// After the matcher decides WHICH profile key a dropdown maps to, this module
// decides WHICH option to select inside that dropdown. It mirrors the option
// matching used in-page by the filler (diacritic/case-insensitive, exact ->
// startsWith -> substring), then falls back to an AI call for options that
// don't textually match the profile value (e.g. "USA" -> "United States").

import { selectOptions, SENSITIVE_PROFILE_KEYS } from '../api/backend';

const SENSITIVE_KEY_SET = new Set(SENSITIVE_PROFILE_KEYS);

// Single source of truth for which scanned-field widgets count as a
// dropdown. Exported so BrowserScreen's pre-harvest widget filter (fields
// don't have `options` populated yet, so `isDropdown` itself can't be used
// there) stays in sync with this module instead of hand-copying the list.
export const DROPDOWN_WIDGET_NAMES = ['select', 'button-dropdown', 'combobox-input'];

const DROPDOWN_WIDGETS = new Set(DROPDOWN_WIDGET_NAMES);

function isDropdown(field) {
  return !!field && DROPDOWN_WIDGETS.has(field.widget) &&
    Array.isArray(field.options) && field.options.length > 0;
}

// Resolve a profile value for a mapped key, mirroring the filler's
// deprecated-alias fallback (expectedSalary -> salary).
function valueFor(profile, key) {
  let val = profile[key];
  if ((val === undefined || val === null || val === '') && key === 'expectedSalary') {
    val = profile.salary;
  }
  if (val === undefined || val === null) return '';
  return String(val);
}

function clean(t) {
  return (t || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .trim();
}

// Labels that prompt rather than answer. Never a valid selection.
const PLACEHOLDER_RE = /^(?:select|choose|please select|none|-+|—)?\s*[.…]*$/i;

// Only aliases that actually collide in practice; not a country database.
const COUNTRY_ALIASES = {
  usa: 'united states', us: 'united states', america: 'united states',
  uk: 'united kingdom', britain: 'united kingdom', 'great britain': 'united kingdom',
  uae: 'united arab emirates',
};

const DECLINE_RE =
  /\b(?:decline|prefer not|do not wish|don't wish|not to answer|choose not|rather not)\b/i;

// Parses "1-3 years", "5+ years", "Less than 1", "10 or more" into a range.
// Returns null when the label is not a numeric bucket.
function parseBucket(label) {
  const s = (label || '').toString().toLowerCase();

  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?)/);
  if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]) };

  m = s.match(/(\d+(?:\.\d+)?)\s*(?:\+|or more|or above|and above)/) ||
      s.match(/(?:more than|over|at least)\s*(\d+(?:\.\d+)?)/);
  if (m) return { min: parseFloat(m[1]), max: Infinity };

  m = s.match(/(?:less than|under|fewer than)\s*(\d+(?:\.\d+)?)/);
  if (m) return { min: 0, max: parseFloat(m[1]) };

  return null;
}

// Score one option against the target value. Returns 0 when no match.
function scoreOption(opt, target) {
  const lab = clean(opt.label);
  const val = clean(opt.value);
  let score = 0;
  if (lab && lab === target) score = Math.max(score, 5);
  if (val && val === target) score = Math.max(score, 5);
  if (lab && lab.indexOf(target) === 0) score = Math.max(score, 4);
  if (val && val.indexOf(target) === 0) score = Math.max(score, 4);
  if (target.length >= 2 && lab && lab.indexOf(target) !== -1) score = Math.max(score, 3);
  if (target.length >= 2 && val && val.indexOf(target) !== -1) score = Math.max(score, 3);
  if (target.length >= 2 && lab && target.indexOf(lab) !== -1) score = Math.max(score, 2);
  // Common boolean-style mappings (work authorization, relocation, etc.)
  if (/^(yes|true|1|y)$/.test(target) && /^(yes|i (am|do)|authorized|true)/.test(lab)) score = Math.max(score, 4);
  if (/^(no|false|0|n)$/.test(target) && /^(no|i (am not|do not)|not authorized|false)/.test(lab)) score = Math.max(score, 4);
  // Country aliases, so a profile saying "USA" finds "United States".
  const aliased = COUNTRY_ALIASES[target];
  if (aliased && lab === aliased) score = Math.max(score, 5);

  // Decline intent, matched to whatever wording this particular form uses.
  if (DECLINE_RE.test(target) && DECLINE_RE.test(lab)) score = Math.max(score, 5);
  return score;
}

function bestLocalOption(options, rawValue) {
  const target = clean(rawValue);
  if (!target) return null;

  // A placeholder is never an answer, in either direction.
  const usable = options.filter(o => !PLACEHOLDER_RE.test((o.label || '').trim()));
  if (usable.length === 0) return null;
  if (PLACEHOLDER_RE.test(String(rawValue).trim())) return null;

  let best = null;
  let bestScore = 0;
  for (const opt of usable) {
    const s = scoreOption(opt, target);
    if (s > bestScore) { bestScore = s; best = opt; }
  }
  if (best) return best.label || best.value || '';

  // No textual match: a numeric value may still belong to a range bucket,
  // e.g. yearsExperience 1.7 into "1-3 years".
  const num = parseFloat(target);
  if (!Number.isNaN(num) && /^[\d.]+$/.test(target)) {
    for (const opt of usable) {
      const bucket = parseBucket(opt.label);
      if (bucket && num >= bucket.min && num <= bucket.max) {
        return opt.label || opt.value || '';
      }
    }
  }

  return null;
}

// Local pass: returns { selections, unresolved } where selections maps fieldId
// to the chosen option text and unresolved lists dropdown fields that need AI.
export function resolveLocally(fields, mapping, profile) {
  const selections = {};
  const unresolved = [];
  for (const field of fields) {
    if (!isDropdown(field)) continue;
    const key = mapping[field.id];
    if (!key) continue;
    const rawValue = valueFor(profile, key);
    if (!rawValue) continue;
    const hit = bestLocalOption(field.options, rawValue);
    if (hit) selections[field.id] = hit;
    else unresolved.push(field);
  }
  return { selections, unresolved };
}

// AI pass: batch the unresolved dropdowns into a single /select-option call.
export async function resolveWithAi(unresolved, mapping, profile) {
  if (!unresolved || unresolved.length === 0) return {};
  const items = [];
  for (const field of unresolved) {
    const key = mapping[field.id];
    if (!key) continue;
    // Unlike /match, /select-option genuinely needs the raw value (it asks
    // the model which option corresponds to it), so redaction would make the
    // call useless rather than private. The only safe fix is to never send
    // these keys' values at all — an unresolved EEO dropdown is left for the
    // user to pick by hand rather than escalated to a third-party LLM.
    if (SENSITIVE_KEY_SET.has(key)) continue;
    const rawValue = valueFor(profile, key);
    if (!rawValue) continue;
    items.push({
      fieldId: field.id,
      label: field.label || field.ariaLabel || field.nearbyText || field.name || '',
      profileKey: key,
      profileValue: rawValue,
      options: (field.options || []).map(o => ({ value: o.value || '', label: o.label || '' })),
    });
  }
  if (items.length === 0) return {};
  try {
    return await selectOptions(items);
  } catch {
    return {};
  }
}
