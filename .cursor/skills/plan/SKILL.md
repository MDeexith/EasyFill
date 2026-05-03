---
name: plan
description: >-
  Plans hardening work for the in-app browser autofill feature (the app's
  USP) in this React Native project. Use when the user invokes /plan, says
  "plan", asks to plan, design, or improve autofill, asks to strengthen
  form-field detection, AI + regex matching, the autofill button, or
  profile-based auto-filling inside the WebView. Produces a structured,
  file-scoped implementation plan that hardens the field scanner, the
  AI-priority + regex matcher, and the filler — without writing any code
  until the plan is approved.
---

# Plan: Harden the autofill USP (detection + AI/regex matching + filling)

## Why this skill exists

The autofill feature is the app's USP and it currently misses fields, mis-maps fields, or fails to fill on common job sites. This skill produces a focused, file-scoped plan to make it work reliably.

The desired UX is unchanged:

1. User opens any URL inside the in-app browser.
2. App scans the page for input fields and shows a single autofill button (FAB).
3. On tap, app runs AI + regex matching together (AI takes priority when it returns a key) and fills the matched fields from the user's profile.
4. Long-form fields are then drafted by the AI.

The plan must strengthen steps 1–3 without changing this contract.

## Step 0 — Switch to Plan mode

Before doing anything else, call `SwitchMode` with `target_mode_id: "plan"` and a one-line explanation. Reason: this is a multi-file design task with trade-offs (AI vs regex priority, on-device vs backend, perf vs coverage). Do not write code in this skill — only produce the plan.

## Workflow checklist

Copy and track:

```
- [ ] 0. Switch to Plan mode
- [ ] 1. Read each file in the "File map" section below
- [ ] 2. For every "Known weak signal" check whether it is still present in the code
- [ ] 3. Ask the user any blocking clarifying question (max 2)
- [ ] 4. Produce the plan using the "Plan output template" below
- [ ] 5. Wait for user approval before implementing
```

## File map (read these — do not skim)

| Layer | File | What it does |
|---|---|---|
| Field scan (in-page JS) | `app/src/webview/formScanner.js` | Injected into WebView, finds inputs, assigns `data-af-id`, posts `FIELDS_SCANNED` |
| Filler (in-page JS) | `app/src/webview/filler.js` | Injected to set values + dispatch `input`/`change`/`blur` |
| Regex matcher | `app/src/matcher/heuristics.js` | Pure-JS rules mapping field text → profile key |
| AI matcher | `app/src/matcher/llmClient.js` | Calls `/match` on backend |
| Combiner | `app/src/matcher/index.js` | Runs heuristics, then AI overrides (AI-priority) |
| Browser UI / orchestration | `app/src/screens/BrowserScreen.jsx` | FAB, panel, autofill phase machine, message handling |
| Profile schema | `app/src/profile/schema.js` | Source of truth for `EMPTY_PROFILE` keys |
| Backend matcher | `backend_py/routes/match.py` + `backend_py/prompts/match.txt` | LLM prompt for field → profile key mapping |

## Known weak signals (verify against current code, then plan fixes)

These are the real, specific problems likely degrading the USP. The plan must address each one or explicitly justify skipping it.

### Detection (`formScanner.js`)

- Ignores `autocomplete` attribute — the single strongest signal. HTML5 tokens like `email`, `tel`, `given-name`, `family-name`, `street-address`, `postal-code`, `country`, `cc-number`, `bday`, `organization-title` map almost 1:1 to profile keys.
- Ignores semantic `type` attribute (`email`, `tel`, `url`, `number`, `date`) when these alone are high-confidence signals.
- Does not pierce **Shadow DOM** — Workday, Lever, Greenhouse, Ashby, Wellfound and many enterprise ATS use web components / shadow roots. Forms there are invisible to `document.querySelectorAll`.
- Does not scan inside same-origin **iframes**.
- Ignores `contenteditable` rich-text editors (cover-letter style fields on some ATS).
- `MutationObserver` only listens for `childList` / `subtree`; misses inputs that mount hidden (`display:none` → visible) and inputs that gain `name`/`id` after hydration.
- Hard timer re-scans (`1500`, `3500` ms) are brittle — slow networks, hydration delays, or modal-mounted forms slip through.
- `data-af-id` falls back to `el.id` first; element ids are not guaranteed unique in the wild and collisions silently overwrite mappings.
- `nearbyText` walks only 4 ancestors and grabs the first `<label>` it finds — picks up wrong labels in deeply nested grid layouts and React form libs that render labels as siblings of the wrapper, not the input.
- Excludes checkbox/radio entirely — fine for now (profile has no boolean keys), but flag any new profile fields that need them.

### Regex matcher (`heuristics.js`)

- Single highest-priority pass; first rule wins. There is no **confidence score**, so a weak label match silently overrides what could be a strong `autocomplete`/`type` match.
- Does not consume `autocomplete` or `type` at all (see detection issues).
- Missing common signals: middle name, preferred name, pronouns, date of birth, gender, work authorization / sponsorship, willing to relocate, notice period, current vs expected CTC, languages, references.
- `startDate` regex is loose enough to grab "start date of your most recent role" in a work-history block.
- `salary` lumps current salary and expected salary into one key.
- No i18n — fails on non-English labels (if the app is intended for global use, decide explicitly: defer or address).

### Combiner (`matcher/index.js`)

