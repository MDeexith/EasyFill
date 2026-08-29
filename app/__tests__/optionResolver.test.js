import { resolveLocally } from '../src/matcher/optionResolver';

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
