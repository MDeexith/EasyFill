import { applyHeuristics, matchingRuleKeys } from '../src/matcher/heuristics';

function field(overrides) {
  return { id: overrides.id || 'f1', ...overrides };
}

describe('applyHeuristics', () => {
  test('maps email field by name', () => {
    const { mapping } = applyHeuristics([field({ id: 'f1', name: 'email' })]);
    expect(mapping['f1']).toBe('email');
  });

  test('maps first name by label', () => {
    const { mapping } = applyHeuristics([field({ id: 'f2', label: 'First Name' })]);
    expect(mapping['f2']).toBe('firstName');
  });

  test('maps last name by placeholder', () => {
    const { mapping } = applyHeuristics([field({ id: 'f3', placeholder: 'Last name' })]);
    expect(mapping['f3']).toBe('lastName');
  });

  test('maps phone by ariaLabel', () => {
    const { mapping } = applyHeuristics([field({ id: 'f4', ariaLabel: 'Mobile number' })]);
    expect(mapping['f4']).toBe('phone');
  });

  test('maps LinkedIn URL by label', () => {
    const { mapping } = applyHeuristics([field({ id: 'f5', label: 'LinkedIn Profile' })]);
    expect(mapping['f5']).toBe('linkedIn');
  });

  test('maps cover letter by label', () => {
    const { mapping } = applyHeuristics([field({ id: 'f6', label: 'Cover Letter' })]);
    expect(mapping['f6']).toBe('coverLetter');
  });

  test('maps city by name', () => {
    const { mapping } = applyHeuristics([field({ id: 'f7', name: 'city' })]);
    expect(mapping['f7']).toBe('city');
  });

  test('unmatched fields go to unmatched list with null mapping', () => {
    const { mapping, unmatched } = applyHeuristics([field({ id: 'f8', name: 'mystery_field_xyz' })]);
    expect(mapping['f8']).toBeNull();
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].id).toBe('f8');
  });

  test('maps multiple fields in one pass', () => {
    const fields = [
      field({ id: 'a', name: 'fname', label: 'First Name' }),
      field({ id: 'b', name: 'lname', label: 'Surname' }),
      field({ id: 'c', name: 'email_address', label: 'Email address' }),
    ];
    const { mapping } = applyHeuristics(fields);
    expect(mapping['a']).toBe('firstName');
    expect(mapping['b']).toBe('lastName');
    expect(mapping['c']).toBe('email');
  });

  test('maps zip code variants', () => {
    const { mapping: m1 } = applyHeuristics([field({ id: 'z1', label: 'ZIP Code' })]);
    const { mapping: m2 } = applyHeuristics([field({ id: 'z2', label: 'Postal Code' })]);
    expect(m1['z1']).toBe('zipCode');
    expect(m2['z2']).toBe('zipCode');
  });

  test('maps skills field', () => {
    const { mapping } = applyHeuristics([field({ id: 's1', label: 'Technical Skills' })]);
    expect(mapping['s1']).toBe('skills');
  });
});

