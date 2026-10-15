import React, { useState } from 'react';
import { Modal, View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, Card } from './ui';
import { theme } from '../theme/tokens';
import { questionText, isAcknowledgment } from '../profile/applicationAnswers';

export default function ApplicationAnswersSheet({ count, prepare, fill }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setOpen(true);
    setBusy(true);
    setSession(null);
    setAnswers({});
    setError('');
    try { setSession(await prepare()); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true);
    setError('');
    try {
      const failed = await fill(session, answers);
      if (failed.length) {
        setSession(prev => ({ ...prev, fields: prev.fields.filter(f => failed.includes(f.id)) }));
        setAnswers(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => failed.includes(id))));
        setError('Some answers could not be filled. Try again or select them on the page.');
      } else { setOpen(false); }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!count && !open) return null;
  return <>
    <Btn variant="ghost" onPress={start} style={styles.trigger}>Answer remaining questions ({count})</Btn>
    <Modal visible={open} animationType="slide" onRequestClose={() => !busy && setOpen(false)}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>Application answers</Text>
            <Text style={styles.hint}>Your answers are saved on this device for the same questions on this site. Manage them in Profile → Saved Answers.</Text>
          </View>
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {session?.fields.map((field, index) => {
              const options = field.options || [];
              const dropdown = ['select', 'button-dropdown', 'combobox-input'].includes(field.widget);
              return <Card key={field.id}>
                <Text style={styles.question}>{index + 1}. {questionText(field)}</Text>
                {isAcknowledgment(field) && <Text style={styles.hint}>This application only · not saved for reuse</Text>}
                {dropdown ? (options.length ? <View style={styles.options}>{options.map(option => {
                  const selected = answers[field.id] === option.value;
                  return <TouchableOpacity key={option.value} disabled={busy} accessibilityRole="radio"
                    accessibilityState={{ checked: selected }} accessibilityLabel={option.label}
                    onPress={() => setAnswers(prev => ({ ...prev, [field.id]: option.value }))}
                    style={[styles.option, selected && styles.selected]}>
                    <Text style={styles.optionText}>{option.label}</Text>
                  </TouchableOpacity>;
                })}</View> : <Text style={styles.hint}>Options unavailable. Select an answer on the page.</Text>) :
                  <TextInput accessibilityLabel={questionText(field)} editable={!busy} style={styles.input}
                    multiline={field.longform} value={answers[field.id] || ''}
                    onChangeText={value => setAnswers(prev => ({ ...prev, [field.id]: value }))} />}
              </Card>;
            })}
            {!busy && session?.fields.length === 0 && <Text style={styles.hint}>No unanswered fields on this page.</Text>}
            {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          </ScrollView>
          <View style={styles.footer}>
            <Btn onPress={apply} loading={busy} disabled={!session || !Object.values(answers).some(value => value.trim())}>Fill and remember answers</Btn>
            <Btn variant="ghost" onPress={() => setOpen(false)} disabled={busy}>Close</Btn>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  trigger: { marginTop: 10 },
  header: { padding: 20, gap: 8 },
  title: { color: theme.colors.ink, fontSize: 22, fontWeight: '700' },
  hint: { color: theme.colors.muted, fontSize: 13, lineHeight: 20 },
  list: { padding: 20, paddingTop: 0, gap: 14 },
  question: { color: theme.colors.ink, fontSize: 15, lineHeight: 23, marginBottom: 12 },
  options: { gap: 8 },
  option: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 14 },
  selected: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
  optionText: { color: theme.colors.ink, fontSize: 15 },
  input: { color: theme.colors.ink, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, minHeight: 48 },
  footer: { padding: 16, gap: 8, borderTopWidth: 1, borderColor: theme.colors.border },
  error: { color: theme.colors.danger, fontSize: 14 },
});
