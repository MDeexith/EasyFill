# EasyFill Python Backend — API Reference

Base URL: `http://localhost:3001`

---

## 1. Health Check

### `GET /health`

Verify the server is running.

**Request params:** none

**Response:**
```json
{ "status": "ok" }
```

---

## 2. Match Fields → Profile

### `POST /match/`

Given a list of HTML form fields and a user profile, returns a mapping of each field ID to the matching profile key. Used by the Android app to know what value to fill into each form field.

**Headers:**
```
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `fields` | `array` | ✅ | List of form field descriptors |
| `fields[].id` | `string` | ✅ | Unique field identifier |
| `fields[].name` | `string` | ❌ | HTML `name` attribute |
| `fields[].type` | `string` | ❌ | Input type (`text`, `email`, `tel`, etc.) |
| `fields[].label` | `string` | ❌ | Visible label text |
| `fields[].placeholder` | `string` | ❌ | Placeholder text |
| `fields[].ariaLabel` | `string` | ❌ | ARIA label |
| `fields[].nearbyText` | `string` | ❌ | Text near the field on the page |
| `profile` | `object` | ✅ | Key-value map of the user's profile data |

**Sample request:**
```json
{
  "fields": [
    { "id": "inp_1", "name": "email", "label": "Email address", "type": "email" },
    { "id": "inp_2", "name": "fname", "label": "First Name", "type": "text" },
    { "id": "inp_3", "name": "lname", "label": "Last Name", "type": "text" },
    { "id": "inp_4", "label": "Phone Number", "type": "tel" },
    { "id": "inp_5", "label": "LinkedIn Profile URL", "type": "url" }
  ],
  "profile": {
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane@example.com",
    "phone": "+91-98765-43210",
    "linkedIn": "https://linkedin.com/in/janedoe",
    "city": "Bangalore",
    "state": "Karnataka"
  }
}
```

**Response:**

| Field | Type | Description |
|---|---|---|
| `mapping` | `object` | Maps each field `id` to a profile key, or `null` if no match |

```json
{
  "mapping": {
    "inp_1": "email",
    "inp_2": "firstName",
    "inp_3": "lastName",
    "inp_4": "phone",
    "inp_5": "linkedIn"
  }
}
```

**Error responses:**

| Status | Body | Reason |
|---|---|---|
| `400` | `{ "error": {...} }` | Invalid request body |
| `500` | `{ "error": "LLM call failed" }` | OpenRouter unreachable or model error |

---

## 3. Parse Resume

### `POST /parse-resume/`

Upload a resume (PDF or image). Returns structured profile data extracted by the LLM.

**Headers:**
```
Content-Type: multipart/form-data
```

**Request body (form-data):**

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | `file` | ✅ | Resume file — PDF or image (PNG/JPG) |

**Sample request (curl):**
```bash
curl -X POST http://localhost:3001/parse-resume/ \
  -F "file=@/path/to/resume.pdf"
```

**Response:**

| Field | Type | Description |
|---|---|---|
| `profile` | `object` | Extracted profile data |
| `profile.firstName` | `string` | First name |
| `profile.lastName` | `string` | Last name |
| `profile.name` | `string` | Full name |
| `profile.email` | `string` | Email address |
| `profile.phone` | `string` | Phone number |
| `profile.address` | `string` | Street address |
| `profile.city` | `string` | City |
| `profile.state` | `string` | State |
| `profile.zipCode` | `string` | ZIP / PIN code |
| `profile.country` | `string` | Country |
| `profile.linkedIn` | `string` | LinkedIn URL |
| `profile.portfolio` | `string` | Portfolio URL |
| `profile.github` | `string` | GitHub URL |
| `profile.currentTitle` | `string` | Current job title |
| `profile.currentCompany` | `string` | Current employer |
| `profile.yearsExperience` | `number` | Estimated total years of experience |
| `profile.skills` | `string` | Comma-separated skills |
| `profile.experience` | `array` | Work history |
| `profile.experience[].company` | `string` | Company name |
| `profile.experience[].title` | `string` | Job title |
| `profile.experience[].startDate` | `string` | Start date |
| `profile.experience[].endDate` | `string` | End date |
| `profile.experience[].description` | `string` | Role description |
| `profile.education` | `array` | Education history |
| `profile.education[].institution` | `string` | School/university name |
| `profile.education[].degree` | `string` | Degree type |
| `profile.education[].field` | `string` | Field of study |
| `profile.education[].graduationYear` | `string` | Graduation year |

```json
{
  "profile": {
    "firstName": "Jane",
    "lastName": "Doe",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+91-98765-43210",
    "city": "Bangalore",
    "state": "Karnataka",
    "country": "India",
    "linkedIn": "https://linkedin.com/in/janedoe",
    "github": "https://github.com/janedoe",
    "currentTitle": "Senior Software Engineer",
    "currentCompany": "Acme Corp",
    "yearsExperience": 6,
    "skills": "Python, TypeScript, React, PostgreSQL, AWS",
    "experience": [
      {
        "company": "Acme Corp",
        "title": "Senior Software Engineer",
        "startDate": "2021-06",
        "endDate": "Present",
        "description": "Led backend services for payments platform."
      }
    ],
    "education": [
      {
        "institution": "IIT Bombay",
        "degree": "B.Tech",
        "field": "Computer Science",
        "graduationYear": "2018"
      }
    ]
  }
}
```

**Error responses:**

| Status | Body | Reason |
|---|---|---|
| `400` | `{ "error": "No file uploaded" }` | No file attached |
| `500` | `{ "error": "Resume parsing failed" }` | LLM error or malformed response |

---

## 4. Generate Form Answer

### `POST /generate/`

Given a user's profile and context about a form field, generates a tailored first-person answer. Used for open-ended fields like cover letters, "Why do you want to work here?", etc.

**Headers:**
```
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `profile` | `object` | ✅ | User's profile key-value map |
| `label` | `string` | ❌ | Form field label text |
| `placeholder` | `string` | ❌ | Field placeholder text |
| `nearby` | `string` | ❌ | Text near the field on the page for context |
| `host` | `string` | ❌ | Company name or website domain |

