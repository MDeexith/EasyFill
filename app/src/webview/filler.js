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

  // Strategy A: InputEvent with inputType satisfies React 17+ createRoot event delegation.
  var inputFired = false;
  try {
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true,
      inputType: 'insertText', data: value,
    }));
    inputFired = true;
  } catch (e) {}
  if (!inputFired) el.dispatchEvent(new Event('input', { bubbles: true }));

  // Strategy B: React fiber direct onChange call for React 16 class components.
  try {
    var fk = Object.keys(el).find(function(k) {
      return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance');
    });
    if (fk) {
      var node = el[fk];
      while (node) {
        var p = node.memoizedProps;
        if (p && typeof p.onChange === 'function') {
          p.onChange({ target: el, currentTarget: el, type: 'change', nativeEvent: { data: value } });
          break;
        }
        node = node.return;
      }
    }
  } catch (e) {}

  // Strategy C: change event for Vue, Angular, jQuery.
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

// Strip combining marks + leading non-alphanumerics (e.g. flag emoji,
// arrows, leading spaces) so option text matching tolerates "🇮🇳 India" vs
// "India".
function cleanOptText(t) {
  return (t || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .trim();
}

function isButtonDropdown(el) {
  if (!el || !el.getAttribute || !el.tagName) return false;
  var tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (isContentEditable(el)) return false;
  var role = el.getAttribute('role') || '';
  var hasPopup = el.getAttribute('aria-haspopup') || '';
  if (tag === 'BUTTON') return true;
  if (role === 'combobox' || role === 'listbox') return true;
  if (hasPopup === 'listbox' || hasPopup === 'menu' || hasPopup === 'true') return true;
  return false;
}

// Wait until the dropdown's popup listbox/menu actually appears in the DOM,
// then return it. Returns null on timeout.
function waitForListbox(el, maxAttempts, intervalMs) {
  return new Promise(function(resolve) {
    var attempts = 0;
    function poll() {
      attempts++;
      var ariaControls = el.getAttribute && el.getAttribute('aria-controls');
      var listbox = null;
      if (ariaControls) {
        try { listbox = document.getElementById(ariaControls); } catch (e) {}
      }
      if (!listbox) {
        listbox =
          document.querySelector('[role="listbox"]:not([aria-hidden="true"])') ||
          document.querySelector('[role="menu"]:not([aria-hidden="true"])') ||
          document.querySelector('[data-radix-popper-content-wrapper] [role="listbox"], [data-radix-popper-content-wrapper] [role="menu"]') ||
          document.querySelector('.MuiMenu-list, .MuiList-root, .ant-select-dropdown:not(.ant-select-dropdown-hidden), [class*="menu-list"], [class*="dropdown-menu"]:not([hidden])');
      }
      if (listbox) { resolve(listbox); return; }
      if (attempts >= maxAttempts) { resolve(null); return; }
      setTimeout(poll, intervalMs);
    }
    poll();
  });
}

function tryButtonDropdownFill(el, value) {
  return new Promise(function(resolve) {
    try {
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true })); } catch (e) {}
      try { el.click(); } catch (e) {}

      waitForListbox(el, 12, 150).then(function(listbox) {
        if (!listbox) { resolve(false); return; }

        var options = listbox.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, a');
        if (!options || options.length === 0) { resolve(false); return; }

        var target = cleanOptText(value);
        var best = null, bestScore = 0;
        for (var i = 0; i < options.length; i++) {
          var text = cleanOptText(options[i].innerText || options[i].textContent || '');
          if (!text) continue;
          var score = text === target ? 4
                    : text.startsWith(target) ? 3
                    : (target.length >= 2 && text.indexOf(target) !== -1) ? 2
                    : 0;
          if (score > bestScore) { bestScore = score; best = options[i]; }
        }

        if (!best) { resolve(false); return; }

        try { best.scrollIntoView({ block: 'center' }); } catch (e) {}
        try { best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (e) {}
        try { best.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true })); } catch (e) {}
        try { best.click(); } catch (e) {}
        // Some menus close only on a follow-up Enter on the trigger.
        try {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        } catch (e) {}
        resolve(true);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

function isPlacesLikeInput(el) {
  if (!el || !el.getAttribute) return false;
  if (el.getAttribute('role') !== 'combobox') return false;
  if (el.getAttribute('aria-controls')) return false;
  var name = (el.getAttribute('name') || '').toLowerCase();
  var ph = (el.getAttribute('placeholder') || '').toLowerCase();
  var al = (el.getAttribute('aria-label') || '').toLowerCase();
  var dl = (el.getAttribute('data-label') || '').toLowerCase();
  return /city|location|locat|where|based|address/.test(name + ' ' + ph + ' ' + al + ' ' + dl);
}

function pickBestOption(el, value, resolve) {
  try {
    var listbox = document.querySelector('[role="listbox"]') ||
                  document.querySelector('.pac-container') ||
                  document.querySelector('[class*="autocomplete"]');

    function fallbackArrow() {
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
        setTimeout(function() {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          resolve(false);
        }, 150);
      } catch(e) { resolve(false); }
    }

    if (!listbox) { fallbackArrow(); return; }

    var options = listbox.querySelectorAll('[role="option"], .pac-item, li');
    if (!options || options.length === 0) { fallbackArrow(); return; }

    var target = String(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    var best = null, bestScore = 0;
    for (var i = 0; i < options.length; i++) {
      var text = (options[i].innerText || options[i].textContent || '')
                  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      var score = text === target ? 3 : text.startsWith(target) ? 2 : text.indexOf(target) !== -1 ? 1 : 0;
      if (score > bestScore) { bestScore = score; best = options[i]; }
    }

    if (best) {
      try { best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch(e) {}
      try { best.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch(e) {}
      best.click();
      resolve(true);
    } else {
      fallbackArrow();
    }
  } catch(e) { resolve(false); }
}

function tryPlacesComboboxFill(el, value) {
  return new Promise(function(resolve) {
    fireFocus(el);
    var setter = nativeSetter(el);
    if (setter) setter(''); else el.value = '';
    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'deleteContentBackward',
      }));
    } catch(e) { el.dispatchEvent(new Event('input', { bubbles: true })); }

    var typeChunk = value.slice(0, Math.min(value.length, 6));
    var i = 0;

    function typeNext() {
      if (i >= typeChunk.length) {
        setTimeout(function() { pickBestOption(el, value, resolve); }, 700);
        return;
      }
      var partial = typeChunk.slice(0, i + 1);
      if (setter) setter(partial); else el.value = partial;
      try {
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true,
          inputType: 'insertText', data: typeChunk[i],
        }));
      } catch(e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
      i++;
      setTimeout(typeNext, 80);
    }

    typeNext();
  });
}

