# Complete Autofill, Part 1: Data + Dropdown Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dropdowns, comboboxes and checkboxes fill on real job applications, by supplying the answers a résumé cannot provide and by reading option lists that only exist once a menu is opened.

**Architecture:** The injected page script opens each mapped combobox, reads the options its listbox renders, and posts them to React Native. RN attaches those options to the scanned fields and runs the *existing* `resolveLocally` → `resolveWithAi` pair, which already does local-then-LLM option matching and only ever failed because the option arrays were empty. Matching logic stays in plain testable JavaScript on the RN side.

**Tech Stack:** React Native 0.85, MMKV, Jest 29 (`@react-native/jest-preset`), injected WebView JavaScript (ES5 syntax only inside injected strings).

## Global Constraints

- Node >= 22.11.0.
- **Do not add npm dependencies.** The configured registry (`artifact-keeper-gusw1.sidp.reports.mn`) is unreachable outside the corporate VPN. This is why matching lives in RN rather than jsdom-tested page code.
- Injected WebView scripts are ES5-only: `var`, no arrow functions, no `const`/`let`, no template literals. Match the existing style in `src/webview/filler.js`.
- App code is JavaScript, not TypeScript. Function components. No new state libraries.
- EEO values default to decline; never send EEO values to the backend.
- Run tests from the `app/` directory: `cd app && npx jest`.

## Scope

Covers spec sections 1 (data layer), 2 (dropdown resolution), 3 (learning loop), 5 (per-field outcomes) and 6 (error handling). Spec section 4 (review sheet UI) is deliberately deferred to Part 2 — it is a separable UI feature, and Part 1 delivers the reported bug fix on its own.

**Deviation from spec, deliberate:** the spec's jsdom fixture tests are dropped. `jest-environment-jsdom` cannot be installed (see Global Constraints), and the fixtures have limited value anyway since React-Select options do not exist in static HTML. Coverage comes from unit tests on `resolveLocally` plus a manual device pass, which the spec already identified as mandatory for the popup path.

---

### Task 1: Profile schema keys and migration

New keys are useless if existing users' stored profiles do not gain them. `loadProfile()` currently returns parsed JSON directly, so a stored profile written before this change has no `requiresSponsorship` key at all.

**Files:**
- Modify: `app/src/profile/schema.js`
- Modify: `app/src/profile/store.js` (the `loadProfile` function)
- Test: `app/__tests__/profileSchema.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `EMPTY_PROFILE` gains keys `authorizedToWork`, `requiresSponsorship`, `hispanicLatino`, `veteranStatus`, `disabilityStatus`, `heardAboutUs` (all `''`). `loadProfile()` returns an object guaranteed to contain every `EMPTY_PROFILE` key.

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/profileSchema.test.js`:

```javascript
import { EMPTY_PROFILE, PROFILE_FIELD_LABELS } from '../src/profile/schema';

describe('profile schema', () => {
  const NEW_KEYS = [
    'authorizedToWork',
    'requiresSponsorship',
    'hispanicLatino',
    'veteranStatus',
    'disabilityStatus',
    'heardAboutUs',
  ];

  test('defines every new application key', () => {
    for (const key of NEW_KEYS) {
      expect(EMPTY_PROFILE).toHaveProperty(key, '');
    }
  });

  test('gives every new key a human label', () => {
    for (const key of NEW_KEYS) {
      expect(typeof PROFILE_FIELD_LABELS[key]).toBe('string');
      expect(PROFILE_FIELD_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  test('keeps pre-existing keys intact', () => {
    expect(EMPTY_PROFILE).toHaveProperty('gender', '');
    expect(EMPTY_PROFILE).toHaveProperty('willingToRelocate', '');
    expect(EMPTY_PROFILE).toHaveProperty('noticePeriod', '');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx jest __tests__/profileSchema.test.js`
Expected: FAIL — `Expected path: "authorizedToWork"` / received undefined.

- [ ] **Step 3: Add the keys to the schema**

In `app/src/profile/schema.js`, inside `EMPTY_PROFILE`, replace the `// ── job / work ──` block's tail so the section reads:

```javascript
  // ── job / work ────────────────────────────────────────────────────────────
  currentTitle: '',
  currentCompany: '',
  yearsExperience: 0,
  workAuthorization: '',
  authorizedToWork: '',
  requiresSponsorship: '',
  willingToRelocate: '',
  noticePeriod: '',

  // ── equal-opportunity (US applications) ───────────────────────────────────
  // Defaults to decline; populated only when the user opts in.
  hispanicLatino: '',
  veteranStatus: '',
  disabilityStatus: '',

  // ── application misc ──────────────────────────────────────────────────────
  heardAboutUs: '',
```

And in `PROFILE_FIELD_LABELS`, after the `noticePeriod` entry:

```javascript
  authorizedToWork: 'Authorized to Work',
  requiresSponsorship: 'Requires Visa Sponsorship',
  hispanicLatino: 'Hispanic / Latino',
  veteranStatus: 'Veteran Status',
  disabilityStatus: 'Disability Status',
  heardAboutUs: 'How You Heard About the Job',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx jest __tests__/profileSchema.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing migration test**

Append to `app/__tests__/profileSchema.test.js`:

```javascript
import { mergeWithSchema } from '../src/profile/schema';

