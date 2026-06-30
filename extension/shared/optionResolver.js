import { selectOptions } from './backend.js';

const RESOLVABLE_WIDGETS = new Set([
  'select', 'button-dropdown', 'combobox-input', 'radio-group', 'checkbox-group',
]);

function isResolvable(field) {
  return !!field &&
    RESOLVABLE_WIDGETS.has(field.widget) &&
    Array.isArray(field.options) && field.options.length > 0;
}

function valueFor(profile, key) {
  let val = profile[key];
  if ((val === undefined || val === null || val === '') && key === 'expectedSalary') {
    val = profile.salary;
  }
  return (val === undefined || val === null) ? '' : String(val);
}

function clean(t) {
  return (t || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .trim();
}

function scoreOption(opt, target) {
  const lab = clean(opt.label || '');
  const val = clean(opt.value || '');
  let score = 0;
  if (lab && lab === target) score = Math.max(score, 5);
  if (val && val === target) score = Math.max(score, 5);
  if (lab && lab.startsWith(target)) score = Math.max(score, 4);
  if (val && val.startsWith(target)) score = Math.max(score, 4);
  if (target.length >= 2 && lab && lab.includes(target)) score = Math.max(score, 3);
  if (target.length >= 2 && val && val.includes(target)) score = Math.max(score, 3);
  if (target.length >= 2 && lab && target.includes(lab)) score = Math.max(score, 2);
  if (/^(yes|true|1|y)$/.test(target) && /^(yes|i (am|do)|authorized|true)/.test(lab)) score = Math.max(score, 4);
  if (/^(no|false|0|n)$/.test(target) && /^(no|i (am not|do not)|not authorized|false)/.test(lab)) score = Math.max(score, 4);
  return score;
}

function flatOpts(field) {
  // radio-group options have {afId, value, label}; dropdown options have {value, label}
  return (field.options || []).map(o => ({ value: o.value || '', label: o.label || '' }));
}

function bestLocalOption(options, rawValue) {
  const target = clean(rawValue);
  if (!target) return null;
  let best = null, bestScore = 0;
  for (const opt of options) {
    const s = scoreOption(opt, target);
    if (s > bestScore) { bestScore = s; best = opt; }
  }
  return best ? (best.label || best.value || '') : null;
}

// Local pass: text-match profile values against option labels.
// Returns { selections: {fieldId: optionLabel}, unresolved: Field[] }
export function resolveLocally(fields, mapping, profile) {
  const selections = {};
  const unresolved = [];
  for (const field of fields) {
    if (!isResolvable(field)) continue;
    const key = mapping[field.id];
    if (!key) continue;
    const rawValue = valueFor(profile, key);
    if (!rawValue) continue;
    const hit = bestLocalOption(flatOpts(field), rawValue);
    if (hit) selections[field.id] = hit;
    else unresolved.push(field);
  }
  return { selections, unresolved };
}

// AI pass: send unresolved fields to /select-option.
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
      options: flatOpts(field),
    });
  }
  if (items.length === 0) return {};
  try {
    return await selectOptions(items);
  } catch {
    return {};
  }
}
