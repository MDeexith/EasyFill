import { answerKey, isAcknowledgment, remainingQuestions, savedAnswers, answersToRemember } from '../src/profile/applicationAnswers';

const url = 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/one/apply';
const question = { id: 'q', label: 'Are you related to a Workday employee?', widget: 'button-dropdown', type: 'button', visible: true, hasValue: false };

test('remembers an explicit answer for the same question on the same site', () => {
  const memory = answersToRemember([question], { q: 'No' }, { q: 'filled' }, url);
  expect(savedAnswers([{ ...question, id: 'new', name: 'changed-id' }], url.replace('/one/', '/two/'), memory)).toEqual({ new: 'No' });
  expect(savedAnswers([question], 'https://another.wd5.myworkdayjobs.com/en-US/jobs', memory)).toEqual({});
  expect(answerKey(question, 'https://jobs.lever.co/company-a/one')).not.toBe(answerKey(question, 'https://jobs.lever.co/company-b/two'));
});

test('the full question prevents collisions between declarations with the same prefix', () => {
  expect(answerKey({ ...question, question: 'prefix ' + 'x'.repeat(210) + ' employee' }, url))
    .not.toBe(answerKey({ ...question, question: 'prefix ' + 'x'.repeat(210) + ' customer' }, url));
});

test('acknowledgments are filled only for the current application, never remembered', () => {
  const acknowledgment = { ...question, label: 'I acknowledge that my answers are truthful' };
  expect(isAcknowledgment(acknowledgment)).toBe(true);
  expect(answersToRemember([acknowledgment], { q: 'Yes' }, { q: 'filled' }, url)).toEqual({});
  expect(savedAnswers([acknowledgment], url, { [answerKey(acknowledgment, url)]: 'Yes' })).toEqual({});
  expect(isAcknowledgment({ ...question, label: 'I certify that my answers are correct' })).toBe(true);
  expect(isAcknowledgment({ ...question, label: 'Which professional certifications do you hold?' })).toBe(false);
});

test('does not remember failed, blank or unprovided answers', () => {
  expect(answersToRemember([question], { q: 'No' }, { q: 'control-failed' }, url)).toEqual({});
  expect(answersToRemember([question], {}, { q: 'filled' }, url)).toEqual({});
  expect(answersToRemember([question], { q: '  ' }, { q: 'filled' }, url)).toEqual({});
});

test('remembers option labels instead of unstable site-specific option ids', () => {
  const field = { ...question, options: [{ value: 'opaque-id', label: 'No' }] };
  const memory = answersToRemember([field], { q: 'opaque-id' }, { q: 'filled' }, url);
  expect(savedAnswers([question], url, memory)).toEqual({ q: 'No' });
});

test('offers only unanswered visible supported fields and preserves existing values', () => {
  const fields = [question, { ...question, id: 'filled', hasValue: undefined }, { ...question, id: 'typed', hasValue: true },
    { ...question, id: 'hidden', visible: false }, { ...question, id: 'disabled', disabled: true },
    { ...question, id: 'password', widget: 'text', type: 'password' }, { ...question, id: 'file', widget: 'file' }];
  expect(remainingQuestions(fields, { filled: 'filled' }).map(f => f.id)).toEqual(['q']);
  const memory = answersToRemember([question], { q: 'No' }, { q: 'filled' }, url);
  expect(savedAnswers([{ ...question, hasValue: true }], url, memory)).toEqual({});
  expect(remainingQuestions([question], { q: 'filled' })).toEqual([question]);
});

test('offers unchecked acknowledgments without remembering them, and completes an explicit No', () => {
  const field = { ...question, type: 'checkbox', widget: 'checkbox', question: 'I acknowledge the privacy statement' };
  expect(remainingQuestions([field])).toEqual([field]);
  expect(remainingQuestions([field], { q: 'filled' })).toEqual([]);
  expect(answersToRemember([field], { q: 'Yes' }, { q: 'filled' }, url)).toEqual({});
});
