import { buildCorrectionListenerScript, buildFillScript, buildDirectFillScript } from '../src/webview/filler';

describe('buildCorrectionListenerScript', () => {
  test('listens for change as well as blur', () => {
    const script = buildCorrectionListenerScript([]);
    expect(script).toContain("addEventListener('blur'");
    expect(script).toContain("addEventListener('change'");
  });

  test('reads the checked option label for checkbox and radio', () => {
    const script = buildCorrectionListenerScript([]);
    expect(script).toContain('checkbox');
    expect(script).toContain('radio');
  });

  test('still posts USER_INPUT_DETECTED so the handler is unchanged', () => {
    expect(buildCorrectionListenerScript([])).toContain('USER_INPUT_DETECTED');
  });

  test('uses only ES5 syntax', () => {
    const script = buildCorrectionListenerScript(['af_1']);
    expect(script).not.toMatch(/[=]>/);
    expect(script).not.toMatch(/\bconst\b/);
    expect(script).not.toMatch(/\blet\b/);
  });
});

describe('buildCorrectionListenerScript - runtime behavior', () => {
  // Create a minimal fake DOM to test the generated script
  function createFakeDOM() {
    const handlers = { blur: [], change: [] };
    const messages = [];
    const fakeDocument = {
      addEventListener(eventType, handler) {
        if (eventType === 'blur' || eventType === 'change') {
          handlers[eventType].push(handler);
        }
      },
      querySelector(selector) {
        // Support simple label[for="..."] queries
        if (selector && selector.startsWith('label[for="')) {
          const id = selector.slice(11, -2);
          return fakeDocument._labels[id];
        }
        return null;
      },
      _labels: {},
    };

    const fakeWindow = {
      ReactNativeWebView: {
        postMessage(msg) {
          messages.push(JSON.parse(msg));
        },
      },
    };

    const fakeElement = (attrs = {}) => {
      const el = {
        getAttribute(name) {
          return attrs[name] || null;
        },
        ...attrs,
      };
      if (attrs.hasOwnProperty('closest')) {
        // closest is already defined
      } else {
        el.closest = function(selector) {
          // Minimal closest implementation - only used for finding parent label
          if (selector === 'label') {
            return attrs._parentLabel || null;
          }
          return null;
        };
      }
      return el;
    };

    return {
      fakeDocument,
      fakeWindow,
      fakeElement,
      handlers,
      messages,
    };
  }

  test('a checked radio posts the associated label text as value', () => {
    const { fakeDocument, fakeWindow, fakeElement, handlers, messages } = createFakeDOM();

    // Create a radio button with an associated label
    const radioLabel = fakeElement({
      tagName: 'LABEL',
      innerText: 'Remote',
      textContent: 'Remote',
    });
    fakeDocument._labels.remote_yes = radioLabel;

    const radioEl = fakeElement({
      'data-af-id': 'af_1',
      type: 'radio',
      checked: true,
      id: 'remote_yes',
      value: 'yes',
    });

    // Execute the generated script
    const script = buildCorrectionListenerScript(['af_1']);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    // Simulate change event on radio
    const changeHandler = handlers.change[0];
    changeHandler({ target: radioEl });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'USER_INPUT_DETECTED',
      afId: 'af_1',
      value: 'Remote',
      wasAutoFilled: true,
    });
  });

  test('a <select> change posts the selected option text, not value attribute', () => {
    const { fakeDocument, fakeWindow, fakeElement, handlers, messages } = createFakeDOM();

    const option1 = fakeElement({
      text: 'United States',
      value: 'US',
    });
    const option2 = fakeElement({
      text: 'Canada',
      value: 'CA',
    });

    const selectEl = fakeElement({
      'data-af-id': 'af_2',
      tagName: 'SELECT',
      type: 'select-one',
      value: 'CA',
      selectedIndex: 1,
      options: [option1, option2],
    });

    // Execute the generated script
    const script = buildCorrectionListenerScript([]);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    // Simulate change event on select
    const changeHandler = handlers.change[0];
    changeHandler({ target: selectEl });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'USER_INPUT_DETECTED',
      afId: 'af_2',
      value: 'Canada',
      wasAutoFilled: false,
    });
  });

  test('a <select> with selectedIndex === -1 posts nothing', () => {
    const { fakeDocument, fakeWindow, fakeElement, handlers, messages } = createFakeDOM();

    const selectEl = fakeElement({
      'data-af-id': 'af_3',
      tagName: 'SELECT',
      type: 'select-one',
      value: '',
      selectedIndex: -1,
      options: [],
    });

    // Execute the generated script
    const script = buildCorrectionListenerScript([]);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    // Simulate change event on select
    const changeHandler = handlers.change[0];
    changeHandler({ target: selectEl });

    expect(messages).toHaveLength(0);
  });

  test('a checkbox with no matching label falls back to element value', () => {
    const { fakeDocument, fakeWindow, fakeElement, handlers, messages } = createFakeDOM();

    const checkboxEl = fakeElement({
      'data-af-id': 'af_4',
      type: 'checkbox',
      checked: true,
      id: 'sponsor_agree',
      value: 'agreed',
    });

    // Execute the generated script
    const script = buildCorrectionListenerScript([]);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    // Simulate change event on checkbox
    const changeHandler = handlers.change[0];
    changeHandler({ target: checkboxEl });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'USER_INPUT_DETECTED',
      afId: 'af_4',
      value: 'agreed',
      wasAutoFilled: false,
    });
  });

  test('posted message has exact shape with wasAutoFilled reflecting filledAfIds', () => {
    const { fakeDocument, fakeWindow, fakeElement, handlers, messages } = createFakeDOM();

    const inputEl = fakeElement({
      'data-af-id': 'af_5',
      type: 'text',
      value: 'John Doe',
    });

    // Execute the generated script with af_5 marked as filled
    const script = buildCorrectionListenerScript(['af_5']);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    // Simulate blur event on text input
    const blurHandler = handlers.blur[0];
    blurHandler({ target: inputEl });

    expect(messages).toHaveLength(1);
    const msg = messages[0];
    expect(Object.keys(msg).sort()).toEqual(['afId', 'type', 'value', 'wasAutoFilled']);
    expect(msg.type).toBe('USER_INPUT_DETECTED');
    expect(msg.afId).toBe('af_5');
    expect(msg.value).toBe('John Doe');
    expect(msg.wasAutoFilled).toBe(true);
  });

  test('unchecked checkbox does not post', () => {
    const { fakeDocument, fakeWindow, fakeElement, handlers, messages } = createFakeDOM();

    const checkboxEl = fakeElement({
      'data-af-id': 'af_6',
      type: 'checkbox',
      checked: false,
      value: 'option',
    });

    // Execute the generated script
    const script = buildCorrectionListenerScript([]);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    // Simulate change event on unchecked checkbox
    const changeHandler = handlers.change[0];
    changeHandler({ target: checkboxEl });

    // No message should be posted for unchecked checkbox
    expect(messages).toHaveLength(0);
  });

  test('element without data-af-id does not post', () => {
    const { fakeDocument, fakeWindow, fakeElement, handlers, messages } = createFakeDOM();

    const inputEl = fakeElement({
      type: 'text',
      value: 'some value',
      // no data-af-id
    });

    // Execute the generated script
    const script = buildCorrectionListenerScript([]);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    // Simulate blur event
    const blurHandler = handlers.blur[0];
    blurHandler({ target: inputEl });

    expect(messages).toHaveLength(0);
  });
});

