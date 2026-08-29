import axios from 'axios';
import { redactSensitive, matchFields, generateText } from '../src/api/backend';

jest.mock('axios');

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

// No committed test asserted that matchFields / generateText actually CALL
// redactSensitive — only that the helper works in isolation. A refactor that
// dropped the call from either wire path would have left every existing test
// green while shipping EEO answers and date of birth to a third-party LLM.
// These assert the REAL axios payload.
describe('the wire payload never carries sensitive values', () => {
  const SENSITIVE = ['gender', 'hispanicLatino', 'veteranStatus', 'disabilityStatus', 'dateOfBirth'];

  const fullProfile = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    gender: 'Female',
    hispanicLatino: 'Yes',
    veteranStatus: 'I am a protected veteran',
    disabilityStatus: 'Yes, I have a disability',
    dateOfBirth: '1815-12-10',
  };

  beforeEach(() => {
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { decisions: {}, text: 'ok', selections: {} } });
  });

  function sentProfile() {
    expect(axios.post).toHaveBeenCalledTimes(1);
    return axios.post.mock.calls[0][1].profile;
  }

  test('/match sends every sensitive key present but EMPTY', async () => {
    await matchFields([{ id: 'af_1', name: 'gender' }], fullProfile);

    const sent = sentProfile();
    for (const key of SENSITIVE) {
      // Key names must survive: /match needs them so the LLM can map a form's
      // "Gender" / "Veteran Status" field to the right profile key.
      expect(Object.prototype.hasOwnProperty.call(sent, key)).toBe(true);
      expect(sent[key]).toBe('');
    }
  });

  test('/match still sends the non-sensitive values it needs', async () => {
    await matchFields([{ id: 'af_1', name: 'email' }], fullProfile);

    const sent = sentProfile();
    expect(sent.firstName).toBe('Ada');
    expect(sent.email).toBe('ada@example.com');
  });

  test('/generate sends every sensitive key present but EMPTY', async () => {
    await generateText({
      profile: fullProfile,
      label: 'Why do you want to work here?',
      placeholder: '',
      nearby: '',
      host: 'boards.greenhouse.io',
    });

    const sent = sentProfile();
    for (const key of SENSITIVE) {
      expect(Object.prototype.hasOwnProperty.call(sent, key)).toBe(true);
      expect(sent[key]).toBe('');
    }
  });

  test('no sensitive VALUE appears anywhere in the serialised /match body', async () => {
    // Belt and braces: catches a value smuggled through under another key,
    // or nested inside `fields`.
    await matchFields(
      [{ id: 'af_1', name: 'gender', label: 'Gender', options: [{ value: 'f', label: 'Female' }] }],
      fullProfile
    );

    const body = JSON.stringify(axios.post.mock.calls[0][1]);
    expect(body).not.toContain('I am a protected veteran');
    expect(body).not.toContain('Yes, I have a disability');
    expect(body).not.toContain('1815-12-10');
  });

  test('no sensitive VALUE appears anywhere in the serialised /generate body', async () => {
    await generateText({
      profile: fullProfile, label: 'Tell us about yourself', placeholder: '', nearby: '', host: 'x',
    });

    const body = JSON.stringify(axios.post.mock.calls[0][1]);
    expect(body).not.toContain('I am a protected veteran');
    expect(body).not.toContain('Yes, I have a disability');
    expect(body).not.toContain('1815-12-10');
  });

  test('the caller\'s own profile object is not mutated by the send', async () => {
    const snapshot = JSON.parse(JSON.stringify(fullProfile));
    await matchFields([{ id: 'af_1' }], fullProfile);
    expect(fullProfile).toEqual(snapshot);
  });
});
