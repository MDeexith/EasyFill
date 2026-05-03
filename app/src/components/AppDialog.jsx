import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  StyleSheet,
} from 'react-native';
import { theme } from '../theme/tokens';

/**
 * useDialog — imperative API that mirrors Alert.alert().
 *
 * const { show, dialogProps } = useDialog();
 * show({ title, message, buttons });
 * <AppDialog {...dialogProps} />
 */
export function useDialog() {
  const [state, setState] = useState({ visible: false, title: '', message: '', buttons: [] });

  const show = useCallback((opts) => {
    setState({ visible: true, title: '', message: '', buttons: [], ...opts });
  }, []);

  const hide = useCallback(() => {
    setState(prev => ({ ...prev, visible: false }));
  }, []);

  return { show, dialogProps: { ...state, onClose: hide } };
}

/**
 * AppDialog — EasyFill-styled modal dialog.
 *
 * buttons: Array<{ text, style? ('cancel' | 'destructive' | undefined), onPress? }>
 *
 * 1 button  → full-width primary CTA
 * 2 buttons → [ghost Cancel] [primary/destructive Action]
 */
export default function AppDialog({ visible, title, message, buttons = [], onClose }) {
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 280,
          friction: 22,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 0.95, duration: 110, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 110, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, scaleAnim, opacityAnim]);

  const handlePress = useCallback((btn) => {
    onClose();
    btn.onPress?.();
  }, [onClose]);

  const isSingle = buttons.length <= 1;
  const singleBtn = buttons[0];

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.scrim}>
          {/* Stop scrim tap from propagating into the card */}
          <TouchableWithoutFeedback>
            <Animated.View
              style={[
                styles.card,
                { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
              ]}
            >
              {/* ── Body ── */}
              <View style={styles.body}>
                <Text style={styles.title}>{title}</Text>
                {!!message && <Text style={styles.message}>{message}</Text>}
              </View>

              {/* ── Footer ── */}
              <View style={styles.footer}>
                {isSingle ? (
                  // Single full-width button
                  <TouchableOpacity
                    onPress={() => handlePress(singleBtn ?? { text: 'OK' })}
                    activeOpacity={0.82}
                    style={[
                      styles.btnFull,
                      singleBtn?.style === 'destructive' && styles.bgDanger,
                    ]}
                  >
                    <Text style={styles.btnFullText}>
                      {singleBtn?.text ?? 'OK'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  // Two-button row
                  <View style={styles.btnRow}>
                    {buttons.map((btn) => (
                      <TouchableOpacity
                        key={btn.text}
                        onPress={() => handlePress(btn)}
                        activeOpacity={0.82}
                        style={[
                          styles.btnHalf,
                          btn.style === 'cancel' && styles.btnGhost,
                          btn.style === 'destructive' && styles.bgDanger,
                          !btn.style && styles.bgInk,
                        ]}
                      >
                        <Text
                          style={[
                            styles.btnHalfText,
                            btn.style === 'cancel' && styles.textInk,
                            (btn.style === 'destructive' || !btn.style) && styles.textWhite,
                          ]}
                        >
                          {btn.text}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 304,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 22,
    elevation: 24,
  },

  // ── Body ──
  body: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
  },
  title: {
    fontSize: 16,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: theme.colors.ink,
  },
  message: {
    marginTop: 7,
    fontSize: 14,
    fontFamily: theme.font.sans,
    color: theme.colors.ink2,
    lineHeight: 21,
  },

  // ── Footer ──
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    padding: 12,
  },

  // Single full-width button
  btnFull: {
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFullText: {
    fontSize: 15,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: '#fff',
  },

  // Two-button row
  btnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  btnHalf: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnHalfText: {
    fontSize: 14,
    fontFamily: theme.font.sans,
    fontWeight: '600',
  },

  // Variants
  btnGhost: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'transparent',
  },
  bgInk: { backgroundColor: theme.colors.ink },
  bgDanger: { backgroundColor: theme.colors.danger },
  textWhite: { color: '#fff' },
  textInk: { color: theme.colors.ink },
});
