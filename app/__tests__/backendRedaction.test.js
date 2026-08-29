import { redactSensitive } from '../src/api/backend';

describe('redactSensitive', () => {
  test('empties every sensitive key that is present', () => {
    const profile = {
      gender: 'Female',
      hispanicLatino: 'Yes',
      veteranStatus: 'I am a protected veteran',
      disabilityStatus: 'Yes, I have a disability',
      dateOfBirth: '1990-01-01',
    };
    const result = redactSensitive(profile);
    // Key-preserving: /match needs the key names present to map a form's
    // "Gender"/"Veteran Status" field, so the keys must survive even though
    // their values are wiped.
    expect('gender' in result).toBe(true);
    expect('hispanicLatino' in result).toBe(true);
    expect('veteranStatus' in result).toBe(true);
    expect('disabilityStatus' in result).toBe(true);
    expect('dateOfBirth' in result).toBe(true);
    expect(result.gender).toBe('');
    expect(result.hispanicLatino).toBe('');
    expect(result.veteranStatus).toBe('');
    expect(result.disabilityStatus).toBe('');
    expect(result.dateOfBirth).toBe('');
  });

  test('leaves non-sensitive keys byte-identical, including nested structures', () => {
    const experience = [{ company: 'Acme', title: 'Engineer' }];
    const profile = {
      firstName: 'Ada',
      email: 'ada@example.com',
      skills: 'JavaScript, Python',
      experience,
      gender: 'Female',
    };
    const result = redactSensitive(profile);
    expect(result.firstName).toBe('Ada');
    expect(result.email).toBe('ada@example.com');
    expect(result.skills).toBe('JavaScript, Python');
    expect(result.experience).toBe(experience); // same reference, untouched
  });

  test('does not mutate the input object', () => {
    const profile = { gender: 'Female', firstName: 'Ada' };
    const snapshot = { ...profile };
    redactSensitive(profile);
    expect(profile).toEqual(snapshot);
  });

  test('tolerates null and undefined without throwing', () => {
    expect(() => redactSensitive(null)).not.toThrow();
    expect(() => redactSensitive(undefined)).not.toThrow();
    expect(redactSensitive(null)).toBeFalsy();
    expect(redactSensitive(undefined)).toBeFalsy();
  });

  test('a profile missing the sensitive keys entirely is handled without adding them', () => {
    const profile = { firstName: 'Ada', email: 'ada@example.com' };
    const result = redactSensitive(profile);
    expect(result).toEqual({ firstName: 'Ada', email: 'ada@example.com' });
    expect('gender' in result).toBe(false);
    expect('hispanicLatino' in result).toBe(false);
    expect('veteranStatus' in result).toBe(false);
    expect('disabilityStatus' in result).toBe(false);
    expect('dateOfBirth' in result).toBe(false);
  });
});
