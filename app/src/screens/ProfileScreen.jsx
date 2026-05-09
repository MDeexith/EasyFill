import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, Chip, Eyebrow, T } from '../components/ui';
import Icon from '../components/Icon';
import { theme } from '../theme/tokens';
import {
  loadProfile,
  saveProfile,
  listMappingCache,
  deleteMappingCacheEntry,
  deleteMappingCacheHost,
  listFieldCorrections,
  deleteFieldCorrection,
} from '../profile/store';
import { PROFILE_FIELD_LABELS } from '../profile/schema';

const SECTIONS = [
  { title: 'Identity', fields: ['firstName', 'lastName', 'email', 'phone', 'pronouns', 'dateOfBirth', 'gender'] },
  { title: 'Location', fields: ['city', 'state', 'country', 'zipCode'] },
  { title: 'Links', fields: ['linkedIn', 'portfolio', 'github'] },
  { title: 'Work', fields: ['currentTitle', 'currentCompany', 'yearsExperience', 'salary', 'startDate', 'skills'] },
  // For yes/no questions enter exactly "Yes" or "No" — the autofill engine
  // matches these against radio/select option labels at fill time.
  { title: 'Eligibility', fields: ['workAuthorization', 'willingToRelocate', 'noticePeriod'] },
  { title: 'Cover letter', fields: ['coverLetter'] },
];

function getInitials(profile) {
  const first = (profile.firstName || profile.name || '').trim();
  const last = (profile.lastName || '').trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  return 'EF';
}

function groupMappingsByHost(entries) {
  const byHost = {};
  for (const entry of entries) {
    if (!byHost[entry.host]) byHost[entry.host] = [];
    byHost[entry.host].push(entry);
  }
  return Object.entries(byHost).map(([host, items]) => ({ host, items }));
}

