export const FORM_SCANNER_JS = `
(function() {
  if (window.__AF_SCANNER_INSTALLED__) { return; }
  window.__AF_SCANNER_INSTALLED__ = true;

  var AF_ATTR = 'data-af-id';
  var SKIP_ROLE_RE = /^(navigation|menu|menubar|tablist|toolbar|banner|contentinfo)$/i;
  var INPUT_SELECTOR =
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]):not([type=file]):not([aria-hidden="true"]),' +
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

  function reportAtsIframe(src) {
    if (!src || !window.ReactNativeWebView) return false;
    if (!ATS_DOMAIN_RE.test(src)) return false;
    if (!window.__AF_ATS_REPORTED__) window.__AF_ATS_REPORTED__ = {};
    if (window.__AF_ATS_REPORTED__[src]) return true;
    window.__AF_ATS_REPORTED__[src] = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'ATS_IFRAME_DETECTED', src: src,
    }));
    return true;
  }

  // Career sites that wrap a Greenhouse iframe leave a \`<div id="grnhse_app">\`
  // marker in their SSR HTML. We extract the Greenhouse token from one of:
  //   1. data-ghid attribute (Stripe-style: <div id="grnhse_app" data-ghid="X">)
  //   2. existing Greenhouse loader script's \`for\`/\`token\` query params
  //   3. trailing numeric segment of location.pathname (Databricks-style:
  //      .../slug-12345678901)
  // …and the company slug from one of:
  //   1. \`for=\` param of a Greenhouse loader script (most accurate)
  //   2. first label of location.hostname (works for stripe.com → "stripe",
  //      databricks.com → "databricks")
  // Then we construct the embed URL and navigate, without waiting for the
  // iframe to ever be injected by the page's async loader.
  function tryEagerGreenhouseDetect() {
    try {
      var ghApp = document.getElementById('grnhse_app');
      if (!ghApp) return false;

      var ghid = '';
      var company = '';

      var dghid = ghApp.getAttribute && ghApp.getAttribute('data-ghid');
      if (dghid) ghid = dghid;

      try {
        var loader = document.querySelector('script[src*="boards.greenhouse.io"]');
        if (loader && loader.src) {
          var fm = loader.src.match(/[?&]for=([^&#]+)/);
          if (fm) company = decodeURIComponent(fm[1]);
          if (!ghid) {
            var tm = loader.src.match(/[?&]token=([^&#]+)/);
            if (tm) ghid = decodeURIComponent(tm[1]);
          }
        }
      } catch (e) {}

      // URL-pathname fallback for sites like Databricks whose SSR HTML lacks
      // a data-ghid attribute. Greenhouse tokens are 6+ digits at the end of
      // the path (sometimes followed by /apply).
      if (!ghid) {
        try {
          var path = (location.pathname || '').replace(/\\/+$/, '');
          var pm = path.match(/[-\\/](\\d{6,})(?:\\/apply)?$/);
          if (pm) ghid = pm[1];
        } catch (e) {}
      }

      if (!company) {
        var host = (location.hostname || '').replace(/^www\\./, '');
        company = host.split('.')[0] || '';
      }

      if (!company || !ghid) return false;
      var url = 'https://job-boards.greenhouse.io/embed/job_app?for=' +
        encodeURIComponent(company) + '&token=' + encodeURIComponent(ghid);
      return reportAtsIframe(url);
    } catch (e) { return false; }
  }

  function postDiag(stage) {
    if (!window.ReactNativeWebView) return;
    try {
      var iframes = document.getElementsByTagName('iframe');
      var srcs = [];
      for (var i = 0; i < iframes.length; i++) {
        srcs.push((iframes[i].src || iframes[i].getAttribute('src') || '').slice(0, 160));
      }
      var ghApp = document.getElementById('grnhse_app');
      var inputCount = 0;
      try { inputCount = document.querySelectorAll('input,textarea,select').length; } catch (e) {}
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'DIAG',
        stage: stage,
        url: location.href.slice(0, 200),
        readyState: document.readyState,
        iframeCount: iframes.length,
        iframeSrcs: srcs,
        hasGhApp: !!ghApp,
        ghid: ghApp && ghApp.getAttribute ? (ghApp.getAttribute('data-ghid') || '') : '',
        inputCount: inputCount,
      }));
    } catch (e) {}
  }

  function getDocs(rootDoc) {
    var docs = [rootDoc];
    var iframes = rootDoc.getElementsByTagName('iframe');
    for (var i = 0; i < iframes.length; i++) {
      var iframeDoc = null;
      try { iframeDoc = iframes[i].contentDocument; } catch (e) {}

      if (iframeDoc && iframeDoc.body) {
        docs.push(iframeDoc);
      } else {
        // contentDocument is null or threw — cross-origin iframe.
        // RN WebView returns null instead of throwing for cross-origin access,
        // so ATS detection must live here (not only in catch).
        var src = iframes[i].src || iframes[i].getAttribute('src') || '';
        // loading="lazy" can defer iframe content fetch on mobile — flip to
        // eager so cross-origin job-board iframes load even if below the fold.
        try {
          if (iframes[i].getAttribute && iframes[i].getAttribute('loading') === 'lazy') {
            iframes[i].setAttribute('loading', 'eager');
          }
        } catch (e) {}
        reportAtsIframe(src);
      }
    }
    return docs;
  }

  // Many career sites (Stripe, Databricks) only insert the Greenhouse iframe
  // *after* their boards loader script runs — which can be lazy-loaded
  // (deferred until scroll/idle). Detect the marker, force the loader to run,
  // and aggressively poll for the iframe so we don't depend on user scroll.
  function primeAtsLoaders() {
    if (window.__AF_ATS_PRIMED__) return;
    window.__AF_ATS_PRIMED__ = true;

    var ghApp = document.getElementById('grnhse_app');
    if (ghApp) {
      // Some pages wait until \`grnhse_app\` is visible to load the iframe.
      // Force-trigger any existing async/deferred Greenhouse loader scripts.
      try {
        var scripts = document.querySelectorAll('script[src*="boards.greenhouse.io/embed/job_board/js"], script[src*="boards.greenhouse.io"]');
        for (var i = 0; i < scripts.length; i++) {
          var s = scripts[i];
          // Re-insert (clones execute) if it never ran or got deferred.
          var clone = document.createElement('script');
          clone.async = false;
          clone.src = s.src;
          (document.head || document.body).appendChild(clone);
        }
        // If no loader script tag is present at all, infer the company from
        // hostname and inject the official Greenhouse loader directly.
        if (scripts.length === 0) {
          var host = (location.hostname || '').replace(/^www\\./, '');
          var ghidEl = ghApp.getAttribute && ghApp.getAttribute('data-ghid');
          var company = host.split('.')[0];
          if (ghidEl && company) {
            var loader = document.createElement('script');
            loader.async = false;
            loader.src = 'https://boards.greenhouse.io/embed/job_board/js?for=' + encodeURIComponent(company);
            (document.head || document.body).appendChild(loader);
          }
        }
      } catch (e) {}
    }
  }

  function pollForAtsIframes() {
    if (window.__AF_ATS_POLL_STARTED__) return;
    window.__AF_ATS_POLL_STARTED__ = true;

    var elapsed = 0;
    var INTERVAL = 800;
    var MAX = 60000;

    var poll = setInterval(function() {
      elapsed += INTERVAL;
      try {
        var iframes = document.getElementsByTagName('iframe');
        var found = false;
        for (var i = 0; i < iframes.length; i++) {
          var src = iframes[i].src || iframes[i].getAttribute('src') || '';
          if (src && ATS_DOMAIN_RE.test(src)) {
            if (reportAtsIframe(src)) found = true;
          }
        }
        // Eager-detect via SSR markers each cycle — covers SPAs that add
        // \`#grnhse_app\` after initial page load.
        if (!found && tryEagerGreenhouseDetect()) found = true;

        // Once we've reported, we can stop early — BrowserScreen will navigate.
        if (found) { clearInterval(poll); return; }

        // Iframe not yet in DOM. If a Greenhouse marker is present but no
        // iframe, re-prime the loader (script may have failed silently).
        if (document.getElementById('grnhse_app') && elapsed % 4000 === 0) {
          window.__AF_ATS_PRIMED__ = false;
          primeAtsLoaders();
        }
      } catch (e) {}
      if (elapsed >= MAX) clearInterval(poll);
    }, INTERVAL);
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

    if (fp === lastFingerprint && fp !== '') {
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

  // Eager Greenhouse detection — fires *before* iframe is even injected, by
  // reading the SSR \`#grnhse_app[data-ghid]\` marker. Critical for sites where
  // the loader script is heavily lazy-loaded (Stripe mobile rendering).
  try { tryEagerGreenhouseDetect(); } catch (e) {}
  // Run ATS priming + polling immediately so career sites that only
  // inject the application iframe on scroll/idle still get detected fast.
  try { primeAtsLoaders(); } catch (e) {}
  try { pollForAtsIframes(); } catch (e) {}
  try { postDiag('install'); } catch (e) {}

  scanForms();

  if (document.readyState !== 'complete') {
    window.addEventListener('DOMContentLoaded', function() {
      try { tryEagerGreenhouseDetect(); } catch (e) {}
      try { primeAtsLoaders(); } catch (e) {}
      try { postDiag('dom-ready'); } catch (e) {}
      scheduleScan(150);
    }, { once: true });
    window.addEventListener('load', function() {
      try { tryEagerGreenhouseDetect(); } catch (e) {}
      try { primeAtsLoaders(); } catch (e) {}
      try { postDiag('load'); } catch (e) {}
      scheduleScan(300);
    }, { once: true });
  }

  // Safety-net periodic re-scans for late-hydrating SPAs; stops once two
  // consecutive scans return the same field set.
  var safetyDelays = [800, 1800, 3500, 6000, 8000, 12000];
  safetyDelays.forEach(function(ms) {
    setTimeout(function() {
      if (stableScans < 2) scanForms();
    }, ms);
  });

  // Adaptive observer on the main document
  try {
    var observer = new MutationObserver(function(mutations) {
      var trigger = false;
      var atsTrigger = false;
      for (var m = 0; m < mutations.length; m++) {
        var mut = mutations[m];
        if (mut.type === 'attributes') {
          var t = mut.target;
          if (t && t.tagName === 'IFRAME' && mut.attributeName === 'src') {
            trigger = true;
            // Eagerly check if the new src is an ATS iframe and report
            // immediately — don't wait for the 300ms scheduled rescan.
            try { reportAtsIframe(t.src || t.getAttribute('src') || ''); } catch (e) {}
            atsTrigger = true;
          }
          else if (t && t.matches && t.matches(INPUT_SELECTOR)) trigger = true;
        } else if (mut.addedNodes && mut.addedNodes.length) {
          for (var n = 0; n < mut.addedNodes.length; n++) {
            var node = mut.addedNodes[n];
            if (node.nodeType !== 1) continue;
            // Direct iframe insert — check src right away (loader scripts
            // often add the iframe with src already set).
            if (node.tagName === 'IFRAME') {
              try { reportAtsIframe(node.src || node.getAttribute('src') || ''); } catch (e) {}
              trigger = true;
            } else if (
              node.tagName === 'FORM' ||
              node.tagName === 'INPUT' ||
              node.tagName === 'TEXTAREA' ||
              node.tagName === 'SELECT' ||
              isContentEditable(node) ||
              (node.querySelector && node.querySelector(INPUT_SELECTOR))
            ) {
              trigger = true;
            }
            // Nested iframe — wrapper divs inserted by JS loaders frequently
            // contain the ATS iframe. The original code missed this case.
            if (node.querySelectorAll) {
              try {
                var nestedIfrs = node.querySelectorAll('iframe');
                for (var ni = 0; ni < nestedIfrs.length; ni++) {
                  var nsrc = nestedIfrs[ni].src || nestedIfrs[ni].getAttribute('src') || '';
                  if (nsrc) reportAtsIframe(nsrc);
                  trigger = true;
                }
              } catch (e) {}
            }
          }
        }
      }
      if (trigger) scheduleScan(atsTrigger ? 50 : 300);
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
