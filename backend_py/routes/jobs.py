import re
import time
import asyncio
import random
import string
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

# ── Curated company lists ──────────────────────────────────────────────
GREENHOUSE_COMPANIES = [
    'figma', 'stripe', 'notion', 'cloudflare', 'airtable',
    'databricks', 'discord', 'duolingo', 'gusto', 'hashicorp',
    'ironclad', 'lattice', 'linear', 'loom', 'miro',
    'plaid', 'ramp', 'retool', 'rippling', 'scale',
    'snyk', 'sourcegraph', 'supabase', 'vercel', 'watershed',
    'webflow', 'doordash', 'brex', 'dbt-labs', 'anduril',
]

LEVER_COMPANIES = [
    'netflix', 'twitch', 'lever', 'postman', 'netlify',
    'samsara', 'verkada', 'anthropic', 'wiz-inc', 'lucidmotors',
    'navan', 'podium', 'earnin', 'hightouch', 'weights-and-biases',
]

custom_companies: list[dict] = []

# ── Cache ──────────────────────────────────────────────────────────────
_cache: dict[str, dict] = {}
CACHE_TTL = 15 * 60  # 15 minutes


def get_cached(key: str):
    entry = _cache.get(key)
    if not entry:
        return None
    if time.time() - entry["ts"] > CACHE_TTL:
        del _cache[key]
        return None
    return entry["data"]


def set_cache(key: str, data: list):
    _cache[key] = {"data": data, "ts": time.time()}


# ── Role categorization ────────────────────────────────────────────────
def categorize_role(title: str, dept: str) -> str:
    t = f"{title} {dept}".lower()
    if re.search(r'\b(engineer|developer|frontend|backend|fullstack|full-stack|devops|sre|infrastructure|platform|software|swe|mobile|ios|android|ml|machine learning|data engineer|cloud)\b', t):
        return 'Engineering'
    if re.search(r'\b(design|ux|ui|product design|graphic|visual|brand design|creative)\b', t):
        return 'Design'
    if re.search(r'\b(product manager|product lead|pm|product owner|product analyst)\b', t):
        return 'Product'
    if re.search(r'\b(market|growth|seo|content|social media|communications|pr|public relations|brand)\b', t):
        return 'Marketing'
    if re.search(r'\b(sales|account executive|business develop|bdr|sdr|revenue|partnerships)\b', t):
        return 'Sales'
    if re.search(r'\b(ops|operations|people|hr|human resources|recruiting|recruiter|talent|finance|accounting|legal|admin|office|facilities)\b', t):
        return 'Operations'
    if re.search(r'\b(data scien|analyst|analytics|bi |business intelligence|research)\b', t):
        return 'Data'
    if re.search(r'\b(support|success|customer|cx|helpdesk|technical support)\b', t):
        return 'Support'
    return 'Other'


def _rand_id(n: int = 8) -> str:
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=n))


# ── Fetchers ──────────────────────────────────────────────────────────

async def fetch_greenhouse_jobs(board_token: str) -> list:
    cache_key = f"gh_{board_token}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs")
            res.raise_for_status()
            data = res.json()

        jobs = []
        for j in data.get("jobs", []):
            dept = (j.get("departments") or [{}])[0].get("name", "")
            loc = j.get("location", {}).get("name", "")
            jobs.append({
                "id": f"gh_{board_token}_{j['id']}",
                "title": j.get("title", ""),
                "company": (j.get("company") or {}).get("name", board_token),
                "department": dept,
                "category": categorize_role(j.get("title", ""), dept),
                "location": loc,
                "applyUrl": j.get("absolute_url", f"https://boards.greenhouse.io/{board_token}/jobs/{j['id']}"),
                "postedDate": j.get("updated_at"),
                "source": "greenhouse",
                "sourceLabel": "Greenhouse",
            })
        set_cache(cache_key, jobs)
        return jobs
    except Exception:
        return []


async def fetch_lever_jobs(company_handle: str) -> list:
    cache_key = f"lv_{company_handle}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(f"https://api.lever.co/v0/postings/{company_handle}?mode=json")
            res.raise_for_status()
            postings = res.json()

        if not isinstance(postings, list):
            postings = []

        jobs = []
        for p in postings:
            cats = p.get("categories") or {}
            dept = cats.get("team") or cats.get("department") or ""
            loc = cats.get("location", "")
            commitment = cats.get("commitment", "")
            created_at = p.get("createdAt")
            posted = (
                datetime.fromtimestamp(created_at / 1000, tz=timezone.utc).isoformat()
                if created_at else None
            )
            jobs.append({
                "id": f"lv_{company_handle}_{p['id']}",
                "title": p.get("text", ""),
                "company": p.get("company", company_handle),
                "department": dept,
                "category": categorize_role(p.get("text", ""), dept),
                "location": f"{loc} · {commitment}" if commitment else loc,
                "applyUrl": p.get("hostedUrl") or p.get("applyUrl") or "",
                "postedDate": posted,
                "source": "lever",
                "sourceLabel": "Lever",
            })
        set_cache(cache_key, jobs)
        return jobs
    except Exception:
        return []


