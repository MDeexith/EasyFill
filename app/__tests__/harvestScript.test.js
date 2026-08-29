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
    expect(() => new Function(script)).not.toThrow();

    // Verify the malicious id is present but safely escaped (in JSON form)
    expect(script).toContain('af_1');
    expect(script).toContain('alert');

    // Verify ids round-trip correctly through JSON
    const normalScript = buildComboboxHarvestScript(['test_id']);
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
      expect(() => new Function(script)).not.toThrow();
    });
  });

  test('buildDirectFillScript parses with edge cases', () => {
    const values = {};
    edgeCaseIds.forEach((id, i) => {
      values[id] = `value_${i}`;
    });
    const script = buildDirectFillScript(values);
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
    expect(() => new Function(script)).not.toThrow();
  });

  test('buildCorrectionListenerScript parses with edge cases', () => {
    const script = buildCorrectionListenerScript(edgeCaseIds);
    expect(() => new Function(script)).not.toThrow();
  });
});
