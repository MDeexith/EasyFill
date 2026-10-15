import { FORM_SCANNER_JS } from '../src/webview/formScanner';

function fixture() {
  const messages = [];
  const observers = [];
  const state = { elements: [], iframes: [] };
  const document = {
    readyState: 'complete', addEventListener() {}, removeEventListener() {},
    querySelectorAll: selector => selector === '*' ? [] : state.elements.filter(el =>
      el.tagName === 'INPUT' || (el.tagName === 'BUTTON' && selector.includes('button[aria-haspopup')) ||
      (['listbox', 'checkbox', 'radio'].includes(el.getAttribute('role')) && selector.includes('[role="' + el.getAttribute('role') + '"]'))),
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

test('Workday header menus are excluded while application dropdowns remain', () => {
  const dom = fixture();
  const language = dom.element({ 'aria-haspopup': 'listbox', 'aria-label': 'English' }, 'BUTTON');
  const menu = dom.element({ 'aria-haspopup': 'true', 'aria-label': 'main menu' }, 'BUTTON');
  for (const el of [language, menu]) {
    el.closest = selector => selector.includes('[data-automation-id="header"]') ? {} : null;
  }
  const country = dom.element({ 'aria-haspopup': 'listbox', 'aria-label': 'Country' }, 'BUTTON');
  dom.state.elements = [language, menu, country];
  dom.install();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields.map(f => f.ariaLabel)).toEqual(['Country']);
});

test.each(['Resume/CV', 'Cover letter'])('identifies a hidden upload by its own %s group', section => {
  const dom = fixture();
  const upload = dom.element({ type: 'file' });
  upload.visible = false;
  const group = dom.element({ 'aria-labelledby': 'upload-section' }, 'DIV');
  group.ownerDocument.getElementById = () => ({ innerText: section });
  upload.closest = selector => selector.includes('[role="group"]') ? group : null;
  dom.state.elements = [upload];
  dom.install();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0]).toMatchObject({
    widget: 'file', label: section, visible: false,
  });
});

test('Workday select inputs are dropdowns and their dialog search boxes are not extra questions', () => {
  const dom = fixture();
  const trigger = dom.element({ 'data-uxi-widget-type': 'selectinput' });
  const search = dom.element({ 'data-uxi-widget-type': 'selectinput' });
  search.closest = selector => selector.includes('responsiveMonikerPrompt') ? {} : null;
  dom.state.elements = [trigger, search];
  dom.install();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields).toHaveLength(1);
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0].widget).toBe('combobox-input');
});

test.each([1, 2, 'popup'])('uses a legend only for a single visible dropdown (%s controls)', count => {
  const dom = fixture();
  const dropdown = dom.element({ 'aria-haspopup': 'listbox', 'aria-label': 'Select One Required' }, 'BUTTON');
  const twin = dom.element({});
  twin.visible = false;
  const other = dom.element({});
  if (count === 'popup') other.closest = selector => selector.includes('[role="listbox"]') ? {} : null;
  const fieldset = {
    tagName: 'FIELDSET', childNodes: [], getAttribute: () => null,
    querySelector: () => ({ innerText: 'Are you authorized to work in this country?' }),
    querySelectorAll: selector => selector === 'label' ? [] : count === 1 ? [dropdown, twin] : [dropdown, other],
  };
  dropdown.parentElement = fieldset;
  dropdown.closest = selector => selector === 'fieldset' ? fieldset : null;
  dom.state.elements = [dropdown];
  dom.install();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0].label).toBe(
    count !== 2 ? 'Are you authorized to work in this country?' : '',
  );
});


test('detects a cross-origin Workday application iframe', () => {
  const dom = fixture();
  dom.state.iframes = [{ src: 'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/123' }];
  dom.install();
  expect(dom.messages).toContainEqual({
    type: 'ATS_IFRAME_DETECTED', src: dom.state.iframes[0].src,
  });
});

test('keeps full declaration text and distinguishes placeholders from selected answers', () => {
  const dom = fixture();
  const dropdown = dom.element({ 'aria-haspopup': 'listbox' }, 'BUTTON');
  dropdown.textContent = 'Select One';
  const question = 'Please review: ' + 'long declaration '.repeat(30);
  const fieldset = {
    tagName: 'FIELDSET', childNodes: [], getAttribute: () => null,
    querySelector: () => ({ innerText: question }),
    querySelectorAll: selector => selector === 'label' ? [] : [dropdown],
  };
  dropdown.parentElement = fieldset;
  dropdown.closest = selector => selector === 'fieldset' ? fieldset : null;
  dom.state.elements = [dropdown];
  dom.install();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0]).toMatchObject({
    label: question.trim().slice(0, 200), question: question.trim(), hasValue: false,
  });
  dropdown.textContent = 'No';
  dom.update();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0].hasValue).toBe(true);
});

test.each(['multiselectInputContainer', '-control'])('recognizes a selected combobox with an empty search input (%s)', container => {
  const dom = fixture();
  const dropdown = dom.element({ role: 'combobox', 'aria-label': 'Skills' });
  dropdown.value = '';
  dropdown.closest = selector => selector.includes(container) ? { querySelector: () => ({ textContent: 'JavaScript' }) } : null;
  dom.state.elements = [dropdown];
  dom.install();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0].hasValue).toBe(true);
});

test('an unchecked checkbox is unanswered even when its HTML value is on', () => {
  const dom = fixture();
  const checkbox = dom.element({ type: 'checkbox', 'aria-label': 'I acknowledge the privacy statement' });
  checkbox.value = 'on';
  checkbox.checked = false;
  dom.state.elements = [checkbox];
  dom.install();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0].hasValue).toBe(false);
  checkbox.checked = true;
  dom.update();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0].hasValue).toBe(true);
});

test.each(['checkbox', 'radio'])('ARIA %s preserves selected and mixed states', role => {
  const dom = fixture();
  const control = dom.element({ role, 'aria-label': 'Question', 'aria-checked': 'false' }, 'DIV');
  dom.state.elements = [control];
  dom.install();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0].hasValue).toBe(false);
  for (const state of ['true', 'mixed']) {
    control.setAttribute('aria-checked', state);
    dom.update();
    expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0].hasValue).toBe(true);
  }
});

test.each(['checkbox', 'radio'])('a %s group preserves an existing checked option', type => {
  const dom = fixture();
  const options = [dom.element({ type, name: 'choices' }), dom.element({ type, name: 'choices' })];
  options.forEach(option => { option.value = 'on'; option.checked = false; });
  dom.state.elements = options;
  dom.install();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0]).toMatchObject({ widget: type + '-group', hasValue: false });
  options[1].checked = true;
  dom.update();
  expect(dom.messages.filter(msg => msg.fields).at(-1).fields[0].hasValue).toBe(true);
});
