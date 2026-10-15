import { buildResumeAttachScript } from '../src/webview/filler';

test.each(['empty', 'selected', 'uploaded'])('resume attachment preserves an %s upload', state => {
  const events = [];
  const messages = [];
  const el = {
    type: 'file', files: state === 'selected' ? [{ name: 'chosen.pdf' }] : [],
    closest: () => state === 'uploaded' ? { querySelector: () => ({}) } : null,
    dispatchEvent: event => events.push(event.type),
  };
  const document = {
    querySelector: () => el, querySelectorAll: () => [], getElementsByTagName: () => [],
  };
  const window = { ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) } };
  function File(bytes, name) { this.name = name; }
  function DataTransfer() {
    this.files = [];
    this.items = { add: file => this.files.push(file) };
  }
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'File', 'DataTransfer', buildResumeAttachScript(['upload'], 'cGRm', 'resume.pdf'))(
    document, window, File, DataTransfer,
  );
  expect(messages[0].outcomes.upload).toBe('filled');
  expect(events).toEqual(state === 'empty' ? ['input', 'change'] : []);
  if (state === 'selected') expect(el.files[0].name).toBe('chosen.pdf');
});