async def fetch_remotive_jobs(search: str = "", category: str = "") -> list:
    cache_key = f"remotive_{search}_{category}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    try:
        params: dict = {"limit": "100"}
        if search:
            params["search"] = search
        if category:
            cat_map = {
                "Engineering": "software-dev",
                "Design": "design",
                "Product": "product",
                "Marketing": "marketing",
                "Sales": "sales",
                "Data": "data",
                "Support": "customer-support",
                "Operations": "hr",
            }
            if category in cat_map:
                params["category"] = cat_map[category]

        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get("https://remotive.com/api/remote-jobs", params=params)
            res.raise_for_status()
            data = res.json()

        jobs = []
        for j in data.get("jobs", []):
            jobs.append({
                "id": f"rem_{j['id']}",
                "title": j.get("title", ""),
                "company": j.get("company_name", ""),
                "department": j.get("category", ""),
                "category": categorize_role(j.get("title", ""), j.get("category", "")),
                "location": j.get("candidate_required_location", "Remote"),
                "applyUrl": j.get("url", ""),
                "postedDate": j.get("publication_date"),
                "source": "remotive",
                "sourceLabel": "Remotive",
            })
        set_cache(cache_key, jobs)
        return jobs
    except Exception:
        return []


async def fetch_arbeitnow_jobs(page: int = 1) -> list:
    cache_key = f"arb_p{page}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get("https://www.arbeitnow.com/api/job-board-api", params={"page": page})
            res.raise_for_status()
            data = res.json()

        jobs = []
        for j in data.get("data", []):
            created = j.get("created_at")
            posted = (
                datetime.fromtimestamp(created, tz=timezone.utc).isoformat()
                if created else None
            )
            tags = j.get("tags") or []
            jobs.append({
                "id": f"arb_{j.get('slug') or j.get('url') or _rand_id()}",
                "title": j.get("title", ""),
                "company": j.get("company_name", ""),
                "department": ", ".join(tags),
                "category": categorize_role(j.get("title", ""), " ".join(tags)),
                "location": j.get("location") or ("Remote" if j.get("remote") else ""),
                "applyUrl": j.get("url", ""),
                "postedDate": posted,
                "source": "arbeitnow",
                "sourceLabel": "Arbeitnow",
            })
        set_cache(cache_key, jobs)
        return jobs
    except Exception:
        return []


def _parse_date(date_str: Optional[str]) -> float:
    if not date_str:
        return 0
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0


# ── Routes ─────────────────────────────────────────────────────────────

@router.get("/feed")
async def jobs_feed(
    search: str = Query(default=""),
    category: str = Query(default=""),
    page: int = Query(default=1),
    sources: str = Query(default=""),
):
    search = search.lower().strip()
    enabled_sources = (
        [s.strip().lower() for s in sources.split(",") if s.strip()]
        if sources else ["greenhouse", "lever", "remotive", "arbeitnow"]
    )

    tasks = []

    if "greenhouse" in enabled_sources:
        companies = (
            GREENHOUSE_COMPANIES[:15]
            + [c["handle"] for c in custom_companies if c["platform"] == "greenhouse"]
        )
        for co in companies:
            tasks.append(fetch_greenhouse_jobs(co))

    if "lever" in enabled_sources:
        companies = (
            LEVER_COMPANIES
            + [c["handle"] for c in custom_companies if c["platform"] == "lever"]
        )
        for co in companies:
            tasks.append(fetch_lever_jobs(co))

    if "remotive" in enabled_sources:
        tasks.append(fetch_remotive_jobs(search, category))

    if "arbeitnow" in enabled_sources:
        tasks.append(fetch_arbeitnow_jobs(page))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_jobs: list = []
    for r in results:
        if isinstance(r, list):
            all_jobs.extend(r)

    if search:
        all_jobs = [
            j for j in all_jobs
            if search in j["title"].lower()
            or search in j["company"].lower()
            or search in j["department"].lower()
            or search in j["location"].lower()
        ]

    if category and category != "All":
        all_jobs = [j for j in all_jobs if j["category"] == category]

    all_jobs.sort(key=lambda j: _parse_date(j["postedDate"]), reverse=True)

    per_page = 50
    start = (page - 1) * per_page
    paginated = all_jobs[start:start + per_page]

    return {
        "jobs": paginated,
        "total": len(all_jobs),
        "page": page,
        "perPage": per_page,
        "hasMore": start + per_page < len(all_jobs),
    }


