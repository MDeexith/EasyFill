import { buildComboboxHarvestScript, buildFillScript, buildDirectFillScript, buildCorrectionListenerScript } from '../src/webview/filler';

describe('buildComboboxHarvestScript', () => {
  test('embeds the requested field ids', () => {
    const script = buildComboboxHarvestScript(['af_3', 'af_7']);
    expect(script).toContain('af_3');
    expect(script).toContain('af_7');
  });

  test('posts the COMBOBOX_OPTIONS message type', () => {
    expect(buildComboboxHarvestScript(['af_1'])).toContain('COMBOBOX_OPTIONS');
  });

  test('uses only ES5 syntax, since the WebView runs it verbatim', () => {
    const script = buildComboboxHarvestScript(['af_1']);
    expect(script).not.toMatch(/=>/);
    expect(script).not.toMatch(/\bconst\b/);
    expect(script).not.toMatch(/\blet\b/);
  });

  test('generates valid JavaScript even with injection attempts', () => {
    // Test that script parses as valid JavaScript
    const script = buildComboboxHarvestScript(['af_1"; alert(1); //']);
    // eslint-disable-next-line no-new-func
    expect(() => new Function(script)).not.toThrow();

    // Verify the malicious id is present but safely escaped (in JSON form)
    expect(script).toContain('af_1');
    expect(script).toContain('alert');

    // Verify ids round-trip correctly through JSON
    const normalScript = buildComboboxHarvestScript(['test_id']);
    // eslint-disable-next-line no-new-func
    expect(() => new Function(normalScript)).not.toThrow();
    expect(normalScript).toContain('test_id');
  });

  test('returns an inert script for an empty list', () => {
    const script = buildComboboxHarvestScript([]);
    expect(typeof script).toBe('string');
    expect(script).toContain('COMBOBOX_OPTIONS');
  });
});

// Regression coverage for all script builders with edge-case values
describe('Script builder parsing regression coverage', () => {
  const edgeCaseIds = [
    'af_1',                          // normal
    "af_o'brien",                    // apostrophe
    'af_2"; alert(1); //',          // double quote attempt
    'af_3\\backslash',              // backslash
    'af_4\nwith\nnewlines',         // newlines
  ];

  test('buildComboboxHarvestScript parses with edge cases', () => {
    edgeCaseIds.forEach(id => {
      const script = buildComboboxHarvestScript([id]);
      // eslint-disable-next-line no-new-func
      expect(() => new Function(script)).not.toThrow();
    });
  });

  test('buildDirectFillScript parses with edge cases', () => {
    const values = {};
    edgeCaseIds.forEach((id, i) => {
      values[id] = `value_${i}`;
    });
    const script = buildDirectFillScript(values);
    // eslint-disable-next-line no-new-func
    expect(() => new Function(script)).not.toThrow();
  });

  test('buildFillScript parses with edge cases', () => {
    const profile = {
      firstName: "O'Brien",
      lastName: 'Smith"Quote',
      bio: 'Line1\nLine2',
    };
    const profileJson = JSON.stringify(profile);
    const mapping = {};
    edgeCaseIds.forEach((id, i) => {
      mapping[id] = Object.keys(profile)[i % Object.keys(profile).length];
    });
    const script = buildFillScript(mapping, profileJson, []);
    // eslint-disable-next-line no-new-func
    expect(() => new Function(script)).not.toThrow();
  });

  test('buildCorrectionListenerScript parses with edge cases', () => {
    const script = buildCorrectionListenerScript(edgeCaseIds);
    // eslint-disable-next-line no-new-func
    expect(() => new Function(script)).not.toThrow();
  });
});

// ── Behavioural coverage ─────────────────────────────────────────────────────
//
// The harvest is the riskiest artefact on the branch (it mutates a live third
// party application form by opening its menus) and previously had only
// substring/parse assertions. These execute the generated script against a
// hand-rolled fake DOM, the same technique as __tests__/correctionListener.test.js
// and __tests__/fillOutcomes.test.js. jsdom is not available.

function createHarvestDOM({ elements = {}, listboxes = [], byId = {} } = {}) {
  const messages = [];
  const opened = [];

  function makeRoot(self) {
    return {
      querySelector(selector) {
        const m = /\[data-af-id="([^"]+)"\]/.exec(selector || '');
        if (m && elements[m[1]]) return elements[m[1]];
        return null;
      },
      // Faithful enough for the one selector the harvest uses: honour the
      // `:not([aria-hidden="true"])` guard so dropping it from the source
      // actually changes what this fake returns.
      querySelectorAll(selector) {
        if (selector === '*') return [];
        if (/role="(?:listbox|menu)"/.test(selector)) {
          const excludesHidden = /:not\(\[aria-hidden="true"\]\)/.test(selector);
          return self().listboxes.filter(
            lb => !(excludesHidden && lb.getAttribute('aria-hidden') === 'true')
          );
        }
        return [];
      },
      getElementsByTagName() {
        return [];
      },
      getElementById(id) {
        return byId[id] || null;
      },
    };
  }

  const state = { listboxes };
  const fakeDocument = makeRoot(() => state);

  const fakeWindow = {
    HTMLInputElement: { prototype: {} },
    HTMLTextAreaElement: { prototype: {} },
    ReactNativeWebView: {
      postMessage(msg) {
        messages.push(JSON.parse(msg));
      },
    },
  };

  return { fakeDocument, fakeWindow, messages, state, opened };
}

