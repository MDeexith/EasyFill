# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**EasyFill** — React Native mobile app + Python FastAPI backend that auto-fills job application forms. Core USP: user uploads resume once → app auto-detects form fields in any job application WebView → matches fields to profile → fills them. Also includes a multi-source job discovery feed.

## Commands

### Mobile App (`/app`)
```bash
npm start              # Metro bundler
npm run android        # Run on Android device/emulator
npm run ios            # Run on iOS simulator
npm run lint           # ESLint
npm test               # Jest
```
Node >= 22.11.0 required.

### Backend (`/backend_py`)
```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 3001   # Dev server
```

**Required env var:** `OPENROUTER_API_KEY` in `.env`

### Docker
```bash
docker build -t easyfill-backend .
docker run -p 3001:3001 -e OPENROUTER_API_KEY=<key> easyfill-backend
```

## Architecture

### End-to-End Autofill Flow
1. User opens job URL → `BrowserScreen` renders `WebView`
2. `formScanner.js` injected on page load — traverses DOM (+ shadow DOM + same-origin iframes), assigns stable `data-af-id="af_N"` to each field, posts `FORM_DETECTED` to RN
3. `matchFieldsToProfile()` in `app/src/matcher/index.js`:
   - Check MMKV cache (hostname-keyed, 30-day TTL)
   - Run regex heuristics (`heuristics.js`)
   - If cache miss & LLM enabled → POST `/match` to backend (OpenRouter)
   - Merge with confidence: autocomplete attr (1.0) > field type (0.95) > AI ≥0.6 > regex > AI <0.6
   - Deduplicate: one profile key → highest-confidence field wins
4. `buildFillScript(mapping, profileJson)` in `app/src/webview/filler.js` — fires React/Vue/Angular-compatible events to set values natively, highlights filled fields green
5. `buildCorrectionListenerScript()` — tracks user overrides on blur, sends back `USER_INPUT_DETECTED`; corrections saved via `mergeFieldCorrections()` and reused

### Key Files

| File | Role |
|------|------|
| `app/src/webview/formScanner.js` | DOM field detection, shadow DOM + iframe crawling |
| `app/src/webview/filler.js` | Fill script builders; `setNativeInput` handles React/Vue/Angular fiber hacks |
| `app/src/matcher/index.js` | Heuristics + LLM merge with confidence scoring |
| `app/src/matcher/heuristics.js` | Regex patterns for field name/label/placeholder → profile key |
| `app/src/profile/store.js` | All MMKV persistence: profile, history, feed cache, mapping cache, corrections |
| `app/src/profile/schema.js` | Canonical profile shape (all fillable keys) |
| `app/src/api/backend.js` | `matchFields()`, `generateText()`, `parseResume()` HTTP calls; default URL configurable from Settings |
| `app/src/screens/BrowserScreen.jsx` | WebView orchestration: inject scripts, handle messages, autofill lifecycle |
| `backend_py/routes/match.py` | LLM field matching via `prompts/match.txt` |
| `backend_py/routes/jobs.py` | Job feed: JobSpy + Jobicy + Remotive + Greenhouse in parallel; layered cache |
| `backend_py/openrouter.py` | `generate(prompt)` async wrapper; used by match, generate, parse_resume |

### Profile Storage (MMKV)
- `saveProfile` / `loadProfile` — flat object matching `schema.js`
- `getCachedMapping(hostname)` / `saveMappingCacheEntry(hostname, mapping)` — per-site field mapping cache
- `loadFieldCorrections()` / `mergeFieldCorrections()` — user override memory
- `addHistoryEntry()` / `updateHistoryEntry()` — application tracking

### Backend Routes
| Endpoint | Purpose |
|----------|---------|
| `POST /match` | LLM field-to-profile mapping |
| `POST /generate` | Generate freeform answer (cover letter, etc.) |
| `POST /parse-resume` | PDF → profile (pdfplumber + LLM + regex, parallel merge) |
| `GET /jobs/feed` | Aggregated job listings (paginated, 50/page) |

`/jobs/feed` params: `search`, `category`, `location`, `country` (`in`/`us`/`gb`/`au`/`global`), `page`, `is_remote`, `job_type`

### Job Feed
4 sources queried in parallel: **JobSpy** (Indeed, LinkedIn, Naukri, Google, Glassdoor — 3h cache), **Jobicy** (15m), **Remotive** (15m), **Greenhouse** (25 curated companies + custom — 15m per company). All results merged, deduped by ID prefix, sorted by date.

### Design System
All UI uses tokens from `app/src/theme/tokens.js`. Reusable primitives in `app/src/components/ui.jsx` (`Btn`, `Card`, `T`, `Eyebrow`, `IconBtn`, `Input`). Icons in `app/src/components/Icon.jsx` (SVG, Lucide-style).

### Navigation
Bottom tabs: Home → Discover (JobFeedScreen) → Profile → Settings. `BrowserScreen` is a modal stack navigator pushed from job cards. Onboarding gate: Upload → Confirm → Main (checked via `isOnboarded()` in MMKV).
