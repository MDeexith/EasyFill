import { buildFillScript, buildDirectFillScript } from '../src/webview/filler';

function fixture({ catalog = true } = {}) {
  let open = false;
  let results = [];
  const selected = new Set();
  const searches = [];
  let committedQuery = '';
  const messages = [];
  const attributes = { 'data-uxi-widget-type': 'selectinput', 'data-uxi-multiselect-id': 'skills' };
  const source = {
    tagName: 'INPUT', value: '', isConnected: true,
    getAttribute: key => attributes[key] || null,
    closest: () => ({ querySelectorAll: () => [...selected].map(textContent => ({ textContent })) }),
    focus() {}, blur() {}, dispatchEvent() {},
    click() { open = true; },
  };
  const input = {
    ...source,
    dispatchEvent(event) {
      if (event.type === 'input') {
        const value = input.value;
        setTimeout(() => { committedQuery = value; }, 50);
      }
      if (event.type !== 'keydown' || event.key !== 'Enter') return;
      const query = committedQuery;
      searches.push(query);
      results = [];
      setTimeout(() => {
        if (query === 'Missing') return;
        const checkbox = { get checked() { return selected.has(query); } };
        const leaf = {
          querySelector: () => checkbox,
          dispatchEvent() {},
          click() { if (checkbox.checked) selected.delete(query); else selected.add(query); },
        };
        const option = {
          id: 'menuItem-REMOTE_SKILL-1-' + query,
          textContent: query, getAttribute: () => null,
          querySelector: () => leaf, scrollIntoView() {},
          // Workday's outer role=option only focuses; the leaf commits.
          click() { throw new Error('Clicked the non-interactive option wrapper'); },
        };
        results = catalog ? [option, { ...option, id: 'menuItem-REMOTE_SKILL-2-' + query }, {
          ...option, id: 'menuItem-' + query,
          querySelector: () => ({ ...leaf, click() { throw new Error('Chose duplicate free-text skill'); } }),
        }] : [{ ...option, id: 'menuItem-' + query }, { ...option, id: 'menuItem-' + query }];
      }, 200);
    },
  };
  const listbox = { querySelectorAll: () => results };
  const prompt = {
    getAttribute: () => 'skills',
    querySelector: selector => selector.includes('input') ? input : listbox,
    querySelectorAll: () => [{ textContent: 'Done', click() { open = false; } }],
  };
  const document = {
    querySelector: () => source,
    querySelectorAll: selector => selector === '[data-associated-widget]' && open ? [prompt] : [],
    getElementsByTagName: () => [],
  };
  source.ownerDocument = document;
  const window = {
    HTMLInputElement: { prototype: {} }, HTMLTextAreaElement: { prototype: {} },
    ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) },
  };
  function run(script) {
    function TestEvent(type, init) { this.type = type; Object.assign(this, init); }
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', script)(
      document, window, TestEvent, TestEvent, TestEvent,
    );
  }
  return { run, source, selected, searches, messages, window, isOpen: () => open };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('searches and commits each Workday skill through its mobile popup', async () => {
  const dom = fixture();
  const script = buildFillScript({ skills: 'skills' }, JSON.stringify({ skills: 'Python, Docker' }), []);
  dom.run(script);
  expect(dom.messages).toEqual([]);
  await jest.runAllTimersAsync();
  expect(dom.searches).toEqual(['Python', 'Docker']);
  expect([...dom.selected]).toEqual(['Python', 'Docker']);
  expect(dom.messages[0].outcomes.skills).toBe('filled');
  expect(dom.isOpen()).toBe(false);
  dom.run(script);
  await jest.runAllTimersAsync();
  expect([...dom.selected]).toEqual(['Python', 'Docker']);
  expect(dom.searches).toEqual(['Python', 'Docker']);
});

test('missing Workday options are reported as failures', async () => {
  const dom = fixture();
  dom.run(buildDirectFillScript({ skills: 'Missing' }));
  await jest.runAllTimersAsync();
  expect(dom.messages[0].outcomes.skills).toBe('control-failed');
  expect(dom.isOpen()).toBe(false);
});

test('duplicate renderings of the same free-text skill are one choice', async () => {
  const dom = fixture({ catalog: false });
  dom.run(buildDirectFillScript({ skills: 'Python' }));
  await jest.runAllTimersAsync();
  expect([...dom.selected]).toEqual(['Python']);
  expect(dom.messages[0].outcomes.skills).toBe('filled');
});

test('a manual edit or navigation prevents Workday selection', async () => {
  const dom = fixture();
  dom.source.__afUserEdited = true;
  dom.run(buildDirectFillScript({ skills: 'Python' }));
  await jest.runAllTimersAsync();
  expect(dom.searches).toEqual([]);
  dom.source.__afUserEdited = false;
  dom.run(buildDirectFillScript({ skills: 'Python' }));
  dom.window.__AF_FILL_EPOCH__ = 1;
  await jest.runAllTimersAsync();
  expect([...dom.selected]).toEqual([]);
});
