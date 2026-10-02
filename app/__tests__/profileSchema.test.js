import {
  EMPTY_PROFILE,
  PROFILE_FIELD_LABELS,
  PROFILE_EDITOR_SECTIONS,
  mergeWithSchema,
} from '../src/profile/schema';

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

// C2: App.jsx gates ApplicationDetailsScreen behind the onboarding stack,
// which is only entered when isOnboarded() is false. Every existing Play Store
// user is already onboarded, so if a key is not in the Profile editor there is
// no route by which they can ever set it.
describe('PROFILE_EDITOR_SECTIONS', () => {
  const NEW_KEYS = [
    'authorizedToWork',
    'requiresSponsorship',
    'heardAboutUs',
    'gender',
    'hispanicLatino',
    'veteranStatus',
    'disabilityStatus',
  ];
  const allFields = PROFILE_EDITOR_SECTIONS.flatMap(s => s.fields);

  test('exposes every key an already-onboarded user would otherwise never reach', () => {
    for (const key of NEW_KEYS) {
      expect(allFields).toContain(key);
    }
  });

  test('groups the four EEO keys into one clearly-labelled section', () => {
    const eeo = PROFILE_EDITOR_SECTIONS.find(s => /equal opportunity/i.test(s.title));
    expect(eeo).toBeDefined();
    expect(eeo.fields.sort()).toEqual(
      ['disabilityStatus', 'gender', 'hispanicLatino', 'veteranStatus'].sort()
    );
    // The section must say what happens to these values — they are the ones
    // the app is contractually forbidden from sending to the backend.
    expect(eeo.note).toMatch(/device/i);
  });

  test('every editor field is a real profile key', () => {
    for (const key of allFields) {
      expect(Object.prototype.hasOwnProperty.call(EMPTY_PROFILE, key)).toBe(true);
    }
  });

  test('every editor field has a human label', () => {
    for (const key of allFields) {
      expect(typeof PROFILE_FIELD_LABELS[key]).toBe('string');
    }
  });

  test('no key appears in two sections (one input, one source of truth)', () => {
    expect(new Set(allFields).size).toBe(allFields.length);
  });
});
