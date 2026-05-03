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
  const [fillStats, setFillStats] = useState({ autoMatched: 0, aiMatched: 0, regexMatched: 0 });

  const urlRef = useRef(url);
  const titleRef = useRef('');


  const fabAnim = useRef(new Animated.Value(0)).current;
  const panelAnim = useRef(new Animated.Value(0)).current;
  const lastInjectedUrl = useRef('');

  const longFormFields = fields.filter(f => f.longform);
  const fieldCount = fields.length;

  useEffect(() => {
    const shouldShowFab = phase === 'detected' || phase === 'filled' || phase === 'no-fields';
    Animated.spring(fabAnim, {
      toValue: shouldShowFab ? 1 : 0,
      useNativeDriver: true,
      tension: 60,
      friction: 8,
    }).start();
  }, [phase, fabAnim]);

  // After page load, if no FIELDS_SCANNED message ever arrives, fall into a
  // 'no-fields' state so the user gets a manual "Scan again" affordance
  // instead of an invisible feature.
  useEffect(() => {
    if (loading) return;
    if (fields.length > 0) return;
    if (phase !== 'loading') return;
    const timer = setTimeout(() => {
      setPhase(prev => (prev === 'loading' ? 'no-fields' : prev));
    }, 4000);
    return () => clearTimeout(timer);
  }, [loading, fields.length, phase]);

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

    // Derive current title/company/yoe from experience[] when those keys are
    // empty, so the matcher has more profile keys to satisfy.
    const xp = Array.isArray(p.experience) ? p.experience : [];
    if (xp.length > 0) {
      const latest = xp[0] || {};
      if (!p.currentTitle && latest.title) p.currentTitle = latest.title;
      if (!p.currentCompany && latest.company) p.currentCompany = latest.company;
      if (!p.yearsExperience || p.yearsExperience === 0) {
        let totalMonths = 0;
        for (const e of xp) {
          const start = e.startDate ? new Date(e.startDate) : null;
          const end = e.endDate ? new Date(e.endDate) : new Date();
          if (start && !isNaN(start) && end && !isNaN(end) && end > start) {
            totalMonths += (end - start) / (1000 * 60 * 60 * 24 * 30.44);
          }
        }
        if (totalMonths > 0) p.yearsExperience = Math.round(totalMonths / 12);
      }
    }

    // Back-compat: legacy `salary` resolves to expectedSalary if the latter
    // is empty.
    if (!p.expectedSalary && p.salary) p.expectedSalary = p.salary;

    // Compose skills with any per-experience skills arrays.
    const skillSet = new Set();
    if (typeof p.skills === 'string' && p.skills.trim()) {
      p.skills.split(',').map(s => s.trim()).filter(Boolean).forEach(s => skillSet.add(s));
    }
    for (const e of xp) {
      if (Array.isArray(e.skills)) e.skills.forEach(s => s && skillSet.add(s));
    }
    if (skillSet.size > 0) p.skills = Array.from(skillSet).join(', ');

    return p;
  }

  const doAiDraft = useCallback(async (longs) => {
    if (!longs || longs.length === 0) return;
    setPhase('drafting');
    setDraftProgress({ current: 0, total: longs.length });

    const profile = loadProfile();
    const host = getHostname(urlRef.current);
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
      // Fallback: AI_FILL_COMPLETE message sets phase, but guard against it not firing
      setTimeout(() => setPhase(p => p === 'drafting' ? 'filled' : p), 5000);
    } else {
      setPhase('filled');
    }
  }, []);

  // Unified autofill: priority pipeline (autocomplete/type > AI > regex),
  // followed by long-form AI drafting.
  const doAutofill = useCallback(async (scanned) => {
    setPhase('filling');
    setFillStats({ autoMatched: 0, aiMatched: 0, regexMatched: 0 });
    try {
      const profile = enrichProfile(loadProfile());

      const { mapping, decisions } = await matchFieldsToProfile(scanned, profile, true);

      let autoMatched = 0;
      let aiMatched = 0;
      let regexMatched = 0;
      for (const dec of Object.values(decisions || {})) {
        if (!dec || !dec.key) continue;
        if (dec.source === 'autocomplete' || dec.source === 'type') autoMatched++;
        else if (dec.source === 'ai' || dec.source === 'ai-low') aiMatched++;
        else regexMatched++;
      }
      setFillStats({ autoMatched, aiMatched, regexMatched });

      const script = buildFillScript(mapping, JSON.stringify(profile));
      webViewRef.current?.injectJavaScript(script);

      const longs = scanned.filter(f => f.longform);
      if (longs.length > 0) {
        await doAiDraft(longs);
      }
    } catch {
      setPhase('detected');
    }
  }, [doAiDraft]);

  const manualRescan = useCallback(() => {
    setPhase('loading');
    setFields([]);
    setFillStats({ autoMatched: 0, aiMatched: 0, regexMatched: 0 });
    // Clear the install guard so the scanner re-runs from scratch.
    webViewRef.current?.injectJavaScript('window.__AF_SCANNER_INSTALLED__ = false; true;');
    webViewRef.current?.injectJavaScript(FORM_SCANNER_JS + '; true;');
  }, []);

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
        if (scanned.length > 0) {
          setPhase(prev => prev === 'loading' ? 'detected' : prev);
        }
      }

      if (data.type === 'FILL_COMPLETE') {
        const n = data.filled ?? 0;
        setFilledCount(prev => prev + n);
        setTracked(prev => {
          if (!prev && n > 0) {
            addHistoryEntry({
              url: urlRef.current,
              title: titleRef.current || getHostname(urlRef.current),
              status: 'submitted',
              filled: n,
            });
            return true;
          }
          return prev;
        });
        setTimeout(() => setPhase(prev => prev === 'filling' ? 'filled' : prev), 200);
      }

      if (data.type === 'AI_FILL_COMPLETE') {
        const n = data.filled ?? 0;
        setFilledCount(prev => prev + n);
        setPhase(prev => prev === 'drafting' ? 'filled' : prev);
      }
    } catch {}
  }, []);

  const host = getHostname(currentUrl);

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
          onLoadStart={() => { setLoading(true); setPhase('loading'); setFields([]); setFillStats({ autoMatched: 0, aiMatched: 0, regexMatched: 0 }); }}
          onLoadEnd={() => {
            setLoading(false);
            lastInjectedUrl.current = currentUrl;
            webViewRef.current?.injectJavaScript(FORM_SCANNER_JS + '; true;');
          }}
          onNavigationStateChange={state => {
            setCurrentUrl(state.url);
            setPageTitle(state.title || '');
            setWebViewCanGoBack(state.canGoBack);
            urlRef.current = state.url;
            titleRef.current = state.title || '';
            // Catch SPA route changes that don't trigger onLoadEnd
            if (state.url && state.url !== lastInjectedUrl.current) {
              lastInjectedUrl.current = state.url;
              setPhase('loading');
              setFields([]);
              setFillStats({ autoMatched: 0, aiMatched: 0, regexMatched: 0 });
              setTimeout(() => {
                webViewRef.current?.injectJavaScript(FORM_SCANNER_JS + '; true;');
              }, 600);
            }
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



        {(phase === 'detected' || phase === 'filled' || phase === 'no-fields') && (
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
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.fabBtn}
              onPress={() => phase === 'no-fields' ? manualRescan() : setPhase('panel')}
            >
              <View style={styles.fabDot}>
                <Icon
                  name={
                    phase === 'filled' ? 'check' :
                    phase === 'no-fields' ? 'refresh' :
                    'zap'
                  }
                  size={14}
                  color="#052e1f"
                  strokeWidth={phase === 'filled' ? 3 : 2.5}
                />
              </View>
              <Text style={styles.fabText}>
                {phase === 'filled'
                  ? ((fillStats.autoMatched + fillStats.aiMatched) > 0
                      ? `Auto:${fillStats.autoMatched} · AI:${fillStats.aiMatched} · Regex:${fillStats.regexMatched}`
                      : 'Filled')
                  : phase === 'no-fields'
                    ? 'No fields · tap to rescan'
                    : 'Autofill ready'}
              </Text>
              {phase !== 'no-fields' && (
                <View style={styles.fabCount}>
                  <Text style={styles.fabCountText}>
                    {phase === 'filled' ? filledCount : fieldCount}
                  </Text>
                </View>
              )}
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
                      <View style={styles.panelNum}><Text style={styles.panelNumText}>{fieldCount - longFormFields.length}</Text></View>
                      <Text style={styles.panelRowText}>Short fields</Text>
                      <Icon name="zap" size={13} color={theme.colors.accent} strokeWidth={2.5} />
                    </View>
                    {longFormFields.length > 0 && (
                      <View style={styles.panelRow}>
                        <View style={styles.panelNum}><Text style={styles.panelNumText}>{longFormFields.length}</Text></View>
                        <Text style={styles.panelRowText}>Long-form {longFormFields.length === 1 ? 'answer' : 'answers'}</Text>
                        <Icon name="sparkles" size={13} color={theme.colors.muted} />
                      </View>
                    )}
                  </View>

                  <TouchableOpacity
                    onPress={() => doAutofill(fields)}
                    activeOpacity={0.85}
                    style={styles.fillBtn}
                  >
                    <Icon name="sparkles" size={15} color={theme.colors.accent} strokeWidth={2.5} />
                    <Text style={styles.fillBtnText}>
                      Autofill {fieldCount} field{fieldCount === 1 ? '' : 's'}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.panelFoot}>
                    <Icon name="zap" size={11} color={theme.colors.muted} />
                    <Text style={styles.panelFootText}>AI matching · Regex fallback · Local backend</Text>
                  </View>
                </>
              )}

              {phase === 'filling' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.scanIcon}>
                    <ActivityIndicator color={theme.colors.accentInk} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.panelTitle}>Matching fields…</Text>
                    <Text style={[styles.panelSub, { marginTop: 4 }]}>
                      AI + regex analyzing {fieldCount} fields
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