- AI override is unconditional whenever AI returns a non-null key. There is no AI confidence to gate this — a hallucinated mapping silently replaces a correct regex match.
- No deduplication — AI can map two different fields to the same profile key (e.g., both "Full Name" and "First Name" → `firstName`), causing one to be filled with the wrong value.
- No conflict resolution between heuristics and AI when they disagree on a field that is clearly answerable by `autocomplete`/`type` (which are stronger than either).

### Filler (`filler.js`)

- `if (val === 0) return;` drops `yearsExperience: 0` (a valid value).
- Sets `<select>` value but does not handle React-Select / Headless UI / custom dropdowns (hidden input + listbox).
- No date-picker handling: setting `value` on a date input that is actually a custom widget does nothing.
- No multi-value / chips input handling for `skills`.
- No `focus` before `input` event — some validation libs (Formik/RHF) only register changes after focus.
- Does not treat array profile values (`experience`, `education`) at all.

### Backend prompt (`prompts/match.txt`)

- Does not include `autocomplete` or `type` in the field example or rules.
- Does not enforce uniqueness (one profile key per field is fine; same profile key on multiple fields should be allowed only when label clearly disambiguates).
- Does not include a confidence field that the combiner could use to gate the override.

### UX / orchestration (`BrowserScreen.jsx`)

- FAB only appears in `phase === 'detected' || 'filled'`. If the scan runs before the form mounts and never re-fires, the user sees nothing — the USP is invisible. Plan should ensure the FAB or a manual "Scan again" affordance is reachable when fields are zero.
- `enrichProfile` only splits/joins name; does not derive `currentCompany` from the latest `experience[0].company`, `currentTitle` from `experience[0].title`, or `yearsExperience` from `experience` durations. Add this so AI/regex have more keys to match against.

## Profile schema (verbatim, from `app/src/profile/schema.js`)

When the plan adds new profile keys, list them explicitly and update `EMPTY_PROFILE`, `PROFILE_FIELD_LABELS`, `heuristics.js`, and `prompts/match.txt` together. Existing keys:

`firstName, lastName, name, email, phone, address, city, state, zipCode, country, linkedIn, portfolio, github, currentTitle, currentCompany, yearsExperience, coverLetter, salary, startDate, skills, experience[], education[]`

## Plan output template

Produce the plan as a single Markdown response in this exact shape:

```markdown
# Autofill hardening plan

## 1. Goal recap
One paragraph restating the USP and what "fixed" looks like.

## 2. Confirmed weak signals
Bullet list — only the items from "Known weak signals" that you actually
verified in the current code. Cite file + line range (e.g.
`app/src/matcher/heuristics.js:1-38`).

## 3. Proposed changes (file by file)

### 3.1 `app/src/webview/formScanner.js`
- Change A — what + why
- Change B — what + why

### 3.2 `app/src/matcher/heuristics.js`
...

### 3.3 `app/src/matcher/index.js`
...

### 3.4 `app/src/webview/filler.js`
...

### 3.5 `app/src/profile/schema.js`
...

### 3.6 `backend_py/prompts/match.txt` and `backend_py/routes/match.py`
...

### 3.7 `app/src/screens/BrowserScreen.jsx`
...

## 4. New matching priority (explicit)
Document the final precedence rule, e.g.:

  1. `autocomplete` token (highest, deterministic)
  2. semantic `type` (email/tel/url/date)
  3. AI mapping with confidence ≥ THRESHOLD
  4. Regex on label/name/placeholder/aria/nearbyText
  5. AI mapping with confidence < THRESHOLD (lowest)

(Adjust based on what the user wants — they have stated AI > regex; honour
that for tiers 3 vs 4 unless `autocomplete`/`type` give certainty.)

## 5. Implementation order
Numbered list, smallest-risk first. Each step should be independently
shippable and testable in the in-app browser.

## 6. Acceptance criteria
Concrete checks the user can run, e.g.:
- "On https://jobs.lever.co/<co>/<job>, all of name/email/phone/linkedIn
  are filled on a single tap."
- "On a Workday job posting (Shadow DOM), at least name + email + phone
  are filled."
- "yearsExperience = 0 fills the field instead of being skipped."

## 7. Risks & open questions
- Risks (perf, breakage, prompt-cost, etc.)
- Open questions for the user before coding starts.
```

## Constraints

- **Do not write or edit code** while in this skill. Output the plan only.
- Honour the user's stated priority: **AI takes priority over regex**. The
  plan may introduce `autocomplete`/`type` as deterministic signals above
  AI only because they are not heuristic — they are the page declaring its
  own field semantics. Call this out explicitly and let the user confirm.
- Keep the on-device path working when the backend is unreachable. Regex
  + `autocomplete`/`type` must still produce a useful fill without the
  network.
- Do not regress WebView performance: scanner must remain
  fire-and-forget, observer-driven, and bounded in DOM walks.
- Preserve the existing message contract (`FIELDS_SCANNED`,
  `FILL_COMPLETE`, `AI_FILL_COMPLETE`).

## Anti-patterns to avoid in the plan

- "Rewrite the matcher" — too vague. Always cite the file and the
  specific behaviour that changes.
- Adding a new profile key without also updating `EMPTY_PROFILE`,
  `PROFILE_FIELD_LABELS`, the regex rules, and `match.txt`.
- Suggesting a new ML model or library before exhausting deterministic
  signals (`autocomplete`, `type`, HTML5 patterns).
- Silent fallbacks — every override path (AI > regex, autocomplete > AI,
  etc.) must be observable in `fillStats` so the user can see why a field
  was filled the way it was.
