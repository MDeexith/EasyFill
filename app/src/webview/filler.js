// Escape a JSON string for safe inlining inside a <script>-injected payload:
// neutralises </script>, U+2028, U+2029.
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Shared in-page filler runtime used by both buildFillScript and
// buildDirectFillScript. Defined once (string) and concatenated into the
// payload to keep the two scripts in sync.
const FILLER_RUNTIME = `
function findEl(id) {
  function search(root) {
    if (!root || !root.querySelector) return null;
    var q = '[data-af-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]';
    var direct = null;
    try { direct = root.querySelector(q); } catch (e) {}
    if (direct) return direct;
    if (root.querySelectorAll) {
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) {
          var found = search(all[i].shadowRoot);
          if (found) return found;
        }
      }
    }
    return null;
  }
  var el = search(document);
  if (el) return el;
  // Same-origin iframe walk
  var ifr = document.getElementsByTagName('iframe');
  for (var i = 0; i < ifr.length; i++) {
    try {
      var d = ifr[i].contentDocument;
      if (d) {
        var found = search(d);
        if (found) return found;
      }
    } catch (e) {}
  }
  return null;
}

function isContentEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  var ce = el.getAttribute && el.getAttribute('contenteditable');
  return ce === '' || ce === 'true' || (el.getAttribute && el.getAttribute('role') === 'textbox');
}

function nativeSetter(el) {
  var proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, 'value');
  return desc && desc.set ? desc.set.bind(el) : null;
}

function fireFocus(el) {
  try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (_) {} }
  try { el.dispatchEvent(new Event('focus', { bubbles: true })); } catch (e) {}
}

function setNativeInput(el, value) {
  var setter = nativeSetter(el);
  if (setter) setter(value);
  else el.value = value;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setContentEditable(el, value) {
  fireFocus(el);
  var ok = false;
  try {
    // Replace existing content first
    if (document.execCommand) {
      document.execCommand('selectAll', false, null);
      ok = document.execCommand('insertText', false, value);
    }
  } catch (e) {}
  if (!ok) {
    el.textContent = value;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
  }
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
}

function setSelectVal(el, value) {
  var opts = Array.from(el.options);
  var match = opts.find(function(o) { return o.value === value || o.text === value; }) ||
              opts.find(function(o) {
                return (o.value || '').toLowerCase() === String(value).toLowerCase() ||
                       (o.text  || '').toLowerCase() === String(value).toLowerCase();
              }) ||
              opts.find(function(o) {
                return (o.text || '').toLowerCase().indexOf(String(value).toLowerCase()) !== -1;
              });
  if (match) {
    el.value = match.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

function tryComboboxFill(el, value) {
  // React-Select / Headless UI / ARIA combobox patterns
  var role = el.getAttribute && el.getAttribute('role');
  var hasPopup = el.getAttribute && el.getAttribute('aria-haspopup');
  var controls = el.getAttribute && el.getAttribute('aria-controls');
  if (role !== 'combobox' && hasPopup !== 'listbox' && !controls) return false;

  fireFocus(el);
  setNativeInput(el, value);

  // Wait one tick for the listbox to render, then click the matching option.
  setTimeout(function() {
    try {
      var listbox = controls ? document.getElementById(controls) :
        document.querySelector('[role="listbox"]');
      if (!listbox) return;
      var options = listbox.querySelectorAll('[role="option"]');
      for (var i = 0; i < options.length; i++) {
        var t = (options[i].innerText || options[i].textContent || '').trim().toLowerCase();
        if (t === String(value).toLowerCase() || t.indexOf(String(value).toLowerCase()) !== -1) {
          options[i].click();
          return;
        }
      }
    } catch (e) {}
  }, 80);
  return true;
}

function fillChips(el, values) {
  fireFocus(el);
  var setter = nativeSetter(el);
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (setter) setter(v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // Many chip inputs commit on Enter
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    } catch (e) {}
  }
}

function fillOne(el, value) {
  if (!el) return false;
  var strVal = String(value);

  // Highlight on success regardless of strategy
  function mark() {
    try {
      el.style.backgroundColor = '#ecfdf5';
      el.style.border = '2px solid #10b981';
    } catch (e) {}
  }

  if (isContentEditable(el)) {
    setContentEditable(el, strVal);
    mark();
    return true;
  }

  if (el.tagName === 'SELECT') {
    var ok = setSelectVal(el, strVal);
    if (ok) mark();
    return ok;
  }

  // Combobox / custom dropdown — try first, fall through to native fill if it
  // wasn't actually a combobox.
  if (tryComboboxFill(el, strVal)) {
    mark();
    return true;
  }

  fireFocus(el);
  setNativeInput(el, strVal);
  try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
  mark();
  return true;
}
`;

export function buildDirectFillScript(valuesById) {
  return `
(function() {
  var values = ${safeJson(valuesById)};
  ${FILLER_RUNTIME}

  var filled = 0;
  Object.keys(values).forEach(function(id) {
    var el = findEl(id);
    if (!el) return;
    if (fillOne(el, values[id])) filled++;
  });
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'AI_FILL_COMPLETE', filled: filled }));
  }
})();
  `;
}

export function buildFillScript(mapping, profileJson) {
  // profileJson is already a JSON string (existing callers pass JSON.stringify(profile)).
  // Re-encode through safeJson to neutralise any embedded "</script>" sequence.
  const safeProfile = safeJson(JSON.parse(profileJson));
  return `
(function() {
  var profile = ${safeProfile};
  var mapping = ${safeJson(mapping)};
  ${FILLER_RUNTIME}

  // Profile keys whose value is a comma-separated list and which should be
  // filled as chips when the target field is a combobox/multi-input.
  var CHIP_KEYS = { skills: true, languages: true };

  var filled = 0;
  Object.keys(mapping).forEach(function(fieldId) {
    var profileKey = mapping[fieldId];
    if (!profileKey) return;

    // Resolve value with deprecated-alias fallback (salary -> expectedSalary).
    var val = profile[profileKey];
    if ((val === undefined || val === null || val === '') && profileKey === 'expectedSalary') {
      val = profile.salary;
    }
    if (val === undefined || val === null || val === '') return;

    var el = findEl(fieldId);
    if (!el) return;

    if (CHIP_KEYS[profileKey] && (el.getAttribute('role') === 'combobox' ||
        el.getAttribute('aria-haspopup') === 'listbox')) {
      var values = String(val).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      fillChips(el, values);
      filled++;
      return;
    }

    if (fillOne(el, val)) filled++;
  });

  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'FILL_COMPLETE', filled: filled }));
  }
})();
  `;
}
