// Workday "Phone" section: four adjacent controls all regex-match /phone/.
// The singleton must land on the actual number input (name=phoneNumber).
jest.mock('../src/profile/store', () => ({
  getCachedMapping: () => null,
  saveMappingCacheEntry: () => {},
}));
jest.mock('../src/matcher/llmClient', () => ({ llmMatch: jest.fn() }));

const { matchFieldsToProfile } = require('../src/matcher/index');

const fields = [
  // name="phoneType" ties the real input's name tier (Workday) — the dedupe
  // tie-break must hand the free-text phone key to the text control.
  { id: 'devtype', name: 'phoneType', domId: 'phoneNumber--phoneType', label: 'Phone Device Type', widget: 'button-dropdown', tag: 'button', type: 'button', visible: true },
  { id: 'code', label: '', placeholder: 'Search', nearbyText: 'Country/Territory Phone Code', widget: 'combobox-input', tag: 'input', type: 'text', visible: true },
  { id: 'num', name: 'phoneNumber', label: '', widget: 'text', tag: 'input', type: 'text', visible: true },
  { id: 'ext', name: 'extension', label: 'Phone Extension', widget: 'text', tag: 'input', type: 'text', visible: true },
];

test('phone singleton lands on the number input, not device-type/code/extension', async () => {
  const { mapping, decisions } = await matchFieldsToProfile(fields, { phone: '7021125165' }, false, null);
  expect(mapping.num).toBe('phone');
  expect(mapping.devtype).not.toBe('phone');
  expect(mapping.code).not.toBe('phone');
  expect(mapping.ext).not.toBe('phone');
});
