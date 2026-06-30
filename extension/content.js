// content.js — regular (non-module) content script (isolated world).
// Chrome does not support "type":"module" for manifest-declared content scripts.
// We use dynamic import() with chrome.runtime.getURL() instead, which works
// in content scripts and correctly resolves the full ES-module chain.
//
// Fill logic runs in a separate MAIN world content script (filler/filler-main.js),
// which is declared in the manifest with "world":"MAIN".  MAIN world scripts are
// injected by the extension and are never subject to the page's Content Security
// Policy — no 'unsafe-inline' required.  We communicate with it via postMessage.

(async () => {
  const ext = (path) => chrome.runtime.getURL(path);

  let installScanner, matchFieldsToProfile, loadProfile, getAiEnabled, mergeFieldCorrections,
      loadResumeText, resolveLocally, resolveWithAi, enrichProfile, generateText;

  try {
    ([
      { installScanner },
      { matchFieldsToProfile },
      { loadProfile, getAiEnabled, mergeFieldCorrections, loadResumeText },
      { resolveLocally, resolveWithAi },
      { enrichProfile },
      { generateText },
    ] = await Promise.all([
      import(ext('scanner/formScanner.js')),
      import(ext('shared/matcher/index.js')),
      import(ext('shared/storage.js')),
      import(ext('shared/optionResolver.js')),
      import(ext('shared/enrich.js')),
      import(ext('shared/backend.js')),
    ]));
  } catch (err) {
    console.error('[EasyFill] Failed to load extension modules:', err);
    return;
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  let lastFields  = [];
  let lastMapping = {};
  let fillPending = false;

  // ─── Resume text fallback from profile ───────────────────────────────────

  function buildResumeFromProfile(profile) {
    const lines = [];
    if (profile.name || profile.firstName) lines.push((profile.name || `${profile.firstName} ${profile.lastName}`).trim());
    if (profile.currentTitle) lines.push(profile.currentTitle);
    if (profile.currentCompany) lines.push(`at ${profile.currentCompany}`);
    if (profile.skills) lines.push(`\nSkills: ${profile.skills}`);
    const xp = Array.isArray(profile.experience) ? profile.experience : [];
    if (xp.length > 0) {
      lines.push('\nExperience:');
      for (const e of xp) {
        lines.push(`${e.title || ''} at ${e.company || ''} (${e.startDate || ''}–${e.endDate || 'Present'})`);
        if (e.description) lines.push(e.description);
      }
    }
    const edu = Array.isArray(profile.education) ? profile.education : [];
    if (edu.length > 0) {
      lines.push('\nEducation:');
      for (const e of edu) {
        lines.push(`${e.degree || ''} ${e.field || ''} — ${e.institution || ''} (${e.year || ''})`);
      }
    }
    return lines.join('\n');
  }

  // ─── Open-ended question detection ────────────────────────────────────────

  function looksLikeQuestion(text) {
    if (!text) return false;
    if (text.includes('?')) return true;
    return /^(why|how|do you|are you|would you|can you|have you|describe|tell us|explain|what |please)/i.test(text.trim());
  }

  // ─── Build group-meta for radio/checkbox widgets ───────────────────────────

  function buildGroupMeta(fields) {
    const meta = {};
    for (const f of (fields || [])) {
      if (!f || !f.id) continue;
      if (f.widget === 'radio-group' || f.widget === 'checkbox-group') {
        meta[f.id] = {
          widget: f.widget,
          options: (f.options || []).map(o => ({ afId: o.afId, value: o.value || '', label: o.label || '' })),
        };
      }
    }
    return meta;
  }

  // ─── Fill helper — wraps DO_FILL and resolves with the filled count ──────────

  function doFillAndWait(msg) {
    return new Promise(resolve => {
      function handler(e) {
        if (e.source === window && e.data?.source === 'easyfill' && e.data?.type === 'FILL_COMPLETE') {
          window.removeEventListener('message', handler);
          resolve(e.data.filled || 0);
        }
      }
      window.addEventListener('message', handler);
      window.postMessage(msg, '*');
    });
  }

  // ─── Core autofill flow ────────────────────────────────────────────────────
  // Sends fill parameters to filler-main.js (MAIN world) via postMessage.
  // filler-main.js bypasses the page CSP; no inline script injection needed.

  async function runAutofill(fields) {
    if (!fields || fields.length === 0) return;
    if (fillPending) return;
    fillPending = true;

    notifyPopup({ type: 'FILL_MATCHING' });

    try {
      const profile   = enrichProfile(await loadProfile());
      const aiEnabled = await getAiEnabled();
      const hostname  = location.hostname;

      const { mapping } = await matchFieldsToProfile(fields, profile, aiEnabled, hostname);
      lastMapping = mapping;

      if (Object.keys(mapping).length === 0) {
        console.log('[EasyFill] No fields matched — skipping fill');
        notifyPopup({ type: 'FILL_COMPLETE', filled: 0 });
        return;
      }

      // Resolve dropdown/radio-group options: text-match first, then AI for leftovers.
      const { selections: localSel, unresolved } = resolveLocally(fields, mapping, profile);
      let optionSelections = localSel;
      if (aiEnabled && unresolved.length > 0) {
        try {
          const aiSel = await resolveWithAi(unresolved, mapping, profile);
          optionSelections = { ...localSel, ...aiSel };
        } catch (_) {}
      }

      // Split mapping: question fields (longform with question-like label) vs regular.
      const fieldById = Object.fromEntries(fields.map(f => [f.id, f]));
      const questionIds = new Set(Object.keys(mapping).filter(id => {
        const f = fieldById[id];
        return f && f.longform && looksLikeQuestion(f.label || f.ariaLabel || f.placeholder || f.nearbyText || '');
      }));

      const regularMapping  = Object.fromEntries(Object.entries(mapping).filter(([id]) => !questionIds.has(id)));
      const questionMapping = Object.fromEntries(Object.entries(mapping).filter(([id]) =>  questionIds.has(id)));
      const groupMeta = buildGroupMeta(fields);

      // Phase 1: fill regular fields immediately so the user sees progress.
      notifyPopup({ type: 'FILL_STARTED' });
      const filled1 = await doFillAndWait({
        source: 'easyfill', type: 'DO_FILL',
        mapping: regularMapping, profile, groupMeta, optionSelections, generatedValues: {},
      });

      // Phase 2: generate answers for question fields, then fill them.
      let filled2 = 0;
      if (aiEnabled && questionIds.size > 0) {
        notifyPopup({ type: 'FILL_GENERATING' });
        let resumeText = await loadResumeText();
        // Fallback: reconstruct from profile if resume text was never stored.
        if (!resumeText) resumeText = buildResumeFromProfile(profile);
        const generatedValues = {};
        const results = await Promise.allSettled(
          [...questionIds].map(id => {
            const f = fieldById[id];
            return generateText({
              profile,
              label: f.label || f.ariaLabel || '',
              placeholder: f.placeholder || '',
              nearby: f.nearbyText || '',
              host: hostname,
              resumeText,
            }).then(text => ({ id, text }));
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value?.text) {
            generatedValues[r.value.id] = r.value.text;
          }
        }
        if (Object.keys(generatedValues).length > 0) {
          filled2 = await doFillAndWait({
            source: 'easyfill', type: 'DO_FILL',
            mapping: questionMapping, profile, groupMeta: {}, optionSelections: {}, generatedValues,
          });
        }
      }

      notifyPopup({ type: 'FILL_COMPLETE', filled: filled1 + filled2, total: fields.length });

      const filledAfIds = Object.fromEntries(Object.keys(mapping).map(id => [id, true]));
      window.postMessage({ source: 'easyfill', type: 'INSTALL_CORRECTION_LISTENER', filledAfIds }, '*');
    } catch (err) {
      console.error('[EasyFill] Autofill error:', err);
      notifyPopup({ type: 'FILL_COMPLETE', filled: 0 });
    } finally {
      fillPending = false;
    }
  }

  // ─── Scanner callback ───────────────────────────────────────────────────────

  function onScannerMessage(msg) {
    if (msg.type === 'FIELDS_SCANNED' || msg.type === 'FIELDS_UPDATED') {
      lastFields = msg.fields || [];
      notifyPopup({ type: 'FIELDS_FOUND', count: lastFields.length });
      // Fill is intentional — user clicks "Fill this page" in the popup (TRIGGER_FILL).
    }
  }

  // ─── Messages from filler-main.js (MAIN world) ──────────────────────────────

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'easyfill') return;

    if (e.data.type === 'USER_INPUT_DETECTED') {
      const { afId, value } = e.data;
      const field = lastFields.find(f => f.id === afId);
      if (!field) return;
      const fp = [field.name || '', field.label || '', field.type || '', field.autocomplete || ''].join('|');
      await mergeFieldCorrections({ [fp]: value });
    }
  });

  // ─── Popup messages ─────────────────────────────────────────────────────────

  function notifyPopup(data) {
    chrome.runtime.sendMessage({ ...data, url: location.href }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_STATUS') {
      sendResponse({ fieldsFound: lastFields.length, fieldsMapped: Object.keys(lastMapping).length, url: location.href });
      return true;
    }
    if (msg.type === 'TRIGGER_FILL') {
      runAutofill(lastFields).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === 'RESCAN') {
      window.__AF_SCANNER_INSTALLED__ = false;
      installScanner(onScannerMessage);
      sendResponse({ ok: true });
      return true;
    }
  });

  // ─── Boot ───────────────────────────────────────────────────────────────────

  installScanner(onScannerMessage);

})();
