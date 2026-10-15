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
var afEpoch = window.__AF_FILL_EPOCH__;
function afIsCurrent() { return afEpoch === window.__AF_FILL_EPOCH__; }
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

// Stamp an element the moment WE are about to change it, so the correction
// listener can tell our own synthetic input/change events from a real user
// edit. A window rather than a flag because the async widget paths
// (tryButtonDropdownFill, tryPlacesComboboxFill, tryComboboxFill) dispatch
// seconds after fillOne returns, and because the events that finally fire are
// often dispatched by the PAGE's own handlers reacting to our click, not by us.
// Element-scoped rather than global, so a genuine edit to a different field
// during a fill is still learned.
function afMarkFilled(el) {
  try { if (el) el.__afFilledAt = Date.now(); } catch (e) {}
}

// National-format phone: strip the profile country's dial code when the
// stored value is "<code> + 10 digits" glued together (e.g. "917021125165").
// Pages routinely render the dial code as a fixed prefix beside the input, so
// filling the full string double-counts the code and fails validation.
// shortcut: dial-code table covers main markets; extend when a market needs it.
function normalisePhone(raw, country, el) {
  var digits = String(raw).replace(/[^0-9]/g, '');
  // Workday separates the dial code without declaring tel-national.
  var doc = el.ownerDocument || document;
  var codeInput = /--phoneNumber$/.test(el.id || '') && doc.getElementById
    ? doc.getElementById(el.id.replace(/--phoneNumber$/, '--countryPhoneCode')) : null;
  var container = codeInput && codeInput.closest('[data-automation-id="multiselectInputContainer"]');
  var selected = container && container.querySelector('[data-automation-id="selectedItem"]');
  var selectedCode = selected && /\\(\\+([0-9]+)\\)/.exec(selected.textContent || '');
  if (selectedCode) {
    if (String(raw).trim().charAt(0) === '+') {
      return digits.indexOf(selectedCode[1]) === 0 ? digits.slice(selectedCode[1].length) : raw;
    }
    if (el.getAttribute('autocomplete') !== 'tel-national' && el.maxLength !== 10) return digits;
  }
  if (el.getAttribute('autocomplete') !== 'tel-national' && el.maxLength !== 10) return raw;
  var codes = { india: '91', 'united states': '1', usa: '1', 'united kingdom': '44', uk: '44' };
  var cc = selectedCode ? selectedCode[1] : codes[String(country || '').trim().toLowerCase()] || '';
  if (cc && digits.indexOf(cc) === 0 && digits.length === cc.length + 10) {
    return digits.slice(cc.length);
  }
  return raw;
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
  // React 17+ maps onFocus to focusin, not focus.
  try { el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); } catch (e) {}
}

// Commit a filled value the way a real user leaving the field would. Workday
// (and other ATSes) persist a field server-side only on focusout — React 17+
// maps onBlur to focusout, so a synthetic 'blur' alone never reaches their
// handler and the save-side validation still sees the field as empty.
function fireBlur(el) {
  try { el.blur(); } catch (e) {}
  try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
  try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } catch (e) {}
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

var LISTBOX_SELECTOR =
  '[role="listbox"]:not([aria-hidden="true"]), ' +
  '[role="menu"]:not([aria-hidden="true"]), .pac-container, ' +
  '.MuiMenu-list, .ant-select-dropdown:not(.ant-select-dropdown-hidden), [class*="menu-list"], [class*="dropdown-menu"]:not([hidden])';

// Search roots, nearest first: the element's own shadow root (Workday), then
// its document (same-origin iframe), then the top document. Mirrors the
// reach of FILLER_RUNTIME's findEl, which is what located the field.
function scopesOf(el) {
  var roots = [];
  try {
    var r = el.getRootNode ? el.getRootNode() : null;
    if (r && r.querySelectorAll) roots.push(r);
  } catch (e) {}
  try {
    if (el.ownerDocument && roots.indexOf(el.ownerDocument) === -1) roots.push(el.ownerDocument);
  } catch (e) {}
  if (roots.indexOf(document) === -1) roots.push(document);
  return roots;
}

