export const FORM_SCANNER_JS = `
(function() {
  if (window.__AF_SCANNER_INSTALLED__) { return; }
  window.__AF_SCANNER_INSTALLED__ = true;

  var AF_ATTR = 'data-af-id';
  var SKIP_ROLE_RE = /^(navigation|menu|menubar|tablist|toolbar|banner|contentinfo)$/i;
  var INPUT_SELECTOR =
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]):not([type=file]),' +
    'textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]';

  // Stable counter so af_<n> ids never collide
  var afCounter = 0;
  // Field-set fingerprint to debounce no-op re-scans
  var lastFingerprint = '';
  var stableScans = 0;
  var rescanTimer = null;

  // ── helpers ──────────────────────────────────────────────────────────────

  function isContentEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    var ce = el.getAttribute && el.getAttribute('contenteditable');
    if (ce === '' || ce === 'true') return true;
    if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
    return false;
  }

  var ATS_DOMAIN_RE = /\b(boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs\.lever\.co|app\.lever\.co|wd\d+\.myworkdayjobs\.com|apply\.workable\.com|smartrecruiters\.com|icims\.com|taleo\.net|jobvite\.com|ashbyhq\.com|recruitee\.com|bamboohr\.com)\b/i;

  function getDocs(rootDoc) {
    var docs = [rootDoc];
    var iframes = rootDoc.getElementsByTagName('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try {
        var d = iframes[i].contentDocument;
        if (d && d.body) docs.push(d);
      } catch (e) {
        // Cross-origin: if it's a known ATS, tell React Native to navigate there directly
        var src = iframes[i].src || iframes[i].getAttribute('src') || '';
        if (src && ATS_DOMAIN_RE.test(src) && window.ReactNativeWebView) {
          if (!window.__AF_ATS_REPORTED__) window.__AF_ATS_REPORTED__ = {};
          if (!window.__AF_ATS_REPORTED__[src]) {
            window.__AF_ATS_REPORTED__[src] = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'ATS_IFRAME_DETECTED', src: src,
            }));
          }
        }
      }
    }
    return docs;
  }

  function queryAllDeep(root, selector) {
    var results = [];
    function walk(node) {
      if (!node || !node.querySelectorAll) return;
      try {
        var matches = node.querySelectorAll(selector);
        for (var i = 0; i < matches.length; i++) results.push(matches[i]);
      } catch (e) {}
      // Descend into open shadow roots
      var all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (var j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) walk(all[j].shadowRoot);
      }
    }
    walk(root);
    return results;
  }

  function preferredLabelFor(el) {
    // 1. <label for="id">
    if (el.id) {
      try {
        var doc = el.ownerDocument || document;
        var root = (el.getRootNode && el.getRootNode()) || doc;
        var lbl = root.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (!lbl && root !== doc) lbl = doc.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl && lbl.innerText) return lbl.innerText.trim().slice(0, 120);
      } catch (e) {}
    }
    // 2. wrapping <label>
    var p = el.parentElement;
    for (var i = 0; i < 3 && p; i++) {
      if (p.tagName === 'LABEL' && p.innerText) return p.innerText.trim().slice(0, 120);
      p = p.parentElement;
    }
    // 3. aria-labelledby
    var llby = el.getAttribute && el.getAttribute('aria-labelledby');
    if (llby) {
      try {
        var doc2 = el.ownerDocument || document;
        var root2 = (el.getRootNode && el.getRootNode()) || doc2;
        var firstId = llby.split(/\\s+/)[0];
        var target = (root2.getElementById ? root2.getElementById(firstId) : null)
                  || doc2.getElementById(firstId);
        if (target && target.innerText) return target.innerText.trim().slice(0, 120);
      } catch (e) {}
    }
    return '';
  }

  function getNearbyText(el) {
    // Prefer immediately preceding sibling <label> or text in document order
    var prev = el.previousElementSibling;
    if (prev && prev.tagName === 'LABEL' && prev.innerText) {
      return prev.innerText.trim().slice(0, 120);
    }

    // Walk up to 6 ancestors, skipping nav/menu/toolbar landmarks,
    // and grab the first <label> we encounter.
    var p = el.parentElement;
    for (var i = 0; i < 6 && p; i++) {
      var role = p.getAttribute && p.getAttribute('role');
      if (role && SKIP_ROLE_RE.test(role)) { p = p.parentElement; continue; }
      var lbls = p.querySelectorAll ? p.querySelectorAll('label') : [];
      if (lbls.length > 0 && lbls[0].innerText) {
        return lbls[0].innerText.trim().slice(0, 120);
      }
      p = p.parentElement;
    }

    // Fallback: preceding text node
    var siblings = el.parentElement ? el.parentElement.childNodes : [];
    for (var j = 0; j < siblings.length; j++) {
      var n = siblings[j];
      if (n === el) break;
      if (n.nodeType === 3 && n.textContent && n.textContent.trim()) {
        return n.textContent.trim().slice(0, 120);
      }
    }

    if (prev && prev.innerText) return prev.innerText.trim().slice(0, 120);
    return '';
  }

  function describeField(el) {
    var afId = el.getAttribute(AF_ATTR);
    if (!afId) {
      // Always use a synthetic id; never trust el.id (collisions in the wild)
      afId = 'af_' + (afCounter++);
      try { el.setAttribute(AF_ATTR, afId); } catch (e) {}
    }

    var tag = el.tagName.toLowerCase();
    var rawType = (el.getAttribute && el.getAttribute('type')) || '';
    var inputType = rawType ? rawType.toLowerCase() : tag;
    var contentEditable = isContentEditable(el);

    return {
      id: afId,
      domId: el.id || '',
      name: (el.getAttribute && el.getAttribute('name')) || '',
      tag: tag,
      type: inputType,
      inputType: inputType,
      autocomplete: (el.getAttribute && el.getAttribute('autocomplete')) || '',
      pattern: (el.getAttribute && el.getAttribute('pattern')) || '',
      maxLength: (el.maxLength && el.maxLength > 0) ? el.maxLength : 0,
      required: !!(el.required || (el.getAttribute && el.getAttribute('aria-required') === 'true')),
      role: (el.getAttribute && el.getAttribute('role')) || '',
      ariaHasPopup: (el.getAttribute && el.getAttribute('aria-haspopup')) || '',
      ariaControls: (el.getAttribute && el.getAttribute('aria-controls')) || '',
      label: preferredLabelFor(el),
      placeholder: (el.getAttribute && el.getAttribute('placeholder')) || '',
      ariaLabel: (el.getAttribute && el.getAttribute('aria-label')) || '',
      nearbyText: getNearbyText(el),
      contentEditable: contentEditable,
      longform: tag === 'textarea' || contentEditable,
    };
  }

  function scanForms() {
    var fields = [];
    var docs = getDocs(document);
    for (var d = 0; d < docs.length; d++) {
      var els = queryAllDeep(docs[d], INPUT_SELECTOR);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        // Skip elements that are visually irrelevant (display:none ancestors are
        // common during hydration; we still index them so observers can replay).
        if (!el || !el.tagName) continue;
        try {
          fields.push(describeField(el));
        } catch (e) {}
      }
    }

    // Deduplicate by af-id (Shadow DOM + iframe walks can revisit nodes)
    var seen = {};
    var unique = [];
    for (var k = 0; k < fields.length; k++) {
      if (!seen[fields[k].id]) {
        seen[fields[k].id] = true;
        unique.push(fields[k]);
      }
    }

    // Stable fingerprint of the field set; suppress duplicate posts
    var fp = unique.map(function(f) {
      return f.id + ':' + f.name + ':' + f.type + ':' + f.autocomplete;
    }).join('|');

    if (fp === lastFingerprint) {
      stableScans++;
    } else {
      var isFirstScan = lastFingerprint === '';
      lastFingerprint = fp;
      stableScans = 0;
      if (unique.length > 0 && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: isFirstScan ? 'FIELDS_SCANNED' : 'FIELDS_UPDATED', fields: unique,
        }));
      }
    }
  }

  function scheduleScan(delay) {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(function() {
      rescanTimer = null;
      scanForms();
    }, delay || 250);
  }

  // ── triggers ─────────────────────────────────────────────────────────────

  scanForms();

  if (document.readyState !== 'complete') {
    window.addEventListener('DOMContentLoaded', function() { scheduleScan(150); }, { once: true });
    window.addEventListener('load', function() { scheduleScan(300); }, { once: true });
  }

  // Safety-net periodic re-scans for late-hydrating SPAs; stops once two
  // consecutive scans return the same field set.
  var safetyDelays = [800, 1800, 3500, 6000, 8000];
  safetyDelays.forEach(function(ms) {
    setTimeout(function() {
      if (stableScans < 2) scanForms();
    }, ms);
  });

  // Adaptive observer on the main document
  try {
    var observer = new MutationObserver(function(mutations) {
      var trigger = false;
      for (var m = 0; m < mutations.length && !trigger; m++) {
        var mut = mutations[m];
        if (mut.type === 'attributes') {
          var t = mut.target;
          if (t && t.tagName === 'IFRAME' && mut.attributeName === 'src') trigger = true;
          else if (t && t.matches && t.matches(INPUT_SELECTOR)) trigger = true;
        } else if (mut.addedNodes && mut.addedNodes.length) {
          for (var n = 0; n < mut.addedNodes.length; n++) {
            var node = mut.addedNodes[n];
            if (node.nodeType !== 1) continue;
            if (
              node.tagName === 'FORM' ||
              node.tagName === 'INPUT' ||
              node.tagName === 'TEXTAREA' ||
              node.tagName === 'SELECT' ||
              node.tagName === 'IFRAME' ||
              isContentEditable(node) ||
              (node.querySelector && node.querySelector(INPUT_SELECTOR))
            ) { trigger = true; break; }
          }
        }
      }
      if (trigger) scheduleScan(300);
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['name', 'id', 'autocomplete', 'type', 'role', 'aria-label', 'aria-labelledby', 'placeholder', 'style', 'class', 'hidden', 'src'],
    });
  } catch (e) {}

  // IntersectionObserver: re-scan when previously hidden fields scroll into view.
  // Catches multi-step ATS forms (Workday, iCIMS) that reveal sections on scroll.
  try {
    var visObs = new IntersectionObserver(function(entries) {
      for (var e = 0; e < entries.length; e++) {
        if (entries[e].isIntersecting) { scheduleScan(200); return; }
      }
    }, { threshold: 0.1 });

    function observeAllInputs() {
      var docs = getDocs(document);
      for (var d = 0; d < docs.length; d++) {
        var iels = queryAllDeep(docs[d], INPUT_SELECTOR);
        for (var ii = 0; ii < iels.length; ii++) {
          try { visObs.observe(iels[ii]); } catch(ve) {}
        }
      }
    }
    observeAllInputs();

    var inputAddObs = new MutationObserver(function(mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        for (var n = 0; n < added.length; n++) {
          var node = added[n];
          if (!node || node.nodeType !== 1) continue;
          if (node.matches && node.matches(INPUT_SELECTOR)) {
            try { visObs.observe(node); } catch(ve) {}
          }
          if (node.querySelectorAll) {
            var ni = node.querySelectorAll(INPUT_SELECTOR);
            for (var k = 0; k < ni.length; k++) {
              try { visObs.observe(ni[k]); } catch(ve) {}
            }
          }
        }
      }
    });
    inputAddObs.observe(document.body || document.documentElement, {
      childList: true, subtree: true,
    });
  } catch (e) {}
})();
`;
