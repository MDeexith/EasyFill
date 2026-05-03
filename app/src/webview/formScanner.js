export const FORM_SCANNER_JS = `
(function() {
  var AF_ATTR = 'data-af-id';

  function getNearbyText(el) {
    // 1. explicit <label for="id">
    if (el.id) {
      var lbl = document.querySelector('label[for="' + el.id + '"]');
      if (lbl) return lbl.innerText.trim().slice(0, 100);
    }
    // 2. wrapping <label>
    var p = el.parentElement;
    for (var i = 0; i < 4 && p; i++) {
      var lbls = p.querySelectorAll('label');
      if (lbls.length > 0) return lbls[0].innerText.trim().slice(0, 100);
      p = p.parentElement;
    }
    // 3. aria-labelledby
    var llby = el.getAttribute('aria-labelledby');
    if (llby) {
      var target = document.getElementById(llby);
      if (target) return target.innerText.trim().slice(0, 100);
    }
    // 4. preceding sibling text node
    var siblings = el.parentElement ? el.parentElement.childNodes : [];
    for (var j = 0; j < siblings.length; j++) {
      if (siblings[j].nodeType === 3 && siblings[j].textContent.trim())
        return siblings[j].textContent.trim().slice(0, 100);
    }
    // 5. preceding element text (common in React form libs)
    var prev = el.previousElementSibling;
    if (prev && prev.innerText) return prev.innerText.trim().slice(0, 100);
    return '';
  }

  function scanForms() {
    var sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]), textarea, select';
    var els = document.querySelectorAll(sel);
    var fields = [];
    var idx = 0;

    els.forEach(function(el) {
      // Assign stable data attribute so filler can always find this element
      var afId = el.getAttribute(AF_ATTR);
      if (!afId) {
        afId = el.id || (el.name ? 'name_' + el.name : 'af_' + idx);
        el.setAttribute(AF_ATTR, afId);
      }
      idx++;

      fields.push({
        id: afId,
        name: el.name || '',
        type: (el.type || el.tagName).toLowerCase(),
        tag: el.tagName.toLowerCase(),
        label: '',
        placeholder: el.placeholder || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        nearbyText: getNearbyText(el),
        longform: el.tagName.toLowerCase() === 'textarea',
      });
    });

    if (fields.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'FIELDS_SCANNED', fields: fields }));
    }
  }

  // Initial scan
  scanForms();

  // Re-scan after delays — catches SPA frames that render forms late
  setTimeout(scanForms, 1500);
  setTimeout(scanForms, 3500);

  // Watch for dynamically added form elements
  var observer = new MutationObserver(function(mutations) {
    var hasFormChange = mutations.some(function(m) {
      return Array.from(m.addedNodes).some(function(n) {
        return n.nodeType === 1 && (
          n.tagName === 'FORM' ||
          n.tagName === 'INPUT' ||
          n.tagName === 'TEXTAREA' ||
          n.tagName === 'SELECT' ||
          (n.querySelector && n.querySelector('input, textarea, select'))
        );
      });
    });
    if (hasFormChange) setTimeout(scanForms, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
`;