// aria-controls / aria-owns names THIS field's popup, so it is authoritative
// — honoured even when it resolves to a node already read, because some
// widgets legitimately reuse one portal container for every menu.
function byAssociation(el, roots) {
  var id = null;
  try { id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns'); } catch (e) {}
  if (!id) return null;
  for (var i = 0; i < roots.length; i++) {
    var node = null;
    try {
      node = roots[i].getElementById ? roots[i].getElementById(id) : null;
    } catch (e) {}
    if (!node) continue;
    try {
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') continue;
    } catch (e) {}
    if (node.getClientRects && !node.getClientRects().length) continue;
    return node;
  }
  return null;
}

function findListbox(el, prevListbox) {
  var prompt = workdayPrompt(el);
  if (prompt) return prompt.querySelector('[role="listbox"]');
  var roots = scopesOf(el);
  var assoc = byAssociation(el, roots);
  if (assoc) return assoc;
  if (el.getAttribute('aria-controls') || el.getAttribute('aria-owns')) return null;
  for (var i = 0; i < roots.length; i++) {
    var nodes = [];
    try { nodes = roots[i].querySelectorAll(LISTBOX_SELECTOR); } catch (e) { nodes = []; }
    for (var j = 0; j < nodes.length; j++) {
      // An unassociated menu identical to the one the last field used is
      // assumed stale rather than guessed to belong here. A missed harvest
      // just leaves the field to the AI resolver; a wrong one picks a wrong
      // answer on a live application.
      if (prevListbox && nodes[j] === prevListbox) continue;
      if (nodes[j].getAttribute('data-automation-id') === 'selectedItemList') continue;
      if (nodes[j].getClientRects && !nodes[j].getClientRects().length) continue;
      return nodes[j];
    }
  }
  return null;
}

function dropdownOptions(listbox) {
  var semantic = listbox.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]');
  if (semantic.length) return semantic;
  var actions = listbox.querySelectorAll('.pac-item, button, a');
  return actions.length ? actions : listbox.querySelectorAll('li');
}

function clickCheckable(el, shouldBeChecked) {
  // Set checked state imperatively, then dispatch the events React/Vue
  // listen to. click() alone toggles unpredictably when state already matches.
  if (!el) return false;
  afMarkFilled(el);
  try {
    if (typeof shouldBeChecked === 'boolean' && el.checked === shouldBeChecked) {
      // Already in target state; still fire change so any onChange runs.
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  } catch (e) {}
  try {
    var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'checked');
    if (desc && desc.set) desc.set.call(el, shouldBeChecked === false ? false : true);
    else el.checked = shouldBeChecked === false ? false : true;
  } catch (e) {
    try { el.checked = shouldBeChecked === false ? false : true; } catch (_) {}
  }
  try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
  try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  return true;
}

function fillRadioGroup(options, value) {
  if (!options || !options.length) return false;
  var target = cleanOptText(value);
  var best = null, bestScore = 0;
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var lab = cleanOptText(opt.label);
    var val = cleanOptText(opt.value);
    var score = 0;
    if (lab && lab === target) score = Math.max(score, 4);
    if (val && val === target) score = Math.max(score, 4);
    if (lab && lab.indexOf(target) === 0) score = Math.max(score, 3);
    if (val && val.indexOf(target) === 0) score = Math.max(score, 3);
    if (target.length >= 2 && lab && lab.indexOf(target) !== -1) score = Math.max(score, 2);
    if (target.length >= 2 && val && val.indexOf(target) !== -1) score = Math.max(score, 2);
    // Common boolean-style mappings
    if (/^(yes|true|1|y)$/.test(target) && /^(yes|i (am|do)|authorized|true)/.test(lab)) score = Math.max(score, 3);
    if (/^(no|false|0|n)$/.test(target)  && /^(no|i (am not|do not)|not authorized|false)/.test(lab)) score = Math.max(score, 3);
    if (score > bestScore) { bestScore = score; best = opt; }
  }
  if (!best) return false;
  var radio = findEl(best.afId);
  if (!radio) return false;
  return clickCheckable(radio, true);
}

function fillCheckboxGroup(options, value) {
  if (!options || !options.length) return false;
  var values = String(value).split(',').map(function(s) { return cleanOptText(s); }).filter(Boolean);
  if (values.length === 0) return false;
  var hits = 0;
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var lab = cleanOptText(opt.label);
    var val = cleanOptText(opt.value);
    var match = false;
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

function openDropdown(el) {
  fireFocus(el);
  try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (e) {}
  try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true })); } catch (e) {}
  try { el.click(); } catch (e) {}
  if (el.getAttribute('aria-expanded') !== 'true') {
    try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true })); } catch (e) {}
  }
}

