# Job Feed Endpoint — How It Works

`GET /jobs/feed`

---

## Sources

Every request fetches from **three types of sources in parallel**:

### 1. JobSpy (scraper)
Scrapes live job boards via the JobSpy library. Each platform runs as a separate task.

**India (`country=in`):** Indeed, LinkedIn, Naukri, Google, Glassdoor  
**Global (`country=us/gb/...`):** Indeed, LinkedIn, ZipRecruiter, Google

JobSpy is synchronous (blocking), so each platform runs in a **thread pool executor** to avoid blocking the async event loop.

**Cache:** Results are cached per `(platform + search + location)` for **3 hours**. First request for a new query is slow (10–20s per platform). Subsequent requests within 3h are instant.

---

### 2. Jobicy
Free remote jobs REST API. Called on every request with the search keyword as a tag filter.

**Cache:** 15 minutes.

---

### 3. Remotive
Free remote jobs REST API. Called on every request with search + category filter.

**Cache:** 15 minutes.

---

### 4. Greenhouse (opt-in per request)
Fetches jobs from the public Greenhouse job board API for up to 15 curated companies (Stripe, Figma, Notion, etc.) plus any custom companies added via `POST /jobs/companies`.

Called with `?content=true` to get department and office location data.

**Cache:** 15 minutes per company board.

---

## Request Flow

```
GET /jobs/feed?search=android&location=Bangalore&country=in&page=1
```

```
Step 1 — Build task list
│
├── fetch_jobspy_platform("indeed",     search, location)  ─┐
├── fetch_jobspy_platform("linkedin",   search, location)   │  all run
├── fetch_jobspy_platform("naukri",     search, location)   │  in parallel
├── fetch_jobspy_platform("google",     search, location)   │  via
├── fetch_jobspy_platform("glassdoor",  search, location)  ─┘  asyncio.gather
│
├── fetch_jobicy_jobs(search)
├── fetch_remotive_jobs(search, category)
└── fetch_greenhouse_jobs(company) × 15 companies

Step 2 — asyncio.gather(*tasks)
         All tasks fire simultaneously. Each checks its own cache first.
         Cache hit → returns instantly.
         Cache miss → fetches live (JobSpy takes 10–20s, REST APIs ~1s).

Step 3 — Merge
         Flatten all returned job lists into one list.

Step 4 — Filter (if search or category provided)
         Search: keeps jobs where title/company/department/location contains the keyword.
         Category: keeps jobs matching Engineering/Design/Product/etc.

Step 5 — Sort
         Sort all jobs by postedDate descending (newest first).
         Jobs with no date sink to the bottom.

Step 6 — Paginate
         10 jobs per page.
         page=1 → jobs[0:10], page=2 → jobs[10:20], etc.

Step 7 — Return
         { jobs, total, page, perPage, hasMore }
```

---

## Caching Behaviour

| Source | Cache Key | TTL |
|---|---|---|
| JobSpy | `spy_{platform}_{search}_{location}` | 3 hours |
| Jobicy | `jobicy_{search}_{count}` | 15 min |
| Remotive | `remotive_{search}_{category}` | 15 min |
| Greenhouse | `gh_{board_token}` | 15 min |

- **Warm cache:** response is near-instant regardless of source
- **Cold cache (JobSpy):** first request for a query takes 10–20s total (all 5 platforms run in parallel, not sequentially)
- Use `POST /jobs/refresh` to clear JobSpy cache and force a re-scrape
- Use `GET /jobs/cache/status` to inspect what is currently cached

---

## Query Parameters

| Param | Default | Description |
|---|---|---|
| `search` | `""` | Keyword — matched against title, company, department, location |
| `category` | `""` | `Engineering`, `Design`, `Product`, `Marketing`, `Sales`, `Data`, `Support`, `Operations` |
| `page` | `1` | Page number (10 jobs per page) |
| `location` | `""` | Location string passed to JobSpy e.g. `Bangalore`, `Mumbai` |
| `country` | `"in"` | `in` = India (default), `us`, `gb`, `au` |
| `is_remote` | `false` | Filter for remote jobs (JobSpy only) |
| `job_type` | `null` | `fulltime`, `parttime`, `internship`, `contract` (JobSpy only) |
| `experience` | `null` | Years of experience — accepted but not yet applied (reserved for future use) |
