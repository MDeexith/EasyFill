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

  let installScanner, matchFieldsToProfile, loadProfile, getAiEnabled, mergeFieldCorrections;

  try {
    ([
      { installScanner },
      { matchFieldsToProfile },
      { loadProfile, getAiEnabled, mergeFieldCorrections },
    ] = await Promise.all([
      import(ext('scanner/formScanner.js')),
      import(ext('shared/matcher/index.js')),
      import(ext('shared/storage.js')),
    ]));
  } catch (err) {
    console.error('[EasyFill] Failed to load extension modules:', err);
    return;
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  let lastFields  = [];
  let lastMapping = {};
  let fillPending = false;

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

  // ─── Core autofill flow ────────────────────────────────────────────────────
  // Sends fill parameters to filler-main.js (MAIN world) via postMessage.
  // filler-main.js bypasses the page CSP; no inline script injection needed.

  async function runAutofill(fields) {
    if (!fields || fields.length === 0) return;
    if (fillPending) return;
    fillPending = true;

    try {
      const profile   = await loadProfile();
      const aiEnabled = await getAiEnabled();
      const hostname  = location.hostname;

      const { mapping } = await matchFieldsToProfile(fields, profile, aiEnabled, hostname);
      lastMapping = mapping;

      if (Object.keys(mapping).length === 0) {
        console.log('[EasyFill] No fields matched — skipping fill');
        notifyPopup({ type: 'STATUS', fieldsFound: fields.length, fieldsMapped: 0 });
        return;
      }

      const filledAfIds = Object.fromEntries(Object.keys(mapping).map(id => [id, true]));

      // Ask filler-main.js (MAIN world) to fill — bypasses page CSP.
      window.postMessage({
        source: 'easyfill',
        type: 'DO_FILL',
        mapping,
        profile,
        groupMeta: buildGroupMeta(fields),
      }, '*');

      window.postMessage({
        source: 'easyfill',
        type: 'INSTALL_CORRECTION_LISTENER',
        filledAfIds,
      }, '*');
    } catch (err) {
      console.error('[EasyFill] Autofill error:', err);
    } finally {
      fillPending = false;
    }
  }

  // ─── Scanner callback ───────────────────────────────────────────────────────

  function onScannerMessage(msg) {
    if (msg.type === 'FIELDS_SCANNED' || msg.type === 'FIELDS_UPDATED') {
      lastFields = msg.fields || [];
      notifyPopup({ type: 'FIELDS_FOUND', count: lastFields.length });
      runAutofill(lastFields);
    }
  }

  // ─── Messages from filler-main.js (MAIN world) ──────────────────────────────

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'easyfill') return;

    if (e.data.type === 'FILL_COMPLETE') {
      notifyPopup({ type: 'FILL_COMPLETE', filled: e.data.filled, total: lastFields.length });
    }

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
