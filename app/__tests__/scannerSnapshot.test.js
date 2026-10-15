import { FORM_SCANNER_JS } from '../src/webview/formScanner';

function fixture() {
  const messages = [];
  const observers = [];
  const state = { elements: [], iframes: [] };
  const document = {
    readyState: 'complete', addEventListener() {}, removeEventListener() {},
    querySelectorAll: selector => selector === '*' ? [] : state.elements.filter(el =>
      el.tagName === 'INPUT' || (el.getAttribute('role') === 'listbox' && selector.includes('[role="listbox"]'))),
    querySelector: () => null, getElementById: () => null,
    getElementsByTagName: tag => tag === 'iframe' ? state.iframes : [],
  };
  const window = { ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) } };
  function element(attrs = {}, tag = 'INPUT') {
    const el = {
      tagName: tag, nodeType: 1, id: '', visible: true,
      getAttribute: key => attrs[key] ?? null,
      setAttribute: (key, value) => { attrs[key] = value; },
      getClientRects: () => el.visible ? [{}] : [],
      ownerDocument: document,
    };
    return el;
  }
  function install() {
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', 'MutationObserver', FORM_SCANNER_JS)(document, window,
      function(callback) { observers.push(callback); this.observe = () => {}; this.disconnect = () => {}; });
  }
  function update() {
    observers[0]([{ type: 'attributes', target: { matches: () => true }, attributeName: 'aria-label' }]);
    jest.advanceTimersByTime(350);
  }
  return { state, messages, window, element, install, update };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('reports label hydration and visibility changes for existing field ids', () => {
  const dom = fixture();
  const attrs = { name: 'country', 'aria-label': '' };
  const el = dom.element(attrs);
  el.visible = false;
  dom.state.elements = [el];
  dom.install();
  attrs['aria-label'] = 'Country';
  el.visible = true;
  dom.update();
  const scans = dom.messages.filter(msg => msg.fields);
  expect(scans).toHaveLength(2);
  expect(scans[1].fields[0]).toMatchObject({ ariaLabel: 'Country', visible: true });
});

test('an empty stage is reported so removed fields do not remain active', () => {
  const dom = fixture();
  dom.state.elements = [dom.element({ name: 'email' })];
  dom.install();
  dom.state.elements = [];
  dom.update();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields).toEqual([]);
});

test('reinjection never reuses an id already assigned to a surviving field', () => {
  const dom = fixture();
  dom.state.elements = [dom.element({ name: 'email' })];
  dom.install();
  dom.window.__AF_SCANNER_INSTALLED__ = false;
  dom.state.elements.push(dom.element({ name: 'country' }));
  dom.install();
  const fields = dom.messages.filter(msg => msg.fields).at(-1).fields;
  expect(fields).toHaveLength(2);
  expect(new Set(fields.map(f => f.id)).size).toBe(2);
});

test('a popup listbox is not described as another form field', () => {
  const dom = fixture();
  dom.state.elements = [dom.element({ role: 'listbox', 'aria-label': 'Country' }, 'DIV')];
  dom.install();
  const scans = dom.messages.filter(msg => msg.fields);
  expect(scans.flatMap(msg => msg.fields)).toEqual([]);
});


test('detects a cross-origin Workday application iframe', () => {
  const dom = fixture();
  dom.state.iframes = [{ src: 'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/123' }];
  dom.install();
  expect(dom.messages).toContainEqual({
    type: 'ATS_IFRAME_DETECTED', src: dom.state.iframes[0].src,
  });
});