**Sample request:**
```json
{
  "profile": {
    "firstName": "Jane",
    "currentTitle": "Senior Software Engineer",
    "currentCompany": "Acme Corp",
    "yearsExperience": 6,
    "skills": "Python, TypeScript, React, PostgreSQL, AWS"
  },
  "label": "Cover Letter",
  "placeholder": "Tell us why you want to work here...",
  "nearby": "Why are you a good fit for this role?",
  "host": "stripe.com"
}
```

**Response:**

| Field | Type | Description |
|---|---|---|
| `text` | `string` | Generated answer — plain text, no markdown, no quotes |

```json
{
  "text": "I've spent six years building backend systems at Acme Corp, primarily in Python and TypeScript, with a focus on payments infrastructure. Stripe's work on financial APIs sits at exactly the intersection of reliability engineering and developer experience that I've been obsessed with. I'd bring both deep backend experience and a strong sense for what makes an API intuitive to use."
}
```

**Error responses:**

| Status | Body | Reason |
|---|---|---|
| `400` | `{ "error": {...} }` | Invalid request body |
| `500` | `{ "error": "LLM call failed" }` | OpenRouter unreachable or model error |

---

## 5. Job Feed

### `GET /jobs/feed`

Returns aggregated job listings from multiple sources. JobSpy results (Indeed, LinkedIn, Naukri, Google) are cached for 3 hours per unique query — first request is slow (live scrape), subsequent requests within 3h are instant.

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `search` | `string` | `""` | Keyword filter — matches against title, company, department, location |
| `category` | `string` | `""` | Role category filter: `Engineering`, `Design`, `Product`, `Marketing`, `Sales`, `Operations`, `Data`, `Support` |
| `page` | `integer` | `1` | Page number (50 jobs per page) |
| `location` | `string` | `""` | Location string passed to JobSpy (e.g. `"Bangalore"`, `"Mumbai"`) |
| `country` | `string` | `"in"` | `"in"` = India (default), `"us"`, `"gb"`, `"au"`, `"global"` |
| `is_remote` | `boolean` | `false` | Filter for remote jobs only |
| `job_type` | `string` | `null` | `fulltime`, `parttime`, `internship`, `contract` |

**Sample requests:**
```
GET /jobs/feed
GET /jobs/feed?search=android+developer&location=Bangalore
GET /jobs/feed?category=Engineering&country=in&page=2
GET /jobs/feed?search=frontend&is_remote=true&job_type=fulltime
GET /jobs/feed?country=us&search=data+scientist&location=New+York
GET /jobs/feed?search=backend
```

**Response:**

| Field | Type | Description |
|---|---|---|
| `jobs` | `array` | Paginated list of job objects (max 50) |
| `total` | `integer` | Total matched jobs across all sources |
| `page` | `integer` | Current page |
| `perPage` | `integer` | Items per page (always 10) |
| `hasMore` | `boolean` | Whether more pages exist |

**Job object:**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique job ID (prefixed by source: `spy_`, `jobicy_`, `gh_`, etc.) |
| `title` | `string` | Job title |
| `company` | `string` | Company name |
| `department` | `string` | Department or function |
| `category` | `string` | Auto-categorized role: `Engineering`, `Design`, `Product`, etc. |
| `location` | `string` | City, state, country or `"Remote"` |
| `applyUrl` | `string` | Direct link to apply |
| `postedDate` | `string\|null` | ISO 8601 date string or null |
| `source` | `string` | Source platform: `indeed`, `linkedin`, `naukri`, `google`, `jobicy`, etc. |
| `sourceLabel` | `string` | Human-readable source name |
| `isRemote` | `boolean` | Remote flag (JobSpy sources only) |
| `jobType` | `string` | `fulltime`, `parttime`, `internship`, `contract` (JobSpy sources only) |
| `salary` | `string\|null` | Salary range string e.g. `"$80,000 - $120,000"` (JobSpy sources only) |
| `currency` | `string` | Currency code e.g. `"INR"`, `"USD"` (JobSpy sources only) |
| `description` | `string` | Full job description (JobSpy sources only) |

