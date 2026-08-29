# Complete Autofill — carried into Part 2

Findings raised during Part 1's task reviews and final whole-branch review that
were deliberately deferred rather than fixed. Each was verified; none is a
guess. Part 2 (the review sheet) should triage these before building on
`fillOutcomes`.

## Known limitations in shipped behaviour

**Unchecking a standalone checkbox is never learned.** The correction listener
returns early on `!el.checked`. Verified inert rather than merely acceptable:
`fillOne` has no checkbox branch, so a standalone checkbox is never *checked* by
autofill in the first place — there is no autofilled state for a user to undo.
`clickCheckable` can set `.checked = false` but is only reachable from
`buildFillScript`'s group path, not correction replay. Fixing this properly
means changing correction storage and replay semantics. Documented in
`app/src/webview/filler.js`.

**`PLACEHOLDER_RE` treats "none", "-" and "—" as never-selectable.** A profile
value of "None" therefore falls through to `/select-option`, which picks it
correctly — the cost is one LLM round trip, not a wrong fill. The sharp edge:
sensitive keys have no AI fallback by design, so a "None" answer on an EEO
field would be left blank. None of the offered EEO answers is "None", so this
is currently unreachable.

**`veteranStatus`'s affirmative value does not match Greenhouse.**
`ApplicationDetailsScreen` stores `"I am a protected veteran"`; Greenhouse's
option reads `"I identify as one or more of the classifications of a protected
veteran"`. Local matching misses, and sensitive keys are excluded from the AI
resolver, so the field is left blank. `gender`, `hispanicLatino` and
`disabilityStatus` all match. A "protected veteran" keyword rule in
`scoreOption` would close it.

**`heardAboutUs` is a dead key.** Added to the schema and Profile editor, but
nothing writes it. The learning loop stores answers in `fieldCorrections` keyed
by fingerprint, not into the profile, so the spec's "learned" mechanism does not
populate it.

**New keys are missing from `SINGLETON_KEYS`** (`app/src/matcher/index.js`).
`gender` is a singleton, but `hispanicLatino`, `veteranStatus`,
`disabilityStatus`, `authorizedToWork` and `requiresSponsorship` are not, so
they are exempt from dedupe and two fields can claim the same key.

**The per-host mapping cache persists old mappings for 30 days.** The C1
heuristics fix will not reach already-visited sites without a cache version
bump.

## In-page state that outlives a scan

**`window.__AF_FILLED_IDS__` and `__AF_CORRECTION_LISTENER__` are never cleared**
on an SPA route change or in `manualRescan`, and `af-id`s are reassigned
`af_1..af_N` on every fresh scan. A stale id can therefore suppress a later
genuine correction. Strictly a false negative (lost learning), never a false
positive.

**`fillOne` and `clickCheckable` stamp on entry**, before knowing the fill
succeeded, so a failed fill still suppresses a genuine edit for 5s.

**A run in flight when the page navigates** keeps injecting the previous page's
mapping under reused af-ids. Pre-existing; the re-entrancy queue does not worsen
it.

## Untested paths

- `ProfileScreen` → `ApplicationDetails` navigation wiring. The data half is
  tested; the routing was verified by reading only (no MMKV or
  NavigationContainer mocks exist in this repo).
- `setFillOutcomes({})` resets — React state in a screen with no render
  harness. `fillOutcomes` is write-only until Part 2 consumes it.
- **The open-read-click path against a real React-Select.** Task 8, the manual
  device pass, was skipped. The spec calls this the riskiest part of the design.
  The listbox-attribution fix and the shadow-DOM/iframe traversal have only been
  exercised against a hand-rolled fake DOM.

## Smaller items

- `filledCount` double-counts across fill passes; `fillOutcomes` now makes an
  exact count available via
  `Object.values(fillOutcomes).filter(o => o === 'filled').length`.
- `formScanner.js`'s `INPUT_SELECTOR` includes `[role="listbox"]`, so menus the
  harvest opens are briefly picked up as new fields. Cosmetic noise;
  `filledUrlsRef` prevents an autofill loop.
- Onboarding choice pills are ~35px tall, below the 44pt guideline — consistent
  with the app's existing `Btn size="sm"`.
- "Skip for now" and "Done" both write the decline value into all four EEO keys.
  Defensible as the privacy-preserving default, but "Skip" writing data is
  surprising.
- Text inputs fire both `blur` and `change`, posting a duplicate
  `USER_INPUT_DETECTED`. Harmless — `mergeFieldCorrections` is idempotent.
- `<select multiple>` reads only `options[selectedIndex]`.
- `selectOptions` has no internal guard against sensitive keys; the privacy
  invariant rests entirely on its single caller filtering them. A defensive
  filter inside it would make a future second caller fail safe.
