export function buildDirectFillScript(valuesById) {
  return `
(function() {
  var values = ${JSON.stringify(valuesById)};
  function setVal(el, v) {
    var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (s && s.set) s.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var filled = 0;
  Object.keys(values).forEach(function(id) {
    var el = document.getElementById(id) ||
             document.querySelector('[name="' + id.replace('name_', '') + '"]');
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

  function nativeInputValueSet(el, value) {
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                       Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function nativeSelectSet(el, value) {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  var filled = 0;

  Object.keys(mapping).forEach(function(fieldId) {
    var profileKey = mapping[fieldId];
    if (!profileKey || profile[profileKey] === undefined || profile[profileKey] === '') return;

    var el = document.getElementById(fieldId) ||
             document.querySelector('[name="' + fieldId.replace('name_', '') + '"]');
    if (!el) return;

    var value = String(profile[profileKey]);

    if (el.tagName === 'SELECT') {
      nativeSelectSet(el, value);
    } else {
      nativeInputValueSet(el, value);
    }

    el.style.backgroundColor = '#e8f5e9';
    el.style.border = '2px solid #4caf50';
    filled++;
  });

  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'FILL_COMPLETE', filled: filled }));
})();
  `;
}
