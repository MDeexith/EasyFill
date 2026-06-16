// Adapted from app/src/webview/formScanner.js.
// Key change: replaces window.ReactNativeWebView.postMessage() with onMessage(data) callback.
// ATS iframe detection (Greenhouse/Lever URL reporting) is removed — extensions can inject
// into job board iframes directly via manifest host_permissions.

export function installScanner(onMessage) {
  if (window.__AF_SCANNER_INSTALLED__) return;
  window.__AF_SCANNER_INSTALLED__ = true;

  var AF_ATTR = 'data-af-id';
  var SKIP_ROLE_RE = /^(navigation|menu|menubar|tablist|toolbar|banner|contentinfo)$/i;
  var INPUT_SELECTOR =
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([aria-hidden="true"]),' +
    'textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"],' +
    '[role="combobox"], [role="listbox"],' +
    'button[aria-haspopup="listbox"], button[aria-haspopup="menu"], button[aria-haspopup="true"],' +
    '[aria-haspopup="listbox"], [aria-haspopup="menu"],' +
    '[role="radio"], [role="checkbox"]';

  var afCounter = 0;
  var lastFingerprint = '';
  var stableScans = 0;
  var rescanTimer = null;

  function isContentEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    var ce = el.getAttribute && el.getAttribute('contenteditable');
    if (ce === '' || ce === 'true') return true;
    if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
    return false;
  }

  function getDocs(rootDoc) {
    var docs = [rootDoc];
    var iframes = rootDoc.getElementsByTagName('iframe');
    for (var i = 0; i < iframes.length; i++) {
      var iframeDoc = null;
      try { iframeDoc = iframes[i].contentDocument; } catch (e) {}
      if (iframeDoc && iframeDoc.body) docs.push(iframeDoc);
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
      var all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (var j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) walk(all[j].shadowRoot);
      }
    }
    walk(root);
    return results;
  }

  function preferredLabelFor(el) {
    if (el.id) {
      try {
        var doc = el.ownerDocument || document;
        var root = (el.getRootNode && el.getRootNode()) || doc;
        var lbl = root.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (!lbl && root !== doc) lbl = doc.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl && lbl.innerText) return lbl.innerText.trim().slice(0, 120);
      } catch (e) {}
    }
    var p = el.parentElement;
    for (var i = 0; i < 3 && p; i++) {
      if (p.tagName === 'LABEL' && p.innerText) return p.innerText.trim().slice(0, 120);
      p = p.parentElement;
    }
    var llby = el.getAttribute && el.getAttribute('aria-labelledby');
    if (llby) {
      try {
        var doc2 = el.ownerDocument || document;
        var root2 = (el.getRootNode && el.getRootNode()) || doc2;
        var firstId = llby.split(/\s+/)[0];
        var target = (root2.getElementById ? root2.getElementById(firstId) : null)
                  || doc2.getElementById(firstId);
        if (target && target.innerText) return target.innerText.trim().slice(0, 120);
      } catch (e) {}
    }
    return '';
  }

  function getNearbyText(el) {
    var prev = el.previousElementSibling;
    if (prev && prev.tagName === 'LABEL' && prev.innerText) {
      return prev.innerText.trim().slice(0, 120);
    }
    var p = el.parentElement;
    for (var i = 0; i < 6 && p; i++) {
      var role = p.getAttribute && p.getAttribute('role');
      if (role && SKIP_ROLE_RE.test(role)) { p = p.parentElement; continue; }
      var lbls = p.querySelectorAll ? p.querySelectorAll('label') : [];
      if (lbls.length > 0 && lbls[0].innerText) return lbls[0].innerText.trim().slice(0, 120);
      p = p.parentElement;
    }
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

  function classifyWidget(el, tag, contentEditable) {
    if (contentEditable) return 'contenteditable';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    var role = (el.getAttribute && el.getAttribute('role')) || '';
    var hasPopup = (el.getAttribute && el.getAttribute('aria-haspopup')) || '';
    var rawType = ((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
    if (tag === 'input') {
      if (rawType === 'radio') return 'radio';
      if (rawType === 'checkbox') return 'checkbox';
      if (rawType === 'file') return 'file';
      if (role === 'combobox' || hasPopup === 'listbox' || hasPopup === 'menu') return 'combobox-input';
      return 'text';
    }
    if (role === 'radio') return 'radio';
    if (role === 'checkbox') return 'checkbox';
    if (tag === 'button' || role === 'combobox' || role === 'listbox' ||
        hasPopup === 'listbox' || hasPopup === 'menu' || hasPopup === 'true') {
      return 'button-dropdown';
    }
    return 'text';
  }

  function getGroupLabelFor(el) {
    var p = el.parentElement;
    for (var i = 0; i < 6 && p; i++) {
      if (p.tagName === 'FIELDSET') {
        try {
          var lg = p.querySelector(':scope > legend');
          if (lg && lg.innerText && lg.innerText.trim()) return lg.innerText.trim().slice(0, 200);
        } catch (e) {}
      }
      var role = p.getAttribute && p.getAttribute('role');
      if (role === 'group' || role === 'radiogroup') {
        var llby = p.getAttribute && p.getAttribute('aria-labelledby');
        if (llby) {
          try {
            var doc = el.ownerDocument || document;
            var ref = doc.getElementById(llby.split(/\s+/)[0]);
            if (ref && ref.innerText) return ref.innerText.trim().slice(0, 200);
          } catch (e) {}
        }
        var al = p.getAttribute && p.getAttribute('aria-label');
        if (al) return al.trim().slice(0, 200);
      }
      p = p.parentElement;
    }
    return getNearbyText(el);
  }

  function getOptionLabelFor(el) {
    var existing = preferredLabelFor(el);
    if (existing) return existing.slice(0, 80);
    var n = el.nextSibling;
    while (n) {
      if (n.nodeType === 3 && n.textContent && n.textContent.trim()) return n.textContent.trim().slice(0, 80);
      if (n.nodeType === 1) {
        var t = ((n.innerText || n.textContent) || '').trim();
        if (t) return t.slice(0, 80);
        break;
      }
      n = n.nextSibling;
    }
    return (el.value || '').slice(0, 80);
  }

  function isLabeledDropdownTrigger(el, label, ariaLabel, name, nearbyText) {
    if (label || ariaLabel || name) return true;
    if (el.id) return true;
    if (el.getAttribute && el.getAttribute('aria-labelledby')) return true;
    var t = (nearbyText || '').trim();
    if (t && t.length <= 60 && !/^(menu|more|options|filter|sort|share)$/i.test(t)) return true;
    return false;
  }

  var OPT_MAX = 200;
  var OPT_TEXT_MAX = 80;
  function extractOptions(el, widget) {
    var out = [];
    try {
      if (widget === 'select' && el.options) {
        for (var i = 0; i < el.options.length && out.length < OPT_MAX; i++) {
          var o = el.options[i];
          var label = (o.text || o.label || '').trim().slice(0, OPT_TEXT_MAX);
          var value = (o.value != null ? String(o.value) : '').slice(0, OPT_TEXT_MAX);
          if (!label && !value) continue;
          out.push({ value, label });
        }
        return out;
      }
      if (widget === 'button-dropdown' || widget === 'combobox-input') {
        var controls = el.getAttribute && el.getAttribute('aria-controls');
        var listbox = null;
        if (controls) {
          var doc = el.ownerDocument || document;
          try { listbox = doc.getElementById(controls); } catch (e) {}
        }
        if (!listbox) return out;
        var opts = listbox.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, option');
        for (var j = 0; j < opts.length && out.length < OPT_MAX; j++) {
          var text = ((opts[j].innerText || opts[j].textContent) || '').trim().slice(0, OPT_TEXT_MAX);
          if (!text) continue;
          var ov = (opts[j].getAttribute && (opts[j].getAttribute('data-value') || opts[j].getAttribute('value'))) || '';
          out.push({ value: String(ov).slice(0, OPT_TEXT_MAX), label: text });
        }
      }
    } catch (e) {}
    return out;
  }

  function describeField(el) {
    var afId = el.getAttribute(AF_ATTR);
    if (!afId) {
      afId = 'af_' + (afCounter++);
      try { el.setAttribute(AF_ATTR, afId); } catch (e) {}
    }
    var tag = el.tagName.toLowerCase();
    var rawType = (el.getAttribute && el.getAttribute('type')) || '';
    var inputType = rawType ? rawType.toLowerCase() : tag;
    var contentEditable = isContentEditable(el);
    var widget = classifyWidget(el, tag, contentEditable);
    var label = preferredLabelFor(el);
    var ariaLabel = (el.getAttribute && el.getAttribute('aria-label')) || '';
    var name = (el.getAttribute && el.getAttribute('name')) || '';
    var nearbyText = getNearbyText(el);

    var desc = {
      id: afId, domId: el.id || '', name, tag, type: inputType, inputType,
      widget,
      autocomplete: (el.getAttribute && el.getAttribute('autocomplete')) || '',
      pattern: (el.getAttribute && el.getAttribute('pattern')) || '',
      maxLength: (el.maxLength && el.maxLength > 0) ? el.maxLength : 0,
      required: !!(el.required || (el.getAttribute && el.getAttribute('aria-required') === 'true')),
      role: (el.getAttribute && el.getAttribute('role')) || '',
      ariaHasPopup: (el.getAttribute && el.getAttribute('aria-haspopup')) || '',
      ariaControls: (el.getAttribute && el.getAttribute('aria-controls')) || '',
      label, placeholder: (el.getAttribute && el.getAttribute('placeholder')) || '',
      ariaLabel, nearbyText, contentEditable,
      longform: tag === 'textarea' || contentEditable,
      _droppable: widget === 'button-dropdown'
        ? isLabeledDropdownTrigger(el, label, ariaLabel, name, nearbyText)
        : true,
    };

    if (widget === 'select' || widget === 'button-dropdown' || widget === 'combobox-input') {
      var opts = extractOptions(el, widget);
      if (opts.length > 0) desc.options = opts;
    }
    if (widget === 'radio' || widget === 'checkbox') {
      desc._groupLabel = getGroupLabelFor(el);
      desc._optionValue = (el.getAttribute && el.getAttribute('value')) || '';
      desc._optionLabel = getOptionLabelFor(el);
    }
    return desc;
  }

  function scanForms() {
    var fields = [];
    var docs = getDocs(document);
    for (var d = 0; d < docs.length; d++) {
      var els = queryAllDeep(docs[d], INPUT_SELECTOR);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el || !el.tagName) continue;
        try { fields.push(describeField(el)); } catch (e) {}
      }
    }

    var seen = {};
    var unique = [];
    for (var k = 0; k < fields.length; k++) {
      var fld = fields[k];
      if (seen[fld.id]) continue;
      if (fld._droppable === false) continue;
      seen[fld.id] = true;
      delete fld._droppable;
      unique.push(fld);
    }

    // Fold radio/checkbox siblings into groups
    var groups = {};
    var standalone = [];
    for (var g = 0; g < unique.length; g++) {
      var item = unique[g];
      if (item.widget === 'radio' || item.widget === 'checkbox') {
        var key = (item.widget === 'radio' ? 'r:' : 'c:') + (item.name || ('__solo_' + item.id));
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      } else {
        delete item._groupLabel; delete item._optionValue; delete item._optionLabel;
        standalone.push(item);
      }
    }

    var grouped = [];
    Object.keys(groups).forEach(function(gk) {
      var members = groups[gk];
      if (members.length <= 1) {
        var only = members[0];
        only.label = only._groupLabel || only.label || only._optionLabel || '';
        only.optionLabel = only._optionLabel || '';
        only.optionValue = only._optionValue || '';
        delete only._groupLabel; delete only._optionValue; delete only._optionLabel;
        standalone.push(only);
        return;
      }
      var first = members[0];
      grouped.push({
        id: first.id, domId: first.domId, name: first.name,
        tag: first.tag, type: first.type, inputType: first.type,
        widget: first.widget === 'radio' ? 'radio-group' : 'checkbox-group',
        autocomplete: '', pattern: '', maxLength: 0,
        required: members.some(function(m) { return m.required; }),
        role: first.role || '', ariaHasPopup: '', ariaControls: '',
        label: first._groupLabel || first.label || '',
        placeholder: '', ariaLabel: '', nearbyText: first.nearbyText || '',
        contentEditable: false, longform: false,
        options: members.map(function(m) {
          return { afId: m.id, value: m._optionValue || '', label: m._optionLabel || '' };
        }),
      });
    });

    unique = standalone.concat(grouped);

    var fp = unique.map(function(f) {
      return f.id + ':' + f.name + ':' + f.type + ':' + f.autocomplete +
        ':' + (f.options ? f.options.length : 0);
    }).join('|');

    if (fp === lastFingerprint && fp !== '') {
      stableScans++;
    } else {
      var isFirstScan = lastFingerprint === '';
      lastFingerprint = fp;
      stableScans = 0;
      if (unique.length > 0) {
        // Replaces window.ReactNativeWebView.postMessage()
        onMessage({ type: isFirstScan ? 'FIELDS_SCANNED' : 'FIELDS_UPDATED', fields: unique });
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

  scanForms();

  if (document.readyState !== 'complete') {
    window.addEventListener('DOMContentLoaded', function() { scheduleScan(150); }, { once: true });
    window.addEventListener('load', function() { scheduleScan(300); }, { once: true });
  }

  // Safety-net re-scans for late-hydrating SPAs
  [800, 1800, 3500, 6000, 8000, 12000].forEach(function(ms) {
    setTimeout(function() { if (stableScans < 2) scanForms(); }, ms);
  });

  try {
    var observer = new MutationObserver(function(mutations) {
      var trigger = false;
      for (var m = 0; m < mutations.length; m++) {
        var mut = mutations[m];
        if (mut.type === 'attributes') {
          var t = mut.target;
          if (t && t.matches && t.matches(INPUT_SELECTOR)) trigger = true;
        } else if (mut.addedNodes && mut.addedNodes.length) {
          for (var n = 0; n < mut.addedNodes.length; n++) {
            var node = mut.addedNodes[n];
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'FORM' || node.tagName === 'INPUT' ||
                node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' ||
                isContentEditable(node) ||
                (node.querySelector && node.querySelector(INPUT_SELECTOR))) {
              trigger = true;
            }
          }
        }
      }
      if (trigger) scheduleScan(300);
    });
    observer.observe(document.body || document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['name', 'id', 'autocomplete', 'type', 'role', 'aria-label',
                        'aria-labelledby', 'placeholder', 'style', 'class', 'hidden'],
    });
  } catch (e) {}

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
    inputAddObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
}
