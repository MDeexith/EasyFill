# EasyFill: completing a whole job application

**Date:** 2026-08-29
**Status:** approved, ready for implementation planning

## Goal

Autofill every field of a real job application, so the user only attaches their
résumé and presses Submit. Filling stops short of the attachment and the
submission itself — both stay with the user.

## Problem

Users report that text fields fill but dropdowns and checkboxes do not. That is
three separate causes, established by running the current code against two live
Greenhouse forms (Cloudflare job 7695702, Figma job 5364702004, fetched from
`https://job-boards.greenhouse.io/embed/job_app?for=<company>&token=<job_id>`).

### Cause 1 — no value to fill

`filler.js` returns early on an empty value:

```js
if (val === undefined || val === null || val === '') return;
```

The questions that render as dropdowns and checkboxes are exactly the ones a
résumé never states: work authorization, immigration sponsorship, the EEO block
(gender, Hispanic/Latino, veteran status, disability status), notice period,
relocation, "how did you hear about this job". `schema.js` has no keys for most
of them, and the ones it does have (`workAuthorization`, `willingToRelocate`,
`noticePeriod`) are never populated, because parsing cannot invent them.

### Cause 2 — option lists are absent at scan time

Neither form uses `<select>`. Cloudflare's form has zero native selects, zero
radios, and one checkbox; its seven "dropdowns" are React-Select comboboxes:

```html
<input id="country" role="combobox" aria-expanded="false" aria-haspopup="true">
```

`formScanner.js` harvests options through `aria-controls`:

```js
if (controls) { listbox = doc.getElementById(controls); }
if (!listbox) return out;   // empty options
```

The initial DOM contains **no `aria-controls` attributes at all** — React-Select
creates the listbox only when the menu opens. Every such field therefore reaches
the matcher with `options: []`, so `/select-option` cannot translate a profile
value into an option ("USA" → "United States", `1.7` → "1-3 years").

Note that this does *not* break every combobox. `tryComboboxFill` types the
value so React-Select filters, then clicks the match, which succeeds whenever
the profile value already resembles the option text. It is specifically
*translation* that fails.

### Cause 3 — the learning loop only sees text

`buildCorrectionListenerScript` listens for `blur` and reads
`el.value || el.textContent`. Checkboxes, radios, and React-Select never produce
a useful value that way, so nothing is learned from them.

## Design

### 1. Data layer

New profile keys, each justified by a question on the sampled forms:

| Key | Why | Source |
|---|---|---|
| `authorizedToWork` | Figma asks directly; distinct from free-text `workAuthorization` | onboarding |
| `requiresSponsorship` | Both forms ask; not inferable from authorization | onboarding |
| `hispanicLatino` | EEO block | onboarding, opt-in |
| `veteranStatus` | EEO block | onboarding, opt-in |
| `disabilityStatus` | EEO block | onboarding, opt-in |
| `heardAboutUs` | Cloudflare asks; options vary per company | learned |

`gender`, `willingToRelocate`, and `noticePeriod` already exist in `schema.js`
but are never populated, because parsing cannot derive them. Onboarding fills
them; `gender` joins the EEO opt-in group. `pronouns` also already exists and is
asked by Figma — it is populated by the résumé parser when stated, and otherwise
left to the learning loop.

**EEO defaults to "Decline to self-identify"** — a valid choice on every US EEO
form and the privacy-preserving default. The onboarding screen offers one
toggle: decline everything (default, no questions) or answer them (expands to
four pickers). Race, disability, and veteran data are stored only on an explicit
opt-in, live in local MMKV, and are never sent to the backend: `/match` receives
field metadata and profile *keys*, and values are applied on-device.

**Onboarding step** between Confirm and Main, asking five things: authorized to
work, requires sponsorship, notice period, willing to relocate, EEO toggle.
Skippable; editable later from Profile.

### 2. Dropdown and combobox resolution

Replace type-then-filter with open-then-match, batching the misses:

1. **Open without typing.** Focus the combobox so React-Select renders its
   listbox. The options exist in the DOM only at this moment.
2. **Match locally** against the live options: exact and case-insensitive,
   yes/no forms, country aliases, numeric-into-bucket (`1.7` → `1-3 years`),
   decline-to-self-identify variants, substring as last resort. A hit clicks the
   option with no network call.
3. **Batch the misses** into one `DROPDOWN_OPTIONS_HARVESTED` message carrying
   the real options.
4. **One `/select-option` call** for the batch, then `buildDirectFillScript`
   reopens and clicks each. Both functions are reused unchanged; they fail today
   only because they receive empty option arrays.

Comboboxes open serially with a short delay, since focusing one closes another.
If opening yields no options after the existing three retries, fall back to the
current char-by-char typing path, which async sources like Google Places need.

Local-first matching matters because `/match` already costs 13–20s against the
free-tier models. Country, yes/no, and experience buckets resolve with no added
latency; only unusual option sets pay for the single batched call (~2.8s
measured).

**Checkboxes.** Radio and checkbox groups already route through
`fillRadioGroup` / `fillCheckboxGroup` and work once a value exists, which
section 1 supplies. Standalone consent checkboxes (acknowledgements, terms,
privacy policy) are deliberately left unticked and surfaced for review: ticking
one is a legal affirmation that belongs to the user.

### 3. Learning loop

Add a capture-phase `change` listener beside the existing `blur` listener.
Radio and checkbox record the chosen option's label; select and combobox record
the selected option text. The fingerprint format
(`name|label|type|autocomplete`) is unchanged, so stored corrections stay valid.

Replay must route through the option-matching path from section 2. Setting a raw
value would type "1-3 years" as text into a combobox and filter it to nothing.

This is what makes "How did you hear about this job?" unanswerable on the first
application and automatic on every one after.

### 4. Review step

After the AI pass, a summary sheet lists what still needs the user: consent
checkboxes, fields with no profile value, fields the matcher declined, and the
résumé attachment. Tapping an entry scrolls to it in the WebView and highlights
it amber, beside the green already used for filled fields. This makes the
file-upload ceiling an explicit checklist rather than a silent gap.

### 5. Observability

`FILL_COMPLETE` reports a bare `filled` count today, which made a 12s client
timeout on `/match` indistinguishable from "the AI found nothing". Extend it to
a per-field outcome — `filled`, `no-value`, `no-match`, `control-failed` — and
feed that into both `fillStats` and the review list.

### 6. Error handling

- `/select-option` failure: local matches stand, the rest go to review.
- Combobox will not open: fall back to the typing path, then to review.
- `/match` failure: already logged rather than swallowed; regex results stand.

Nothing silently no-ops.

## Testing

- **Unit (Jest).** The value normalizer is pure logic and carries most of the
  new code: buckets, country aliases, yes/no, decline variants, substring
  fallback.
- **Fixture (jsdom).** The two Greenhouse forms above become checked-in
  fixtures for scanner and matcher tests — field detection, widget
  classification, profile-key mapping.
- **Manual.** jsdom cannot run React-Select's popup, so the open-read-click path
  is verifiable only in a real browser or on device. This is the riskiest part
  of the design and needs a deliberate manual pass.

## Out of scope

- Attaching the résumé file. Browsers forbid setting a file input's value from
  JS; a workaround would mean driving the native Android chooser, which is
  fragile and was explicitly deferred.
- Auto-submitting the application.
- Login and session sharing with Chrome. The user does not consider this a
  problem.

## Open questions

None blocking. Whether consent checkboxes should auto-tick is settled as "no",
revisitable if the review step proves annoying in practice.
