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
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { IconBtn } from '../components/ui';
import Icon from '../components/Icon';
import { theme } from '../theme/tokens';
import { FORM_SCANNER_JS } from '../webview/formScanner';

import { buildFillScript, buildDirectFillScript, buildCorrectionListenerScript } from '../webview/filler';
import { matchFieldsToProfile } from '../matcher';
import { resolveLocally, resolveWithAi } from '../matcher/optionResolver';
import { generateText } from '../api/backend';
import { loadProfile, addHistoryEntry, loadFieldCorrections, mergeFieldCorrections } from '../profile/store';
import { enrichProfile } from '../profile/enrich';

function getHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Known career-site URL patterns that wrap a Greenhouse iframe. We rewrite
// these to the embed URL on first load so the WebView never has to render
// the parent page or follow Greenhouse's 3-4 redirect chain to the wrapper
// page. Returns null when the URL doesn't match a known pattern.
//
// Patterns handled:
//   1. Greenhouse listing pages (most common feed `applyUrl`):
//        https://boards.greenhouse.io/<company>/jobs/<token>
//        https://job-boards.greenhouse.io/<company>/jobs/<token>
//   2. Greenhouse embed page (already-embed, just normalized):
//        https://job-boards.greenhouse.io/embed/job_app?for=<company>&token=<token>
//   3. Stripe wrapper:
//        https://stripe.com/jobs/listing/<slug>/<token>(/apply)?
//   4. Databricks wrapper:
//        https://www.databricks.com/company/careers/<cat>/<slug>-<token>
function transformCareerUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');
    let company = '';
    let token = '';

    // Greenhouse listing — by far the most common shape coming out of feeds.
    if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
      // Already an embed URL? Honour it as-is (ensures we don't loop).
      if (u.pathname.startsWith('/embed/job_app')) return null;
      const m = u.pathname.match(/^\/([a-z0-9_-]+)\/jobs\/(\d{6,})\/?$/i);
      if (m) { company = m[1]; token = m[2]; }
    }

    // Stripe.
    if (!token && host === 'stripe.com') {
      const m = u.pathname.match(/\/jobs\/listing\/[^/]+\/(\d{6,})(?:\/apply)?\/?$/);
      if (m) { company = 'stripe'; token = m[1]; }
    }

    // Databricks.
    if (!token && host === 'databricks.com') {
      const m = u.pathname.match(/\/company\/careers\/[^/]+\/.*?-(\d{6,})\/?$/);
      if (m) { company = 'databricks'; token = m[1]; }
    }

    // Universal `?gh_jid=<token>` fallback. Greenhouse appends this query
    // param on every redirect hop, so any URL on a host we recognise but
    // whose pathname didn't match still gives us the token. The company
    // slug falls back to the bare hostname (works for stripe.com,
    // databricks.com, and any other single-brand domain).
    if (!token) {
      const ghJid = u.searchParams.get('gh_jid');
      if (ghJid && /^\d{6,}$/.test(ghJid) && host && host !== 'localhost') {
        const slug = host.split('.')[0];
        if (slug && slug !== 'greenhouse') {
          company = slug;
          token = ghJid;
        }
      }
    }

    if (company && token) {
      return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(company)}&token=${encodeURIComponent(token)}`;
    }
  } catch (e) {}
  return null;
}

// Pre-page injection: force shadow roots open (Workday) + inject window.chrome stub
// so Google's sign-in page doesn't block with "this browser may not be secure".
const PRE_INJECT_JS = `(function(){
  try{var o=Element.prototype.attachShadow;Element.prototype.attachShadow=function(i){return o.call(this,{mode:'open'});};}catch(e){}
  try{if(!window.chrome){window.chrome={app:{isInstalled:false,InstallState:{DISABLED:'disabled',INSTALLED:'installed',NOT_INSTALLED:'not_installed'},RunningState:{CANNOT_RUN:'cannot_run',READY_TO_RUN:'ready_to_run',RUNNING:'running'}},runtime:{id:undefined}};}}catch(e){}
})();true;`;

// Desktop UA: job application forms (Greenhouse, Workday, Lever) render full
// field sets only on desktop. Mobile UA triggers stripped views or app-store redirects.
const WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/136.0.0.0 Safari/537.36';


export default function BrowserScreen({ route, navigation }) {
  const { url } = route.params;
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  // Pre-transform known career-site URLs (Stripe, Databricks, …) to their
  // Greenhouse embed form on initial load, so the WebView never wastes a
  // round-trip rendering the parent page wrapper. Falls through to the
  // original URL when the pattern doesn't match — runtime ATS detection
  // (formScanner.tryEagerGreenhouseDetect) handles everything else.
  const initialUrl = transformCareerUrl(url) || url;
  // webViewSource is React-controlled so we can navigate the WebView by
  // updating state — more reliable than injecting `window.location.href`
  // which can race with the parent page's own navigation handlers.
  const [webViewSource, setWebViewSource] = useState({ uri: initialUrl });
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [pageTitle, setPageTitle] = useState('');
  const [fields, setFields] = useState([]);
  const [phase, setPhase] = useState('loading');
  // phase: loading | detected | panel | filling | filling-ai | drafting | filled | ats-loading
  const [filledCount, setFilledCount] = useState(0);
  const [draftProgress, setDraftProgress] = useState({ current: 0, total: 0 });
  const [tracked, setTracked] = useState(false);
  const [webViewCanGoBack, setWebViewCanGoBack] = useState(false);
  const [fillStats, setFillStats] = useState({ autoMatched: 0, aiMatched: 0, regexMatched: 0 });
  const [pendingCorrections, setPendingCorrections] = useState({});
  const [multiStepActive, setMultiStepActive] = useState(false);
  const [stepCount, setStepCount] = useState(1);
  const multiStepActiveRef = useRef(false);
  const filledUrlsRef = useRef(new Set());

  const urlRef = useRef(initialUrl);
  const titleRef = useRef('');
  // If we pre-transformed the URL, mark it as already-handled so the runtime
  // ATS detector doesn't try to navigate to the same URL again.
  const lastAtsSrcRef = useRef(initialUrl !== url ? initialUrl : '');

  const { width: screenW, height: screenH } = useWindowDimensions();
  const FAB_W = 180;
  const FAB_H = 46;

  const fabPos = useRef({ x: screenW - FAB_W - 14, y: screenH - FAB_H - 22 - 44 });
  const fabPan = useRef(new Animated.ValueXY(fabPos.current)).current;
  const isDragging = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        isDragging.current = false;
        fabPan.setOffset({ x: fabPos.current.x, y: fabPos.current.y });
        fabPan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_, g) => {
        isDragging.current = Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6;
        fabPan.setValue({ x: g.dx, y: g.dy });
      },
      onPanResponderRelease: (_, g) => {
        fabPan.flattenOffset();
        const clampedX = Math.max(8, Math.min(fabPos.current.x + g.dx, screenW - FAB_W - 8));
        const clampedY = Math.max(8, Math.min(fabPos.current.y + g.dy, screenH - FAB_H - 80));
        fabPos.current = { x: clampedX, y: clampedY };
        Animated.spring(fabPan, {
          toValue: { x: clampedX, y: clampedY },
          useNativeDriver: false,
          tension: 60,
          friction: 8,
        }).start();
      },
    })
  ).current;

  const fabAnim = useRef(new Animated.Value(0)).current;
  const panelAnim = useRef(new Animated.Value(0)).current;
  const lastInjectedUrl = useRef('');
  const fieldsRef = useRef([]);

  const longFormFields = fields.filter(f => f.longform);
  const fieldCount = fields.length;

  useEffect(() => {
    const shouldShowFab = phase === 'detected' || phase === 'filled' || phase === 'no-fields' || phase === 'filling-ai';
    Animated.spring(fabAnim, {
      toValue: shouldShowFab ? 1 : 0,
      useNativeDriver: false,
      tension: 60,
      friction: 8,
    }).start();
  }, [phase, fabAnim]);

  // Safety net: if loading spinner is stuck (onLoadEnd never fired), clear it after 5s.
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(timer);
  }, [loading]);

  // Safety net: if filling/filling-ai/drafting hangs (backend timeout, network error),
  // revert to detected after 25s so user can retry.
  useEffect(() => {
    if (phase !== 'filling' && phase !== 'filling-ai' && phase !== 'drafting') return;
    const timer = setTimeout(() => {
      setPhase(prev =>
        (prev === 'filling' || prev === 'filling-ai' || prev === 'drafting') ? 'detected' : prev
      );
    }, 25000);
    return () => clearTimeout(timer);
  }, [phase]);

  // After page load, if no FIELDS_SCANNED message ever arrives, fall into a
  // 'no-fields' state so the user gets a manual "Scan again" affordance
  // instead of an invisible feature.
  // We don't trigger this during 'ats-loading' since we're mid-navigation
  // from a parent page (Stripe/Databricks) to the actual embed form.
  useEffect(() => {
    if (loading) return;
    if (fields.length > 0) return;
    if (phase !== 'loading') return;
    const timer = setTimeout(() => {
      setPhase(prev => (prev === 'loading' ? 'no-fields' : prev));
    }, 8000);
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

  useEffect(() => { multiStepActiveRef.current = multiStepActive; }, [multiStepActive]);
  useEffect(() => { fieldsRef.current = fields; }, [fields]);

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

  const doAiDraft = useCallback(async (longs) => {
    if (!longs || longs.length === 0) return;
    setPhase('drafting');
    setDraftProgress({ current: 0, total: longs.length });

    const profile = loadProfile();
    const host = getHostname(urlRef.current);
    const drafts = {};

    // Worker-pool: at most DRAFT_CONCURRENCY generate calls in flight at a
    // time. Sequential awaits caused N×latency wall time; full Promise.all
    // would burst the OpenRouter free-tier rate limit on long forms.
    const DRAFT_CONCURRENCY = 4;
    let nextIdx = 0;
    let completed = 0;

    async function worker() {
      while (true) {
        const i = nextIdx++;
        if (i >= longs.length) return;
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
        completed += 1;
        setDraftProgress({ current: completed, total: longs.length });
      }
    }

    const workerCount = Math.min(DRAFT_CONCURRENCY, longs.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    if (Object.keys(drafts).length > 0) {
      const script = buildDirectFillScript(drafts);
      webViewRef.current?.injectJavaScript(script);
      // Fallback: AI_FILL_COMPLETE message sets phase, but guard against it not firing
      setTimeout(() => setPhase(p => p === 'drafting' ? 'filled' : p), 5000);
    } else {
      setPhase('filled');
    }
  }, []);

  // Unified autofill: two-pass progressive fill.
  // Pass 1 (cache + regex) injects immediately; Pass 2 (AI) fills remaining in background.
  const doAutofill = useCallback(async (scanned) => {
    setPhase('filling');
    setFillStats({ autoMatched: 0, aiMatched: 0, regexMatched: 0 });
    filledUrlsRef.current.add(urlRef.current);
    try {
      const profile = enrichProfile(loadProfile());
      const host = getHostname(urlRef.current);

      // ── PASS 1: cache + regex (no AI) ───────────────────────────────────
      const { mapping: fastMapping, decisions: fastDecisions } =
        await matchFieldsToProfile(scanned, profile, false, host);

      // Resolve dropdown options locally (no AI) so the fast pass fills the
      // correct option (e.g. profile "USA" -> option "United States").
      const { selections: localSelections, unresolved: fastDropdownsForAi } =
        resolveLocally(scanned, fastMapping, profile);

      webViewRef.current?.injectJavaScript(
        buildFillScript(fastMapping, JSON.stringify(profile), scanned, localSelections)
      );

      let autoMatched = 0, regexMatched = 0;
      for (const dec of Object.values(fastDecisions || {})) {
        if (!dec?.key) continue;
        if (dec.source === 'autocomplete' || dec.source === 'type' || dec.source === 'cache') autoMatched++;
        else regexMatched++;
      }
      setFillStats({ autoMatched, aiMatched: 0, regexMatched });

      // FAB appears now — user can interact with fast-filled fields
      setPhase('filling-ai');

      // ── PASS 2: AI for uncovered fields ─────────────────────────────────
      const uncovered = scanned.filter(f => !fastMapping[f.id]);
      const fastKeys = new Set(Object.values(fastMapping));

      let safeAiMapping = {};
      let aiDropdownsForAi = [];

      if (uncovered.length > 0) {
        try {
          const { mapping: aiMapping, decisions: aiDecisions } =
            await matchFieldsToProfile(uncovered, profile, true, null);

          // Cross-pass dedup: skip keys already owned by fast pass
          for (const [id, key] of Object.entries(aiMapping)) {
            if (!fastKeys.has(key)) safeAiMapping[id] = key;
          }

          if (Object.keys(safeAiMapping).length > 0) {
            // Resolve dropdown options locally for AI-mapped fields too.
            const { selections: aiLocalSelections, unresolved } =
              resolveLocally(uncovered, safeAiMapping, profile);
            aiDropdownsForAi = unresolved;
            webViewRef.current?.injectJavaScript(
              buildFillScript(safeAiMapping, JSON.stringify(profile), uncovered, aiLocalSelections)
            );
          }

          let aiMatched = 0;
          for (const dec of Object.values(aiDecisions || {})) {
            if (!dec?.key) continue;
            if (dec.source === 'ai' || dec.source === 'ai-low') aiMatched++;
          }
          setFillStats(prev => ({ ...prev, aiMatched }));
        } catch { /* AI failed — fast fill stands */ }
      }

      // ── Dropdown option AI resolution ───────────────────────────────────
      // For dropdowns whose option couldn't be matched locally, ask the LLM to
      // pick the best option (e.g. "USA" -> "United States", "4" -> "3-5 years")
      // and inject a dropdown-only fill. Runs in the background after the fast
      // pass, mirroring the AI key-matching pass.
      try {
        const dropdownsForAi = fastDropdownsForAi.concat(aiDropdownsForAi);
        if (dropdownsForAi.length > 0) {
          const combinedMapping = { ...fastMapping, ...safeAiMapping };
          const aiSelections = await resolveWithAi(dropdownsForAi, combinedMapping, profile);
          if (Object.keys(aiSelections).length > 0) {
            webViewRef.current?.injectJavaScript(buildDirectFillScript(aiSelections));
          }
        }
      } catch { /* dropdown AI resolution failed — local selections stand */ }

      // Apply saved corrections for fields the profile didn't cover
      const corrections = loadFieldCorrections();
      const correctionFills = {};
      for (const f of scanned) {
        if (fastMapping[f.id]) continue;
        const fp = [f.name||'', f.label||'', f.type||'', f.autocomplete||''].join('|');
        if (fp.split('|').filter(Boolean).length < 2) continue;
        if (corrections[fp] !== undefined) correctionFills[f.id] = corrections[fp];
      }
      if (Object.keys(correctionFills).length > 0) {
        webViewRef.current?.injectJavaScript(buildDirectFillScript(correctionFills));
      }

      webViewRef.current?.injectJavaScript(
        buildCorrectionListenerScript(Object.keys(fastMapping))
      );

      setMultiStepActive(true);

      const longs = scanned.filter(f => f.longform);
      if (longs.length > 0) {
        await doAiDraft(longs);
      } else {
        setPhase('filled');
      }
    } catch {
      filledUrlsRef.current.delete(urlRef.current);
      setPhase('detected');
    }
  }, [doAiDraft]);

  const manualRescan = useCallback(() => {
    setPhase('loading');
    setFields([]);
    setFillStats({ autoMatched: 0, aiMatched: 0, regexMatched: 0 });
    setMultiStepActive(false);
    setStepCount(1);
    filledUrlsRef.current.clear();
    // Clear ALL guards so the scanner re-runs from scratch and ATS detection
    // can re-fire (otherwise stale __AF_ATS_REPORTED__ entries silence repeats).
    lastAtsSrcRef.current = '';
    webViewRef.current?.injectJavaScript(
      'window.__AF_SCANNER_INSTALLED__ = false;' +
      'window.__AF_ATS_REPORTED__ = {};' +
      'window.__AF_ATS_PRIMED__ = false;' +
      'window.__AF_ATS_POLL_STARTED__ = false;' +
      'true;'
    );
    webViewRef.current?.injectJavaScript(FORM_SCANNER_JS + '; true;');
  }, []);

  const handleSaveCorrections = useCallback(() => {
    mergeFieldCorrections(pendingCorrections);
    setPendingCorrections({});
  }, [pendingCorrections]);

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

    // Intercept any in-flight navigation to a known career-site URL and
    // short-circuit to the Greenhouse embed URL. Catches the redirect chain
    //   boards.greenhouse.io/X/jobs/Y → 302 → stripe.com/jobs/search?gh_jid=Y
    //   → 301 → stripe.com/jobs/listing/.../Y
    // before the WebView has to render the wrapper page.
    const transformed = transformCareerUrl(reqUrl);
    if (transformed && transformed !== reqUrl && lastAtsSrcRef.current !== transformed) {
      lastAtsSrcRef.current = transformed;
      setPhase('ats-loading');
      setWebViewSource({ uri: transformed });
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
          if (
            multiStepActiveRef.current &&
            !filledUrlsRef.current.has(urlRef.current)
          ) {
            filledUrlsRef.current.add(urlRef.current);
            setStepCount(prev => prev + 1);
            setTimeout(() => doAutofill(scanned), 600);
          } else {
            setPhase(prev =>
              (prev === 'loading' || prev === 'no-fields' || prev === 'ats-loading')
                ? 'detected' : prev
            );
          }
        }
      }

      if (data.type === 'ATS_IFRAME_DETECTED') {
        const atsSrc = data.src;
        // Navigate directly to the embed URL — it loads the full form standalone.
        // Do NOT transform to the listing page: that page re-embeds the same iframe
        // and Databricks forms include a validityToken that would be stripped.
        if (atsSrc && lastAtsSrcRef.current !== atsSrc) {
          lastAtsSrcRef.current = atsSrc;
          setPhase('ats-loading');
          // Belt-and-suspenders navigation:
          //   1. injectJavaScript window.location.replace — synchronous in the
          //      page context, works on every react-native-webview version,
          //      bypasses any same-source dedupe in React state.
          //   2. setWebViewSource — keeps React's notion of the URL in sync so
          //      `source` prop matches actual WebView URL after navigation.
          // Empirically (1) alone is reliable on Android; (2) alone has been
          // flaky when the WebView has already done internal navigations.
          webViewRef.current?.injectJavaScript(
            `window.location.replace(${JSON.stringify(atsSrc)}); true;`
          );
          setWebViewSource({ uri: atsSrc });
          // Greenhouse React SPA hydrates 1-4s after load. onLoadEnd injects the
          // scanner immediately (too early). Re-inject at 2s, 4s, 7s so we catch
          // fields that appear after React renders the form.
          [2000, 4000, 7000].forEach(delay => {
            setTimeout(() => {
              webViewRef.current?.injectJavaScript(
                'window.__AF_SCANNER_INSTALLED__ = false; true;'
              );
              webViewRef.current?.injectJavaScript(FORM_SCANNER_JS + '; true;');
            }, delay);
          });
        }
      }

      if (data.type === 'FIELDS_UPDATED') {
        const newFields = data.fields || [];
        if (newFields.length > 0) {
          const existing = new Set(fieldsRef.current.map(f => f.id));
          const added = newFields.filter(f => !existing.has(f.id));
          setFields(prev => added.length > 0 ? [...prev, ...added] : prev);
          if (
            multiStepActiveRef.current &&
            !filledUrlsRef.current.has(urlRef.current) &&
            added.length > 0
          ) {
            filledUrlsRef.current.add(urlRef.current);
            setStepCount(s => s + 1);
            setTimeout(() => doAutofill(added), 600);
          } else {
            setPhase(prev =>
              (prev === 'loading' || prev === 'no-fields' || prev === 'ats-loading')
                ? 'detected' : prev
            );
          }
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
        // Safety net: if FILL_COMPLETE fires while still in 'filling', advance to 'filling-ai'
        // (doAutofill controls the real filled transition after both passes complete)
        setTimeout(() => setPhase(prev => prev === 'filling' ? 'filling-ai' : prev), 200);
      }

      if (data.type === 'AI_FILL_COMPLETE') {
        const n = data.filled ?? 0;
        setFilledCount(prev => prev + n);
        setPhase(prev => prev === 'drafting' ? 'filled' : prev);
      }

      if (data.type === 'DIAG') {
        // Diagnostic info is logged only — surfaces in `adb logcat | grep AF`
        // for development; never shown in the UI.
        try {
          console.log('[AF DIAG]', data.stage, JSON.stringify({
            url: data.url,
            iframes: data.iframeCount,
            srcs: data.iframeSrcs,
            ghApp: data.hasGhApp,
            ghid: data.ghid,
            inputs: data.inputCount,
          }));
        } catch (e) {}
      }

      if (data.type === 'USER_INPUT_DETECTED') {
        const { afId, value, wasAutoFilled } = data;
        if (wasAutoFilled) return;
        setFields(currentFields => {
          const field = currentFields.find(f => f.id === afId);
          if (!field) return currentFields;
          const fp = [field.name||'', field.label||'', field.type||'', field.autocomplete||''].join('|');
          if (fp.split('|').filter(Boolean).length < 2) return currentFields;
          setPendingCorrections(prev => ({ ...prev, [fp]: value }));
          return currentFields;
        });
      }
    } catch {}
  }, [doAutofill]);

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
          source={webViewSource}
          style={{ flex: 1, backgroundColor: '#fff' }}
          injectedJavaScriptBeforeContentLoaded={PRE_INJECT_JS}
          onLoadStart={() => {
            setLoading(true);
            setFields([]);
            setFillStats({ autoMatched: 0, aiMatched: 0, regexMatched: 0 });
            setPendingCorrections({});
            // Preserve 'ats-loading' so the user sees the "Opening application
            // form…" banner uninterrupted across the parent→embed navigation.
            setPhase(prev => prev === 'ats-loading' ? prev : 'loading');
          }}
          onLoadEnd={() => {
            setLoading(false);
            lastInjectedUrl.current = urlRef.current;
            webViewRef.current?.injectJavaScript(FORM_SCANNER_JS + '; true;');
          }}
          onNavigationStateChange={state => {
            setCurrentUrl(state.url);
            setPageTitle(state.title || '');
            setWebViewCanGoBack(state.canGoBack);
            const prevUrl = urlRef.current;
            urlRef.current = state.url;
            titleRef.current = state.title || '';
            // Catch SPA route changes that don't trigger onLoadEnd
            if (state.url && state.url !== lastInjectedUrl.current) {
              lastInjectedUrl.current = state.url;
              setPhase(prev => prev === 'ats-loading' ? prev : 'loading');
              setFields([]);
              setFillStats({ autoMatched: 0, aiMatched: 0, regexMatched: 0 });
              setPendingCorrections({});
              // Reset ATS loop guard when hostname changes so a new job page on the
              // same company's ATS gets a fresh transform attempt.
              try {
                const prevHost = new URL(prevUrl).hostname;
                const nextHost = new URL(state.url).hostname;
                if (prevHost !== nextHost) {
                  lastAtsSrcRef.current = '';
                  setMultiStepActive(false);
                  setStepCount(1);
                  filledUrlsRef.current.clear();
                }
              } catch {}
              // Clear scanner guard + ATS report cache so detection re-fires on new page.
              webViewRef.current?.injectJavaScript(
                'window.__AF_SCANNER_INSTALLED__ = false; window.__AF_ATS_REPORTED__ = {}; true;'
              );
              setTimeout(() => {
                webViewRef.current?.injectJavaScript(FORM_SCANNER_JS + '; true;');
              }, 1000);
            }
          }}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onOpenWindow={onOpenWindow}
          userAgent={WEBVIEW_USER_AGENT}
          sharedCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
        />

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={theme.colors.ink} />
          </View>
        )}

        {phase === 'ats-loading' && (
          <View style={styles.atsBanner}>
            <ActivityIndicator size="small" color={theme.colors.accentInk} />
            <Text style={styles.atsBannerText}>
              Opening application form…
            </Text>
          </View>
        )}




        {(phase === 'detected' || phase === 'filled' || phase === 'no-fields' || phase === 'filling-ai') && (
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              styles.fab,
              {
                left: fabPan.x,
                top: fabPan.y,
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
              onPress={() => {
                if (isDragging.current) return;
                if (phase === 'no-fields') manualRescan();
                else if (phase !== 'filling-ai') setPhase('panel');
              }}
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
                {phase === 'filling-ai'
                  ? `${filledCount} filled · AI matching…`
                  : phase === 'filled'
                    ? (multiStepActive && stepCount > 1
                        ? `Step ${stepCount} · ${filledCount} filled`
                        : (fillStats.autoMatched + fillStats.aiMatched) > 0
                            ? `AI Auto:${fillStats.autoMatched + fillStats.aiMatched} · Regex:${fillStats.regexMatched}`
                            : 'Filled')
                    : phase === 'no-fields'
                      ? 'No fields · tap to rescan'
                      : multiStepActive
                        ? `Step ${stepCount} · Autofill ready`
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

        {phase === 'filled' && Object.keys(pendingCorrections).length > 0 && (
          <View style={styles.memorySave}>
            <TouchableOpacity onPress={handleSaveCorrections} activeOpacity={0.8} style={styles.memorySaveBtn}>
              <Icon name="bookmark" size={12} color={theme.colors.accentInk} strokeWidth={2} />
              <Text style={styles.memorySaveText}>
                Save {Object.keys(pendingCorrections).length} answer{Object.keys(pendingCorrections).length > 1 ? 's' : ''} to memory
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPendingCorrections({})} activeOpacity={0.7} style={styles.memorySaveDismiss}>
              <Icon name="close" size={11} color={theme.colors.muted} />
            </TouchableOpacity>
          </View>
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

  // Memory save chip
  memorySave: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
    ...theme.shadow.lg,
  },
  memorySaveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memorySaveText: {
    fontSize: 12,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.accentInk,
  },
  memorySaveDismiss: {
    padding: 4,
  },

  atsBanner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
    ...theme.shadow.lg,
  },
  atsBannerText: {
    fontSize: 13,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.accentInk,
  },

});
