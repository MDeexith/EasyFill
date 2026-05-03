export function buildDirectFillScript(valuesById) {
  return `
(function() {
  var values = ${JSON.stringify(valuesById)};

  function findEl(id) {
    return document.querySelector('[data-af-id="' + id + '"]') ||
           document.getElementById(id) ||
           (id.startsWith('name_') ? document.querySelector('[name="' + id.slice(5) + '"]') : null);
  }

  function setVal(el, v) {
    var proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  var filled = 0;
  Object.keys(values).forEach(function(id) {
    var el = findEl(id);
    if (!el) return;
    setVal(el, values[id]);
    el.style.backgroundColor = '#ecfdf5';
    el.style.border = '2px solid #10b981';
    filled++;
  });
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'AI_FILL_COMPLETE', filled: filled }));
})();
  `;
}

export function buildFillScript(mapping, profileJson) {
  return `
(function() {
  var profile = ${profileJson};
  var mapping = ${JSON.stringify(mapping)};

  function findEl(id) {
    return document.querySelector('[data-af-id="' + id + '"]') ||
           document.getElementById(id) ||
           (id.startsWith('name_') ? document.querySelector('[name="' + id.slice(5) + '"]') : null);
  }

  function setInputVal(el, value) {
    var proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  function setSelectVal(el, value) {
    // Try exact match first, then case-insensitive
    var opts = Array.from(el.options);
    var match = opts.find(function(o) { return o.value === value || o.text === value; }) ||
                opts.find(function(o) { return o.value.toLowerCase() === value.toLowerCase() || o.text.toLowerCase() === value.toLowerCase(); });
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  var filled = 0;

  Object.keys(mapping).forEach(function(fieldId) {
    var profileKey = mapping[fieldId];
    if (!profileKey) return;
    var val = profile[profileKey];
    if (val === undefined || val === null || val === '' || val === 0) return;

    var el = findEl(fieldId);
    if (!el) return;

    var strVal = String(val);
    if (el.tagName === 'SELECT') {
      setSelectVal(el, strVal);
    } else {
      setInputVal(el, strVal);
    }

    el.style.backgroundColor = '#e8f5e9';
    el.style.border = '2px solid #4caf50';
    filled++;
  });

  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'FILL_COMPLETE', filled: filled }));
})();
  `;
}