describe('mergeWithSchema', () => {
  test('fills keys missing from an older stored profile', () => {
    const stored = { firstName: 'Deexith', email: 'a@b.com' };
    const merged = mergeWithSchema(stored);
    expect(merged.firstName).toBe('Deexith');
    expect(merged.requiresSponsorship).toBe('');
    expect(merged.disabilityStatus).toBe('');
  });

  test('never overwrites a stored value with an empty default', () => {
    const merged = mergeWithSchema({ noticePeriod: '30 days' });
    expect(merged.noticePeriod).toBe('30 days');
  });

  test('preserves array fields', () => {
    const merged = mergeWithSchema({ experience: [{ company: 'Media.net' }] });
    expect(merged.experience).toHaveLength(1);
    expect(merged.education).toEqual([]);
  });

  test('tolerates null and undefined', () => {
    expect(mergeWithSchema(null).firstName).toBe('');
    expect(mergeWithSchema(undefined).email).toBe('');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd app && npx jest __tests__/profileSchema.test.js`
Expected: FAIL — `mergeWithSchema is not a function`.

- [ ] **Step 7: Implement mergeWithSchema and use it in loadProfile**

Append to `app/src/profile/schema.js`:

```javascript
// Stored profiles predate later schema additions, so a profile read from disk
// can be missing keys entirely. Merging against EMPTY_PROFILE guarantees every
// key exists without clobbering anything the user has already set.
export function mergeWithSchema(stored) {
  return { ...EMPTY_PROFILE, ...(stored || {}) };
}
```

In `app/src/profile/store.js`, change the `EMPTY_PROFILE` import to also pull in `mergeWithSchema`, and rewrite `loadProfile`:

```javascript
export function loadProfile() {
  const raw = storage.getString(PROFILE_KEY);
  if (!raw) return { ...EMPTY_PROFILE };
  try {
    return mergeWithSchema(JSON.parse(raw));
  } catch {
    return { ...EMPTY_PROFILE };
  }
}
```

- [ ] **Step 8: Run the full suite**

Run: `cd app && npx jest`
Expected: PASS, all suites. `heuristics.test.js` and `profileFeed.test.js` must still pass.

- [ ] **Step 9: Commit**

```bash
git add app/src/profile/schema.js app/src/profile/store.js app/__tests__/profileSchema.test.js
git commit -m "feat: add application-question profile keys with schema migration"
```

---

### Task 2: Extend the existing local option matcher

`optionResolver.js` already scores options — exact, prefix, substring, and
yes/no — in `scoreOption` / `bestLocalOption`. Do not build a second matcher
beside it. Three rules are missing, and they are exactly the ones real forms
need: numeric buckets, country aliases, and decline-to-self-identify.

Note also that `resolveLocally` gates on `isDropdown(field)`, which requires
`field.options.length > 0`. React-Select fields always arrive with zero options,
so today they are skipped without even being queued for the LLM. Task 4 fixes
that by supplying real options; this task makes the scoring good enough to use
them.

**Files:**
- Modify: `app/src/matcher/optionResolver.js`
- Test: `app/__tests__/optionResolver.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveLocally(fields, mapping, profile)` keeps its existing
  signature and `{ selections, unresolved }` return shape, but now resolves
  numeric buckets, country aliases and decline intent. Task 4 calls it.

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/optionResolver.test.js`:

```javascript
import { resolveLocally } from '../src/matcher/optionResolver';

// resolveLocally takes scanned fields, so build one with options attached.
function dropdown(id, ...labels) {
  return {
    id,
    widget: 'combobox-input',
    options: labels.map((label, i) => ({ value: String(i), label })),
  };
}

function resolveOne(field, key, profile) {
  const { selections, unresolved } = resolveLocally([field], { [field.id]: key }, profile);
  return { hit: selections[field.id], missed: unresolved.length > 0 };
}

describe('resolveLocally — existing behaviour still works', () => {
  test('matches an exact country label', () => {
    const f = dropdown('af_1', 'Select…', 'India', 'United States');
    expect(resolveOne(f, 'country', { country: 'India' }).hit).toBe('India');
  });

  test('matches yes/no phrasing', () => {
    const f = dropdown('af_2', 'Yes', 'No');
    expect(resolveOne(f, 'authorizedToWork', { authorizedToWork: 'Yes' }).hit).toBe('Yes');
  });
});

describe('resolveLocally — numeric buckets', () => {
  const YEARS = () => dropdown('af_3', 'Select…', '0-1 years', '1-3 years', '3-5 years', '5+ years');

  test('places 1.7 years into the 1-3 bucket', () => {
    expect(resolveOne(YEARS(), 'yearsExperience', { yearsExperience: 1.7 }).hit).toBe('1-3 years');
  });

  test('places 0.5 into the 0-1 bucket', () => {
    expect(resolveOne(YEARS(), 'yearsExperience', { yearsExperience: 0.5 }).hit).toBe('0-1 years');
  });

  test('places 8 into the open-ended 5+ bucket', () => {
    expect(resolveOne(YEARS(), 'yearsExperience', { yearsExperience: 8 }).hit).toBe('5+ years');
  });

  test('handles a value on a bucket boundary', () => {
    expect(resolveOne(YEARS(), 'yearsExperience', { yearsExperience: 3 }).hit).toBe('3-5 years');
  });
});

describe('resolveLocally — country aliases', () => {
  const C = () => dropdown('af_4', 'Select…', 'India', 'United States', 'United Kingdom');

  test('maps USA to United States', () => {
    expect(resolveOne(C(), 'country', { country: 'USA' }).hit).toBe('United States');
  });

  test('maps UK to United Kingdom', () => {
    expect(resolveOne(C(), 'country', { country: 'UK' }).hit).toBe('United Kingdom');
  });
});

describe('resolveLocally — decline to self-identify', () => {
  const EEO = () => dropdown('af_5', 'Hispanic or Latino', 'Not Hispanic or Latino', 'I do not wish to answer');

  test('matches a decline value to this form\'s wording', () => {
    const p = { hispanicLatino: 'Decline to self-identify' };
    expect(resolveOne(EEO(), 'hispanicLatino', p).hit).toBe('I do not wish to answer');
  });

  test('matches prefer-not-to-say phrasing', () => {
    const p = { hispanicLatino: 'prefer not to say' };
    expect(resolveOne(EEO(), 'hispanicLatino', p).hit).toBe('I do not wish to answer');
  });
});

describe('resolveLocally — placeholders and misses', () => {
  test('never selects the placeholder option', () => {
    const f = dropdown('af_6', 'Select…', 'India', 'United States');
    const { hit } = resolveOne(f, 'country', { country: 'Select' });
    expect(hit).toBeUndefined();
  });

  test('queues an unmatched value for the LLM', () => {
    const f = dropdown('af_7', 'LinkedIn', 'A friend', 'Careers page');
    const { hit, missed } = resolveOne(f, 'heardAboutUs', { heardAboutUs: 'Hacker News' });
    expect(hit).toBeUndefined();
    expect(missed).toBe(true);
  });

  test('skips a field whose profile value is empty', () => {
    const f = dropdown('af_8', 'LinkedIn', 'A friend');
    const { selections, unresolved } = resolveLocally([f], { af_8: 'heardAboutUs' }, { heardAboutUs: '' });
    expect(selections).toEqual({});
    expect(unresolved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx jest __tests__/optionResolver.test.js`
Expected: the two "existing behaviour" tests PASS; the bucket, alias, decline
and placeholder tests FAIL.

- [ ] **Step 3: Add the missing rules**

In `app/src/matcher/optionResolver.js`, add above `scoreOption`:

```javascript
// Labels that prompt rather than answer. Never a valid selection.
const PLACEHOLDER_RE = /^(?:select|choose|please select|none|-+|—)?\s*[.…]*$/i;

// Only aliases that actually collide in practice; not a country database.
const COUNTRY_ALIASES = {
  usa: 'united states', us: 'united states', america: 'united states',
  uk: 'united kingdom', britain: 'united kingdom', 'great britain': 'united kingdom',
  uae: 'united arab emirates',
};

const DECLINE_RE =
  /\b(?:decline|prefer not|do not wish|don't wish|not to answer|choose not|rather not)\b/i;

// Parses "1-3 years", "5+ years", "Less than 1", "10 or more" into a range.
// Returns null when the label is not a numeric bucket.
function parseBucket(label) {
  const s = (label || '').toString().toLowerCase();

  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?)/);
  if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]) };

  m = s.match(/(\d+(?:\.\d+)?)\s*\+/) ||
      s.match(/(?:more than|over|at least)\s*(\d+(?:\.\d+)?)/);
  if (m) return { min: parseFloat(m[1]), max: Infinity };

  m = s.match(/(?:less than|under|fewer than)\s*(\d+(?:\.\d+)?)/);
  if (m) return { min: 0, max: parseFloat(m[1]) };

  return null;
}
```

Then extend `scoreOption`, inserting before its `return score;`:

```javascript
  // Country aliases, so a profile saying "USA" finds "United States".
  const aliased = COUNTRY_ALIASES[target];
  if (aliased && lab === aliased) score = Math.max(score, 5);

  // Decline intent, matched to whatever wording this particular form uses.
  if (DECLINE_RE.test(target) && DECLINE_RE.test(lab)) score = Math.max(score, 5);
```

And rewrite `bestLocalOption` so it rejects placeholders and can place a number
into a bucket:

```javascript
function bestLocalOption(options, rawValue) {
  const target = clean(rawValue);
  if (!target) return null;

  // A placeholder is never an answer, in either direction.
  const usable = options.filter(o => !PLACEHOLDER_RE.test((o.label || '').trim()));
  if (usable.length === 0) return null;
  if (PLACEHOLDER_RE.test(String(rawValue).trim())) return null;

  let best = null;
  let bestScore = 0;
  for (const opt of usable) {
    const s = scoreOption(opt, target);
    if (s > bestScore) { bestScore = s; best = opt; }
  }
  if (best) return best.label || best.value || '';

  // No textual match: a numeric value may still belong to a range bucket,
  // e.g. yearsExperience 1.7 into "1-3 years".
  const num = parseFloat(target);
  if (!Number.isNaN(num) && /^[\d.]+$/.test(target)) {
    for (const opt of usable) {
      const bucket = parseBucket(opt.label);
      if (bucket && num >= bucket.min && num <= bucket.max) {
        return opt.label || opt.value || '';
      }
    }
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx jest __tests__/optionResolver.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full suite for regressions**

Run: `cd app && npx jest`
Expected: PASS. `heuristics.test.js`, `profileFeed.test.js` and Task 1's tests
must be unaffected.

- [ ] **Step 6: Commit**

```bash
git add app/src/matcher/optionResolver.js app/__tests__/optionResolver.test.js
git commit -m "feat: match numeric buckets, country aliases and decline options"
```

---

### Task 3: Harvest combobox options at fill time

**Files:**
- Modify: `app/src/webview/filler.js` (add a new exported builder near `buildDirectFillScript` at line 526)
- Test: `app/__tests__/harvestScript.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildComboboxHarvestScript(fieldIds)` returning a script string. When run in the page it posts one message: `{ type: 'COMBOBOX_OPTIONS', options: { [afId]: Array<{value, label}> } }`. Task 4 consumes that message.

- [ ] **Step 1: Write the failing test**

The script is a string, so the test asserts on its content rather than executing DOM code.

Create `app/__tests__/harvestScript.test.js`:

```javascript
import { buildComboboxHarvestScript } from '../src/webview/filler';

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

  test('escapes ids safely rather than interpolating raw', () => {
    const script = buildComboboxHarvestScript(['af_1"; alert(1); //']);
    expect(script).not.toContain('"; alert(1); //"');
  });

  test('returns an inert script for an empty list', () => {
    const script = buildComboboxHarvestScript([]);
    expect(typeof script).toBe('string');
    expect(script).toContain('COMBOBOX_OPTIONS');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx jest __tests__/harvestScript.test.js`
Expected: FAIL — `buildComboboxHarvestScript is not a function`.

- [ ] **Step 3: Implement the harvest script builder**

`filler.js` already has a `safeJson` helper used by the other builders; reuse it. Add after `buildDirectFillScript` (which ends near line 562):

```javascript
// Opens each combobox in turn and reports the options its listbox renders.
//
// React-Select and similar widgets create their listbox only on open, so the
// options simply do not exist at scan time — this is why resolveLocally skipped
// these fields entirely (isDropdown requires a non-empty options array).
// Opening is serial because focusing one combobox closes another.
export function buildComboboxHarvestScript(fieldIds) {
  return `
(function() {
  var ids = ${safeJson(fieldIds || [])};
  var results = {};

  function findEl(afId) {
    try { return document.querySelector('[data-af-id="' + afId + '"]'); }
    catch (e) { return null; }
  }

  function readOptions(el) {
    var out = [];
    var controls = el.getAttribute('aria-controls');
    var listbox = null;
    if (controls) { try { listbox = document.getElementById(controls); } catch (e) {} }
    if (!listbox) listbox = document.querySelector('[role="listbox"]');
    if (!listbox) return out;
    var nodes = listbox.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li');
    for (var i = 0; i < nodes.length; i++) {
      var label = (nodes[i].innerText || nodes[i].textContent || '').trim();
      if (!label) continue;
      out.push({ value: nodes[i].getAttribute('data-value') || label, label: label });
    }
    return out;
  }

  function closeAny(el) {
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      el.blur();
    } catch (e) {}
  }

  function step(i) {
    if (i >= ids.length) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'COMBOBOX_OPTIONS', options: results
        }));
      }
      return;
    }
    var afId = ids[i];
    var el = findEl(afId);
    if (!el) { step(i + 1); return; }

    // Native <select> already carries its options; no need to open anything.
    if (el.tagName === 'SELECT' && el.options) {
      var nat = [];
      for (var k = 0; k < el.options.length; k++) {
        nat.push({ value: el.options[k].value, label: (el.options[k].text || '').trim() });
      }
      results[afId] = nat;
      step(i + 1);
      return;
    }

    try {
      el.focus();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
    } catch (e) {}

    // Give the widget time to render its listbox before reading it.
    setTimeout(function() {
      var opts = readOptions(el);
      if (opts.length) results[afId] = opts;
      closeAny(el);
      setTimeout(function() { step(i + 1); }, 60);
    }, 300);
  }

  step(0);
})();
  `;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx jest __tests__/harvestScript.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/webview/filler.js app/__tests__/harvestScript.test.js
git commit -m "feat: harvest combobox options by opening them at fill time"
```

---

### Task 4: Wire harvesting into the autofill sequence

Feed the harvested options back into the existing `resolveLocally` /
`resolveWithAi` pair by attaching them to the scanned field objects. No new
resolver function is needed — those two already do the work, and only ever
failed because `field.options` was empty.

**Files:**
- Modify: `app/src/screens/BrowserScreen.jsx` (the `doAutofill` callback and the `onMessage` handler)
- Modify: `app/src/matcher/optionResolver.js` (export `isDropdown`)

**Interfaces:**
- Consumes: `buildComboboxHarvestScript(fieldIds)` from Task 3; the extended
  `resolveLocally` from Task 2; existing `resolveWithAi` and
  `buildDirectFillScript`.
- Produces: no new exported API. `isDropdown(field)` becomes exported so
  BrowserScreen selects the same widget set the resolver recognises.

- [ ] **Step 1: Export isDropdown**

In `app/src/matcher/optionResolver.js`, change the declaration on line 13 from
`function isDropdown(field)` to:

```javascript
export function isDropdown(field) {
```

Note it also requires a non-empty `options` array, which is exactly the gate
that harvesting now satisfies.

- [ ] **Step 2: Wire the harvest into BrowserScreen**

In `app/src/screens/BrowserScreen.jsx`, extend the existing imports — do not add
duplicate import statements for modules already imported:

```javascript
import { buildComboboxHarvestScript } from '../webview/filler';
import { resolveLocally, resolveWithAi, isDropdown } from '../matcher/optionResolver';
```

Add a ref beside the other refs near the top of the component, so the message
handler can hand results back to the awaiting autofill run:

```javascript
  const harvestResolveRef = useRef(null);
```

In the `onMessage` handler, beside the existing `USER_INPUT_DETECTED` branch:

```javascript
      if (data.type === 'COMBOBOX_OPTIONS') {
        const resolve = harvestResolveRef.current;
        harvestResolveRef.current = null;
        if (resolve) resolve(data.options || {});
      }
```

Then replace the dropdown block in `doAutofill` — the `try { ... }` beginning
with the `// ── Dropdown option AI resolution ──` comment — with:

```javascript
      // ── Dropdown resolution ─────────────────────────────────────────────
      // Options for React-Select style comboboxes do not exist until the menu
      // is opened, so harvest them from the live page, then run the ordinary
      // local-then-AI resolution over fields that finally have options.
      try {
        const combinedMapping = { ...fastMapping, ...safeAiMapping };
        const DROPDOWN_WIDGETS = ['select', 'combobox-input', 'button-dropdown'];
        const dropdownIds = scanned
          .filter(f => combinedMapping[f.id] && DROPDOWN_WIDGETS.includes(f.widget))
          .map(f => f.id);

        if (dropdownIds.length > 0) {
          const harvested = await new Promise(resolve => {
            harvestResolveRef.current = resolve;
            webViewRef.current?.injectJavaScript(buildComboboxHarvestScript(dropdownIds));
            // The page may never answer (navigation, a widget that will not
            // open); do not leave autofill hanging on it.
            setTimeout(() => {
              if (harvestResolveRef.current === resolve) {
                harvestResolveRef.current = null;
                resolve({});
              }
            }, 8000);
          });

          // Attach the harvested options so isDropdown() finally passes.
          const withOptions = scanned
            .filter(f => harvested[f.id] && harvested[f.id].length > 0)
            .map(f => ({ ...f, options: harvested[f.id] }));

          const { selections, unresolved } =
            resolveLocally(withOptions, combinedMapping, profile);

          if (Object.keys(selections).length > 0) {
            webViewRef.current?.injectJavaScript(buildDirectFillScript(selections));
          }

          if (unresolved.length > 0) {
            const aiSelections = await resolveWithAi(unresolved, combinedMapping, profile);
            if (Object.keys(aiSelections).length > 0) {
              webViewRef.current?.injectJavaScript(buildDirectFillScript(aiSelections));
            }
          }
        }
      } catch (err) {
        console.warn('[autofill] dropdown resolution failed:', err?.message || err);
      }
```

`resolveWithAi` already expects field objects carrying `options`, which is what
`resolveLocally` puts into `unresolved`, so the two compose unchanged.

- [ ] **Step 3: Remove the now-dead variables**

The earlier passes assign `fastDropdownsForAi` and `aiDropdownsForAi` from
`resolveLocally`'s `unresolved` output. Those pre-harvest values are always
empty for React-Select fields and are no longer consumed. Delete both variables
and the `unresolved` destructuring that produced them, keeping the `selections`
output, which the fast pass still injects.

- [ ] **Step 4: Verify**

Run: `cd app && npx jest && npx eslint src/screens/BrowserScreen.jsx src/matcher/optionResolver.js`
Expected: all tests PASS; 0 ESLint errors, and no `no-unused-vars` error for the
deleted variables.

- [ ] **Step 5: Commit**

```bash
git add app/src/screens/BrowserScreen.jsx app/src/matcher/optionResolver.js
git commit -m "feat: resolve dropdowns from options harvested off the live page"
```

---

### Task 5: Onboarding step for unanswerable questions

**Files:**
- Create: `app/src/screens/ApplicationDetailsScreen.jsx`
- Modify: `app/App.jsx` (register the route)
- Modify: `app/src/screens/ConfirmScreen.jsx` (navigate here instead of Main)

**Interfaces:**
- Consumes: `EMPTY_PROFILE` keys from Task 1; `loadProfile`, `saveProfile`, `setOnboarded` from `src/profile/store`.
- Produces: route name `'ApplicationDetails'`. On completion it calls `setOnboarded(true)` and `navigation.replace('Main')` — the responsibility moves out of ConfirmScreen.

- [ ] **Step 1: Create the screen**

Create `app/src/screens/ApplicationDetailsScreen.jsx`:

```javascript
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, Card, T, Eyebrow } from '../components/ui';
import { theme } from '../theme/tokens';
import { loadProfile, saveProfile, setOnboarded } from '../profile/store';

const DECLINE = 'Decline to self-identify';

const YES_NO = ['Yes', 'No'];
const GENDERS = ['Male', 'Female', 'Non-binary', DECLINE];
const HISPANIC = ['Yes', 'No', DECLINE];
const VETERAN = ['I am not a protected veteran', 'I am a protected veteran', DECLINE];
const DISABILITY = ['No, I do not have a disability', 'Yes, I have a disability', DECLINE];

function Choice({ label, options, value, onChange }) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(opt)}
            activeOpacity={0.85}
            style={[styles.pill, value === opt && styles.pillOn]}
          >
            <Text style={[styles.pillText, value === opt && styles.pillTextOn]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function ApplicationDetailsScreen({ navigation }) {
  const [profile, setProfile] = useState(() => loadProfile());
  const [eeoOpen, setEeoOpen] = useState(false);

  const set = useCallback((key, value) => {
    setProfile(p => ({ ...p, [key]: value }));
  }, []);

  const finish = useCallback(() => {
    // Anything the user left untouched in the EEO block stays declined.
    const next = {
      ...profile,
      gender: profile.gender || DECLINE,
      hispanicLatino: profile.hispanicLatino || DECLINE,
      veteranStatus: profile.veteranStatus || DECLINE,
      disabilityStatus: profile.disabilityStatus || DECLINE,
    };
    saveProfile(next);
    setOnboarded(true);
    navigation.replace('Main');
  }, [profile, navigation]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Eyebrow>ONE-TIME SETUP</Eyebrow>
        <Text style={T.h1}>A few things your résumé doesn't say</Text>
        <Text style={styles.sub}>
          Applications ask these constantly. Answer once and EasyFill fills them every time.
        </Text>

        <Card style={styles.card}>
          <Choice
            label="Are you authorized to work in the country you're applying to?"
            options={YES_NO}
            value={profile.authorizedToWork}
            onChange={v => set('authorizedToWork', v)}
          />
          <Choice
            label="Will you require visa sponsorship?"
            options={YES_NO}
            value={profile.requiresSponsorship}
            onChange={v => set('requiresSponsorship', v)}
          />
          <Choice
            label="Are you willing to relocate?"
            options={YES_NO}
            value={profile.willingToRelocate}
            onChange={v => set('willingToRelocate', v)}
          />
          <View style={styles.block}>
            <Text style={styles.label}>Notice period</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 30 days, Immediate"
              placeholderTextColor={theme.colors.faint}
              value={profile.noticePeriod}
              onChangeText={v => set('noticePeriod', v)}
            />
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.label}>Equal opportunity questions</Text>
          <Text style={styles.sub}>
            US applications ask about gender, ethnicity, veteran and disability status.
            Answering is optional — we decline on your behalf unless you choose otherwise.
            These answers stay on your device.
          </Text>
          {!eeoOpen ? (
            <Btn variant="secondary" onPress={() => setEeoOpen(true)}>
              Answer them instead
            </Btn>
          ) : (
            <View>
              <Choice label="Gender" options={GENDERS}
                value={profile.gender} onChange={v => set('gender', v)} />
              <Choice label="Hispanic or Latino?" options={HISPANIC}
                value={profile.hispanicLatino} onChange={v => set('hispanicLatino', v)} />
              <Choice label="Veteran status" options={VETERAN}
                value={profile.veteranStatus} onChange={v => set('veteranStatus', v)} />
              <Choice label="Disability status" options={DISABILITY}
                value={profile.disabilityStatus} onChange={v => set('disabilityStatus', v)} />
            </View>
          )}
        </Card>

        <Btn onPress={finish}>Done</Btn>
        <TouchableOpacity onPress={finish} style={styles.skip} activeOpacity={0.7}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 18, paddingBottom: 40, gap: 14 },
  sub: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  card: { gap: 14 },
  block: { gap: 8 },
  label: { color: theme.colors.ink, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    borderWidth: 1, borderColor: theme.colors.line,
  },
  pillOn: { backgroundColor: theme.colors.ink, borderColor: theme.colors.ink },
  pillText: { color: theme.colors.muted, fontSize: 13 },
  pillTextOn: { color: '#fff', fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: theme.colors.line, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.ink, fontSize: 14,
  },
  skip: { alignItems: 'center', paddingVertical: 12 },
  skipText: { color: theme.colors.muted, fontSize: 13 },
});
```

Before running, confirm the token names used above exist in `src/theme/tokens.js` — the file uses `theme.colors.*`, and `bg`, `ink`, `muted`, `faint`, `line` are referenced elsewhere in the codebase. If any name differs, use the codebase's actual name rather than adding a token.

- [ ] **Step 2: Register the route**

In `app/App.jsx`, add the import beside the other screen imports:

```javascript
import ApplicationDetailsScreen from './src/screens/ApplicationDetailsScreen';
```

And the route immediately after the `Confirm` screen:

```javascript
          <RootStack.Screen name="ApplicationDetails" component={ApplicationDetailsScreen} />
```

- [ ] **Step 3: Route ConfirmScreen through the new step**

In `app/src/screens/ConfirmScreen.jsx`, the save handler currently reads:

```javascript
    saveProfile(profile);
    setOnboarded(true);
    navigation.replace('Main');
```

Replace with:

```javascript
    saveProfile(profile);
    // setOnboarded now happens in ApplicationDetails, so a user who quits
    // mid-setup is returned to onboarding rather than a half-filled profile.
    navigation.replace('ApplicationDetails');
```

Remove `setOnboarded` from the import on line 7 if it is no longer referenced in the file.

- [ ] **Step 4: Verify**

Run: `cd app && npx jest && npx eslint src/screens/ApplicationDetailsScreen.jsx src/screens/ConfirmScreen.jsx App.jsx`
Expected: tests PASS; 0 ESLint errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/screens/ApplicationDetailsScreen.jsx app/src/screens/ConfirmScreen.jsx app/App.jsx
git commit -m "feat: ask the five questions a resume cannot answer during onboarding"
```

---

### Task 6: Learn from dropdown and checkbox answers

**Files:**
- Modify: `app/src/webview/filler.js` (`buildCorrectionListenerScript`, near line 631)
- Test: `app/__tests__/correctionListener.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the listener additionally posts `USER_INPUT_DETECTED` on `change` for checkbox, radio, select and combobox controls. The message shape is unchanged, so `BrowserScreen`'s existing handler and `mergeFieldCorrections` need no modification.

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/correctionListener.test.js`:

```javascript
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
    expect(script).not.toMatch(/=>/);
    expect(script).not.toMatch(/\bconst\b/);
    expect(script).not.toMatch(/\blet\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx jest __tests__/correctionListener.test.js`
Expected: FAIL on the `change` listener assertion.

- [ ] **Step 3: Extend the listener**

Replace the body of `buildCorrectionListenerScript` in `app/src/webview/filler.js` with:

```javascript
export function buildCorrectionListenerScript(filledAfIds) {
  const filledMap = Object.fromEntries((filledAfIds || []).map(id => [id, true]));
  return `
(function() {
  if (window.__AF_CORRECTION_LISTENER__) return;
  window.__AF_CORRECTION_LISTENER__ = true;
  var filled = ${safeJson(filledMap)};

  function report(el, value) {
    var afId = el.getAttribute && el.getAttribute('data-af-id');
    if (!afId || !value) return;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'USER_INPUT_DETECTED',
        afId: afId,
        value: value,
        wasAutoFilled: !!filled[afId],
      }));
    }
  }

  // Text-like controls settle on blur.
  document.addEventListener('blur', function(e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var value = (el.value || el.textContent || '').trim();
    report(el, value);
  }, true);

  // Checkboxes, radios and selects never blur meaningfully, so the answer the
  // user chose was previously never learned. 'change' is where they commit.
  document.addEventListener('change', function(e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var type = (el.type || '').toLowerCase();
    var value = '';

    if (type === 'checkbox' || type === 'radio') {
      if (!el.checked) return;
      var lid = el.getAttribute('id');
      var lab = null;
      if (lid) { try { lab = document.querySelector('label[for="' + lid + '"]'); } catch (err) {} }
      if (!lab && el.closest) lab = el.closest('label');
      value = lab ? (lab.innerText || lab.textContent || '').trim() : (el.value || '').trim();
    } else if (el.tagName === 'SELECT') {
      var sel = el.options && el.options[el.selectedIndex];
      value = sel ? (sel.text || sel.value || '').trim() : '';
    } else {
      value = (el.value || '').trim();
    }

    report(el, value);
  }, true);
})();
  `;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx jest __tests__/correctionListener.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/webview/filler.js app/__tests__/correctionListener.test.js
git commit -m "feat: learn user answers from dropdowns, radios and checkboxes"
```

---

### Task 7: Per-field fill outcomes

Today `FILL_COMPLETE` carries only a count, which is why a client timeout was indistinguishable from "the model found nothing" for an entire debugging session.

**Files:**
- Modify: `app/src/webview/filler.js` (the `buildFillScript` reporting block near line 604)
- Modify: `app/src/screens/BrowserScreen.jsx` (the `FILL_COMPLETE` message branch)
- Test: `app/__tests__/fillOutcomes.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `FILL_COMPLETE` gains `outcomes: { [afId]: 'filled' | 'no-value' | 'control-failed' }`. Part 2's review sheet consumes this.

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/fillOutcomes.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx jest __tests__/fillOutcomes.test.js`
Expected: FAIL — script does not contain `outcomes`.

- [ ] **Step 3: Record outcomes in the fill script**

In `buildFillScript` inside `app/src/webview/filler.js`, declare an outcomes object beside the existing `var filled = 0;` counter:

```javascript
  var outcomes = {};
```

Then set it at each exit point of the per-field loop. The early return for an empty value becomes:

```javascript
    if (val === undefined || val === null || val === '') { outcomes[fieldId] = 'no-value'; return; }
```

The radio and checkbox group branches become:

```javascript
    if (meta && meta.widget === 'radio-group') {
      if (fillRadioGroup(meta.options, val)) { filled++; outcomes[fieldId] = 'filled'; }
      else outcomes[fieldId] = 'control-failed';
      return;
    }
    if (meta && meta.widget === 'checkbox-group') {
      if (fillCheckboxGroup(meta.options, val)) { filled++; outcomes[fieldId] = 'filled'; }
      else outcomes[fieldId] = 'control-failed';
      return;
    }
```

The missing-element guard and the final fill become:

```javascript
    var el = findEl(fieldId);
    if (!el) { outcomes[fieldId] = 'control-failed'; return; }
```

```javascript
    if (fillOne(el, val)) { filled++; outcomes[fieldId] = 'filled'; }
    else outcomes[fieldId] = 'control-failed';
```

The chip branch, which currently increments `filled` unconditionally, becomes:

```javascript
      fillChips(el, values);
      filled++;
      outcomes[fieldId] = 'filled';
      return;
```

Finally, include it in the message:

```javascript
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'FILL_COMPLETE', filled: filled, outcomes: outcomes
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx jest __tests__/fillOutcomes.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Store the outcomes in BrowserScreen**

Add a state hook beside the existing `fillStats` state:

```javascript
  const [fillOutcomes, setFillOutcomes] = useState({});
```

In the `onMessage` handler, find the branch handling `FILL_COMPLETE` and merge the outcomes in. Because autofill injects several fill scripts in sequence (fast pass, AI pass, dropdown pass), merge rather than replace:

```javascript
      if (data.type === 'FILL_COMPLETE') {
        setFillOutcomes(prev => ({ ...prev, ...(data.outcomes || {}) }));
      }
```

If no `FILL_COMPLETE` branch exists yet, add one alongside the `USER_INPUT_DETECTED` branch. Reset it in `onLoadStart`, beside the existing `setFields([])`:

```javascript
            setFillOutcomes({});
```

- [ ] **Step 6: Verify the whole suite**

Run: `cd app && npx jest && npx eslint src/webview/filler.js src/screens/BrowserScreen.jsx`
Expected: all tests PASS; 0 ESLint errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/webview/filler.js app/src/screens/BrowserScreen.jsx app/__tests__/fillOutcomes.test.js
git commit -m "feat: report per-field fill outcomes instead of a bare count"
```

---

### Task 8: Manual verification on a real application

Unit tests cannot exercise React-Select's popup. This task is mandatory before release and is the riskiest part of the plan.

**Files:** none.

- [ ] **Step 1: Build and install**

```bash
cd app && npx react-native run-android
```

- [ ] **Step 2: Complete onboarding**

Upload a résumé, confirm the parsed profile, and answer the new Application Details screen. Verify the EEO section stays collapsed and defaults to decline when skipped.

- [ ] **Step 3: Open a real Greenhouse application**

Paste `https://job-boards.greenhouse.io/embed/job_app?for=cloudflare&token=7695702` into the home screen URL box. This form has seven React-Select comboboxes and one consent checkbox, and was the source of the diagnosis.

- [ ] **Step 4: Observe and record**

With the Metro console open (`npx react-native log-android`), confirm:

- `[matcher] AI /match returned N decision(s)` appears with N > 0 rather than the previous timeout warning.
- Country and Location (City) fill.
- The sponsorship, Gender, Hispanic/Latino, Veteran and Disability comboboxes fill from the onboarding answers.
- The consent checkbox stays unticked, as designed.
- Menus do not visibly flicker open and stay open.

Record which of the seven filled. Anything that did not is a real finding for Part 2 — note the field label and what the console reported.

- [ ] **Step 5: Verify learning**

Type an answer into "How did you hear about this job?", leave the field, then reload the page and re-run autofill. The answer should be replayed.

- [ ] **Step 6: Commit nothing, report findings**

This task produces no code. Report results before starting Part 2.

---

## Self-Review

**Spec coverage.** Section 1 (data layer) → Tasks 1, 5. Section 2 (dropdown
resolution) → Tasks 2, 3, 4. Section 3 (learning loop) → Task 6. Section 5
(observability) → Task 7. Section 6 (error handling) → Task 4's 8s harvest
timeout and `catch` logging, plus Task 7's `control-failed` outcome. Section 4
(review sheet) → deferred to Part 2, stated in Scope. Spec testing section →
unit tests in Tasks 1–7 plus the mandatory manual pass in Task 8; the jsdom
fixture tests are dropped with the reason recorded in Scope.

**Placeholder scan.** No TBD, TODO, or "handle errors appropriately". Every
code step carries the actual code to write.

**Type consistency.** `resolveLocally(fields, mapping, profile) →
{selections, unresolved}` keeps its existing signature through Task 2 and is
called that way in Task 4. `unresolved` holds field *objects* carrying
`options`, which is exactly what `resolveWithAi(unresolved, mapping, profile)`
already expects, so the two compose without adaptation.
`buildComboboxHarvestScript(fieldIds) → string` (Task 3) is called with an array
of ids in Task 4. The `COMBOBOX_OPTIONS` message name matches between Task 3's
producer and Task 4's consumer. `USER_INPUT_DETECTED` (Task 6) keeps its
existing shape, so `BrowserScreen`'s handler needs no change.

**Corrected during review.** An earlier draft of this plan added a new
`optionNormalizer` module with its own `matchOption`, duplicating the
`scoreOption` / `bestLocalOption` matcher already in `optionResolver.js`.
Tasks 2 and 4 were rewritten to extend the existing code instead. Verified
directly against the source: `valueFor` is module-scoped (line 20), so no
hoisting is needed, and `isDropdown` (line 13) gates on
`field.options.length > 0` — which is precisely why React-Select fields are
skipped today, and why attaching harvested options is sufficient to fix them.

**Residual risk.** Task 3's harvest script uses fixed 300ms/60ms delays for menu
rendering. Slow devices or heavy pages may need more; Task 8 is where that gets
observed. If fields come back with no options, raising the 300ms is the first
thing to try.