@router.get("/companies")
def get_companies():
    return {
        "greenhouse": (
            GREENHOUSE_COMPANIES
            + [c["handle"] for c in custom_companies if c["platform"] == "greenhouse"]
        ),
        "lever": (
            LEVER_COMPANIES
            + [c["handle"] for c in custom_companies if c["platform"] == "lever"]
        ),
    }


class AddCompanyRequest(BaseModel):
    handle: str
    platform: str


@router.post("/companies")
def add_company(body: AddCompanyRequest):
    if body.platform not in ("greenhouse", "lever"):
        return JSONResponse(
            status_code=400,
            content={"error": "handle and platform (greenhouse|lever) are required"},
        )
    exists = any(
        c["handle"] == body.handle and c["platform"] == body.platform
        for c in custom_companies
    )
    if not exists:
        custom_companies.append({"handle": body.handle, "platform": body.platform})
    return {"ok": True}


# ── JobSpy scrape endpoint ─────────────────────────────────────────────

@router.get("/scrape")
async def scrape_jobs_endpoint(
    search_term: str = Query(default="software engineer"),
    location: str = Query(default=""),
    site_name: str = Query(default="indeed,linkedin,zip_recruiter,google"),
    results_wanted: int = Query(default=20),
    hours_old: int = Query(default=72),
    job_type: Optional[str] = Query(default=None),
    is_remote: bool = Query(default=False),
    country_indeed: str = Query(default="USA"),
    google_search_term: str = Query(default=""),
    page: int = Query(default=1),
):
    """
    Scrape jobs from LinkedIn, Indeed, ZipRecruiter, Google, Glassdoor, etc.
    using the JobSpy library. Returns the same shape as /jobs/feed.
    """
    try:
        from jobspy import scrape_jobs
        import pandas as pd

        sites = [s.strip() for s in site_name.split(",") if s.strip()]

        kwargs: dict = {
            "site_name": sites,
            "search_term": search_term,
            "results_wanted": results_wanted,
            "hours_old": hours_old,
            "country_indeed": country_indeed,
            "verbose": 0,
        }
        if location:
            kwargs["location"] = location
        if job_type:
            kwargs["job_type"] = job_type
        if is_remote:
            kwargs["is_remote"] = True
        if google_search_term:
            kwargs["google_search_term"] = google_search_term

        # scrape_jobs is synchronous — run in thread pool to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        jobs_df = await loop.run_in_executor(None, lambda: scrape_jobs(**kwargs))

        if jobs_df is None or jobs_df.empty:
            return {"jobs": [], "total": 0, "page": page, "perPage": 50, "hasMore": False}

        jobs_df = jobs_df.where(pd.notna(jobs_df), None)

        jobs = []
        for _, row in jobs_df.iterrows():
            loc_parts = [str(p) for p in [row.get("city"), row.get("state"), row.get("country")] if p]
            loc = ", ".join(loc_parts)

            min_amt = row.get("min_amount")
            max_amt = row.get("max_amount")
            salary_parts = []
            if min_amt is not None:
                salary_parts.append(f"${min_amt:,.0f}")
            if max_amt is not None:
                salary_parts.append(f"${max_amt:,.0f}")

            title = str(row.get("title") or "")
            company = str(row.get("company") or "")
            site = str(row.get("site") or "")
            job_url = str(row.get("job_url") or "")

            posted = row.get("date_posted")
            posted_str = str(posted) if posted is not None else None

            jobs.append({
                "id": f"spy_{site}_{abs(hash(job_url))}",
                "title": title,
                "company": company,
                "department": str(row.get("job_function") or ""),
                "category": categorize_role(title, str(row.get("job_function") or "")),
                "location": loc or ("Remote" if row.get("is_remote") else ""),
                "applyUrl": job_url,
                "postedDate": posted_str,
                "source": site,
                "sourceLabel": site.replace("_", " ").title(),
                "isRemote": bool(row.get("is_remote")),
                "jobType": str(row.get("job_type") or ""),
                "salary": " - ".join(salary_parts) if salary_parts else None,
                "currency": str(row.get("currency") or ""),
                "description": str(row.get("description") or ""),
            })

        per_page = 50
        start = (page - 1) * per_page
        paginated = jobs[start:start + per_page]

        return {
            "jobs": paginated,
            "total": len(jobs),
            "page": page,
            "perPage": per_page,
            "hasMore": start + per_page < len(jobs),
        }
    except Exception as e:
        print(f"scrape error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})
