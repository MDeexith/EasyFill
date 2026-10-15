jest.mock('react-native-mmkv', () => {
  const values = new Map();
  return { createMMKV: () => ({
    getString: key => values.get(key),
    set: (key, value) => values.set(key, value),
    remove: key => values.delete(key),
  }) };
});

import { createMMKV } from 'react-native-mmkv';
import { getCachedMapping, saveMappingCacheEntry, listMappingCache, saveProfile, loadProfile, mergeFieldCorrections, listFieldCorrections, deleteFieldCorrection, loadFieldCorrections } from '../src/profile/store';

test('old generated mappings cannot override corrected matching rules', () => {
  const fields = [{ id: 'q', name: 'question', label: 'Authorized to work in this country?', type: 'button' }];
  const profile = { authorizedToWork: 'Yes' };
  saveProfile(profile);
  saveMappingCacheEntry('example.com', { q: 'authorizedToWork' }, fields, profile);
  expect(getCachedMapping('example.com', fields, profile)).toEqual({ q: 'authorizedToWork' });
  expect(listMappingCache()).toHaveLength(1);
  const storage = createMMKV();
  const cache = JSON.parse(storage.getString('mapping_cache'));
  cache['example.com'].version = 1;
  storage.set('mapping_cache', JSON.stringify(cache));
  expect(getCachedMapping('example.com', fields, profile)).toBeNull();
  expect(listMappingCache()).toEqual([]);
  expect(loadProfile().authorizedToWork).toBe('Yes');
});

test('lists and deletes site answers while preserving legacy answers', () => {
  const key = JSON.stringify(['site-answer-v1', 'workday.example/en-US', 'Related to an employee?']);
  mergeFieldCorrections({ [key]: 'No', 'name|Old answer|text|': 'Old value' });
  expect(listFieldCorrections()).toEqual(expect.arrayContaining([
    expect.objectContaining({ fingerprint: key, host: 'workday.example/en-US', label: 'Related to an employee?', value: 'No' }),
    expect.objectContaining({ label: 'Old answer', value: 'Old value' }),
  ]));
  deleteFieldCorrection(key);
  expect(loadFieldCorrections()).toEqual({ 'name|Old answer|text|': 'Old value' });
});
