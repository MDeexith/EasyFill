import { buildFillScript, buildDirectFillScript, mergeFillOutcomes } from '../src/webview/filler';

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

// Hand-rolled fake DOM (same approach as __tests__/correctionListener.test.js),
// shared by the buildFillScript and buildDirectFillScript behavioural suites
// below so both execute the actual generated scripts and assert on the real
// outcomes map produced, not just on script text.
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

describe('buildFillScript outcome reporting - runtime behavior', () => {
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

// buildDirectFillScript is what the dropdown-resolution pass (and the AI
// draft-fill and saved-corrections passes) inject after the fast/AI passes
// already ran buildFillScript once. Its outcomes must be just as real, since
// this is precisely the pass that turns an earlier 'control-failed' verdict
// on a dropdown into an actual fill.
describe('buildDirectFillScript outcome reporting - runtime behavior', () => {
  test('a field whose element exists and accepts the value is reported as filled', () => {
    const { fakeDocument, fakeWindow, messages } = createFakeDOM({
      af_1: fakeElement({ tagName: 'INPUT', value: '' }),
    });

    const script = buildDirectFillScript({ af_1: 'United States' });
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('AI_FILL_COMPLETE');
    expect(messages[0].filled).toBe(1);
    expect(messages[0].outcomes).toEqual({ af_1: 'filled' });
  });

  test('a field whose element is absent from the DOM is reported as control-failed', () => {
    const { fakeDocument, fakeWindow, messages } = createFakeDOM({});

    const script = buildDirectFillScript({ af_1: 'United States' });
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    expect(messages).toHaveLength(1);
    expect(messages[0].filled).toBe(0);
    expect(messages[0].outcomes).toEqual({ af_1: 'control-failed' });
  });

  test('existing filled count and message type are preserved unchanged', () => {
    // Guards against the "only ADD outcomes" requirement regressing: nothing
    // that already consumes AI_FILL_COMPLETE (e.g. the drafting-phase
    // fallback in BrowserScreen) should see its shape change.
    const { fakeDocument, fakeWindow, messages } = createFakeDOM({
      af_1: fakeElement({ tagName: 'INPUT', value: '' }),
      af_2: fakeElement({ tagName: 'INPUT', value: '' }),
    });

    const script = buildDirectFillScript({ af_1: 'a', af_2: 'b' });
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', script)(fakeDocument, fakeWindow);

    expect(Object.keys(messages[0]).sort()).toEqual(['filled', 'outcomes', 'type']);
    expect(messages[0].type).toBe('AI_FILL_COMPLETE');
    expect(messages[0].filled).toBe(2);
  });
});

// mergeFillOutcomes is the pure helper BrowserScreen uses to fold each
// FILL_COMPLETE / AI_FILL_COMPLETE message into cumulative state. Tested
// directly (not through the component) because the property that matters —
// a later pass's verdict overwrites an earlier one for the same af-id — is
// a pure-data guarantee, independent of React or the WebView bridge.
describe('mergeFillOutcomes', () => {
  test('a later "filled" verdict overwrites an earlier "control-failed" for the same field', () => {
    const afterFastPass = { af_1: 'control-failed' };
    const afterDropdownPass = { af_1: 'filled' };

    expect(mergeFillOutcomes(afterFastPass, afterDropdownPass)).toEqual({ af_1: 'filled' });
  });

  test('fields absent from the incoming map keep their prior verdict', () => {
    const prev = { af_1: 'filled', af_2: 'no-value' };
    const incoming = { af_3: 'control-failed' };

    expect(mergeFillOutcomes(prev, incoming)).toEqual({
      af_1: 'filled',
      af_2: 'no-value',
      af_3: 'control-failed',
    });
  });

  test('tolerates a missing or undefined incoming outcomes map', () => {
    const prev = { af_1: 'filled' };

    expect(mergeFillOutcomes(prev, undefined)).toEqual({ af_1: 'filled' });
    expect(mergeFillOutcomes(undefined, { af_2: 'filled' })).toEqual({ af_2: 'filled' });
  });
});
