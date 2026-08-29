import { EMPTY_PROFILE, PROFILE_FIELD_LABELS, mergeWithSchema } from '../src/profile/schema';

describe('profile schema', () => {
  const NEW_KEYS = [
    'authorizedToWork',
    'requiresSponsorship',
    'hispanicLatino',
    'veteranStatus',
    'disabilityStatus',
    'heardAboutUs',
  ];

  test('defines every new application key', () => {
    for (const key of NEW_KEYS) {
      expect(EMPTY_PROFILE).toHaveProperty(key, '');
    }
  });

  test('gives every new key a human label', () => {
    for (const key of NEW_KEYS) {
      expect(typeof PROFILE_FIELD_LABELS[key]).toBe('string');
      expect(PROFILE_FIELD_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  test('keeps pre-existing keys intact', () => {
    expect(EMPTY_PROFILE).toHaveProperty('gender', '');
    expect(EMPTY_PROFILE).toHaveProperty('willingToRelocate', '');
    expect(EMPTY_PROFILE).toHaveProperty('noticePeriod', '');
  });
});

describe('mergeWithSchema', () => {
  test('fills keys missing from an older stored profile', () => {
    const stored = { firstName: 'Deexith', email: 'a@b.com' };
    const merged = mergeWithSchema(stored);
    expect(merged.firstName).toBe('Deexith');
    expect(merged.requiresSponsorship).toBe('');
    expect(merged.disabilityStatus).toBe('');
  });

  test('never overwrites a stored value with an empty default', () => {
    const merged = mergeWithSchema({ noticePeriod: '30 days' });
    expect(merged.noticePeriod).toBe('30 days');
  });

  test('preserves array fields', () => {
    const merged = mergeWithSchema({ experience: [{ company: 'Media.net' }] });
    expect(merged.experience).toHaveLength(1);
    expect(merged.education).toEqual([]);
  });

  test('tolerates null and undefined', () => {
    expect(mergeWithSchema(null).firstName).toBe('');
    expect(mergeWithSchema(undefined).email).toBe('');
  });
});
