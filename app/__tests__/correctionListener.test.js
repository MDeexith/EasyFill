import { buildCorrectionListenerScript } from '../src/webview/filler';

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
