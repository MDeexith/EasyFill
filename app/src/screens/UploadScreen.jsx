import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { Btn, IconBtn, Card, Eyebrow, T } from '../components/ui';
import Icon from '../components/Icon';
import { theme } from '../theme/tokens';
import { parseResume } from '../api/backend';
import { loadProfile, saveProfile } from '../profile/store';

export default function UploadScreen({ navigation }) {
  const [state, setState] = useState('idle'); // idle | uploading | parsing
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);

  const doPick = useCallback(async () => {
    try {
      const [result] = await pick({ type: [types.pdf] });
      setFileName(result.name ?? 'resume.pdf');
      setState('uploading');
      setTimeout(() => setState('parsing'), 800);
      const profile = await parseResume(result.uri, result.name ?? 'resume.pdf');
      const existing = loadProfile();
      const merged = { ...existing, ...profile };
      saveProfile(merged);
      setParsed(merged);
      setTimeout(() => navigation.replace('Confirm'), 1200);
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        setState('idle');
        return;
      }
      setState('idle');
      Alert.alert('Parse failed', 'Check backend connection.');
    }
  }, [navigation]);

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
          <View style={styles.pBar} />
          <View style={styles.pBar} />
        </View>
        <Text style={styles.step}>1/3</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Eyebrow style={{ marginBottom: 8 }}>STEP 01 · RESUME</Eyebrow>
        <Text style={styles.heading}>Start with your resume.</Text>
        <Text style={styles.sub}>
          We'll pull out your details automatically — name, contact, work history, education. You'll confirm everything on the next screen.
        </Text>

        <View style={{ marginTop: 24 }}>
          {state === 'idle' && (
            <TouchableOpacity onPress={doPick} activeOpacity={0.85} style={styles.dropzone}>
              <View style={styles.uploadIcon}>
                <Icon name="upload" size={20} color="#fff" />
              </View>
              <Text style={styles.dropzoneTitle}>Upload resume</Text>
              <Text style={styles.dropzoneSub}>PDF · Max 10 MB</Text>
            </TouchableOpacity>
          )}

          {(state === 'uploading' || state === 'parsing') && (
            <Card pad={18}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <View style={styles.fileIcon}>
                  <Icon name="file" size={18} color={theme.colors.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
                  <Text style={[T.mono, { marginTop: 2 }]}>
                    {state === 'uploading' ? 'Uploading…' : 'Parsing with AI…'}
                  </Text>
                </View>
                {state === 'parsing' && <Icon name="sparkles" size={18} color={theme.colors.accent} />}
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: state === 'parsing' ? '100%' : '55%' }]} />
              </View>
              {state === 'parsing' && (
                <View style={{ marginTop: 14, gap: 6 }}>
                  {['Contact details', 'Work experience', 'Education', 'Skills'].map(s => (
                    <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Icon name="check" size={13} color={theme.colors.accent} strokeWidth={2.25} />
                      <Text style={{ fontSize: 12, color: theme.colors.ink2 }}>{s} extracted</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          )}

          {state === 'idle' && (
            <View style={{ marginTop: 14, gap: 8 }}>
              <Btn
                variant="ghost"
                size="sm"
                style={{ height: 44, justifyContent: 'space-between' }}
                onPress={() => navigation.replace('Confirm')}
                leftIcon={<Icon name="edit" size={16} />}
                rightIcon={<Icon name="chevron-right" size={16} color={theme.colors.muted} />}
              >
                Skip · fill out manually
              </Btn>
            </View>
          )}
        </View>

        <View style={styles.securityNote}>
          <Icon name="shield" size={18} color={theme.colors.ink} />
          <Text style={styles.securityText}>
            Your resume stays on-device. We parse locally via your backend and never share it.
          </Text>
        </View>
      </ScrollView>
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
    fontSize: 26,
    fontFamily: theme.font.sans,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: theme.colors.ink,
    marginBottom: 8,
  },
  sub: {
    fontSize: 14,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    lineHeight: 21,
  },
  dropzone: {
    backgroundColor: theme.colors.surface2,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    borderRadius: 18,
    padding: 32,
    alignItems: 'center',
    gap: 12,
  },
  uploadIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: theme.colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropzoneTitle: {
    fontSize: 15,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    color: theme.colors.ink,
  },
  dropzoneSub: { fontSize: 12, color: theme.colors.muted, fontFamily: theme.font.sans },
  fileIcon: {
    width: 40,
    height: 48,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.ink,
    fontFamily: theme.font.sans,
  },
  progressTrack: {
    height: 6,
    backgroundColor: theme.colors.surface2,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: theme.colors.accent, borderRadius: 3 },
  securityNote: {
    marginTop: 28,
    padding: 14,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  securityText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.ink2,
    fontFamily: theme.font.sans,
  },
});