// Regression: the branch exists to answer the two questions a résumé cannot.
// Before this fix both were swallowed by `workAuthorization` — a profile key
// nothing populates — which also excluded them from the AI pass.
describe('application-question keys (the branch\'s headline capability)', () => {
  test('Greenhouse\'s "legally authorized to work" question maps to authorizedToWork', () => {
    const { mapping } = applyHeuristics([
      field({ id: 'q1', label: 'Are you legally authorized to work in the United States?' }),
    ]);
    expect(mapping['q1']).toBe('authorizedToWork');
  });

  test('"Authorized to work in" (short form) maps to authorizedToWork', () => {
    const { mapping } = applyHeuristics([
      field({ id: 'q2', label: 'Authorized to work in Canada' }),
    ]);
    expect(mapping['q2']).toBe('authorizedToWork');
  });

  test('"Do you require sponsorship?" maps to requiresSponsorship', () => {
    const { mapping } = applyHeuristics([
      field({ id: 'q3', label: 'Do you require sponsorship?' }),
    ]);
    expect(mapping['q3']).toBe('requiresSponsorship');
  });

  test('"Do you need visa sponsorship?" maps to requiresSponsorship', () => {
    const { mapping } = applyHeuristics([
      field({ id: 'q4', label: 'Do you need visa sponsorship?' }),
    ]);
    expect(mapping['q4']).toBe('requiresSponsorship');
  });

  test('the "now or in the future ... immigration sponsorship" phrasing maps to requiresSponsorship', () => {
    const { mapping } = applyHeuristics([
      field({
        id: 'q5',
        label: 'Will you now or in the future require immigration sponsorship for employment?',
      }),
    ]);
    expect(mapping['q5']).toBe('requiresSponsorship');
  });

  test('workAuthorization still owns genuine status questions', () => {
    const { mapping: m1 } = applyHeuristics([field({ id: 'w1', label: 'Work Authorization' })]);
    const { mapping: m2 } = applyHeuristics([field({ id: 'w2', label: 'What is your visa status?' })]);
    const { mapping: m3 } = applyHeuristics([field({ id: 'w3', label: 'Right to work' })]);
    expect(m1['w1']).toBe('workAuthorization');
    expect(m2['w2']).toBe('workAuthorization');
    expect(m3['w3']).toBe('workAuthorization');
  });

  test('workAuthorization no longer claims the sponsorship / authorized-to-work questions', () => {
    const { mapping } = applyHeuristics([
      field({ id: 'a', label: 'Are you legally authorized to work in the United States?' }),
      field({ id: 'b', label: 'Do you now or in the future require sponsorship?' }),
    ]);
    expect(mapping['a']).not.toBe('workAuthorization');
    expect(mapping['b']).not.toBe('workAuthorization');
  });

  test('the combined "sponsorship for employment visa status" phrasing prefers requiresSponsorship', () => {
    // Both rules match this Greenhouse classic; rule order must break the tie
    // toward the key the user can actually answer.
    const { mapping } = applyHeuristics([
      field({
        id: 'c1',
        label: 'Do you now or in the future require sponsorship for employment visa status?',
      }),
    ]);
    expect(mapping['c1']).toBe('requiresSponsorship');
  });
});

// `applyHeuristics` only reports the winner, and the new rules are ordered
// ahead of `workAuthorization`, so they'd win the tie even if the old
// over-broad pattern were still in place. These assert on the raw claim set
// so the narrowing itself is pinned, not just the ordering.
describe('workAuthorization pattern narrowing (rule-level)', () => {
  test('it does not claim the legally-authorized-to-work question at all', () => {
    const keys = matchingRuleKeys('Are you legally authorized to work in the United States?');
    expect(keys).toContain('authorizedToWork');
    expect(keys).not.toContain('workAuthorization');
  });

  test('it does not claim a bare sponsorship question at all', () => {
    const keys = matchingRuleKeys('Do you now or in the future require sponsorship?');
    expect(keys).toContain('requiresSponsorship');
    expect(keys).not.toContain('workAuthorization');
  });

  test('it still claims genuine status questions', () => {
    expect(matchingRuleKeys('Work Authorization Status')).toContain('workAuthorization');
    expect(matchingRuleKeys('Visa status')).toContain('workAuthorization');
  });

  test('authorizedToWork and requiresSponsorship stay ordered before workAuthorization', () => {
    // The tie-break in bestRegexMatch keeps the FIRST matching rule, so this
    // ordering is load-bearing for the combined phrasings.
    const keys = matchingRuleKeys(
      'Do you now or in the future require sponsorship for employment visa status?'
    );
    expect(keys.indexOf('requiresSponsorship')).toBeLessThan(keys.indexOf('workAuthorization'));
  });
});
