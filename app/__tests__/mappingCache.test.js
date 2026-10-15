jest.mock('react-native-mmkv', () => {
  const values = new Map();
  return { createMMKV: () => ({
    getString: key => values.get(key),
    set: (key, value) => values.set(key, value),
    remove: key => values.delete(key),
  }) };
});

import { createMMKV } from 'react-native-mmkv';
import { getCachedMapping, saveMappingCacheEntry, listMappingCache, saveProfile, loadProfile } from '../src/profile/store';

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
