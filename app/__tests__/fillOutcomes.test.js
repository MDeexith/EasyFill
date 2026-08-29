import { buildFillScript } from '../src/webview/filler';

describe('buildFillScript outcome reporting', () => {
  const fields = [{ id: 'af_1', name: 'email', widget: 'text' }];

  test('reports an outcomes map alongside the count', () => {
    const script = buildFillScript({ af_1: 'email' }, '{}', fields, {});
    expect(script).toContain('outcomes');
    expect(script).toContain('FILL_COMPLETE');
  });

  test('names each outcome state', () => {
    const script = buildFillScript({ af_1: 'email' }, '{}', fields, {});
    expect(script).toContain("'no-value'");
    expect(script).toContain("'control-failed'");
    expect(script).toContain("'filled'");
  });
});

// Behavioural coverage: execute the generated script against a hand-rolled
// fake DOM (same approach as __tests__/correctionListener.test.js) and
// assert the *actual* outcomes map the runtime produces, not just that the
// script text mentions the right strings.
describe('buildFillScript outcome reporting - runtime behavior', () => {
  function createFakeDOM(elementsByAfId = {}) {
    const messages = [];
    const fakeDocument = {
      querySelector(selector) {
        const m = /\[data-af-id="([^"]+)"\]/.exec(selector || '');
        if (m && elementsByAfId[m[1]]) return elementsByAfId[m[1]];
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getElementsByTagName() {
        return [];
      },
    };
    const fakeWindow = {
      // nativeSetter() reads these off `window`; a bare prototype object
      // with no `value` descriptor makes it fall back to plain assignment.
      HTMLInputElement: { prototype: {} },
      HTMLTextAreaElement: { prototype: {} },
      ReactNativeWebView: {
        postMessage(msg) {
          messages.push(JSON.parse(msg));
        },
      },
    };
    return { fakeDocument, fakeWindow, messages };
  }

  function fakeElement(attrs = {}) {
    return {
      getAttribute(name) {
        return attrs[name] !== undefined ? attrs[name] : null;
      },
      dispatchEvent() {},
      focus() {},
      ...attrs,
    };
  }

  function run(mapping, profile, fields, optionSelections = {}) {
    const script = buildFillScript(mapping, JSON.stringify(profile), fields, optionSelections);
    return script;
  }

  test('a plain text field that fills successfully is reported as filled', () => {
    const textFields = [{ id: 'af_1', name: 'email', widget: 'text' }];
    const { fakeDocument, fakeWindow, messages } = createFakeDOM({
      af_1: fakeElement({ tagName: 'INPUT', value: '' }),
    });

    const script = run({ af_1: 'email' }, { email: 'a@b.com' }, textFields);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('FILL_COMPLETE');
    expect(messages[0].filled).toBe(1);
    expect(messages[0].outcomes).toEqual({ af_1: 'filled' });
  });

  test('an empty profile value is reported as no-value, without touching the DOM', () => {
    const textFields = [{ id: 'af_1', name: 'email', widget: 'text' }];
    // No af_1 registered in the DOM at all: if the runtime tried to look it
    // up this would surface as control-failed instead, proving the
    // no-value check short-circuits before findEl runs.
    const { fakeDocument, fakeWindow, messages } = createFakeDOM({});

    const script = run({ af_1: 'email' }, { email: '' }, textFields);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    expect(messages[0].filled).toBe(0);
    expect(messages[0].outcomes).toEqual({ af_1: 'no-value' });
  });

  test('a mapped field with no matching element is reported as control-failed', () => {
    const textFields = [{ id: 'af_1', name: 'email', widget: 'text' }];
    // Profile has a value, but the DOM has no element for af_1 (e.g. it
    // scrolled out / was removed after the scan ran).
    const { fakeDocument, fakeWindow, messages } = createFakeDOM({});

    const script = run({ af_1: 'email' }, { email: 'a@b.com' }, textFields);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    expect(messages[0].filled).toBe(0);
    expect(messages[0].outcomes).toEqual({ af_1: 'control-failed' });
  });

  test('a radio-group with no options is reported as control-failed', () => {
    const groupFields = [
      { id: 'af_2', name: 'workAuth', widget: 'radio-group', options: [] },
    ];
    const { fakeDocument, fakeWindow, messages } = createFakeDOM({});

    const script = run({ af_2: 'workAuth' }, { workAuth: 'yes' }, groupFields);
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    expect(messages[0].filled).toBe(0);
    expect(messages[0].outcomes).toEqual({ af_2: 'control-failed' });
  });

  test('outcomes accumulate independently per field across a mixed batch', () => {
    const mixedFields = [
      { id: 'af_1', name: 'email', widget: 'text' },
      { id: 'af_2', name: 'phone', widget: 'text' },
      { id: 'af_3', name: 'firstName', widget: 'text' },
    ];
    const { fakeDocument, fakeWindow, messages } = createFakeDOM({
      af_1: fakeElement({ tagName: 'INPUT', value: '' }),
      // af_2 deliberately missing from the DOM.
    });

    const script = run(
      { af_1: 'email', af_2: 'phone', af_3: 'firstName' },
      { email: 'a@b.com', phone: '555-1234', firstName: '' },
      mixedFields
    );
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    expect(messages[0].filled).toBe(1);
    expect(messages[0].outcomes).toEqual({
      af_1: 'filled',
      af_2: 'control-failed',
      af_3: 'no-value',
    });
  });
});
