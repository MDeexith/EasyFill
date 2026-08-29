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
