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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, IconBtn, Card, Chip, Eyebrow, T } from '../components/ui';
import Icon from '../components/Icon';
import { theme } from '../theme/tokens';
import { loadProfile, saveProfile } from '../profile/store';
import { PROFILE_FIELD_LABELS } from '../profile/schema';

const SECTIONS = [
  { title: 'Identity', fields: ['firstName', 'lastName', 'email', 'phone'] },
  { title: 'Location', fields: ['city', 'state', 'country', 'zipCode'] },
  { title: 'Links', fields: ['linkedIn', 'portfolio', 'github'] },
  { title: 'Work', fields: ['currentTitle', 'currentCompany', 'yearsExperience', 'salary', 'startDate', 'skills'] },
  { title: 'Cover letter', fields: ['coverLetter'] },
];

function getInitials(profile) {
  const first = (profile.firstName || profile.name || '').trim();
  const last = (profile.lastName || '').trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  return 'EF';
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState(() => loadProfile());
  const [saved, setSaved] = useState(false);

  const update = useCallback((key, value) => {
    setProfile(prev => ({ ...prev, [key]: key === 'yearsExperience' ? Number(value) || 0 : value }));
    setSaved(false);
  }, []);

  const handleSave = useCallback(() => {
    saveProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [profile]);

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
});
