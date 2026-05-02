import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  Animated,
  Platform,
  BackHandler,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { IconBtn } from '../components/ui';
import Icon from '../components/Icon';
import { theme } from '../theme/tokens';
import { FORM_SCANNER_JS } from '../webview/formScanner';

import { buildFillScript, buildDirectFillScript } from '../webview/filler';
import { matchFieldsToProfile } from '../matcher';
import { generateText } from '../api/backend';
import { loadProfile, addHistoryEntry } from '../profile/store';

function getHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

const WEBVIEW_USER_AGENT = Platform.select({
  ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'CriOS/124.0.6367.82 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.6367.82 Mobile Safari/537.36',
});


export default function BrowserScreen({ route, navigation }) {
  const { url } = route.params;
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [pageTitle, setPageTitle] = useState('');
  const [fields, setFields] = useState([]);
  const [phase, setPhase] = useState('loading');
  // phase: loading | detected | panel | filling | drafting | filled
  const [filledCount, setFilledCount] = useState(0);
  const [draftProgress, setDraftProgress] = useState({ current: 0, total: 0 });
  const [tracked, setTracked] = useState(false);
  const [webViewCanGoBack, setWebViewCanGoBack] = useState(false);


  const fabAnim = useRef(new Animated.Value(0)).current;
  const panelAnim = useRef(new Animated.Value(0)).current;

  const longFormFields = fields.filter(f => f.longform);
  const fieldCount = fields.length;

  useEffect(() => {
    const shouldShowFab = phase === 'detected' || phase === 'filled';
    Animated.spring(fabAnim, {
      toValue: shouldShowFab ? 1 : 0,
      useNativeDriver: true,
      tension: 60,
      friction: 8,
    }).start();
  }, [phase, fabAnim]);

  useEffect(() => {
    const shouldShowPanel = phase === 'panel' || phase === 'filling' || phase === 'drafting';
    Animated.spring(panelAnim, {
      toValue: shouldShowPanel ? 1 : 0,
      useNativeDriver: true,
      tension: 70,
      friction: 9,
    }).start();
  }, [phase, panelAnim]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (webViewCanGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [webViewCanGoBack]);

  function enrichProfile(raw) {
    const p = { ...raw };
    if (!p.firstName && !p.lastName && p.name) {
      const parts = p.name.trim().split(/\s+/);
      p.firstName = parts[0] || '';
      p.lastName = parts.slice(1).join(' ') || '';
    }
    if (!p.name && (p.firstName || p.lastName)) {
      p.name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    }
    return p;
  }

  // Regex-only fill — no backend call
  const doAutofillRegex = useCallback(async (scanned) => {
    setPhase('filling');
    try {
      const profile = enrichProfile(loadProfile());
      const mapping = await matchFieldsToProfile(scanned, profile, false);
      const script = buildFillScript(mapping || {}, JSON.stringify(profile));
      webViewRef.current?.injectJavaScript(script);
    } catch {
      setPhase('detected');
    }
  }, []);

  // AI-assisted fill — uses LLM for unmatched fields
  const doAutofillAI = useCallback(async (scanned) => {
    setPhase('filling');
    try {
      const profile = enrichProfile(loadProfile());
      const mapping = await matchFieldsToProfile(scanned, profile, true);
      const script = buildFillScript(mapping || {}, JSON.stringify(profile));
      webViewRef.current?.injectJavaScript(script);
    } catch {
      setPhase('detected');
    }
  }, []);

  const doAiDraft = useCallback(async () => {
    const longs = fields.filter(f => f.longform);
    if (longs.length === 0) return;
    setPhase('drafting');
    setDraftProgress({ current: 0, total: longs.length });

    const profile = loadProfile();
    const host = getHostname(currentUrl);
    const drafts = {};

    for (let i = 0; i < longs.length; i++) {
      const f = longs[i];
      try {
        const text = await generateText({
          profile,
          label: f.label || f.ariaLabel || f.nearbyText || '',
          placeholder: f.placeholder || '',
          nearby: f.nearbyText || '',
          host,
        });
        if (text) drafts[f.id] = text;
      } catch {}
      setDraftProgress({ current: i + 1, total: longs.length });
    }

    if (Object.keys(drafts).length > 0) {
      const script = buildDirectFillScript(drafts);
      webViewRef.current?.injectJavaScript(script);
    } else {
      setPhase('filled');
    }
  }, [fields, currentUrl]);

  const onShouldStartLoadWithRequest = useCallback((request) => {
    const { url: reqUrl } = request;
    if (
      reqUrl.startsWith('tel:') ||
      reqUrl.startsWith('mailto:') ||
      reqUrl.startsWith('facetime:')
    ) {
      Linking.openURL(reqUrl).catch(() => {});
      return false;
    }
    if (
      Platform.OS === 'android' &&
      (reqUrl.startsWith('intent:') ||
        reqUrl.startsWith('market:') ||
        reqUrl.startsWith('android-app:'))
    ) {
      Linking.openURL(reqUrl).catch(() => {});
      return false;
    }
    return true;
  }, []);

  const onOpenWindow = useCallback((syntheticEvent) => {
    const targetUrl = syntheticEvent.nativeEvent.targetUrl;
    if (!targetUrl || targetUrl === 'about:blank') return;
    if (targetUrl.startsWith('tel:') || targetUrl.startsWith('mailto:')) {
      Linking.openURL(targetUrl).catch(() => {});
      return;
    }
    if (targetUrl.startsWith('http')) {
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(targetUrl)}; true;`
      );
    }
  }, []);

  const onMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === 'FIELDS_SCANNED') {
        const scanned = data.fields || [];
        setFields(scanned);
        if (scanned.length > 0 && phase === 'loading') {
          setPhase('detected');
        }
      }

      if (data.type === 'FILL_COMPLETE') {
        const n = data.filled ?? 0;
        setFilledCount(prev => prev + n);
        if (!tracked && n > 0) {
          addHistoryEntry({
            url: currentUrl,
            title: pageTitle || getHostname(currentUrl),
            status: 'submitted',
            filled: n,
          });
          setTracked(true);
        }
        // Re-scan for longform fields after initial fill
        setTimeout(() => {
          setPhase('filled');
        }, 200);
      }

      if (data.type === 'AI_FILL_COMPLETE') {
        const n = data.filled ?? 0;
        setFilledCount(prev => prev + n);
        setPhase('filled');
      }


    } catch {}
  }, [phase, currentUrl, pageTitle, tracked]);

  const host = getHostname(currentUrl);
  const shortFieldCount = fieldCount - longFormFields.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      <View style={styles.chrome}>
        <IconBtn
          name="arrow-left"
          onPress={() => {
            if (webViewCanGoBack) {
              webViewRef.current?.goBack();
            } else if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.replace('Main');
            }
          }}
          color="#fff"
          style={{ width: 32, height: 32 }}
          size={16}
        />
        <View style={styles.urlPill}>
          <Icon name="lock" size={11} color="#a3a3a3" />
          <Text style={styles.urlText} numberOfLines={1}>{host}</Text>
        </View>
        <IconBtn
          name="refresh"
          color="#fff"
          style={{ width: 32, height: 32 }}
          size={15}
          onPress={() => webViewRef.current?.reload()}
        />
      </View>

      <View style={{ flex: 1, position: 'relative' }}>
        <WebView
          ref={webViewRef}
          source={{ uri: url }}
          style={{ flex: 1, backgroundColor: '#fff' }}
          onLoadStart={() => { setLoading(true); setPhase('loading'); setFields([]); }}
          onLoadEnd={() => {
            setLoading(false);
            webViewRef.current?.injectJavaScript(FORM_SCANNER_JS + '; true;');

          }}
          onNavigationStateChange={state => {
            setCurrentUrl(state.url);
            setPageTitle(state.title || '');
            setWebViewCanGoBack(state.canGoBack);
          }}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onOpenWindow={onOpenWindow}
          userAgent={WEBVIEW_USER_AGENT}
          sharedCookiesEnabled={Platform.OS === 'ios'}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
        />

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={theme.colors.ink} />
          </View>
        )}



        {(phase === 'detected' || phase === 'filled') && (
          <Animated.View
            style={[
              styles.fab,
              {
                opacity: fabAnim,
                transform: [{
                  translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }),
                }],
              },
            ]}
          >
            <TouchableOpacity activeOpacity={0.85} style={styles.fabBtn} onPress={() => setPhase('panel')}>
              <View style={styles.fabDot}>
                <Icon
                  name={phase === 'filled' ? 'check' : 'zap'}
                  size={14}
                  color="#052e1f"
                  strokeWidth={phase === 'filled' ? 3 : 2.5}
                />
              </View>
              <Text style={styles.fabText}>
                {phase === 'filled' ? 'Filled' : 'Autofill ready'}
              </Text>
              <View style={styles.fabCount}>
                <Text style={styles.fabCountText}>
                  {phase === 'filled' ? filledCount : fieldCount}
                </Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
        )}

        {(phase === 'panel' || phase === 'filling' || phase === 'drafting') && (
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.panelWrap,
              {
                opacity: panelAnim,
                transform: [{
                  translateY: panelAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }),
                }],
              },
            ]}
          >
            <View style={styles.panel}>
              {phase === 'panel' && (
                <>
                  <View style={styles.panelHead}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={styles.panelMark}>
                        <Text style={styles.panelMarkText}>e</Text>
                      </View>
                      <View>
                        <Text style={styles.panelTitle}>Form detected</Text>
                        <Text style={styles.panelSub}>{host} · {fieldCount} fields</Text>
                      </View>
                    </View>
                    <IconBtn name="close" onPress={() => setPhase(filledCount > 0 ? 'filled' : 'detected')} />
                  </View>

                  <View style={styles.panelStats}>
                    <View style={styles.panelRow}>
                      <View style={styles.panelNum}><Text style={styles.panelNumText}>{shortFieldCount}</Text></View>
                      <Text style={styles.panelRowText}>Personal + work fields</Text>
                      <Icon name="check" size={14} color={theme.colors.accent} strokeWidth={2.5} />
                    </View>
                    {longFormFields.length > 0 && (
                      <View style={styles.panelRow}>
                        <View style={styles.panelNum}><Text style={styles.panelNumText}>{longFormFields.length}</Text></View>
                        <Text style={styles.panelRowText}>Long-form fields</Text>
                        <Icon name="edit" size={14} color={theme.colors.muted} />
                      </View>
                    )}
                  </View>

                  {/* Primary: regex fill — instant, no backend */}
                  <TouchableOpacity
                    onPress={() => doAutofillRegex(fields)}
                    activeOpacity={0.85}
                    style={styles.fillBtn}
                  >
                    <Icon name="zap" size={15} color={theme.colors.accent} strokeWidth={2.5} />
                    <Text style={styles.fillBtnText}>
                      Fill {shortFieldCount} field{shortFieldCount === 1 ? '' : 's'} · Regex
                    </Text>
                  </TouchableOpacity>

                  {/* Secondary: AI fill — smarter matching + long-form draft */}
                  <TouchableOpacity
                    onPress={() => { doAutofillAI(fields); longFormFields.length > 0 && doAiDraft(); }}
                    activeOpacity={0.85}
                    style={styles.aiBtn}
                  >
                    <Icon name="sparkles" size={14} color={theme.colors.accentInk} />
                    <Text style={styles.aiBtnText}>
                      Fill with AI{longFormFields.length > 0 ? ` + draft ${longFormFields.length} long answer${longFormFields.length === 1 ? '' : 's'}` : ''}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.panelFoot}>
                    <Icon name="lock" size={11} color={theme.colors.muted} />
                    <Text style={styles.panelFootText}>Regex is offline · AI uses your local backend</Text>
                  </View>
                </>
              )}

              {phase === 'filling' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.scanIcon}>
                    <ActivityIndicator color={theme.colors.accentInk} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.panelTitle}>Autofilling…</Text>
                    <Text style={[styles.panelSub, { marginTop: 4 }]}>
                      Matching your profile to each field
                    </Text>
                  </View>
                </View>
              )}

              {phase === 'drafting' && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={styles.scanIcon}>
                      <Icon name="sparkles" size={18} color={theme.colors.accentInk} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.panelTitle}>Drafting with AI…</Text>
                      <Text style={[styles.panelSub, { marginTop: 4, fontFamily: theme.font.mono }]}>
                        {draftProgress.current}/{draftProgress.total} answers written
                      </Text>
                    </View>
                  </View>
                  <View style={styles.progress}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${draftProgress.total === 0 ? 0 : (draftProgress.current / draftProgress.total) * 100}%`,
                        },
                      ]}
                    />
                  </View>
                </>
              )}
            </View>
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1a1a1a' },
  chrome: {
    height: 44,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2a2a2a',
  },
  urlPill: {
    flex: 1,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  urlText: {
    flex: 1,
    color: '#d4d4d4',
    fontSize: 11,
    fontFamily: theme.font.mono,
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: 14,
    bottom: 22,
  },
  fabBtn: {
    height: 46,
    paddingHorizontal: 14,
    paddingLeft: 10,
    borderRadius: 23,
    backgroundColor: theme.colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...theme.shadow.lg,
  },
  fabDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: theme.font.sans,
    fontWeight: '600',
  },
  fabCount: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  fabCountText: {
    color: '#052e1f',
    fontSize: 11,
    fontFamily: theme.font.monoExtraBold,
    letterSpacing: -0.4,
  },
  panelWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 14,
  },
  panel: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 20,
    padding: 14,
    ...theme.shadow.lg,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  panelMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: theme.colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelMarkText: {
    color: '#fff',
    fontFamily: theme.font.monoExtraBold,
    fontSize: 14,
    letterSpacing: -1.2,
  },
  panelTitle: {
    fontSize: 14,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    color: theme.colors.ink,
  },
  panelSub: {
    fontSize: 11,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    marginTop: 2,
  },
  panelStats: { marginTop: 10, gap: 2 },
  panelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 2,
  },
  panelNum: {
    minWidth: 22,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 5,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelNumText: {
    color: theme.colors.accentInk,
    fontFamily: theme.font.monoExtraBold,
    fontSize: 10,
  },
  panelRowText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: theme.font.sans,
    color: theme.colors.ink2,
  },
  fillBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fillBtnText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: theme.font.sans,
    fontWeight: '600',
  },
  aiBtn: {
    marginTop: 8,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.colors.accentSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  aiBtnText: {
    color: theme.colors.accentInk,
    fontSize: 13,
    fontFamily: theme.font.sans,
    fontWeight: '700',
  },
  panelFoot: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
  },
  panelFootText: {
    fontSize: 11,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
  },
  scanIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: {
    marginTop: 12,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.accent,
    borderRadius: 3,
  },
});
