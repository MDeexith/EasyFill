# EasyFill

Upload your résumé once. EasyFill fills in every job application after that.

Open a job posting in the app's browser, tap autofill, and it detects the form's
fields, works out which of your details each one wants, and types them in —
including the dropdowns and checkboxes that most autofill tools skip. It learns
from any answer you correct, so it gets better at each site you apply to.

Available on Google Play: **[EasyFill](https://play.google.com/store/apps/details?id=easyfill.app)**

---

## What's in the repo

| Directory | What it is |
|---|---|
| `app/` | The React Native mobile app (Android + iOS) |
| `backend_py/` | FastAPI backend — LLM field matching, résumé parsing, job feed |
| `extension/` | A Chrome MV3 extension sharing the same approach (separate from the app) |
| `docs/` | Design specs and implementation plans |

---

## Running it

### Mobile app

Node >= 22.11.0 required.

```bash
cd app
npm install
npm start            # Metro bundler
npm run android      # or: npm run ios
npm test             # Jest
npm run lint         # ESLint
```

The app talks to the hosted backend at `easyfill.onrender.com`, set as
`BASE_URL` in `app/src/api/backend.js`. There is a `setBackendUrl()` export for
pointing it elsewhere, but nothing currently calls it — change the constant to
develop against a local backend.

### Backend

```bash
cd backend_py
pip install -r requirements.txt
uvicorn main:app --reload --port 3001
```

Required: `OPENROUTER_API_KEY` in a `.env` file.

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | **Required.** OpenRouter API key |
| `OPENROUTER_FREE_MODELS` | Comma-separated model ids, max 3. Overrides the defaults so a delisted free model is a config change, not a deploy |
| `OPENROUTER_BASE_URL` | Point the OpenAI-compatible client elsewhere |
| `FASTROUTER_API_KEY` | Optional paid fallback, used when the free models are rate-limited, delisted, or time out |
| `FASTROUTER_MODEL` | Defaults to `openai/gpt-5.4-nano` |
| `PORT` | Server port |

Free OpenRouter models get delisted without notice and routinely take 50–60s on
long prompts. Setting `FASTROUTER_API_KEY` is what keeps parsing fast and
reliable — without it, a slow or missing free model degrades the app to
regex-only extraction.

### Docker

```bash
cd backend_py
docker build -t easyfill-backend .
docker run -p 3001:3001 -e OPENROUTER_API_KEY=<key> easyfill-backend
```

---

## How autofill works

1. **Open a job URL.** `BrowserScreen` loads it in a `WebView`.
2. **Scan.** `formScanner.js` is injected on load. It walks the DOM — including
   shadow DOM and same-origin iframes — stamps every field with a stable
   `data-af-id`, and posts the list back to React Native.
3. **Match fields to your profile.** Per-site cache first, then regex
   heuristics, then the LLM for anything left. Results merge by confidence:
   an `autocomplete` attribute beats a field type, which beats a high-confidence
   AI guess, which beats regex. One profile key can only win one field.
4. **Fill.** `filler.js` sets values the way React, Vue and Angular expect, so
   the page's own state actually updates. Filled fields flash green.
5. **Resolve dropdowns.** React-Select style comboboxes don't put their options
   in the DOM until opened, so EasyFill opens each one, reads the real options,
   and matches locally — `USA` → "United States", `1.7` → "1–3 years". Only what
   local matching can't resolve goes to the LLM.
6. **Learn.** Anything you correct is remembered by field fingerprint and
   replayed on the next application, at any site.

What it deliberately does **not** do: attach your résumé file (browsers forbid
setting a file input from JavaScript) or submit the application. You review and
send.

### Privacy

Your profile lives on the device in MMKV. Equal-opportunity answers (gender,
ethnicity, veteran and disability status) and date of birth are **never sent to
the backend** — the field-matching request carries those key *names* so the
model can recognise the question, with the values blanked. Dropdown resolution
skips them entirely rather than sending a value. Filling happens on-device with
your real answers.

EEO questions default to "Decline to self-identify" unless you opt in.

---

## Key files

| File | Role |
|---|---|
| `app/src/webview/formScanner.js` | Field detection; shadow DOM + iframe crawling |
| `app/src/webview/filler.js` | Fill scripts; framework-compatible value setting |
| `app/src/webview/harvestCoordinator.js` | Tracks in-flight option harvests so concurrent runs can't corrupt each other |
| `app/src/matcher/index.js` | Heuristics + LLM merge, confidence scoring, dedupe |
| `app/src/matcher/heuristics.js` | Regex patterns mapping field text → profile key |
| `app/src/matcher/optionResolver.js` | Dropdown option matching — buckets, aliases, yes/no |
| `app/src/profile/schema.js` | Canonical profile shape and schema migration |
| `app/src/profile/store.js` | All MMKV persistence |
| `app/src/api/backend.js` | HTTP layer, and the redaction chokepoint |
| `app/src/screens/BrowserScreen.jsx` | WebView orchestration and the autofill sequence |
| `backend_py/openrouter.py` | LLM calls with model fallback |
| `backend_py/routes/` | The five API routes |

---

## API

| Endpoint | Purpose |
|---|---|
| `POST /match` | Map detected form fields to profile keys |
| `POST /parse-resume` | PDF → structured profile (pdfplumber + LLM + regex, merged) |
| `POST /generate` | Draft a freeform answer (cover letter, "why this company") |
| `POST /select-option` | Choose which dropdown option matches a value |
| `GET /jobs/feed` | Aggregated job listings |

`/jobs/feed` accepts `search`, `category`, `location`, `country`
(`in`/`us`/`gb`/`global`), `page`, `is_remote`, `job_type`. It queries JobSpy
(Indeed, LinkedIn, Naukri, Google, Glassdoor), Jobicy, Remotive and 30 curated
Greenhouse boards in parallel, then merges, dedupes and sorts by date. JobSpy
results cache for 3 hours, the rest for 15 minutes.

---

## Testing

```bash
cd app && npm test
```

The WebView scripts are built as strings and run inside the page, so several
suites execute them against a hand-rolled fake DOM via `new Function` rather
than asserting on the script text. `jest-environment-jsdom` isn't available in
this project's environment, and text assertions have previously hidden real
defects — a change that broke every generated script passed a full green suite
because nothing executed one.

Anything involving a real React-Select popup can only be verified on a device.