function fieldDisplayLabel(item) {
  const raw = (item.label || item.name || '').trim();
  if (raw) return raw.replace(/\s+\*\s*$/, '');
  if (item.autocomplete) return item.autocomplete;
  if (item.type) return item.type;
  return '(unnamed field)';
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState(() => loadProfile());
  const [saved, setSaved] = useState(false);
  const [mappingGroups, setMappingGroups] = useState(() => groupMappingsByHost(listMappingCache()));
  const [corrections, setCorrections] = useState(() => listFieldCorrections());

  const refreshMemory = useCallback(() => {
    setMappingGroups(groupMappingsByHost(listMappingCache()));
    setCorrections(listFieldCorrections());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshMemory();
    }, [refreshMemory])
  );

  const update = useCallback((key, value) => {
    setProfile(prev => ({ ...prev, [key]: key === 'yearsExperience' ? Number(value) || 0 : value }));
    setSaved(false);
  }, []);

  const handleSave = useCallback(() => {
    saveProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [profile]);

  const handleDeleteMapping = useCallback((host, fingerprint) => {
    deleteMappingCacheEntry(host, fingerprint);
    refreshMemory();
  }, [refreshMemory]);

  const handleForgetHost = useCallback((host) => {
    deleteMappingCacheHost(host);
    refreshMemory();
  }, [refreshMemory]);

  const handleDeleteCorrection = useCallback((fingerprint) => {
    deleteFieldCorrection(fingerprint);
    refreshMemory();
  }, [refreshMemory]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topbar}>
        <Text style={styles.title}>Profile</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={styles.header}>
            <View style={styles.avatarLg}>
              <Text style={styles.avatarLgText}>{getInitials(profile)}</Text>
            </View>
            <Text style={styles.name}>
              {(profile.firstName || profile.name || 'Your name') + (profile.lastName ? ' ' + profile.lastName : '')}
            </Text>
            <Text style={T.small}>{profile.email || 'No email set'}</Text>
            <Chip tone="accent" style={{ marginTop: 10 }} leftIcon={<Icon name="sparkles" size={11} color={theme.colors.accentInk} />}>
              Used in all autofills
            </Chip>
          </View>

          {SECTIONS.map(section => (
            <View key={section.title} style={{ paddingHorizontal: 16, marginTop: 12 }}>
              <Eyebrow style={{ marginBottom: 8 }}>{section.title.toUpperCase()}</Eyebrow>
              <View style={styles.card}>
                {section.fields.map((key, i, arr) => (
                  <View
                    key={key}
                    style={[
                      styles.field,
                      i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
                    ]}
                  >
                    <Text style={styles.fieldLabel}>{PROFILE_FIELD_LABELS[key] || key}</Text>
                    <TextInput
                      style={[styles.fieldInput, key === 'coverLetter' && styles.textarea]}
                      value={String(profile[key] ?? '')}
                      onChangeText={v => update(key, v)}
                      placeholder={`Add ${(PROFILE_FIELD_LABELS[key] || key).toLowerCase()}`}
                      placeholderTextColor={theme.colors.faint}
                      multiline={key === 'coverLetter'}
                      numberOfLines={key === 'coverLetter' ? 5 : 1}
                      autoCapitalize={
                        key === 'email' || key === 'linkedIn' || key === 'github' || key === 'portfolio'
                          ? 'none'
                          : 'words'
                      }
                      keyboardType={
                        key === 'email'
                          ? 'email-address'
                          : key === 'phone'
                            ? 'phone-pad'
                            : key === 'yearsExperience'
                              ? 'numeric'
                              : 'default'
                      }
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}

          <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
            <View style={styles.memHeader}>
              <Eyebrow>AUTOFILL MEMORY</Eyebrow>
              <Text style={styles.memHeaderCount}>
                {mappingGroups.reduce((n, g) => n + g.items.length, 0) + corrections.length} saved
              </Text>
            </View>
            <Text style={styles.memHelp}>
              Field mappings remembered from previous fills. Delete any entry to force a fresh AI match next time.
            </Text>

            {mappingGroups.length === 0 && corrections.length === 0 ? (
              <View style={[styles.card, styles.memEmpty]}>
                <Icon name="sparkles" size={16} color={theme.colors.muted} />
                <Text style={styles.memEmptyText}>
                  No saved mappings yet. They'll appear here after your first autofill.
                </Text>
              </View>
            ) : (
              <>
                {mappingGroups.map(group => (
                  <View key={group.host} style={[styles.card, { marginBottom: 10 }]}>
                    <View style={styles.memHostRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memHostName} numberOfLines={1}>{group.host}</Text>
                        <Text style={styles.memHostSub}>
                          {group.items.length} field{group.items.length === 1 ? '' : 's'} mapped
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleForgetHost(group.host)}
                        activeOpacity={0.7}
                        style={styles.memHostForget}
                      >
                        <Text style={styles.memHostForgetText}>Forget all</Text>
                      </TouchableOpacity>
                    </View>
                    {group.items.map((item, i) => (
                      <View
                        key={item.fingerprint}
                        style={[
                          styles.memRow,
                          i === 0 && { borderTopWidth: 1, borderTopColor: theme.colors.border },
                          i < group.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
                        ]}
                      >
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={styles.memFieldLabel} numberOfLines={1}>
                            {fieldDisplayLabel(item)}
                          </Text>
                          <View style={styles.memMapRow}>
                            <Text style={styles.memArrow}>→</Text>
                            <Chip tone="accent">
                              {PROFILE_FIELD_LABELS[item.profileKey] || item.profileKey}
                            </Chip>
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteMapping(group.host, item.fingerprint)}
                          activeOpacity={0.6}
                          hitSlop={8}
                          style={styles.memDelBtn}
                        >
                          <Icon name="close" size={14} color={theme.colors.danger} strokeWidth={2.5} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ))}

                {corrections.length > 0 && (
                  <View style={{ marginTop: 14 }}>
                    <Eyebrow style={{ marginBottom: 8 }}>SAVED ANSWERS</Eyebrow>
                    <View style={styles.card}>
                      {corrections.map((item, i) => (
                        <View
                          key={item.fingerprint}
                          style={[
                            styles.memRow,
                            i < corrections.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
                          ]}
                        >
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={styles.memFieldLabel} numberOfLines={1}>
                              {fieldDisplayLabel(item)}
                            </Text>
                            <Text style={styles.memCorrectionValue} numberOfLines={2}>
                              {item.value}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleDeleteCorrection(item.fingerprint)}
                            activeOpacity={0.6}
                            hitSlop={8}
                            style={styles.memDelBtn}
                          >
                            <Icon name="close" size={14} color={theme.colors.danger} strokeWidth={2.5} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.saveBar}>
        <Btn
          variant={saved ? 'accent' : 'primary'}
          onPress={handleSave}
          leftIcon={saved ? <Icon name="check" size={16} color="#fff" strokeWidth={2.5} /> : null}
        >
          {saved ? 'Saved' : 'Save profile'}
        </Btn>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  topbar: {
    height: 52,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: 17,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: theme.colors.ink,
  },
  header: {
    alignItems: 'center',
    paddingTop: 22,
    paddingBottom: 8,
  },
  avatarLg: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: theme.colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarLgText: {
    color: '#fff',
    fontFamily: theme.font.monoExtraBold,
    fontSize: 28,
    letterSpacing: -2,
  },
  name: {
    fontSize: 20,
    fontFamily: theme.font.sans,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: theme.colors.ink,
    marginBottom: 2,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
  },
  field: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
  },
  fieldLabel: {
    fontSize: 11,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.muted,
    letterSpacing: 0.3,
  },
  fieldInput: {
    fontSize: 14,
    fontFamily: theme.font.sans,
    color: theme.colors.ink,
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  textarea: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: 6,
  },
  saveBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    padding: 16,
    backgroundColor: theme.colors.bg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },

  memHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  memHeaderCount: {
    fontSize: 11,
    fontFamily: theme.font.mono,
    color: theme.colors.muted,
    letterSpacing: -0.3,
  },
  memHelp: {
    fontSize: 12,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    lineHeight: 17,
    marginBottom: 12,
  },
  memEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  memEmptyText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    lineHeight: 18,
  },
  memHostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  memHostName: {
    fontSize: 13,
    fontFamily: theme.font.mono,
    fontWeight: '700',
    color: theme.colors.ink,
    letterSpacing: -0.3,
  },
  memHostSub: {
    fontSize: 11,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    marginTop: 2,
  },
  memHostForget: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  memHostForgetText: {
    fontSize: 11,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.danger,
  },
  memRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  memFieldLabel: {
    fontSize: 13,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.ink,
  },
  memMapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
  },
  memArrow: {
    fontSize: 12,
    color: theme.colors.muted,
    fontFamily: theme.font.mono,
  },
  memCorrectionValue: {
    fontSize: 12,
    fontFamily: theme.font.sans,
    color: theme.colors.ink2,
    marginTop: 3,
    lineHeight: 16,
  },
  memDelBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
