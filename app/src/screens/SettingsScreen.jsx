import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eyebrow } from '../components/ui';
import Icon from '../components/Icon';
import { theme } from '../theme/tokens';
import { clearProfile, saveHistory, setOnboarded } from '../profile/store';

export default function SettingsScreen({ navigation }) {
  const resetAll = useCallback(() => {
    Alert.alert(
      'Reset all data?',
      'Clears your profile and history, and returns to onboarding. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            clearProfile();
            saveHistory([]);
            setOnboarded(false);
            const root = navigation.getParent()?.getParent() || navigation.getParent();
            root?.reset({ index: 0, routes: [{ name: 'Splash' }] });
          },
        },
      ]
    );
  }, [navigation]);

  const ITEMS = [
    {
      group: 'PROFILE',
      items: [
        {
          icon: 'user',
          label: 'Edit profile',
          sub: 'Personal info used for autofill',
          onPress: () => navigation.navigate('Profiles'),
        },
        {
          icon: 'file',
          label: 'Re-import resume',
          sub: 'Parse a new PDF',
          onPress: () => navigation.getParent()?.navigate('Upload'),
        },
      ],
    },
    {
      group: 'PRIVACY',
      items: [
        {
          icon: 'shield',
          label: 'Your data',
          sub: 'Stored locally on your device',
          onPress: () => {
            Alert.alert(
              'Your data',
              'Your profile and history are stored only on this device. When you autofill a page, field labels are sent to our private AI model to pick the right matches — never your page content, never your profile values themselves.',
            );
          },
        },
        {
          icon: 'sparkles',
          label: 'How AI assist works',
          sub: 'Smart matching + text drafting',
          onPress: () => {
            Alert.alert(
              'AI assist',
              'Our on-call AI reads each form\'s labels and decides which of your saved fields fits where. For long answers like "Why this role?", the AI drafts an answer from your profile that you can edit before submitting.',
            );
          },
        },
      ],
    },
    {
      group: 'DANGER',
      items: [
        {
          icon: 'trash',
          label: 'Reset all data',
          sub: 'Clear profile and history',
          onPress: resetAll,
          danger: true,
        },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topbar}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {ITEMS.map(section => (
          <View key={section.group} style={{ marginTop: 16, paddingHorizontal: 16 }}>
            <Eyebrow style={{ marginBottom: 8, paddingHorizontal: 4 }}>{section.group}</Eyebrow>
            <View style={styles.card}>
              {section.items.map((it, i, arr) => (
                <TouchableOpacity
                  key={it.label}
                  onPress={it.onPress}
                  activeOpacity={0.7}
                  style={[
                    styles.row,
                    i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
                  ]}
                >
                  <View style={[styles.rowIcon, it.danger && { backgroundColor: '#fef2f2' }]}>
                    <Icon
                      name={it.icon}
                      size={15}
                      color={it.danger ? theme.colors.danger : theme.colors.ink}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, it.danger && { color: theme.colors.danger }]}>
                      {it.label}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{it.sub}</Text>
                  </View>
                  <Icon name="chevron-right" size={16} color={theme.colors.muted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.version}>easyfill · v1.0.0</Text>
      </ScrollView>
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
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontSize: 14,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.ink,
  },
  rowSub: {
    fontSize: 11.5,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    marginTop: 2,
  },
  version: {
    textAlign: 'center',
    fontSize: 11,
    color: theme.colors.muted,
    fontFamily: theme.font.mono,
    marginTop: 28,
    letterSpacing: -0.3,
  },
});
