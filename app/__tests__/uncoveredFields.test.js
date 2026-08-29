import {
  hasUsableProfileValue,
  selectUncoveredFields,
  filledProfileKeys,
} from '../src/matcher/coverage';

// Pass 2 used to be fed `scanned.filter(f => !fastMapping[f.id])`, so a field
// that regex mapped to an EMPTY profile key was treated as covered: it filled
// nothing and was permanently excluded from the AI pass. These helpers are the
// extracted predicate that fixes it.
describe('hasUsableProfileValue', () => {
  test('a key present but empty is not usable', () => {
    expect(hasUsableProfileValue({ workAuthorization: '' }, 'workAuthorization')).toBe(false);
  });

  test('a key absent from the profile entirely is not usable', () => {
    expect(hasUsableProfileValue({ email: 'a@b.com' }, 'authorizedToWork')).toBe(false);
  });

  test('a whitespace-only value is not usable', () => {
    expect(hasUsableProfileValue({ noticePeriod: '   ' }, 'noticePeriod')).toBe(false);
  });

  test('null and undefined values are not usable', () => {
    expect(hasUsableProfileValue({ a: null }, 'a')).toBe(false);
    expect(hasUsableProfileValue({ a: undefined }, 'a')).toBe(false);
  });

  test('a non-empty string is usable', () => {
    expect(hasUsableProfileValue({ authorizedToWork: 'Yes' }, 'authorizedToWork')).toBe(true);
  });

  test('numeric 0 is usable, because the filler fills it', () => {
    // buildFillScript skips only undefined/null/'' — 0 years of experience is
    // a real answer and does get written to the page, so pass 2 must not
    // re-offer the field to the AI.
    expect(hasUsableProfileValue({ yearsExperience: 0 }, 'yearsExperience')).toBe(true);
  });

  test('mirrors the filler\'s expectedSalary -> salary alias fallback', () => {
    expect(hasUsableProfileValue({ expectedSalary: '', salary: '30 LPA' }, 'expectedSalary')).toBe(true);
    expect(hasUsableProfileValue({ expectedSalary: '', salary: '' }, 'expectedSalary')).toBe(false);
  });

  test('an empty array is not usable, a populated one is', () => {
    expect(hasUsableProfileValue({ experience: [] }, 'experience')).toBe(false);
    expect(hasUsableProfileValue({ experience: [{ company: 'Acme' }] }, 'experience')).toBe(true);
  });

  test('a null key or null profile is handled without throwing', () => {
    expect(hasUsableProfileValue(null, 'email')).toBe(false);
    expect(hasUsableProfileValue({ email: 'a@b.com' }, null)).toBe(false);
  });
});

describe('selectUncoveredFields', () => {
  const fields = [
    { id: 'af_1' },   // mapped, has a value  -> covered
    { id: 'af_2' },   // mapped to an empty key -> UNCOVERED
    { id: 'af_3' },   // not mapped at all    -> uncovered
  ];
  const mapping = { af_1: 'email', af_2: 'authorizedToWork' };
  const profile = { email: 'a@b.com', authorizedToWork: '' };

  test('a field mapped to an empty profile key is still uncovered', () => {
    const ids = selectUncoveredFields(fields, mapping, profile).map(f => f.id);
    expect(ids).toContain('af_2');
  });

  test('an unmapped field is uncovered', () => {
    const ids = selectUncoveredFields(fields, mapping, profile).map(f => f.id);
    expect(ids).toContain('af_3');
  });

  test('a field mapped to a key that HAS a value is covered (not re-sent to AI)', () => {
    const ids = selectUncoveredFields(fields, mapping, profile).map(f => f.id);
    expect(ids).not.toContain('af_1');
  });

  test('once the user answers the question, the field becomes covered', () => {
    const answered = { email: 'a@b.com', authorizedToWork: 'Yes' };
    const ids = selectUncoveredFields(fields, mapping, answered).map(f => f.id);
    expect(ids).toEqual(['af_3']);
  });

  test('tolerates a null field list', () => {
    expect(selectUncoveredFields(null, mapping, profile)).toEqual([]);
  });
});

describe('filledProfileKeys (cross-pass dedup)', () => {
  test('only keys the fast pass actually filled are claimed', () => {
    const keys = filledProfileKeys(
      { af_1: 'email', af_2: 'workAuthorization' },
      { email: 'a@b.com', workAuthorization: '' }
    );
    expect(keys.has('email')).toBe(true);
    // The whole point: workAuthorization filled nothing, so it must not block
    // the AI pass from mapping another field onto it.
    expect(keys.has('workAuthorization')).toBe(false);
  });

  test('an empty mapping yields no claimed keys', () => {
    expect(filledProfileKeys({}, { email: 'a@b.com' }).size).toBe(0);
    expect(filledProfileKeys(undefined, {}).size).toBe(0);
  });
});
