// Runs in MAIN world (declared in manifest with "world":"MAIN").
// Extension content scripts bypass page CSP — no 'unsafe-inline' needed.
// Has access to React/Vue/Angular fiber on DOM nodes.
// Communicates with the isolated-world content.js via window.postMessage.

(function () {
  if (window.__AF_FILLER_MAIN__) return;
  window.__AF_FILLER_MAIN__ = true;

  // ─── DOM helpers ────────────────────────────────────────────────────────────

  function findEl(id) {
    function search(root) {
      if (!root || !root.querySelector) return null;
      var q = '[data-af-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]';
      var el = null;
      try { el = root.querySelector(q); } catch (e) {}
      if (el) return el;
      if (root.querySelectorAll) {
        var all = root.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          if (all[i].shadowRoot) { var f = search(all[i].shadowRoot); if (f) return f; }
        }
      }
      return null;
    }
    var el = search(document);
    if (el) return el;
    var ifr = document.getElementsByTagName('iframe');
    for (var i = 0; i < ifr.length; i++) {
      try { var d = ifr[i].contentDocument; if (d) { var f2 = search(d); if (f2) return f2; } } catch (e) {}
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
    if (setter) setter(value); else el.value = value;
    var ok = false;
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
      ok = true;
    } catch (e) {}
    if (!ok) el.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      var fk = Object.keys(el).find(function (k) {
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
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setContentEditable(el, value) {
    fireFocus(el);
    var ok = false;
    try {
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
    var match =
      opts.find(function (o) { return o.value === value || o.text === value; }) ||
      opts.find(function (o) {
        return (o.value || '').toLowerCase() === String(value).toLowerCase() ||
               (o.text  || '').toLowerCase() === String(value).toLowerCase();
      }) ||
      opts.find(function (o) {
        return (o.text || '').toLowerCase().indexOf(String(value).toLowerCase()) !== -1;
      });
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  function cleanOptText(t) {
    return (t || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/^[^a-z0-9]+/, '').trim();
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

  function waitForListbox(el, maxAttempts, intervalMs) {
    return new Promise(function (resolve) {
      var attempts = 0;
      function poll() {
        attempts++;
        var ariaControls = el.getAttribute && el.getAttribute('aria-controls');
        var listbox = null;
        if (ariaControls) { try { listbox = document.getElementById(ariaControls); } catch (e) {} }
        if (!listbox) {
          listbox =
            document.querySelector('[role="listbox"]:not([aria-hidden="true"])') ||
            document.querySelector('[role="menu"]:not([aria-hidden="true"])') ||
            document.querySelector('[data-radix-popper-content-wrapper] [role="listbox"],[data-radix-popper-content-wrapper] [role="menu"]') ||
            document.querySelector('.MuiMenu-list,.MuiList-root,.ant-select-dropdown:not(.ant-select-dropdown-hidden),[class*="menu-list"],[class*="dropdown-menu"]:not([hidden])');
        }
        if (listbox) { resolve(listbox); return; }
        if (attempts >= maxAttempts) { resolve(null); return; }
        setTimeout(poll, intervalMs);
      }
      poll();
    });
  }

  function tryButtonDropdownFill(el, value) {
    return new Promise(function (resolve) {
      try {
        try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
        try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true })); } catch (e) {}
        try { el.click(); } catch (e) {}
        waitForListbox(el, 12, 150).then(function (listbox) {
          if (!listbox) { resolve(false); return; }
          var options = listbox.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"],li,button,a');
          if (!options || options.length === 0) { resolve(false); return; }
          var target = cleanOptText(value), best = null, bestScore = 0;
          for (var i = 0; i < options.length; i++) {
            var text = cleanOptText(options[i].innerText || options[i].textContent || '');
            if (!text) continue;
            var score = text === target ? 4 : text.startsWith(target) ? 3 : (target.length >= 2 && text.indexOf(target) !== -1) ? 2 : 0;
            if (score > bestScore) { bestScore = score; best = options[i]; }
          }
          if (!best) { resolve(false); return; }
          try { best.scrollIntoView({ block: 'center' }); } catch (e) {}
          try { best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (e) {}
          try { best.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true })); } catch (e) {}
          try { best.click(); } catch (e) {}
          resolve(true);
        });
      } catch (e) { resolve(false); }
    });
  }

  function isPlacesLikeInput(el) {
    if (!el || !el.getAttribute) return false;
    if (el.getAttribute('role') !== 'combobox') return false;
    if (el.getAttribute('aria-controls')) return false;
    var s = (el.getAttribute('name') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '');
    return /city|location|locat|where|based|address/i.test(s);
  }

  function pickBestOption(el, value, resolve) {
    try {
      var listbox =
        document.querySelector('[role="listbox"]') ||
        document.querySelector('.pac-container') ||
        document.querySelector('[class*="autocomplete"]');
      function fallback() {
        try {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
          setTimeout(function () { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })); resolve(false); }, 150);
        } catch (e) { resolve(false); }
      }
      if (!listbox) { fallback(); return; }
      var options = listbox.querySelectorAll('[role="option"],.pac-item,li');
      if (!options || options.length === 0) { fallback(); return; }
      var target = String(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      var best = null, bestScore = 0;
      for (var i = 0; i < options.length; i++) {
        var text = (options[i].innerText || options[i].textContent || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        var score = text === target ? 3 : text.startsWith(target) ? 2 : text.indexOf(target) !== -1 ? 1 : 0;
        if (score > bestScore) { bestScore = score; best = options[i]; }
      }
      if (best) {
        try { best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (e) {}
        try { best.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true })); } catch (e) {}
        best.click(); resolve(true);
      } else { fallback(); }
    } catch (e) { resolve(false); }
  }

  function tryPlacesComboboxFill(el, value) {
    return new Promise(function (resolve) {
      fireFocus(el);
      var setter = nativeSetter(el);
      if (setter) setter(''); else el.value = '';
      try { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' })); } catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
      var chunk = value.slice(0, Math.min(value.length, 6)), i = 0;
      function typeNext() {
        if (i >= chunk.length) { setTimeout(function () { pickBestOption(el, value, resolve); }, 700); return; }
        var partial = chunk.slice(0, i + 1);
        if (setter) setter(partial); else el.value = partial;
        try { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: chunk[i] })); } catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
        i++;
        setTimeout(typeNext, 80);
      }
      typeNext();
    });
  }

  function tryComboboxFill(el, value) {
    var role     = el.getAttribute && el.getAttribute('role');
    var hasPopup = el.getAttribute && el.getAttribute('aria-haspopup');
    var controls = el.getAttribute && el.getAttribute('aria-controls');
    if (role !== 'combobox' && hasPopup !== 'listbox' && !controls) return false;
    fireFocus(el);
    setTimeout(function () {
      setNativeInput(el, value);
      var MAX = 3, attempt = 0;
      function tryClick() {
        attempt++;
        setTimeout(function () {
          try {
            var listbox = controls ? document.getElementById(controls) : document.querySelector('[role="listbox"]');
            if (!listbox) { if (attempt < MAX) tryClick(); return; }
            var opts = listbox.querySelectorAll('[role="option"]');
            if (!opts.length) { if (attempt < MAX) tryClick(); return; }
            var val = String(value).toLowerCase();
            for (var i = 0; i < opts.length; i++) {
              var t = (opts[i].innerText || opts[i].textContent || '').trim().toLowerCase();
              if (t === val || t.indexOf(val) !== -1) {
                try { opts[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (e) {}
                try { opts[i].dispatchEvent(new MouseEvent('mouseup',   { bubbles: true })); } catch (e) {}
                opts[i].click(); return;
              }
            }
            try {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
              setTimeout(function () { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })); }, 100);
            } catch (e) {}
          } catch (e) { if (attempt < MAX) tryClick(); }
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
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
      } catch (e) {}
    }
  }

  function clickCheckable(el, shouldBeChecked) {
    if (!el) return false;
    try {
      var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
      var desc  = proto && Object.getOwnPropertyDescriptor(proto, 'checked');
      if (desc && desc.set) desc.set.call(el, shouldBeChecked !== false);
      else el.checked = shouldBeChecked !== false;
    } catch (e) { try { el.checked = shouldBeChecked !== false; } catch (_) {} }
    try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    return true;
  }

  function fillRadioGroup(options, value) {
    if (!options || !options.length) return false;
    var target = cleanOptText(value), best = null, bestScore = 0;
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var lab = cleanOptText(opt.label), val = cleanOptText(opt.value), score = 0;
      if (lab && lab === target) score = Math.max(score, 4);
      if (val && val === target) score = Math.max(score, 4);
      if (lab && lab.startsWith(target)) score = Math.max(score, 3);
      if (val && val.startsWith(target)) score = Math.max(score, 3);
      if (target.length >= 2 && lab && lab.indexOf(target) !== -1) score = Math.max(score, 2);
      if (target.length >= 2 && val && val.indexOf(target) !== -1) score = Math.max(score, 2);
      if (/^(yes|true|1|y)$/.test(target) && /^(yes|i (am|do)|authorized|true)/.test(lab)) score = Math.max(score, 3);
      if (/^(no|false|0|n)$/.test(target) && /^(no|i (am not|do not)|not authorized|false)/.test(lab)) score = Math.max(score, 3);
      if (score > bestScore) { bestScore = score; best = opt; }
    }
    if (!best) return false;
    var radio = findEl(best.afId);
    if (!radio) return false;
    return clickCheckable(radio, true);
  }

  function fillCheckboxGroup(options, value) {
    if (!options || !options.length) return false;
    var values = String(value).split(',').map(function (s) { return cleanOptText(s); }).filter(Boolean);
    if (!values.length) return false;
    var hits = 0;
    for (var i = 0; i < options.length; i++) {
      var opt = options[i], lab = cleanOptText(opt.label), val = cleanOptText(opt.value), match = false;
      for (var v = 0; v < values.length; v++) {
        var t = values[v];
        if (!t) continue;
        if (t === lab || t === val) { match = true; break; }
        if (t.length >= 2 && (lab.indexOf(t) !== -1 || val.indexOf(t) !== -1)) { match = true; break; }
        if (lab.length >= 2 && t.indexOf(lab) !== -1) { match = true; break; }
      }
      if (!match) continue;
      var box = findEl(opt.afId);
      if (!box) continue;
      if (clickCheckable(box, true)) hits++;
    }
    return hits > 0;
  }

  function fillOne(el, value) {
    if (!el) return false;
    var strVal = String(value);
    if (isContentEditable(el)) { setContentEditable(el, strVal); return true; }
    if (el.tagName === 'SELECT') return setSelectVal(el, strVal);
    if (isButtonDropdown(el)) { tryButtonDropdownFill(el, strVal); return true; }
    if (isPlacesLikeInput(el)) { tryPlacesComboboxFill(el, strVal); return true; }
    if (tryComboboxFill(el, strVal)) return true;
    fireFocus(el);
    setNativeInput(el, strVal);
    try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
    return true;
  }

  // ─── Fill orchestration ──────────────────────────────────────────────────────

  var CHIP_KEYS = { skills: true, languages: true };

  function doFill(mapping, profile, groupMeta, optionSelections, generatedValues) {
    var filled = 0;
    Object.keys(mapping).forEach(function (fieldId) {
      var profileKey = mapping[fieldId];
      if (!profileKey) return;

      // Use AI-generated answer for open-ended question fields.
      if (generatedValues && generatedValues[fieldId]) {
        var qEl = findEl(fieldId);
        if (qEl && fillOne(qEl, generatedValues[fieldId])) filled++;
        return;
      }

      var val = profile[profileKey];
      if ((val === undefined || val === null || val === '') && profileKey === 'expectedSalary') val = profile.salary;
      if (val === undefined || val === null || val === '') return;

      // Prefer AI/locally-resolved option label over raw profile value for grouped widgets.
      var resolvedVal = (optionSelections && optionSelections[fieldId] != null && optionSelections[fieldId] !== '')
        ? optionSelections[fieldId]
        : val;

      var meta = groupMeta && groupMeta[fieldId];
      if (meta && meta.widget === 'radio-group')    { if (fillRadioGroup(meta.options, resolvedVal))    filled++; return; }
      if (meta && meta.widget === 'checkbox-group') { if (fillCheckboxGroup(meta.options, resolvedVal)) filled++; return; }

      var el = findEl(fieldId);
      if (!el) return;

      if (CHIP_KEYS[profileKey] && (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox')) {
        var chips = String(val).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        fillChips(el, chips);
        filled++;
        return;
      }

      if (fillOne(el, val)) filled++;
    });
    return filled;
  }

  // ─── Message bridge ──────────────────────────────────────────────────────────

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.source !== 'easyfill') return;

    if (e.data.type === 'DO_FILL') {
      var filled = doFill(e.data.mapping || {}, e.data.profile || {}, e.data.groupMeta || {}, e.data.optionSelections || {}, e.data.generatedValues || {});
      window.postMessage({ source: 'easyfill', type: 'FILL_COMPLETE', filled: filled }, '*');
    }

    if (e.data.type === 'INSTALL_CORRECTION_LISTENER') {
      if (window.__AF_CORRECTION_LISTENER__) return;
      window.__AF_CORRECTION_LISTENER__ = true;
      var filledAfIds = e.data.filledAfIds || {};
      document.addEventListener('blur', function (ev) {
        var el = ev.target;
        var afId = el.getAttribute && el.getAttribute('data-af-id');
        if (!afId) return;
        var value = (el.value || el.textContent || '').trim();
        if (!value) return;
        window.postMessage({
          source: 'easyfill', type: 'USER_INPUT_DETECTED',
          afId: afId, value: value, wasAutoFilled: !!filledAfIds[afId],
        }, '*');
      }, true);
    }
  });
})();