```json
{
  "jobs": [
    {
      "id": "spy_indeed_4829103847261",
      "title": "Senior Android Developer",
      "company": "Swiggy",
      "department": "Engineering",
      "category": "Engineering",
      "location": "Bangalore, Karnataka, India",
      "applyUrl": "https://www.indeed.com/viewjob?jk=abc123",
      "postedDate": "2026-05-02",
      "source": "indeed",
      "sourceLabel": "Indeed",
      "isRemote": false,
      "jobType": "fulltime",
      "salary": null,
      "currency": "INR",
      "description": "We are looking for a Senior Android Developer..."
    },
  ],
  "total": 143,
  "page": 1,
  "perPage": 10,
  "hasMore": true
}
```

---

## 6. Cache Status

### `GET /jobs/cache/status`

Shows all currently cached job sources, how many jobs are stored, how old the cache is, and when it expires. Useful for debugging and verifying cache behaviour.

**Request params:** none

**Sample response:**
```json
{
  "total_cached_jobs": 187,
  "sources": {
    "spy_indeed__india": {
      "count": 50,
      "age_minutes": 14.2,
      "expires_in_minutes": 165.8
    },
    "spy_linkedin__india": {
      "count": 42,
      "age_minutes": 14.3,
      "expires_in_minutes": 165.7
    },
    "spy_naukri__india": {
      "count": 48,
      "age_minutes": 14.5,
      "expires_in_minutes": 165.5
    },
  }
}
```

---

## 7. Clear Cache (Force Refresh)

### `POST /jobs/refresh`

Clears all JobSpy cache entries. The next `/jobs/feed` request will re-scrape live. Use this during testing when you want fresh data immediately.

**Request params:** none

**Sample response:**
```json
{
  "ok": true,
  "cleared": 4,
  "message": "JobSpy cache cleared. Next /jobs/feed will re-scrape."
}
```

---

## 8. List Tracked Companies

### `GET /jobs/companies`

Returns the full list of companies tracked on the Greenhouse board.

**Request params:** none

**Sample response:**
```json
{
  "greenhouse": ["figma", "stripe", "notion", "cloudflare", "..."]
}
```

---

## 9. Add Custom Company

### `POST /jobs/companies`

Add a custom company to track on Greenhouse. Persists in memory until server restart.

**Headers:**
```
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `handle` | `string` | ✅ | Company board handle/slug |
| `platform` | `string` | ✅ | `"greenhouse"` |

**Sample request:**
```json
{
  "handle": "airbnb",
  "platform": "greenhouse"
}
```

**Response:**
```json
{ "ok": true }
```

**Error response:**
```json
{ "error": "platform must be 'greenhouse'" }
```

---

## Cache TTLs

| Source | TTL | Notes |
|---|---|---|
| JobSpy (Indeed, LinkedIn, Naukri, Google, Glassdoor) | **3 hours** | Query-based — populated on first request |
| Jobicy | **15 minutes** | Fast REST API |
| Greenhouse | **15 minutes** | Per company board |

| Remotive | **15 minutes** | Per search+category combo |

---

## 10. Source Test Routes

Individual routes to test each non-JobSpy job source in isolation. Each returns the raw job list from that source plus a count.

### `GET /jobs/sources/jobicy`

| Param | Type | Default | Description |
|---|---|---|---|
| `search` | `string` | `""` | Tag/keyword filter |
| `count` | `integer` | `50` | Number of results |

```
GET /jobs/sources/jobicy?search=python&count=20
```

---

### `GET /jobs/sources/greenhouse`

| Param | Type | Required | Description |
|---|---|---|---|
| `company` | `string` | ✅ | Greenhouse board token e.g. `stripe`, `figma` |

```
GET /jobs/sources/greenhouse?company=stripe
```

---

### `GET /jobs/sources/remotive`

| Param | Type | Default | Description |
|---|---|---|---|
| `search` | `string` | `""` | Keyword search |
| `category` | `string` | `""` | `Engineering`, `Design`, `Product`, `Marketing`, `Sales`, `Data`, `Support`, `Operations` |

```
GET /jobs/sources/remotive?category=Engineering&search=backend
```

**All source routes return:**
```json
{
  "source": "jobicy",
  "count": 42,
  "jobs": [ ... ]
}
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API key for LLM endpoints |

| `PORT` | ❌ | Server port (default: `3001`) |