// I5: the capture-phase 'change' listener fires on the synthetic change events
// that setSelectVal, clickCheckable and setNativeInput dispatch WHILE filling.
// The wasAutoFilled guard only covered ids in fastMapping, so AI-pass fills,
// dropdown fills, correction replays and AI drafts were all unprotected — and
// on a re-entrant run the __AF_CORRECTION_LISTENER__ guard meant the
// already-installed listener never learned the newer ids either. Every such
// fill was recorded as a user correction and replayed onto future forms.
describe('buildCorrectionListenerScript - does not learn our own fills', () => {
  // One shared fake page: the fill script and the listener script run against
  // the SAME element objects, exactly as they do in the WebView, so the
  // element stamping done during the fill is what the listener actually sees.
  function createPage(elementsByAfId) {
    const handlers = { blur: [], change: [] };
    const messages = [];
    const fakeDocument = {
      addEventListener(type, handler) {
        if (handlers[type]) handlers[type].push(handler);
      },
      querySelector(selector) {
        const m = /\[data-af-id="([^"]+)"\]/.exec(selector || '');
        return (m && elementsByAfId[m[1]]) || null;
      },
      querySelectorAll: () => [],
      getElementsByTagName: () => [],
    };
    const fakeWindow = {
      HTMLInputElement: { prototype: {} },
      HTMLTextAreaElement: { prototype: {} },
      ReactNativeWebView: {
        postMessage(msg) { messages.push(JSON.parse(msg)); },
      },
    };
    return { fakeDocument, fakeWindow, handlers, messages };
  }

  function inputEl(afId) {
    const attrs = { 'data-af-id': afId };
    return {
      tagName: 'INPUT',
      type: 'text',
      value: '',
      getAttribute: name => (attrs[name] !== undefined ? attrs[name] : null),
      dispatchEvent() {},
      focus() {},
    };
  }

  function run(page, script) {
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(page.fakeDocument, page.fakeWindow);
  }

  test('a field the AI pass just filled is NOT reported as a user correction', () => {
    const el = inputEl('af_1');
    const page = createPage({ af_1: el });

    run(page, buildCorrectionListenerScript([]));           // listener installed first
    run(page, buildDirectFillScript({ af_1: 'Ada Lovelace' })); // the AI-pass fill

    // The synthetic change the fill dispatched, replayed through the listener.
    page.handlers.change[0]({ target: el });
    page.handlers.blur[0]({ target: el });

    const corrections = page.messages.filter(m => m.type === 'USER_INPUT_DETECTED');
    expect(corrections).toHaveLength(0);
  });

  test('a genuine user change on an untouched field IS still reported', () => {
    const ours = inputEl('af_1');
    const theirs = inputEl('af_2');
    const page = createPage({ af_1: ours, af_2: theirs });

    run(page, buildCorrectionListenerScript([]));
    run(page, buildDirectFillScript({ af_1: 'Ada Lovelace' }));

    // The user types into a DIFFERENT field while our fill is still settling.
    theirs.value = 'Referred by a friend';
    page.handlers.blur[0]({ target: theirs });

    const corrections = page.messages.filter(m => m.type === 'USER_INPUT_DETECTED');
    expect(corrections).toHaveLength(1);
    expect(corrections[0].afId).toBe('af_2');
    expect(corrections[0].value).toBe('Referred by a friend');
    expect(corrections[0].wasAutoFilled).toBe(false);
  });

  test('a field buildFillScript filled from the profile is NOT reported', () => {
    const el = inputEl('af_1');
    const page = createPage({ af_1: el });

    run(page, buildCorrectionListenerScript([]));
    run(page, buildFillScript({ af_1: 'email' }, JSON.stringify({ email: 'a@b.com' }),
      [{ id: 'af_1', widget: 'text' }]));

    page.handlers.change[0]({ target: el });

    expect(page.messages.filter(m => m.type === 'USER_INPUT_DETECTED')).toHaveLength(0);
  });

  test('once the synthetic-fill window elapses, a real correction to the same field is learned', () => {
    const el = inputEl('af_1');
    const page = createPage({ af_1: el });

    run(page, buildCorrectionListenerScript([]));
    run(page, buildDirectFillScript({ af_1: 'Yes' }));

    // The user comes back to the field much later and changes the answer.
    el.__afFilledAt = Date.now() - 60000;
    el.value = 'No';
    page.handlers.change[0]({ target: el });

    const corrections = page.messages.filter(m => m.type === 'USER_INPUT_DETECTED');
    expect(corrections).toHaveLength(1);
    expect(corrections[0].value).toBe('No');
  });

  test('a re-injection teaches the already-installed listener the newer filled ids', () => {
    const el = inputEl('af_9');
    const page = createPage({ af_9: el });

    // Pass 1 installs the listener knowing only the fast pass's ids.
    run(page, buildCorrectionListenerScript(['af_1']));
    // A later pass fills af_9 and re-injects. The DOM listeners are already
    // installed, so before the fix this snapshot was simply discarded.
    run(page, buildCorrectionListenerScript(['af_9']));

    el.value = 'Something';
    page.handlers.blur[0]({ target: el });

    const corrections = page.messages.filter(m => m.type === 'USER_INPUT_DETECTED');
    expect(corrections).toHaveLength(1);
    expect(corrections[0].afId).toBe('af_9');
    expect(corrections[0].wasAutoFilled).toBe(true);
  });

  test('re-injection does not install the listeners twice (no duplicate reports)', () => {
    const el = inputEl('af_1');
    const page = createPage({ af_1: el });

    run(page, buildCorrectionListenerScript([]));
    run(page, buildCorrectionListenerScript(['af_2']));
    run(page, buildCorrectionListenerScript(['af_3']));

    expect(page.handlers.blur).toHaveLength(1);
    expect(page.handlers.change).toHaveLength(1);

    el.value = 'typed by hand';
    page.handlers.blur[0]({ target: el });
    expect(page.messages.filter(m => m.type === 'USER_INPUT_DETECTED')).toHaveLength(1);
  });

  test('a radio the fill script checked is NOT reported', () => {
    // clickCheckable is the group path; it must stamp too, since a checked
    // radio is precisely what the change listener was added to learn.
    const attrs = { 'data-af-id': 'af_opt1' };
    const radio = {
      tagName: 'INPUT',
      type: 'radio',
      checked: false,
      value: 'Yes',
      getAttribute: name => (attrs[name] !== undefined ? attrs[name] : null),
      dispatchEvent() {},
      focus() {},
      closest: () => null,
    };
    const page = createPage({ af_opt1: radio });

    run(page, buildCorrectionListenerScript([]));
    run(page, buildFillScript(
      { af_g: 'authorizedToWork' },
      JSON.stringify({ authorizedToWork: 'Yes' }),
      [{
        id: 'af_g',
        widget: 'radio-group',
        options: [{ afId: 'af_opt1', value: 'Yes', label: 'Yes' }],
      }]
    ));

    radio.checked = true;
    page.handlers.change[0]({ target: radio });

    expect(page.messages.filter(m => m.type === 'USER_INPUT_DETECTED')).toHaveLength(0);
  });
});
