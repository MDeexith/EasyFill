// Custom dropdown widgets keep a display:none native <select> in sync with a
// visible combobox input. Both match the same profile key; the fill must land
// on the visible one or the page looks untouched (joinus.juspay.in pattern).
jest.mock('../src/profile/store', () => ({
  getCachedMapping: () => null,
  saveMappingCacheEntry: () => {},
}));
jest.mock('../src/matcher/llmClient', () => ({ llmMatch: jest.fn() }));

const { matchFieldsToProfile } = require('../src/matcher/index');

const hiddenSelect = {
  id: 'af_8', tag: 'select', type: 'select', widget: 'select',
  label: 'Gender', name: '', autocomplete: '', visible: false,
  options: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }],
};
const visibleInput = {
  id: 'af_7', tag: 'input', type: 'text', widget: 'combobox-input',
  label: 'Gender', name: '', autocomplete: '', visible: true,
};

test('visible field wins singleton key over hidden twin', async () => {
  const { mapping } = await matchFieldsToProfile(
    [hiddenSelect, visibleInput], { gender: 'Male' }, false, null,
  );
  expect(mapping.af_7).toBe('gender');
  expect(mapping.af_8).toBeUndefined();
});

test('fields without visible flag (old scans) still dedupe by confidence', async () => {
  const a = { ...hiddenSelect, visible: undefined };
  const b = { ...visibleInput, visible: undefined };
  const { mapping } = await matchFieldsToProfile([a, b], { gender: 'Male' }, false, null);
  const claimed = [mapping.af_7, mapping.af_8].filter(k => k === 'gender');
  expect(claimed).toHaveLength(1);
});