function tryComboboxFill(el, value) {
  // React-Select / Headless UI / ARIA combobox patterns
  var role = el.getAttribute && el.getAttribute('role');
  var hasPopup = el.getAttribute && el.getAttribute('aria-haspopup');
  var controls = el.getAttribute && el.getAttribute('aria-controls');
  if (role !== 'combobox' && hasPopup !== 'listbox' && !controls) return false;

  fireFocus(el);

  // React Select opens its menu on focus; give it a tick before typing to filter.
  setTimeout(function() {
    setNativeInput(el, value);

    var MAX_ATTEMPTS = 3;
    var attempt = 0;

    function tryClick() {
      attempt++;
      setTimeout(function() {
        try {
          var listbox = controls ? document.getElementById(controls) :
            document.querySelector('[role="listbox"]');
          if (!listbox) {
            if (attempt < MAX_ATTEMPTS) tryClick();
            return;
          }
          var options = listbox.querySelectorAll('[role="option"]');
          if (!options.length) {
            if (attempt < MAX_ATTEMPTS) tryClick();
            return;
          }
          var val = String(value).toLowerCase();
          for (var i = 0; i < options.length; i++) {
            var t = (options[i].innerText || options[i].textContent || '').trim().toLowerCase();
            if (t === val || t.indexOf(val) !== -1) {
              try { options[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch(e) {}
              try { options[i].dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch(e) {}
              options[i].click();
              return;
            }
          }
          // No text match — keyboard-select first visible option as fallback.
          try {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
            setTimeout(function() {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            }, 100);
          } catch(e) {}
        } catch (e) {
          if (attempt < MAX_ATTEMPTS) tryClick();
        }
      }, 350);
    }

    tryClick();
  }, 50);

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

  // No-op kept so existing call sites stay untouched; visual highlight removed.
  function mark() {}

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

  // Button / div-style dropdown (Headless UI Listbox, Radix, MUI Select,
  // Greenhouse Country, Workday "Yes/No", etc.). Click to open, find a
  // matching option in the popup, click it.
  if (isButtonDropdown(el)) {
    tryButtonDropdownFill(el, strVal).then(function(ok) { if (ok) mark(); });
    mark();
    return true;
  }

  // Google Places / geocoding-backed location comboboxes need char-by-char
  // typing + a longer wait for the API response before clicking an option.
  if (isPlacesLikeInput(el)) {
    tryPlacesComboboxFill(el, strVal).then(function(ok) { if (ok) mark(); });
    mark();
    return true;
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

export function buildCorrectionListenerScript(filledAfIds) {
  const filledMap = Object.fromEntries((filledAfIds || []).map(id => [id, true]));
  return `
(function() {
  if (window.__AF_CORRECTION_LISTENER__) return;
  window.__AF_CORRECTION_LISTENER__ = true;
  var filled = ${safeJson(filledMap)};
  document.addEventListener('blur', function(e) {
    var el = e.target;
    var afId = el.getAttribute && el.getAttribute('data-af-id');
    if (!afId) return;
    var value = (el.value || el.textContent || '').trim();
    if (!value) return;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'USER_INPUT_DETECTED',
        afId: afId,
        value: value,
        wasAutoFilled: !!filled[afId],
      }));
    }
  }, true);
})();
  `;
}
