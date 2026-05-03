import React, { useEffect } from 'react';
import { View, Text, StyleSheet, StatusBar, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, Eyebrow, T } from '../components/ui';
import Icon from '../components/Icon';
import { theme } from '../theme/tokens';
import { loadProfile } from '../profile/store';
import AppDialog, { useDialog } from '../components/AppDialog';

export default function SplashScreen({ navigation }) {
  const { show, dialogProps } = useDialog();

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.colors.bg} />
      <View style={styles.container}>
        <View style={styles.lockup}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>e</Text>
          </View>
          <Text style={styles.wordmark}>easyfill</Text>
        </View>

        <View style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
          <Eyebrow>ONE TAP · ANY JOB SITE</Eyebrow>
          <Text style={styles.hero}>Apply to any job</Text>
          <Text style={styles.heroMuted}>in five seconds.</Text>
          <Text style={styles.sub}>
            EasyFill reads any job form on the web — Greenhouse, Lever, Workday, career pages — and fills it with your profile. No more copy-paste.
          </Text>
        </View>

        <View style={styles.footer}>
          <Btn
            variant="primary"
            onPress={() => navigation.replace('Upload')}
            rightIcon={<Icon name="arrow-right" size={16} color="#fff" />}
          >
            Get started
          </Btn>
          <Btn
            variant="ghost"
            onPress={() => {
              const profile = loadProfile();
              const hasName = !!(profile.firstName?.trim() || profile.name?.trim());
              if (hasName) {
                navigation.replace('Main');
              } else {
                show({
                  title: 'No profile found',
                  message: "You don't have a profile yet. Upload your resume to get started.",
                  buttons: [{ text: 'Get started', onPress: () => navigation.replace('Upload') }],
                });
              }
            }}
            style={{ marginTop: 10, height: 44 }}
          >
            I already have a profile
          </Btn>
        </View>
      </View>
      <AppDialog {...dialogProps} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  container: { flex: 1, paddingHorizontal: 28, paddingTop: 32, paddingBottom: 24 },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMarkText: {
    color: '#fff',
    fontFamily: theme.font.monoExtraBold,
    fontSize: 22,
    letterSpacing: -2,
  },
  wordmark: {
    fontFamily: theme.font.monoBold,
    fontSize: 18,
    color: theme.colors.ink,
    letterSpacing: -1,
  },
  hero: {
    fontSize: 38,
    fontFamily: theme.font.sans,
    fontWeight: '800',
    letterSpacing: -1.2,
    color: theme.colors.ink,
    lineHeight: 42,
  },
  heroMuted: {
    fontSize: 38,
    fontFamily: theme.font.sans,
    fontWeight: '800',
    letterSpacing: -1.2,
    color: theme.colors.muted,
    lineHeight: 42,
    marginTop: -8,
  },
  sub: {
    fontSize: 15,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 320,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 16,
  },
});
