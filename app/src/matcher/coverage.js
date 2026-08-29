// Pass-2 coverage predicates.
//
// Kept in their own module (rather than matcher/index.js) because index.js
// imports profile/store.js, which pulls in the MMKV native module and cannot
// be loaded under Jest. These helpers are pure data logic and are exercised
// directly by __tests__/uncoveredFields.test.js.

// A field is only genuinely "covered" by the fast pass when the profile key it
// was mapped to actually holds something to fill. Several keys exist that the
// résumé parser never populates (workAuthorization is the canonical one, and
// the whole point of the branch's new keys is that a CV cannot answer them).
// Treating a regex hit on such a key as coverage silently starved those fields
// of the AI pass — the mapping filled nothing AND blocked the only other thing
// that could have.
//
// The "usable" test deliberately mirrors buildFillScript's own skip condition
// (undefined / null / '' -> outcome 'no-value'), including its deprecated
// expectedSalary -> salary alias, so `uncovered` means exactly "the filler
// would not have put anything here".
export function hasUsableProfileValue(profile, key) {
  if (!key || !profile) return false;
  let val = profile[key];
  if ((val === undefined || val === null || val === '') && key === 'expectedSalary') {
    val = profile.salary;
  }
  if (val === undefined || val === null) return false;
  if (Array.isArray(val)) return val.length > 0;
  // 0 is a real answer for yearsExperience, and the filler fills it.
  if (typeof val === 'number') return true;
  return String(val).trim() !== '';
}

// Fields the AI pass should still be asked about: unmapped ones, plus ones
// mapped to a key with no usable value.
export function selectUncoveredFields(fields, mapping, profile) {
  return (fields || []).filter(
    f => !mapping[f.id] || !hasUsableProfileValue(profile, mapping[f.id])
  );
}

// Profile keys the fast pass genuinely claimed (i.e. actually filled). Used
// for cross-pass dedup: a key the fast pass mapped but could not fill must
// not block the AI pass from assigning it to a field that can be filled.
export function filledProfileKeys(mapping, profile) {
  const keys = new Set();
  for (const key of Object.values(mapping || {})) {
    if (hasUsableProfileValue(profile, key)) keys.add(key);
  }
  return keys;
}

// Ids a mapping pass ACTUALLY wrote to.
//
// buildFillScript reports a field mapped to a key with no usable value as
// 'no-value' and returns before findEl — nothing is written to the page and no
// element is stamped. Declaring such an id auto-filled makes the correction
// listener report wasAutoFilled: true, and BrowserScreen then DISCARDS the
// answer the user typed by hand.
//
// This matters most for the AI pass: selectUncoveredFields deliberately feeds
// it fields whose mapped key is empty, so its mapping routinely contains ids
// that were never filled — precisely the sponsorship / work-authorization
// questions this branch exists to make fillable.
export function mappedFilledIds(mapping, profile) {
  return Object.keys(mapping || {}).filter(id =>
    hasUsableProfileValue(profile, mapping[id])
  );
}

// The complete set of af-ids one autofill run wrote to, in pass order and
// deduped — what buildCorrectionListenerScript is handed. Both mapping passes
// go through the same usable-value filter; the dropdown-resolution and
// correction-replay passes are already id lists of things that were written.
export function collectFilledAfIds({
  fastMapping,
  aiMapping,
  profile,
  dropdownIds = [],
  correctionIds = [],
}) {
  return [...new Set([
    ...mappedFilledIds(fastMapping, profile),
    ...mappedFilledIds(aiMapping, profile),
    ...dropdownIds,
    ...correctionIds,
  ])];
}
