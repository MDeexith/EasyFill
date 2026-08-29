import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, Card, T, Eyebrow } from '../components/ui';
import { theme } from '../theme/tokens';
import { loadProfile, saveProfile, setOnboarded } from '../profile/store';

const DECLINE = 'Decline to self-identify';

const YES_NO = ['Yes', 'No'];
const GENDERS = ['Male', 'Female', 'Non-binary', DECLINE];
const HISPANIC = ['Yes', 'No', DECLINE];
const VETERAN = ['I am not a protected veteran', 'I am a protected veteran', DECLINE];
const DISABILITY = ['No, I do not have a disability', 'Yes, I have a disability', DECLINE];

function Choice({ label, options, value, onChange }) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(opt)}
            activeOpacity={0.85}
            style={[styles.pill, value === opt && styles.pillOn]}
          >
            <Text style={[styles.pillText, value === opt && styles.pillTextOn]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function ApplicationDetailsScreen({ navigation, route }) {
  // Reached two ways: as the last step of onboarding (Upload -> Confirm ->
  // here), or from the Profile tab by an already-onboarded user. Onboarding
  // must replace('Main') because there is no Main below it on the stack yet;
  // a visit from Profile must go BACK, or it would strand the user on a fresh
  // Main and lose the tab they came from.
  const fromProfile = route?.params?.from === 'profile';
  const [profile, setProfile] = useState(() => loadProfile());
  // Already-onboarded users are editing existing answers, so show them
  // rather than hiding them behind "Answer them instead".
  const [eeoOpen, setEeoOpen] = useState(fromProfile);

  const set = useCallback((key, value) => {
    setProfile(p => ({ ...p, [key]: value }));
  }, []);

  const finish = useCallback(() => {
    // Anything the user left untouched in the EEO block stays declined.
    const next = {
      ...profile,
      gender: profile.gender || DECLINE,
      hispanicLatino: profile.hispanicLatino || DECLINE,
      veteranStatus: profile.veteranStatus || DECLINE,
      disabilityStatus: profile.disabilityStatus || DECLINE,
    };
    saveProfile(next);
    if (fromProfile) {
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.replace('Main');
      return;
    }
    setOnboarded(true);
    navigation.replace('Main');
  }, [profile, navigation, fromProfile]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Eyebrow>{fromProfile ? 'APPLICATION QUESTIONS' : 'ONE-TIME SETUP'}</Eyebrow>
        <Text style={T.h1}>A few things your résumé doesn't say</Text>
        <Text style={styles.sub}>
          Applications ask these constantly. Answer once and EasyFill fills them every time.
        </Text>

        <Card style={styles.card}>
          <Choice
            label="Are you authorized to work in the country you're applying to?"
            options={YES_NO}
            value={profile.authorizedToWork}
            onChange={v => set('authorizedToWork', v)}
          />
          <Choice
            label="Will you require visa sponsorship?"
            options={YES_NO}
            value={profile.requiresSponsorship}
            onChange={v => set('requiresSponsorship', v)}
          />
          <Choice
            label="Are you willing to relocate?"
            options={YES_NO}
            value={profile.willingToRelocate}
            onChange={v => set('willingToRelocate', v)}
          />
          <View style={styles.block}>
            <Text style={styles.label}>Notice period</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 30 days, Immediate"
              placeholderTextColor={theme.colors.faint}
              value={profile.noticePeriod}
              onChangeText={v => set('noticePeriod', v)}
            />
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.label}>Equal opportunity questions</Text>
          <Text style={styles.sub}>
            US applications ask about gender, ethnicity, veteran and disability status.
            Answering is optional — we decline on your behalf unless you choose otherwise.
            These answers stay on your device.
          </Text>
          {!eeoOpen ? (
            <Btn variant="ghost" onPress={() => setEeoOpen(true)}>
              Answer them instead
            </Btn>
          ) : (
            <View>
              <Choice label="Gender" options={GENDERS}
                value={profile.gender} onChange={v => set('gender', v)} />
              <Choice label="Hispanic or Latino?" options={HISPANIC}
                value={profile.hispanicLatino} onChange={v => set('hispanicLatino', v)} />
              <Choice label="Veteran status" options={VETERAN}
                value={profile.veteranStatus} onChange={v => set('veteranStatus', v)} />
              <Choice label="Disability status" options={DISABILITY}
                value={profile.disabilityStatus} onChange={v => set('disabilityStatus', v)} />
            </View>
          )}
        </Card>

        <Btn onPress={finish}>{fromProfile ? 'Save' : 'Done'}</Btn>
        <TouchableOpacity onPress={finish} style={styles.skip} activeOpacity={0.7}>
          <Text style={styles.skipText}>{fromProfile ? 'Back to profile' : 'Skip for now'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 18, paddingBottom: 40, gap: 14 },
  sub: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  card: { gap: 14 },
  block: { gap: 8 },
  label: { color: theme.colors.ink, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  pillOn: { backgroundColor: theme.colors.ink, borderColor: theme.colors.ink },
  pillText: { color: theme.colors.muted, fontSize: 13 },
  pillTextOn: { color: '#fff', fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.ink, fontSize: 14,
  },
  skip: { alignItems: 'center', paddingVertical: 12 },
  skipText: { color: theme.colors.muted, fontSize: 13 },
});
