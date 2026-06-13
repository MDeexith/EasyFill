// Dropdown option resolver.
//
// After the matcher decides WHICH profile key a dropdown maps to, this module
// decides WHICH option to select inside that dropdown. It mirrors the option
// matching used in-page by the filler (diacritic/case-insensitive, exact ->
// startsWith -> substring), then falls back to an AI call for options that
// don't textually match the profile value (e.g. "USA" -> "United States").

import { selectOptions } from '../api/backend';

const DROPDOWN_WIDGETS = new Set(['select', 'button-dropdown', 'combobox-input']);

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
  return score;
}

function bestLocalOption(options, rawValue) {
  const target = clean(rawValue);
  if (!target) return null;
  let best = null;
  let bestScore = 0;
  for (const opt of options) {
    const s = scoreOption(opt, target);
    if (s > bestScore) { bestScore = s; best = opt; }
  }
  return best ? (best.label || best.value || '') : null;
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