function trackWorkdayQuestionLoads(el) {
  if (!/Questionnaire--/.test(el.id || '') || typeof window.fetch !== 'function') return null;
  if (!window.__AF_QUESTION_LOADS__) {
    var state = window.__AF_QUESTION_LOADS__ = { pending: 0, settledAt: 0, failures: 0 };
    var fetch = window.fetch;
    window.fetch = function(input) {
      var url = typeof input === 'string' ? input : input && input.url || '';
      var tracked = /\\/questionnaire\\/[^/]+\\/definition(?:[?#]|$)/.test(url);
      if (tracked) state.pending++;
      function settled(failed) {
        if (tracked) { state.pending--; state.settledAt = Date.now(); if (failed) state.failures++; }
      }
      try {
        return fetch.apply(this, arguments).then(function(response) {
          if (tracked && response.ok !== false) {
            try {
              response.clone().arrayBuffer().then(function() { settled(false); }, function() { settled(true); });
            } catch (error) { settled(true); }
          } else { settled(response.ok === false); }
          return response;
        }, function(error) { settled(true); throw error; });
      } catch (error) { settled(true); throw error; }
    };
  }
  return window.__AF_QUESTION_LOADS__;
}

function selectDropdownOption(el, value) {
  return new Promise(function(resolve) {
    var questionLoads = trackWorkdayQuestionLoads(el);
    var failuresBefore = questionLoads ? questionLoads.failures : 0;
    var attempts = 0;
    function poll() {
      if (!afIsCurrent() || el.isConnected === false || el.__afUserEdited) { resolve(false); return; }
      attempts++;
      var best = null, bestScore = 0, tied = false;
      var listbox = findListbox(el);
      if (listbox) {
        var options = dropdownOptions(listbox);
        var target = cleanOptText(value);
        for (var i = 0; i < options.length; i++) {
          var opt = options[i];
          if (opt.disabled || opt.getAttribute('aria-disabled') === 'true') continue;
          var text = cleanOptText(opt.innerText || opt.textContent || '');
          var val = cleanOptText(opt.getAttribute('data-value') || opt.getAttribute('value') || '');
          var score = target && (text === target || val === target) ? 4
            : target.length >= 2 && text.indexOf(target) === 0 ? 3 : 0;
          // Workday offers both a catalog skill and an identical free-text choice.
          if (score === 4 && workdayPrompt(el) && /^menuItem-REMOTE_SKILL-/.test(opt.id || '')) score = 5;
          if (score > bestScore) { best = opt; bestScore = score; tied = false; }
          else if (score && score === bestScore && score !== 5 &&
            !(workdayPrompt(el) && opt.id && opt.id === best.id)) tied = true;
        }
      }
      if (!best || tied) {
        // Search results can briefly contain the previous query's options.
        if (attempts < (workdayPrompt(el) ? 25 : 15)) { setTimeout(poll, 150); return; }
        try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) {}
        resolve(false);
        return;
      }
      try {
        afMarkFilled(el);
        try { best.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        var action = best.querySelector && best.querySelector('[data-automation-id="promptLeafNode"]') || best;
        var checkbox = action.querySelector && action.querySelector('input[type="checkbox"]');
        if (!checkbox || !checkbox.checked) {
          action.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          action.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          action.click();
        }
        fireBlur(el);
        if (!isButtonDropdown(el)) { resolve(true); return; }
        // React may commit the selection after the click handler returns.
        var selectedText = cleanOptText(best.innerText || best.textContent || '');
        var selectedValue = cleanOptText(best.getAttribute('data-value') || best.getAttribute('value') || '');
        var checks = 0;
        var clickedAt = Date.now();
        function confirmSelection() {
          if (!afIsCurrent() || el.isConnected === false || el.__afUserEdited) { resolve(false); return; }
          // Workday refreshes conditional rules and can reset later answers until it settles.
          if (questionLoads && (questionLoads.pending || Date.now() - Math.max(clickedAt, questionLoads.settledAt) < 200)) {
            if (++checks < 50) { setTimeout(confirmSelection, 100); return; }
            resolve(false); return;
          }
          if (questionLoads && questionLoads.failures !== failuresBefore) { resolve(false); return; }
          var display = cleanOptText(el.innerText || el.textContent || '');
          var valueNow = cleanOptText(el.value || '');
          if ((selectedText && (display === selectedText || valueNow === selectedText)) ||
            (selectedValue && valueNow === selectedValue)) { resolve(true); return; }
          if (++checks < 15) { setTimeout(confirmSelection, 100); return; }
          resolve(false);
        }
        confirmSelection();
      } catch (e) { resolve(false); }
    }
    // Let input handlers finish updating the menu before choosing an option.
    setTimeout(poll, 0);
  });
}

function tryButtonDropdownFill(el, value) {
  openDropdown(el);
  return selectDropdownOption(el, value);
}

function isPlacesLikeInput(el) {
  if (!el || !el.getAttribute || el.readOnly) return false;
  if (el.getAttribute('role') !== 'combobox') return false;
  if (el.getAttribute('aria-controls')) return false;
  var name = (el.getAttribute('name') || '').toLowerCase();
  var ph = (el.getAttribute('placeholder') || '').toLowerCase();
  var al = (el.getAttribute('aria-label') || '').toLowerCase();
  var dl = (el.getAttribute('data-label') || '').toLowerCase();
  return /city|location|locat|where|based|address/.test(name + ' ' + ph + ' ' + al + ' ' + dl);
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
      if (!afIsCurrent() || el.isConnected === false || el.__afUserEdited) { resolve(false); return; }
      if (i >= typeChunk.length) {
        setTimeout(function() { selectDropdownOption(el, value).then(resolve); }, 700);
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
  var role = el.getAttribute && el.getAttribute('role');
  var hasPopup = el.getAttribute && el.getAttribute('aria-haspopup');
  if (role !== 'combobox' && hasPopup !== 'listbox' && hasPopup !== 'menu') return false;
  if (el.readOnly) return tryButtonDropdownFill(el, value);
  openDropdown(el);
  var previousValue = el.value;
  setNativeInput(el, value);
  return selectDropdownOption(el, value).then(function(ok) {
    if (!ok && afIsCurrent() && !el.__afUserEdited && el.isConnected !== false) setNativeInput(el, previousValue);
    return ok;
  });
}

function isWorkdaySelect(el) {
  return el.getAttribute('data-uxi-widget-type') === 'selectinput';
}

function workdayPrompt(el) {
  var id = el.getAttribute('data-uxi-multiselect-id');
  if (!id) return null;
  var prompts = (el.ownerDocument || document).querySelectorAll('[data-associated-widget]');
  for (var i = 0; i < prompts.length; i++) {
    if (prompts[i].getAttribute('data-associated-widget') === id) return prompts[i];
  }
  return null;
}

async function fillWorkdaySelect(el, values) {
  if (!afIsCurrent() || el.disabled || el.__afUserEdited || el.isConnected === false) return false;
  openDropdown(el);
  var prompt = null;
  for (var attempt = 0; attempt < 15 && !prompt; attempt++) {
    if (!afIsCurrent() || el.__afUserEdited || el.isConnected === false) return false;
    prompt = workdayPrompt(el);
    if (!prompt) await new Promise(function(resolve) { setTimeout(resolve, 100); });
  }
  if (!prompt) return false;
  var input = prompt.querySelector('input[data-uxi-widget-type="selectinput"]') || el;
  var ok = true;
  for (var i = 0; i < values.length; i++) {
    if (!afIsCurrent() || el.__afUserEdited || input.__afUserEdited || el.isConnected === false || input.isConnected === false) return false;
    var container = el.closest && el.closest('[data-automation-id="multiselectInputContainer"]');
    var selectedItems = container ? container.querySelectorAll('[data-automation-id="selectedItem"]') : [];
    var alreadySelected = false;
    for (var s = 0; s < selectedItems.length; s++) {
      if (cleanOptText(selectedItems[s].textContent) === cleanOptText(values[i])) alreadySelected = true;
    }
    if (alreadySelected) continue;
    afMarkFilled(input);
    setNativeInput(input, values[i]);
    await new Promise(function(resolve) { setTimeout(resolve, 100); });
    if (!afIsCurrent() || el.__afUserEdited || input.__afUserEdited) return false;
    // Workday searches on Enter; typing alone leaves its previous result list.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    if (!await selectDropdownOption(el, values[i])) ok = false;
    await new Promise(function(resolve) { setTimeout(resolve, 100); });
  }
  if (!afIsCurrent()) return false;
  var buttons = prompt.querySelectorAll('button');
  for (var b = 0; b < buttons.length; b++) {
    if ((buttons[b].textContent || '').trim() === 'Done') { buttons[b].click(); break; }
  }
  fireBlur(el);
  return ok;
}

function fillChips(el, values) {
  afMarkFilled(el);
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

function forEachField(ids, fill, done) {
  var index = 0;
  function next() {
    // A timed-out questionnaire request must not race the rest of this batch.
    if (window.__AF_QUESTION_LOADS__ && window.__AF_QUESTION_LOADS__.pending) { done(); return; }
    while (afIsCurrent() && index < ids.length) {
      var result = fill(ids[index++]);
      if (result && typeof result.then === 'function') {
        result.then(next, next);
        return;
      }
    }
    done();
  }
  next();
}

function fillOne(el, value) {
  if (!el || !afIsCurrent() || el.isConnected === false || el.disabled || el.__afUserEdited) return false;
  if (el.readOnly && el.getAttribute('role') !== 'combobox' && el.getAttribute('aria-haspopup') !== 'listbox') return false;
  if (el.getClientRects && !el.getClientRects().length) return false;
  afMarkFilled(el);
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
    return tryButtonDropdownFill(el, strVal);
  }

  // Google Places / geocoding-backed location comboboxes need char-by-char
  // typing + a longer wait for the API response before clicking an option.
  if (isPlacesLikeInput(el)) {
    return tryPlacesComboboxFill(el, strVal);
  }

  // Combobox / custom dropdown — try first, fall through to native fill if it
  // wasn't actually a combobox.
  if (isWorkdaySelect(el)) return fillWorkdaySelect(el, [strVal]);
  var combo = tryComboboxFill(el, strVal);
  if (combo) return combo;

  fireFocus(el);
  setNativeInput(el, strVal);
  fireBlur(el);
  mark();
  return true;
}
`;

// Pure merge for the per-field outcomes map: later results win. Extracted
// so BrowserScreen's several fill passes (fast, AI, dropdown-resolution,
// corrections — each of which may re-touch the same af-id) can be tested
// without executing a generated script or rendering the component. Later
// callers intentionally overwrite earlier ones: e.g. a field the fast pass
// marks 'control-failed' because the raw profile value didn't match any
// option, which the dropdown-resolution pass then fills successfully via
// buildDirectFillScript, must end up 'filled', not stuck at the stale
// earlier verdict.
export function mergeFillOutcomes(prev, incoming) {
  return { ...(prev || {}), ...(incoming || {}) };
}

export function buildDirectFillScript(valuesById, generation = null, explicitAnswers = false) {
  return `
(function() {
  var values = ${safeJson(valuesById)};
  ${FILLER_RUNTIME}

  ${explicitAnswers ? `// Only a fresh user-confirmed answer may supersede earlier manual edits.
  Object.keys(values).forEach(function(id) {
    var el = findEl(id);
    if (el) el.__afUserEdited = false;
  });` : ''}

  var filled = 0;
  var outcomes = {};
  forEachField(Object.keys(values), function(id) {
    var el = findEl(id);
    if (!el) { outcomes[id] = 'control-failed'; return; }
    function record(ok) {
      outcomes[id] = ok ? 'filled' : 'control-failed';
      if (ok) filled++;
    }
    var result = fillOne(el, values[id]);
    if (result && result.then) return result.then(record, function() { record(false); });
    record(result);
  }, function() {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'AI_FILL_COMPLETE', epoch: afEpoch, filled: filled, outcomes: outcomes${generation == null ? '' : ', generation: ' + safeJson(generation)}
    }));
  }
  });
})();
  `;
}

// Attach a file (base64) to <input type="file"> fields via DataTransfer —
// the one programmatic path Chrome allows into a file input. Hidden file
// inputs are fair game: dropzone UIs keep the real input display:none and
// listen for its change event.
// shortcut: whole file inlined as one base64 string into injectJavaScript;
// chunked postMessage transfer if multi-MB resumes ever fail.
export function buildResumeAttachScript(fieldIds, base64, fileName, mime) {
  return `
