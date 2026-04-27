export const FORM_SCANNER_JS = `
(function() {
  function getNearbyText(el) {
    var labelEl = null;
    if (el.id) {
      labelEl = document.querySelector('label[for="' + el.id + '"]');
    }
    if (!labelEl) {
      var parent = el.parentElement;
      for (var i = 0; i < 3 && parent; i++) {
        var labels = parent.querySelectorAll('label');
        if (labels.length > 0) { labelEl = labels[0]; break; }
        parent = parent.parentElement;
      }
    }
    if (labelEl) return labelEl.innerText.trim().slice(0, 80);

    var siblings = el.parentElement ? el.parentElement.childNodes : [];
    for (var j = 0; j < siblings.length; j++) {
      if (siblings[j].nodeType === 3 && siblings[j].textContent.trim()) {
        return siblings[j].textContent.trim().slice(0, 80);
      }
    }
    return '';
  }

  function scanForms() {
    var selectors = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select';
    var elements = document.querySelectorAll(selectors);
    var fields = [];
    elements.forEach(function(el, idx) {
      var tag = el.tagName.toLowerCase();
      var t = (el.type || tag).toLowerCase();
      var field = {
        id: el.id || (el.name ? 'name_' + el.name : 'idx_' + idx),
        name: el.name || '',
        type: t,
        tag: tag,
        label: '',
        placeholder: el.placeholder || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        nearbyText: getNearbyText(el),
        longform: tag === 'textarea',
      };
      fields.push(field);
    });

    if (fields.length > 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'FIELDS_SCANNED', fields: fields }));
    }
  }

  scanForms();

  var observer = new MutationObserver(function(mutations) {
    var hasFormChange = mutations.some(function(m) {
      return Array.from(m.addedNodes).some(function(n) {
        return n.nodeType === 1 && (n.tagName === 'FORM' || n.querySelector && n.querySelector('input, textarea, select'));
      });
    });
    if (hasFormChange) {
      setTimeout(scanForms, 300);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
`;
