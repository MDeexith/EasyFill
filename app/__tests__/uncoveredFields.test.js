import {
  hasUsableProfileValue,
  selectUncoveredFields,
  filledProfileKeys,
  mappedFilledIds,
  collectFilledAfIds,
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

// Regression guard for the fix wave itself.
//
// `filledAfIds` is what buildCorrectionListenerScript is handed, and it drives
// `wasAutoFilled`. BrowserScreen DISCARDS a USER_INPUT_DETECTED whose
// wasAutoFilled is true. So an id declared filled that was never actually
// written silently throws away the answer the user typed by hand.
//
// The fast-pass half was filtered by hasUsableProfileValue but the AI half was
// not — and selectUncoveredFields deliberately feeds the AI pass fields whose
// mapped key is EMPTY, so safeAiMapping routinely contains never-written ids.
// That landed on exactly the sponsorship / work-authorization questions.
describe('mappedFilledIds', () => {
  test('an id mapped to a key with no usable value is NOT reported as filled', () => {
    // buildFillScript reports this 'no-value' and returns before findEl:
    // nothing is written to the page and no element is stamped.
    expect(mappedFilledIds({ af_5: 'workAuthorization' }, { workAuthorization: '' }))
      .toEqual([]);
  });

  test('an id mapped to a key that DOES have a value is reported as filled', () => {
    expect(mappedFilledIds({ af_1: 'email' }, { email: 'a@b.com' }))
      .toEqual(['af_1']);
  });

  test('filters a mixed mapping down to only the ids actually written', () => {
    const ids = mappedFilledIds(
      { af_1: 'email', af_5: 'workAuthorization', af_6: 'authorizedToWork' },
      { email: 'a@b.com', workAuthorization: '', authorizedToWork: 'Yes' }
    );
    expect(ids.sort()).toEqual(['af_1', 'af_6']);
  });

  test('tolerates a null or empty mapping', () => {
    expect(mappedFilledIds(null, {})).toEqual([]);
    expect(mappedFilledIds({}, { email: 'a@b.com' })).toEqual([]);
  });
});

describe('collectFilledAfIds', () => {
  const profile = { email: 'a@b.com', authorizedToWork: 'Yes', workAuthorization: '' };

  test('the AI half is filtered too, not just the fast half', () => {
    const ids = collectFilledAfIds({
      fastMapping: { af_1: 'email' },
      // af_5 is here precisely BECAUSE selectUncoveredFields treats an
      // empty-key field as uncovered — but the AI mapped it back onto another
      // key the profile also cannot answer, so still nothing was written.
      aiMapping: { af_5: 'workAuthorization', af_6: 'authorizedToWork' },
      profile,
    });

    expect(ids).toContain('af_1');   // fast pass, has a value
    expect(ids).toContain('af_6');   // AI pass, has a value
    expect(ids).not.toContain('af_5'); // AI pass, NO value -> never written
  });

  test('a user correction to an AI-mapped but unfilled field stays learnable', () => {
    // The end-to-end property: af_5 must not be declared auto-filled, or
    // BrowserScreen drops the hand-typed answer at the USER_INPUT_DETECTED
    // handler and the user can never teach the app that question.
    const ids = collectFilledAfIds({
      fastMapping: {},
      aiMapping: { af_5: 'workAuthorization' },
      profile: { workAuthorization: '' },
    });
    expect(ids).toEqual([]);
  });

  test('dropdown-resolution and correction-replay ids are included verbatim', () => {
    // Those passes are already lists of things that WERE written, so they get
    // no mapping filter.
    const ids = collectFilledAfIds({
      fastMapping: {},
      aiMapping: {},
      profile,
      dropdownIds: ['af_7'],
      correctionIds: ['af_8'],
    });
    expect(ids.sort()).toEqual(['af_7', 'af_8']);
  });

  test('deduplicates an id claimed by more than one pass', () => {
    const ids = collectFilledAfIds({
      fastMapping: { af_1: 'email' },
      aiMapping: {},
      profile,
      dropdownIds: ['af_1'],
      correctionIds: ['af_1'],
    });
    expect(ids).toEqual(['af_1']);
  });

  test('defaults the optional id lists', () => {
    expect(collectFilledAfIds({ fastMapping: {}, aiMapping: {}, profile })).toEqual([]);
  });
});