(function() {
  var ids = ${safeJson(fieldIds || [])};
  var name = ${safeJson(fileName || 'resume.pdf')};
  var mime = ${safeJson(mime || 'application/pdf')};
  ${FILLER_RUNTIME}
  var outcomes = {};
  var attached = 0;
  try {
    var bin = atob(${safeJson(base64)});
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type: mime }));
    ids.forEach(function(id) {
      var el = findEl(id);
      if (!el || (el.type || '').toLowerCase() !== 'file') { outcomes[id] = 'control-failed'; return; }
      var upload = el.closest && el.closest('[data-automation-id="attachments-FileUpload"]');
      if ((el.files && el.files.length) || (upload && upload.querySelector('[data-automation-id="file-upload-successful"]'))) {
        outcomes[id] = 'filled';
        return;
      }
      try {
        afMarkFilled(el);
        el.files = dt.files;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        attached++;
        outcomes[id] = 'filled';
      } catch (e) { outcomes[id] = 'control-failed'; }
    });
  } catch (e) {}
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'RESUME_ATTACHED', epoch: afEpoch, attached: attached, outcomes: outcomes
    }));
  }
})();
  `;
}

// Opens each combobox in turn and reports the options its listbox renders.
//
// React-Select and similar widgets create their listbox only on open, so the
// options simply do not exist at scan time — this is why resolveLocally skipped
// these fields entirely (isDropdown requires a non-empty options array).
// Opening is serial because focusing one combobox closes another.
//
// `generation` is echoed back in the COMBOBOX_OPTIONS message so
// harvestCoordinator can discard a late reply from a superseded run instead
// of handing one run's options to another.
// Defaults to null (not 0) so a script built without a generation is treated
// as untagged and accepted by deliver(), rather than looking like a reply from
// a generation that can never be current.
export function buildComboboxHarvestScript(fieldIds, generation = null) {
  return `
