import { applyHeuristics } from '../src/matcher/heuristics';

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
