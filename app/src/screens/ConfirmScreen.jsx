import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, IconBtn, Chip, Eyebrow, T } from '../components/ui';
import Icon from '../components/Icon';
import { theme } from '../theme/tokens';
import { loadProfile, saveProfile, setOnboarded } from '../profile/store';
import { PROFILE_FIELD_LABELS } from '../profile/schema';

const CORE_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'city', 'state',
  'linkedIn', 'portfolio', 'github',
  'currentTitle', 'currentCompany', 'yearsExperience', 'salary',
];

export default function ConfirmScreen({ navigation }) {
  const [profile, setProfile] = useState(() => loadProfile());
  const [editing, setEditing] = useState(null);
  const filledCount = CORE_FIELDS.filter(k => !!profile[k]).length;

  const updateField = useCallback((key, value) => {
    setProfile(prev => ({ ...prev, [key]: key === 'yearsExperience' ? Number(value) || 0 : value }));
  }, []);

  const handleContinue = useCallback(() => {
    saveProfile(profile);
    setOnboarded(true);
    navigation.replace('Main');
  }, [profile, navigation]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <IconBtn
          name="arrow-left"
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.replace('Main');
          }}
        />
        <View style={styles.progressRow}>
          <View style={[styles.pBar, styles.pBarActive]} />
          <View style={[styles.pBar, styles.pBarActive]} />
          <View style={styles.pBar} />
        </View>
        <Text style={styles.step}>2/3</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
        <Eyebrow style={{ marginBottom: 8 }}>STEP 02 · CONFIRM</Eyebrow>
        <Text style={styles.heading}>Does this look right?</Text>
        <Text style={styles.sub}>Tap any field to edit. This becomes your autofill profile.</Text>

        <View style={{ marginTop: 14, marginBottom: 16 }}>
          <Chip tone="accent" leftIcon={<Icon name="sparkles" size={12} color={theme.colors.accentInk} />}>
            {filledCount} fields from resume
          </Chip>
        </View>

        {CORE_FIELDS.map(key => {
          const label = PROFILE_FIELD_LABELS[key] || key;
          const value = String(profile[key] ?? '');
          const isFilled = !!value;
          const isEditing = editing === key;
          return (
            <View key={key} style={styles.field}>
              <Text style={T.label}>{label.toUpperCase()}</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setEditing(key)}
                style={[styles.fieldValue, isFilled && styles.fieldValueFilled]}
              >
                {isFilled && <Icon name="check" size={13} color={theme.colors.accent} strokeWidth={2.5} />}
                {isEditing ? (
                  <TextInput
                    value={value}
                    onChangeText={v => updateField(key, v)}
                    onBlur={() => setEditing(null)}
                    autoFocus
                    style={styles.fieldInput}
                    placeholder={label}
                    placeholderTextColor={theme.colors.faint}
                    autoCapitalize={key === 'email' || key.includes('link') || key === 'github' || key === 'portfolio' ? 'none' : 'words'}
                    keyboardType={key === 'email' ? 'email-address' : key === 'phone' ? 'phone-pad' : key === 'yearsExperience' ? 'numeric' : 'default'}
                  />
                ) : (
                  <Text style={[styles.fieldText, !isFilled && { color: theme.colors.faint }]} numberOfLines={1}>
                    {value || 'Tap to add'}
                  </Text>
                )}
                <Icon name="edit" size={13} color={theme.colors.muted} />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.bottomBar}>
        <Btn
          variant="primary"
          onPress={handleContinue}
          rightIcon={<Icon name="arrow-right" size={16} color="#fff" />}
        >
          Looks good, continue
        </Btn>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  topbar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  progressRow: { flex: 1, flexDirection: 'row', gap: 4 },
  pBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: theme.colors.border },
  pBarActive: { backgroundColor: theme.colors.ink },
  step: { fontFamily: theme.font.mono, fontSize: 11, color: theme.colors.muted },
  heading: {
    fontSize: 24,
    fontFamily: theme.font.sans,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: theme.colors.ink,
    marginBottom: 6,
  },
  sub: {
    fontSize: 13,
    color: theme.colors.muted,
    fontFamily: theme.font.sans,
    lineHeight: 19,
  },
  field: { marginBottom: 12, gap: 6 },
  fieldValue: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldValueFilled: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  fieldText: {
    flex: 1,
    fontSize: 14,
    fontFamily: theme.font.sans,
    fontWeight: '500',
    color: theme.colors.ink,
  },
  fieldInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: theme.font.sans,
    fontWeight: '500',
    color: theme.colors.ink,
    padding: 0,
  },
  bottomBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    padding: 16,
    backgroundColor: theme.colors.bg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
});