(function() {
  var ids = ${safeJson(fieldIds || [])};
  var generation = ${safeJson(generation)};
  var results = {};

  // In-page re-entrancy guard. Two step() loops running at once open menus
  // over each other, which is exactly the condition that makes one widget's
  // still-mounted listbox get read as the next widget's options. Expressed as
  // a deadline rather than a boolean so a harvest that dies mid-flight (a page
  // navigating out from under it) cannot block harvesting forever.
  var nowTs = Date.now();
  if (window.__AF_HARVEST_UNTIL__ && nowTs < window.__AF_HARVEST_UNTIL__) return;
  window.__AF_HARVEST_UNTIL__ = nowTs + 30000;

  ${FILLER_RUNTIME}

  function post() {
    window.__AF_HARVEST_UNTIL__ = 0;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'COMBOBOX_OPTIONS', epoch: afEpoch, generation: generation, options: results
      }));
    }
  }

  // The listbox attributed to the PREVIOUS field. closeAny() is best-effort,
  // so the previous widget's menu is frequently still mounted when the next
  // one is read — reporting it again would attribute one combobox's options
  // to another and can select an arbitrary answer on a real application.
  var prevListbox = null;

  function readOptionsFrom(listbox) {
    var out = [];
    if (!listbox || !listbox.querySelectorAll) return out;
    var nodes = [];
    try {
      nodes = dropdownOptions(listbox);
    } catch (e) { return out; }
    for (var i = 0; i < nodes.length; i++) {
      var label = (nodes[i].innerText || nodes[i].textContent || '').trim();
      if (!label) continue;
      out.push({ value: nodes[i].getAttribute('data-value') || label, label: label });
    }
    return out;
  }

  // Poll for options, replacing the single 300ms shot the
  // harvest used to take: React-Select routinely needs longer than that to
  // mount its menu, and a miss silently dropped the field.
  var MAX_ATTEMPTS = 8;
  var INTERVAL_MS = 120;

  function waitForOptions(el, done) {
    var attempts = 0;
    function poll() {
      if (!afIsCurrent()) { done(null, []); return; }
      attempts++;
      var lb = null;
      try { lb = findListbox(el, prevListbox); } catch (e) {}
      if (lb) {
        var opts = readOptionsFrom(lb);
        if (opts.length) { done(lb, opts); return; }
      }
      if (attempts >= MAX_ATTEMPTS) { done(null, []); return; }
      setTimeout(poll, INTERVAL_MS);
    }
    setTimeout(poll, INTERVAL_MS);
  }

  function closeAny(el) {
    var prompt = workdayPrompt(el);
    var buttons = prompt ? prompt.querySelectorAll('button') : [];
    for (var b = 0; b < buttons.length; b++) {
      if ((buttons[b].textContent || '').trim() === 'Done') { buttons[b].click(); break; }
    }
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    } catch (e) {}
    try { el.blur(); } catch (e) {}
  }

  function step(i) {
    if (!afIsCurrent() || i >= ids.length) { post(); return; }
    var afId = ids[i];
    // findEl comes from FILLER_RUNTIME: it walks shadow roots and same-origin
    // iframes. The harvest used to duplicate a plain document.querySelector,
    // which silently dropped every combobox formScanner had tagged inside a
    // shadow root or an iframe (i.e. all of Workday).
    var el = null;
    try { el = findEl(afId); } catch (e) {}
    if (!el) { step(i + 1); return; }

    // Native <select> already carries its options; no need to open anything.
    if (el.tagName === 'SELECT' && el.options) {
      var nat = [];
      for (var k = 0; k < el.options.length; k++) {
        nat.push({ value: el.options[k].value, label: (el.options[k].text || '').trim() });
      }
      results[afId] = nat;
      step(i + 1);
      return;
    }

    openDropdown(el);

    waitForOptions(el, function(listbox, opts) {
      if (!afIsCurrent()) { post(); return; }
      if (opts.length) {
        results[afId] = opts;
        prevListbox = listbox;
      }
      closeAny(el);
      setTimeout(function() { step(i + 1); }, 60);
    });
  }

  step(0);
})();
  `;
}

// Build a compact map of group-style fields keyed by af-id so the runtime
// can route radio-group / checkbox-group fills (which need options[]).
function buildGroupMeta(fields) {
  const meta = {};
  if (!Array.isArray(fields)) return meta;
  for (const f of fields) {
    if (!f || !f.id) continue;
    if (f.widget === 'radio-group' || f.widget === 'checkbox-group') {
      meta[f.id] = {
        widget: f.widget,
        options: (f.options || []).map(o => ({
          afId: o.afId, value: o.value || '', label: o.label || '',
        })),
      };
    }
  }
  return meta;
}

export function buildFillScript(mapping, profileJson, fields, optionSelections = {}, generation = null) {
  // profileJson is already a JSON string (existing callers pass JSON.stringify(profile)).
  // Re-encode through safeJson to neutralise any embedded "</script>" sequence.
  const safeProfile = safeJson(JSON.parse(profileJson));
  const groupMeta = buildGroupMeta(fields);
  return `
