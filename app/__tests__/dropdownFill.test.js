import { buildFillScript, buildDirectFillScript, buildComboboxHarvestScript } from '../src/webview/filler';

// Execute the injected code, including timers; these menus close each other.
function fixture({ labels = ['India', 'Canada'], shadow = false, input = false, nested = false, semantic = true, noControls = false } = {}) {
  const messages = [];
  const opened = [];
  const selected = {};
  let active = null;
  const elements = {};
  const menus = {};
  const root = {
    getElementById: id => menus[id] || null,
    querySelectorAll: () => active ? [menus[active + '-menu']] : [],
  };
  for (const id of ['af_1', 'af_2']) {
    const attrs = { role: 'combobox', 'aria-controls': id + '-menu' };
    if (noControls) { delete attrs['aria-controls']; attrs.name = 'location'; }
    const el = {
      tagName: input ? 'INPUT' : 'BUTTON', value: '', isConnected: true,
      getAttribute: key => attrs[key] || null,
      getRootNode: () => root,
      focus() {}, blur() {}, scrollIntoView() {},
      dispatchEvent(event) {
        if (input && !el.readOnly && event.type === 'input') {
          active = id;
          opened.push(id);
        }
        if (event.key === 'Escape') active = null;
      },
      click() { active = id; opened.push(id); },
    };
    elements[id] = el;
    menus[id + '-menu'] = {
      getAttribute: key => key === 'aria-hidden' && active !== id ? 'true' : null,
      querySelectorAll: selector => active !== id || (!semantic && selector.includes('[role=')) ? [] : labels.flatMap(label => {
        const option = {
        textContent: label,
        getAttribute: () => null,
        dispatchEvent() {}, scrollIntoView() {},
        click() { selected[id] = label; el.value = label; active = null; },
        };
        return nested && selector.includes('li') ? [{ ...option }, option] : [option];
      }),
    };
  }
  const document = {
    querySelector: selector => {
      const match = /data-af-id="([^"]+)"/.exec(selector);
      return match ? elements[match[1]] : null;
    },
    querySelectorAll: () => [], getElementsByTagName: () => [],
    getElementById: id => shadow ? null : root.getElementById(id),
  };
  Object.values(elements).forEach(el => { el.ownerDocument = document; });
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
  return { run, messages, opened, selected, elements };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each(['mapped', 'direct'])('%s pass waits for each menu before opening the next', async mode => {
  const dom = fixture();
  dom.run(mode === 'mapped'
    ? buildFillScript({ af_1: 'country', af_2: 'state' }, JSON.stringify({ country: 'India', state: 'Canada' }), [])
    : buildDirectFillScript({ af_1: 'India', af_2: 'Canada' }));
  expect(dom.messages).toEqual([]);
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({ af_1: 'India', af_2: 'Canada' });
  expect(dom.messages[0].outcomes).toEqual({ af_1: 'filled', af_2: 'filled' });
});

test('a missing option reports failure instead of a successful fill', async () => {
  const dom = fixture({ labels: ['Canada'] });
  dom.run(buildDirectFillScript({ af_1: 'India' }));
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({});
  expect(dom.messages[0].outcomes).toEqual({ af_1: 'control-failed' });
});

test('selection finds the associated popup inside a shadow root', async () => {
  const dom = fixture({ shadow: true });
  dom.run(buildDirectFillScript({ af_1: 'India' }));
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({ af_1: 'India' });
});

test('input comboboxes wait for a real option click', async () => {
  const dom = fixture({ input: true });
  dom.run(buildDirectFillScript({ af_1: 'India', af_2: 'Canada' }));
  expect(dom.messages).toEqual([]);
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({ af_1: 'India', af_2: 'Canada' });
});

test('harvesting opens click-driven button menus', async () => {
  const dom = fixture();
  dom.run(buildComboboxHarvestScript(['af_1']));
  await jest.runAllTimersAsync();
  expect(dom.messages[0].options.af_1).toEqual([
    { value: 'India', label: 'India' }, { value: 'Canada', label: 'Canada' },
  ]);
});

test('navigation cancels a pending menu selection and the rest of the batch', async () => {
  const dom = fixture();
  dom.run(buildDirectFillScript({ af_1: 'India', af_2: 'Canada' }));
  dom.run('window.__AF_FILL_EPOCH__ = 1;');
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({});
});

test('does not overwrite a field edited by the user during an AI request', async () => {
  const dom = fixture({ input: true });
  dom.elements.af_1.__afUserEdited = true;
  dom.elements.af_1.value = 'My choice';
  dom.run(buildDirectFillScript({ af_1: 'India' }));
  await jest.runAllTimersAsync();
  expect(dom.elements.af_1.value).toBe('My choice');
  expect(dom.selected).toEqual({});
});

test('waits for filtered options to replace stale suggestions', async () => {
  const labels = ['Canada'];
  const dom = fixture({ input: true, labels });
  dom.run(buildDirectFillScript({ af_1: 'India' }));
  setTimeout(() => labels.splice(0, 1, 'India'), 200);
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({ af_1: 'India' });
  expect(dom.messages[0].outcomes.af_1).toBe('filled');
});


test('selection-only readonly comboboxes can still open and select', async () => {
  const dom = fixture({ input: true });
  dom.elements.af_1.readOnly = true;
  dom.run(buildDirectFillScript({ af_1: 'India' }));
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({ af_1: 'India' });
});

test('an option nested in a list item is one choice, not an ambiguous tie', async () => {
  const dom = fixture({ nested: true });
  dom.run(buildDirectFillScript({ af_1: 'India' }));
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({ af_1: 'India' });
});


test('a readonly location picker without aria-controls opens instead of typing', async () => {
  const dom = fixture({ input: true, noControls: true });
  dom.elements.af_1.readOnly = true;
  dom.run(buildDirectFillScript({ af_1: 'India' }));
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({ af_1: 'India' });
});

test('a link nested in a plain list item is one option', async () => {
  const dom = fixture({ nested: true, semantic: false });
  dom.run(buildDirectFillScript({ af_1: 'India' }));
  await jest.runAllTimersAsync();
  expect(dom.selected).toEqual({ af_1: 'India' });
});
