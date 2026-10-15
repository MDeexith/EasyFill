import { selectChangedFields, fieldIdentity, selectResumeFields } from '../src/webview/formState';

const field = (id, extra = {}) => ({ id, name: id, widget: 'text', visible: true, ...extra });

test('a same-URL stage with a single field is eligible for autofill', () => {
  expect(selectChangedFields([field('old')], [field('new')])).toEqual([field('new')]);
});

test('fields revealed on the next stage are eligible under their existing ids', () => {
  expect(selectChangedFields([field('country', { visible: false })], [field('country')]))
    .toEqual([field('country')]);
});

test('hydrated labels are retried but option-list churn does not refill a field', () => {
  expect(selectChangedFields([field('a')], [field('a', { label: 'Country' })])).toHaveLength(1);
  expect(selectChangedFields([field('a')], [field('a', { options: [{ label: 'India' }] })])).toEqual([]);
});

test('hidden fields and disabled controls do not enter a new fill pass', () => {
  expect(selectChangedFields([], [field('a', { visible: false }), field('b', { disabled: true })])).toEqual([]);
});

test('field identity changes when a reused control asks a different question', () => {
  expect(fieldIdentity(field('a', { label: 'Country' })))
    .not.toBe(fieldIdentity(field('a', { label: 'State' })));
});

test('an unchanged hidden upload is not repeatedly autofilled', () => {
  const upload = field('resume', { widget: 'file', visible: false });
  expect(selectChangedFields([], [upload])).toEqual([upload]);
  expect(selectChangedFields([upload], [upload])).toEqual([]);
});


test('does not attach the resume to a lone cover-letter upload', () => {
  expect(selectResumeFields([field('cover', { widget: 'file', label: 'Cover letter' })])).toEqual([]);
});

test('selects the resume upload while leaving other attachments alone', () => {
  const resume = field('resume', { widget: 'file', label: 'Resume / CV' });
  expect(selectResumeFields([resume, field('transcript', { widget: 'file', label: 'Transcript' })])).toEqual([resume]);
});