// A popup menu. `optionLabels` become its [role="option"] children.
function fakeListbox(optionLabels, attrs = {}) {
  const nodes = optionLabels.map(label => ({
    innerText: label,
    textContent: label,
    getAttribute(name) {
      return name === 'data-value' ? null : null;
    },
  }));
  return {
    __label: attrs.__label,
    getAttribute(name) {
      return attrs[name] !== undefined ? attrs[name] : null;
    },
    querySelectorAll(selector) {
      return /role="option"/.test(selector) ? nodes : [];
    },
  };
}

// A combobox trigger. Records that it was opened so tests can assert the
// harvest actually drove the widget.
function fakeCombobox(afId, attrs = {}, opened = []) {
  const el = {
    tagName: 'DIV',
    getAttribute(name) {
      if (name === 'data-af-id') return afId;
      return attrs[name] !== undefined ? attrs[name] : null;
    },
    getRootNode() {
      return null;
    },
    ownerDocument: null,
    focus() {
      opened.push(afId);
    },
    blur() {},
    dispatchEvent() {},
  };
  return el;
}

function runHarvest(script, dom) {
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', script)(dom.fakeDocument, dom.fakeWindow);
  // Drain the harvest's polling / inter-field setTimeouts.
  jest.runAllTimers();
}

describe('buildComboboxHarvestScript - runtime behavior', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('an empty id list posts an empty options map immediately', () => {
    const dom = createHarvestDOM();
    runHarvest(buildComboboxHarvestScript([]), dom);

    expect(dom.messages).toHaveLength(1);
    expect(dom.messages[0].type).toBe('COMBOBOX_OPTIONS');
    expect(dom.messages[0].options).toEqual({});
  });

  test('a native <select> is read directly, without opening anything', () => {
    const select = {
      tagName: 'SELECT',
      options: [
        { value: 'us', text: 'United States' },
        { value: 'in', text: ' India ' },
      ],
      getAttribute: () => null,
      focus() { throw new Error('a native select must not be opened'); },
    };
    const dom = createHarvestDOM({ elements: { af_1: select } });
    runHarvest(buildComboboxHarvestScript(['af_1']), dom);

    expect(dom.messages[0].options).toEqual({
      af_1: [
        { value: 'us', label: 'United States' },
        { value: 'in', label: 'India' },
      ],
    });
  });

  test('a combobox is opened and the options its listbox renders are reported', () => {
    const dom = createHarvestDOM();
    const el = fakeCombobox('af_1', {}, dom.opened);
    dom.fakeDocument.querySelector = sel =>
      /af_1/.test(sel) ? el : null;
    dom.state.listboxes = [fakeListbox(['Yes', 'No'])];

    runHarvest(buildComboboxHarvestScript(['af_1']), dom);

    expect(dom.opened).toEqual(['af_1']);
    expect(dom.messages[0].options).toEqual({
      af_1: [
        { value: 'Yes', label: 'Yes' },
        { value: 'No', label: 'No' },
      ],
    });
  });

  test('a field whose element is not in the DOM is skipped, not reported', () => {
    const dom = createHarvestDOM();
    dom.state.listboxes = [fakeListbox(['Yes', 'No'])];
    runHarvest(buildComboboxHarvestScript(['af_missing']), dom);

    expect(dom.messages[0].options).toEqual({});
  });

  test('a combobox that never renders a menu reports nothing for that field', () => {
    const dom = createHarvestDOM();
    const el = fakeCombobox('af_1', {}, dom.opened);
    dom.fakeDocument.querySelector = sel => (/af_1/.test(sel) ? el : null);
    dom.state.listboxes = [];

    runHarvest(buildComboboxHarvestScript(['af_1']), dom);

    expect(dom.opened).toEqual(['af_1']);
    expect(dom.messages[0].options).toEqual({});
  });

  test('an aria-hidden listbox is not read (the :not() guard)', () => {
    const dom = createHarvestDOM();
    const el = fakeCombobox('af_1', {}, dom.opened);
    dom.fakeDocument.querySelector = sel => (/af_1/.test(sel) ? el : null);
    // The only menu in the DOM is one the page has hidden — a closed menu
    // React-Select keeps mounted. Reading it would report options for a
    // dropdown that never actually opened.
    dom.state.listboxes = [fakeListbox(['Stale A', 'Stale B'], { 'aria-hidden': 'true' })];

    runHarvest(buildComboboxHarvestScript(['af_1']), dom);

    expect(dom.opened).toEqual(['af_1']);
    expect(dom.messages[0].options).toEqual({});
  });

  test('a hidden menu is skipped in favour of the visible one', () => {
    const dom = createHarvestDOM();
    const el = fakeCombobox('af_1', {}, dom.opened);
    dom.fakeDocument.querySelector = sel => (/af_1/.test(sel) ? el : null);
    dom.state.listboxes = [
      fakeListbox(['Stale'], { 'aria-hidden': 'true' }),
      fakeListbox(['Live A', 'Live B']),
    ];

    runHarvest(buildComboboxHarvestScript(['af_1']), dom);

    expect(dom.messages[0].options.af_1).toEqual([
      { value: 'Live A', label: 'Live A' },
      { value: 'Live B', label: 'Live B' },
    ]);
  });

  // ── I3 ──────────────────────────────────────────────────────────────────
  test('a stale listbox left over from the previous field is NOT re-reported as the next field\'s options', () => {
    const dom = createHarvestDOM();
    const el1 = fakeCombobox('af_1', {}, dom.opened);
    const el2 = fakeCombobox('af_2', {}, dom.opened);
    dom.fakeDocument.querySelector = sel => {
      if (/af_1/.test(sel)) return el1;
      if (/af_2/.test(sel)) return el2;
      return null;
    };
    // ONE listbox in the DOM for the whole run: field 1's menu, which
    // closeAny() failed to unmount before field 2 was read.
    const stale = fakeListbox(['United States', 'India'], { __label: 'country-menu' });
    dom.state.listboxes = [stale];

    runHarvest(buildComboboxHarvestScript(['af_1', 'af_2']), dom);

    const options = dom.messages[0].options;
    expect(options.af_1).toEqual([
      { value: 'United States', label: 'United States' },
      { value: 'India', label: 'India' },
    ]);
    // Before the fix both ids came back with identical options, which then fed
    // the wrong options into resolution and could select an arbitrary answer.
    expect(options.af_2).toBeUndefined();
    expect(options.af_1).not.toEqual(options.af_2);
  });

  test('two fields with genuinely distinct menus each get their own options', () => {
    const dom = createHarvestDOM();
    const el1 = fakeCombobox('af_1', {}, dom.opened);
    const el2 = fakeCombobox('af_2', {}, dom.opened);
    dom.fakeDocument.querySelector = sel => {
      if (/af_1/.test(sel)) return el1;
      if (/af_2/.test(sel)) return el2;
      return null;
    };
    const first = fakeListbox(['United States', 'India']);
    const second = fakeListbox(['Yes', 'No']);
    dom.state.listboxes = [first];

    // eslint-disable-next-line no-new-func
    new Function('document', 'window', buildComboboxHarvestScript(['af_1', 'af_2']))(
      dom.fakeDocument, dom.fakeWindow
    );
    // Field 1 harvests `first`; then the page swaps in field 2's own menu.
    jest.advanceTimersByTime(200);
    dom.state.listboxes = [second];
    jest.runAllTimers();

    expect(dom.messages[0].options).toEqual({
      af_1: [
        { value: 'United States', label: 'United States' },
        { value: 'India', label: 'India' },
      ],
      af_2: [
        { value: 'Yes', label: 'Yes' },
        { value: 'No', label: 'No' },
      ],
    });
  });

  test('aria-controls association wins over an unassociated menu in the DOM', () => {
    const dom = createHarvestDOM();
    const owned = fakeListbox(['Owned A', 'Owned B']);
    const unrelated = fakeListbox(['Wrong 1', 'Wrong 2']);
    const el = fakeCombobox('af_1', { 'aria-controls': 'lb-1' }, dom.opened);
    dom.fakeDocument.querySelector = sel => (/af_1/.test(sel) ? el : null);
    dom.fakeDocument.getElementById = id => (id === 'lb-1' ? owned : null);
    // An unrelated menu sits earlier in document order — association must win.
    dom.state.listboxes = [unrelated];

    runHarvest(buildComboboxHarvestScript(['af_1']), dom);

    expect(dom.messages[0].options.af_1).toEqual([
      { value: 'Owned A', label: 'Owned A' },
      { value: 'Owned B', label: 'Owned B' },
    ]);
  });

  test('an aria-controls target marked aria-hidden falls through to the generic search', () => {
    const dom = createHarvestDOM();
    const hidden = fakeListbox(['Stale'], { 'aria-hidden': 'true' });
    const visible = fakeListbox(['Live A', 'Live B']);
    const el = fakeCombobox('af_1', { 'aria-controls': 'lb-1' }, dom.opened);
    dom.fakeDocument.querySelector = sel => (/af_1/.test(sel) ? el : null);
    dom.fakeDocument.getElementById = id => (id === 'lb-1' ? hidden : null);
    dom.state.listboxes = [visible];

    runHarvest(buildComboboxHarvestScript(['af_1']), dom);

    expect(dom.messages[0].options.af_1).toEqual([
      { value: 'Live A', label: 'Live A' },
      { value: 'Live B', label: 'Live B' },
    ]);
  });

  test('a menu that appears only after several polls is still harvested', () => {
    // The old code took a single 300ms shot; React-Select routinely needs
    // longer, and a miss silently dropped the field.
    const dom = createHarvestDOM();
    const el = fakeCombobox('af_1', {}, dom.opened);
    dom.fakeDocument.querySelector = sel => (/af_1/.test(sel) ? el : null);
    dom.state.listboxes = [];

    // eslint-disable-next-line no-new-func
    new Function('document', 'window', buildComboboxHarvestScript(['af_1']))(
      dom.fakeDocument, dom.fakeWindow
    );
    jest.advanceTimersByTime(400);
    expect(dom.messages).toHaveLength(0);
    dom.state.listboxes = [fakeListbox(['Late A'])];
    jest.runAllTimers();

    expect(dom.messages[0].options.af_1).toEqual([{ value: 'Late A', label: 'Late A' }]);
  });

  // ── I6 ──────────────────────────────────────────────────────────────────
  test('shadow-DOM and iframe fields are reachable: the harvest reuses FILLER_RUNTIME\'s findEl', () => {
    const script = buildComboboxHarvestScript(['af_1']);
    // The traversing findEl (shadow roots + same-origin iframes) must be the
    // one in scope; the harvest must not define a weaker local copy.
    expect(script).toContain('all[i].shadowRoot');
    expect(script).toContain("getElementsByTagName('iframe')");
    expect(script.match(/function findEl\(/g)).toHaveLength(1);
  });

  test('a combobox inside a shadow root is found and harvested', () => {
    const dom = createHarvestDOM();
    const el = fakeCombobox('af_1', {}, dom.opened);
    const shadowRoot = {
      querySelector(sel) {
        return /af_1/.test(sel) ? el : null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const hostEl = { shadowRoot };
    // Top document knows nothing about af_1; only the shadow root does.
    dom.fakeDocument.querySelector = () => null;
    const rootQsa = dom.fakeDocument.querySelectorAll;
    dom.fakeDocument.querySelectorAll = selector =>
      selector === '*' ? [hostEl] : rootQsa(selector);
    dom.state.listboxes = [fakeListbox(['Shadow A'])];

    runHarvest(buildComboboxHarvestScript(['af_1']), dom);

    expect(dom.opened).toEqual(['af_1']);
    expect(dom.messages[0].options.af_1).toEqual([{ value: 'Shadow A', label: 'Shadow A' }]);
  });

  // ── I4 ──────────────────────────────────────────────────────────────────
  test('a second harvest injected while one is running is a no-op in the page', () => {
    const dom = createHarvestDOM();
    const el = fakeCombobox('af_1', {}, dom.opened);
    dom.fakeDocument.querySelector = sel => (/af_1/.test(sel) ? el : null);
    dom.state.listboxes = [fakeListbox(['A'])];

    // eslint-disable-next-line no-new-func
    new Function('document', 'window', buildComboboxHarvestScript(['af_1'], 1))(
      dom.fakeDocument, dom.fakeWindow
    );
    // Run 2 arrives mid-flight and must not start a second step() loop.
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', buildComboboxHarvestScript(['af_1'], 2))(
      dom.fakeDocument, dom.fakeWindow
    );
    jest.runAllTimers();

    expect(dom.opened).toEqual(['af_1']);   // opened once, not twice
    expect(dom.messages).toHaveLength(1);
    expect(dom.messages[0].generation).toBe(1);
  });

  test('the harvest tags its reply with the generation it was built for', () => {
    const dom = createHarvestDOM();
    runHarvest(buildComboboxHarvestScript([], 7), dom);
    expect(dom.messages[0].generation).toBe(7);
  });

  test('a completed harvest releases the in-page guard for the next run', () => {
    const dom = createHarvestDOM();
    runHarvest(buildComboboxHarvestScript([], 1), dom);
    runHarvest(buildComboboxHarvestScript([], 2), dom);
    expect(dom.messages.map(m => m.generation)).toEqual([1, 2]);
  });
});