(function() {
  var profile = ${safeProfile};
  var mapping = ${safeJson(mapping)};
  var groupMeta = ${safeJson(groupMeta)};
  var optionSelections = ${safeJson(optionSelections || {})};
  ${FILLER_RUNTIME}

  // Profile keys whose value is a comma-separated list and which should be
  // filled as chips when the target field is a combobox/multi-input.
  var CHIP_KEYS = { skills: true, languages: true };

  var filled = 0;
  var outcomes = {};
  forEachField(Object.keys(mapping), function(fieldId) {
    var profileKey = mapping[fieldId];
    if (!profileKey) return;

    // Resolve value with deprecated-alias fallback (salary -> expectedSalary).
    var val = profile[profileKey];
    if ((val === undefined || val === null || val === '') && profileKey === 'expectedSalary') {
      val = profile.salary;
    }
    // Dropdown option override: use the resolved option text (e.g. "United
    // States") instead of the raw profile value (e.g. "USA"). fillOne still
    // routes <select> -> setSelectVal and custom dropdowns -> the popup matcher.
    if (optionSelections[fieldId] !== undefined && optionSelections[fieldId] !== null && optionSelections[fieldId] !== '') {
      val = optionSelections[fieldId];
    }
    if (val === undefined || val === null || val === '') { outcomes[fieldId] = 'no-value'; return; }

    // Non-scalar profile values (education/experience arrays of objects) have
    // no sane string form — String() would type "[object Object]" into the field.
    if (Array.isArray(val)) {
      val = val.filter(function(v) { return v != null && typeof v !== 'object'; }).join(', ');
    }
    if (typeof val === 'object' || val === '') { outcomes[fieldId] = 'no-value'; return; }

    // Radio / checkbox group: routed via options[], not a single el.
    var meta = groupMeta[fieldId];
    if (meta && meta.widget === 'radio-group') {
      if (fillRadioGroup(meta.options, val)) { filled++; outcomes[fieldId] = 'filled'; }
      else outcomes[fieldId] = 'control-failed';
      return;
    }
    if (meta && meta.widget === 'checkbox-group') {
      if (fillCheckboxGroup(meta.options, val)) { filled++; outcomes[fieldId] = 'filled'; }
      else outcomes[fieldId] = 'control-failed';
      return;
    }

    var el = findEl(fieldId);
    if (!el) { outcomes[fieldId] = 'control-failed'; return; }

    if (profileKey === 'phone') val = normalisePhone(val, profile.country, el);
    // Workday rejects the equivalent LinkedIn URL without the www host.
    if (profileKey === 'linkedIn') val = String(val).trim().replace(/^(?:https?:\\/\\/)?(?:www\\.)?linkedin\\.com\\//i, 'https://www.linkedin.com/');

    if (CHIP_KEYS[profileKey] && isWorkdaySelect(el) && !el.__afUserEdited) {
      var choices = String(val).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      return fillWorkdaySelect(el, choices).then(record, function() { record(false); });
    }

    if (el.tagName === 'INPUT' && !el.__afUserEdited && CHIP_KEYS[profileKey] && (el.getAttribute('role') === 'combobox' ||
        el.getAttribute('aria-haspopup') === 'listbox')) {
      var values = String(val).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      fillChips(el, values);
      filled++;
      outcomes[fieldId] = 'filled';
      return;
    }

    function record(ok) {
      outcomes[fieldId] = ok ? 'filled' : 'control-failed';
      if (ok) filled++;
    }
    var result = fillOne(el, val);
    if (result && result.then) return result.then(record, function() { record(false); });
    record(result);
  }, function() {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'FILL_COMPLETE', epoch: afEpoch, filled: filled, outcomes: outcomes${generation == null ? '' : ', generation: ' + safeJson(generation)}
    }));
  }
  });
})();
  `;
}

// How long after WE touched an element its input/change events are treated as
// ours rather than the user's. Covers the slowest async fill path
// (tryButtonDropdownFill: waitForListbox 12 x 150ms, then a click the page
// reacts to). Nothing is lost by being generous: an element inside this window
// was, by definition, just auto-filled, and BrowserScreen already discards
// USER_INPUT_DETECTED for auto-filled fields.
const SYNTHETIC_FILL_WINDOW_MS = 5000;

// `filledAfIds` is merged into a page-level set rather than closed over, and
// re-injection updates that set even though the DOM listeners are installed
// only once. Passing a fresh snapshot on each pass is how the AI pass,
// dropdown-resolution pass, correction replay and AI drafts get represented —
// previously only the fast pass's ids were ever known.
export function buildCorrectionListenerScript(filledAfIds) {
  const filledMap = Object.fromEntries((filledAfIds || []).map(id => [id, true]));
  return `
