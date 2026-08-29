jest.mock('../src/api/backend', () => {
  const actual = jest.requireActual('../src/api/backend');
  return { ...actual, selectOptions: jest.fn(() => Promise.resolve({})) };
});

import { resolveLocally, resolveWithAi } from '../src/matcher/optionResolver';
import { selectOptions } from '../src/api/backend';

// resolveLocally takes scanned fields, so build one with options attached.
function dropdown(id, ...labels) {
  return {
    id,
    widget: 'combobox-input',
    options: labels.map((label, i) => ({ value: String(i), label })),
  };
}

function resolveOne(field, key, profile) {
  const { selections, unresolved } = resolveLocally([field], { [field.id]: key }, profile);
  return { hit: selections[field.id], missed: unresolved.length > 0 };
}

describe('resolveLocally — existing behaviour still works', () => {
  test('matches an exact country label', () => {
    const f = dropdown('af_1', 'Select…', 'India', 'United States');
    expect(resolveOne(f, 'country', { country: 'India' }).hit).toBe('India');
  });

  test('matches yes/no phrasing', () => {
    const f = dropdown('af_2', 'Yes', 'No');
    expect(resolveOne(f, 'authorizedToWork', { authorizedToWork: 'Yes' }).hit).toBe('Yes');
  });
});

describe('resolveLocally — numeric buckets', () => {
  const YEARS = () => dropdown('af_3', 'Select…', '0-1 years', '1-3 years', '3-5 years', '5+ years');

  test('places 1.7 years into the 1-3 bucket', () => {
    expect(resolveOne(YEARS(), 'yearsExperience', { yearsExperience: 1.7 }).hit).toBe('1-3 years');
  });

  test('places 0.5 into the 0-1 bucket', () => {
    expect(resolveOne(YEARS(), 'yearsExperience', { yearsExperience: 0.5 }).hit).toBe('0-1 years');
  });

  test('places 8 into the open-ended 5+ bucket', () => {
    expect(resolveOne(YEARS(), 'yearsExperience', { yearsExperience: 8 }).hit).toBe('5+ years');
  });

  test('places 2.9 into the 1-3 bucket via range matching, not prefix collision', () => {
    // 2.9 is not a prefix of any label, so this can only resolve through
    // parseBucket's range check (unlike a value of 3, which "3-5 years"
    // would also match via the pre-existing lab.indexOf(target) === 0 rule).
    expect(resolveOne(YEARS(), 'yearsExperience', { yearsExperience: 2.9 }).hit).toBe('1-3 years');
  });

  test('resolves "N or more" phrasing for an open-ended bucket', () => {
    const f = dropdown('af_9', 'Select…', '0-5 years', '5-10 years', '10 or more years');
    expect(resolveOne(f, 'yearsExperience', { yearsExperience: 12 }).hit).toBe('10 or more years');
  });
});

describe('resolveLocally — country aliases', () => {
  const C = () => dropdown('af_4', 'Select…', 'India', 'United States', 'United Kingdom');

  test('maps USA to United States', () => {
    expect(resolveOne(C(), 'country', { country: 'USA' }).hit).toBe('United States');
  });

  test('maps UK to United Kingdom', () => {
    expect(resolveOne(C(), 'country', { country: 'UK' }).hit).toBe('United Kingdom');
  });
});

describe('resolveLocally — decline to self-identify', () => {
  const EEO = () => dropdown('af_5', 'Hispanic or Latino', 'Not Hispanic or Latino', 'I do not wish to answer');

  test('matches a decline value to this form\'s wording', () => {
    const p = { hispanicLatino: 'Decline to self-identify' };
    expect(resolveOne(EEO(), 'hispanicLatino', p).hit).toBe('I do not wish to answer');
  });

  test('matches prefer-not-to-say phrasing', () => {
    const p = { hispanicLatino: 'prefer not to say' };
    expect(resolveOne(EEO(), 'hispanicLatino', p).hit).toBe('I do not wish to answer');
  });
});