(function() {
  var incoming = ${safeJson(filledMap)};
  if (!window.__AF_FILLED_IDS__) window.__AF_FILLED_IDS__ = {};
  var incomingKeys = Object.keys(incoming);
  for (var n = 0; n < incomingKeys.length; n++) {
    window.__AF_FILLED_IDS__[incomingKeys[n]] = true;
  }
  // Listeners are capture-phase and global; installing them twice would double
  // every report. The id set above is refreshed on every injection regardless.
  if (window.__AF_CORRECTION_LISTENER__) return;
  window.__AF_CORRECTION_LISTENER__ = true;

  // setSelectVal, clickCheckable and setNativeInput all dispatch synthetic
  // 'change' events while filling, and this listener is capture-phase, so it
  // saw every one of them as a user correction — then replayed them onto
  // future forms. The wasAutoFilled guard did not cover it: that only knew the
  // fast pass's ids, and on a re-entrant run the __AF_CORRECTION_LISTENER__
  // guard meant the already-installed listener never learned the new ones.
  function isSyntheticFill(el) {
    try {
      var t = el && el.__afFilledAt;
      return !!t && (Date.now() - t) < ${SYNTHETIC_FILL_WINDOW_MS};
    } catch (e) { return false; }
  }

  function report(el, value) {
    var afId = el.getAttribute && el.getAttribute('data-af-id');
    if (!afId || !value) return;
    if (isSyntheticFill(el)) return;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'USER_INPUT_DETECTED',
        afId: afId,
        value: value,
        wasAutoFilled: !!(window.__AF_FILLED_IDS__ && window.__AF_FILLED_IDS__[afId]),
      }));
    }
  }

  // Text-like controls settle on blur.
  document.addEventListener('blur', function(e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var value = (el.value || el.textContent || '').trim();
    report(el, value);
  }, true);

  // Checkboxes, radios and selects never blur meaningfully, so the answer the
  // user chose was previously never learned. 'change' is where they commit.
  document.addEventListener('change', function(e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var type = (el.type || '').toLowerCase();
    var value = '';

    if (type === 'checkbox' || type === 'radio') {
      // Only learn checked state. Unchecking is not learned because (1) it would
      // require storing a separate "off" value, but the replay path (buildFillScript
      // -> fillOne) has no logic to set .checked = false based on a stored value,
      // and (2) for checkbox groups, only the checked option is semantically meaningful.
      // Standalone boolean checkboxes don't round-trip correctly through the existing
      // replay system, which only sets .value, not .checked. Changing this would
      // require redesigning either the storage format or the replay path.
      if (!el.checked) return;
      var lid = el.getAttribute('id');
      var lab = null;
      if (lid) { try { lab = document.querySelector('label[for="' + lid + '"]'); } catch (err) {} }
      if (!lab && el.closest) lab = el.closest('label');
      value = lab ? (lab.innerText || lab.textContent || '').trim() : (el.value || '').trim();
    } else if (el.tagName === 'SELECT') {
      var sel = el.options && el.options[el.selectedIndex];
      value = sel ? (sel.text || sel.value || '').trim() : '';
    } else {
      value = (el.value || '').trim();
    }

    report(el, value);
  }, true);
})();
  `;
}