describe('resolveLocally — placeholders and misses', () => {
  test('never selects the placeholder option', () => {
    const f = dropdown('af_6', 'Select…', 'India', 'United States');
    const { hit } = resolveOne(f, 'country', { country: 'Select' });
    expect(hit).toBeUndefined();
  });

  test('queues an unmatched value for the LLM', () => {
    const f = dropdown('af_7', 'LinkedIn', 'A friend', 'Careers page');
    const { hit, missed } = resolveOne(f, 'heardAboutUs', { heardAboutUs: 'Hacker News' });
    expect(hit).toBeUndefined();
    expect(missed).toBe(true);
  });

  test('skips a field whose profile value is empty', () => {
    const f = dropdown('af_8', 'LinkedIn', 'A friend');
    const { selections, unresolved } = resolveLocally([f], { af_8: 'heardAboutUs' }, { heardAboutUs: '' });
    expect(selections).toEqual({});
    expect(unresolved).toEqual([]);
  });
});

describe('resolveWithAi — sensitive keys never reach the AI resolver', () => {
  beforeEach(() => {
    selectOptions.mockClear();
  });

  const SENSITIVE_KEYS = ['gender', 'hispanicLatino', 'veteranStatus', 'disabilityStatus', 'dateOfBirth'];

  test.each(SENSITIVE_KEYS)('excludes a field mapped to %s from the /select-option payload', async key => {
    // Paired with a resolvable non-sensitive field so the batch still makes
    // a network call — otherwise items.length === 0 short-circuits before
    // any call happens, which would make this assertion vacuous.
    const sensitive = dropdown('af_10', 'Option A', 'Option B');
    const companion = dropdown('af_10b', 'India', 'United States');
    await resolveWithAi(
      [sensitive, companion],
      { [sensitive.id]: key, [companion.id]: 'country' },
      { [key]: 'Some real answer', country: 'Some unmatched value' },
    );
    expect(selectOptions).toHaveBeenCalledTimes(1);
    const [items] = selectOptions.mock.calls[0];
    expect(items.find(it => it.fieldId === sensitive.id)).toBeUndefined();
    expect(items.find(it => it.fieldId === companion.id)).toBeDefined();
  });

  test('a sensitive key with no other resolvable fields makes selectOptions a no-op call', async () => {
    const f = dropdown('af_11', 'Option A', 'Option B');
    const result = await resolveWithAi([f], { [f.id]: 'gender' }, { gender: 'Female' });
    expect(result).toEqual({});
    // items.length === 0 short-circuits before the network call entirely.
    expect(selectOptions).not.toHaveBeenCalled();
  });

  test('still includes a non-sensitive key of the same shape (country)', async () => {
    const f = dropdown('af_12', 'India', 'United States');
    await resolveWithAi([f], { [f.id]: 'country' }, { country: 'Some unmatched value' });
    expect(selectOptions).toHaveBeenCalledTimes(1);
    const [items] = selectOptions.mock.calls[0];
    const item = items.find(it => it.fieldId === f.id);
    expect(item).toBeDefined();
    expect(item.profileKey).toBe('country');
    expect(item.profileValue).toBe('Some unmatched value');
  });

  test('a mixed batch keeps only the non-sensitive item', async () => {
    const sensitive = dropdown('af_13', 'Option A', 'Option B');
    const nonSensitive = dropdown('af_14', 'India', 'United States');
    await resolveWithAi(
      [sensitive, nonSensitive],
      { [sensitive.id]: 'veteranStatus', [nonSensitive.id]: 'country' },
      { veteranStatus: 'I am a protected veteran', country: 'Some unmatched value' },
    );
    expect(selectOptions).toHaveBeenCalledTimes(1);
    const [items] = selectOptions.mock.calls[0];
    expect(items).toHaveLength(1);
    expect(items[0].fieldId).toBe(nonSensitive.id);
  });
});
