import asyncio
import os
import random
import re
import string
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

# ── Company lists (legacy board scrapers) ─────────────────────────────
GREENHOUSE_COMPANIES = [
    'figma', 'stripe', 'notion', 'cloudflare', 'airtable',
    'databricks', 'discord', 'duolingo', 'gusto', 'hashicorp',
    'ironclad', 'lattice', 'linear', 'loom', 'miro',
    'plaid', 'ramp', 'retool', 'rippling', 'scale',
    'snyk', 'sourcegraph', 'supabase', 'vercel', 'watershed',
    'webflow', 'doordash', 'brex', 'dbt-labs', 'anduril',
]

custom_companies: list[dict] = []

# ── JobSpy platforms ───────────────────────────────────────────────────
INDIA_PLATFORMS = ["indeed", "linkedin", "naukri", "google", "glassdoor"]
GLOBAL_PLATFORMS = ["indeed", "linkedin", "zip_recruiter", "google"]

# ── Cache ──────────────────────────────────────────────────────────────
_cache: dict[str, dict] = {}
CACHE_TTL = 15 * 60          # 15 min — live API sources (Jobicy, Greenhouse, etc.)
SPY_CACHE_TTL = 3 * 60 * 60  # 3 h — JobSpy (query-based, populated on first request)


def get_cached(key: str, ttl: int = CACHE_TTL):
    entry = _cache.get(key)
    if not entry:
        return None
    if time.time() - entry["ts"] > ttl:
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


def _parse_date(date_str: Optional[str]) -> float:
    if not date_str:
        return 0
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0


# ── JobSpy — one fetcher per platform ─────────────────────────────────

async def fetch_jobspy_platform(
    platform: str,
    search: str = "",
    location: str = "India",
    country_indeed: str = "India",
    results_wanted: int = 50,
    hours_old: int = 72,
    job_type: Optional[str] = None,
    is_remote: bool = False,
) -> list:
    """Scrape one JobSpy platform. Returns from 3h cache if warm, otherwise scrapes live."""
    cache_key = f"spy_{platform}_{search}_{location}".lower().replace(" ", "_")
    cached = get_cached(cache_key, SPY_CACHE_TTL)
    if cached is not None:
        return cached

    try:
        from jobspy import scrape_jobs
        import pandas as pd

        kwargs: dict = {
            "site_name": [platform],
            "search_term": search or "software engineer",
            "location": location,
            "results_wanted": results_wanted,
            "hours_old": hours_old,
            "country_indeed": country_indeed,
            "verbose": 0,
        }
        if job_type:
            kwargs["job_type"] = job_type
        if is_remote:
            kwargs["is_remote"] = True

        loop = asyncio.get_running_loop()
        df = await loop.run_in_executor(None, lambda: scrape_jobs(**kwargs))

        if df is None or df.empty:
            set_cache(cache_key, [])
            return []

        df = df.where(pd.notna(df), None)
        jobs = []
        for _, row in df.iterrows():
            loc_parts = [str(p) for p in [row.get("city"), row.get("state"), row.get("country")] if p]
            title = str(row.get("title") or "")
            job_url = str(row.get("job_url") or "")
            posted = row.get("date_posted")
            min_amt, max_amt = row.get("min_amount"), row.get("max_amount")
            currency_sym = {"INR": "₹", "USD": "$", "GBP": "£", "EUR": "€", "AUD": "A$"}.get(
                str(row.get("currency") or ""), ""
            )
            salary_parts = []
            if min_amt is not None:
                salary_parts.append(f"{currency_sym}{min_amt:,.0f}")
            if max_amt is not None:
                salary_parts.append(f"{currency_sym}{max_amt:,.0f}")
            job_fn = row.get("job_function")
            dept = ", ".join(job_fn) if isinstance(job_fn, list) else str(job_fn or "")
            jobs.append({
                "id": f"spy_{platform}_{abs(hash(job_url))}",
                "title": title,
                "company": str(row.get("company") or ""),
                "department": dept,
                "category": categorize_role(title, dept),
                "location": ", ".join(loc_parts) or ("Remote" if row.get("is_remote") else ""),
                "applyUrl": job_url,
                "postedDate": str(posted) if posted is not None else None,
                "source": platform,
                "sourceLabel": platform.replace("_", " ").title(),
                "isRemote": bool(row.get("is_remote")),
                "jobType": str(row.get("job_type") or ""),
                "salary": " - ".join(salary_parts) if salary_parts else None,
                "currency": str(row.get("currency") or ""),
                "description": str(row.get("description") or ""),
            })

        set_cache(cache_key, jobs)
        return jobs
    except Exception as e:
        print(f"[jobspy:{platform}] error: {e}")
        return []


# ── Live API fetchers ──────────────────────────────────────────────────

async def fetch_jobicy_jobs(search: str = "", count: int = 50) -> list:
    cache_key = f"jobicy_{search}_{count}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    try:
        params: dict = {"count": count}
        if search:
            params["tag"] = search

        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get("https://jobicy.com/api/v2/remote-jobs", params=params)
            res.raise_for_status()
            data = res.json()

        jobs = []
        for j in data.get("jobs", []):
            title = j.get("jobTitle", "")
            industry = j.get("jobIndustry", "")
            jobs.append({
                "id": f"jobicy_{j.get('id', _rand_id())}",
                "title": title,
                "company": j.get("companyName", ""),
                "department": industry,
                "category": categorize_role(title, industry),
                "location": j.get("jobGeo", "Remote"),
                "applyUrl": j.get("url", ""),
                "postedDate": j.get("pubDate"),
                "source": "jobicy",
                "sourceLabel": "Jobicy",
            })
        set_cache(cache_key, jobs)
        return jobs
    except Exception as e:
        print(f"[jobicy] error: {e}")
        return []


async def fetch_greenhouse_jobs(board_token: str) -> list:
    cache_key = f"gh_{board_token}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs",
                params={"content": "true"},
            )
            res.raise_for_status()
            data = res.json()

        jobs = []
        for j in data.get("jobs", []):
            dept = (j.get("departments") or [{}])[0].get("name", "")
            # offices[0].location is a full string e.g. "New York, NY, United States"
            offices = j.get("offices") or []
            loc = (offices[0].get("location") or offices[0].get("name", "")) if offices else j.get("location", {}).get("name", "")
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


async def fetch_remotive_jobs(search: str = "", category: str = "") -> list:
    cache_key = f"remotive_{search}_{category}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached
    print(cache_key)
    try:
        params: dict = {"limit": "100"}
        if search:
            params["search"] = search
        if category:
            cat_map = {
                "Engineering": "software-dev", "Design": "design",
                "Product": "product", "Marketing": "marketing",
                "Sales": "sales", "Data": "data",
                "Support": "customer-support", "Operations": "hr",
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


# ── Source test routes ────────────────────────────────────────────────

@router.get("/sources/jobicy")
async def source_jobicy(
    search: str = Query(default=""),
    count: int = Query(default=50),
):
    jobs = await fetch_jobicy_jobs(search, count)
    return {"source": "jobicy", "count": len(jobs), "jobs": jobs}


@router.get("/sources/greenhouse")
async def source_greenhouse(
    company: str = Query(description="Greenhouse board token e.g. 'stripe', 'figma'"),
):
    jobs = await fetch_greenhouse_jobs(company)
    return {"source": "greenhouse", "company": company, "count": len(jobs), "jobs": jobs}


@router.get("/sources/remotive")
async def source_remotive(
    search: str = Query(default=""),
    category: str = Query(default="", description="Engineering, Design, Product, Marketing, Sales, Data, Support, Operations"),
):
    jobs = await fetch_remotive_jobs(search, category)
    return {"source": "remotive", "count": len(jobs), "jobs": jobs}


# ── Routes ─────────────────────────────────────────────────────────────

@router.get("/feed")
async def jobs_feed(
    search: str = Query(default=""),
    category: str = Query(default=""),
    page: int = Query(default=1),
    location: str = Query(default=""),
    country: str = Query(default="in", description="'in'=India (default), 'us'/'gb'/etc, 'global'"),
    is_remote: bool = Query(default=False),
    job_type: Optional[str] = Query(default=None),
    experience: Optional[int] = Query(default=None),
):
    search_q = search.lower().strip()
    # experience is accepted but not applied to JobSpy — reserved for other platforms
    is_india = country.lower() == "in"
    india_location = location or ("India" if is_india else "")
    country_indeed = "India" if is_india else "USA"
    platforms = INDIA_PLATFORMS if is_india else GLOBAL_PLATFORMS

    per_page = 10

    tasks = []

    for platform in platforms:
        tasks.append(fetch_jobspy_platform(
            platform,
            search=search_q,
            location=india_location,
            country_indeed=country_indeed,
            is_remote=is_remote,
            job_type=job_type,
        ))

    tasks.append(fetch_jobicy_jobs(search_q))
    tasks.append(fetch_remotive_jobs(search_q, category))
    for co in GREENHOUSE_COMPANIES[:15] + [c["handle"] for c in custom_companies if c["platform"] == "greenhouse"]:
        tasks.append(fetch_greenhouse_jobs(co))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_jobs: list = [j for r in results if isinstance(r, list) for j in r]

    if search_q:
        all_jobs = [
            j for j in all_jobs
            if search_q in str(j.get("title", "")).lower()
            or search_q in str(j.get("company", "")).lower()
            or search_q in str(j.get("department", "")).lower()
            or search_q in str(j.get("location", "")).lower()
        ]

    if category and category != "All":
        all_jobs = [j for j in all_jobs if j["category"] == category]

    all_jobs.sort(key=lambda j: _parse_date(j["postedDate"]), reverse=True)

    start = (page - 1) * per_page

    return {
        "jobs": all_jobs[start:start + per_page],
        "total": len(all_jobs),
        "page": page,
        "perPage": per_page,
        "hasMore": start + per_page < len(all_jobs),
    }


@router.post("/refresh")
def refresh_jobs():
    """Clear the JobSpy cache so next /jobs/feed request re-scrapes live."""
    cleared = [k for k in list(_cache.keys()) if k.startswith("spy_")]
    for k in cleared:
        del _cache[k]
    return {"ok": True, "cleared": len(cleared), "message": "JobSpy cache cleared. Next /jobs/feed will re-scrape."}


@router.get("/cache/status")
def cache_status():
    """Show all cached sources: job count, age, and time until expiry."""
    now = time.time()
    entries = {}
    for key, entry in _cache.items():
        age_secs = now - entry["ts"]
        ttl = SPY_CACHE_TTL if key.startswith("spy_") else CACHE_TTL
        entries[key] = {
            "count": len(entry["data"]),
            "age_minutes": round(age_secs / 60, 1),
            "expires_in_minutes": round(max(0, ttl - age_secs) / 60, 1),
        }
    return {
        "total_cached_jobs": sum(e["count"] for e in entries.values()),
        "sources": entries,
    }


@router.get("/companies")
def get_companies():
    return {
        "greenhouse": GREENHOUSE_COMPANIES + [c["handle"] for c in custom_companies if c["platform"] == "greenhouse"],
    }


class AddCompanyRequest(BaseModel):
    handle: str
    platform: str


@router.post("/companies")
def add_company(body: AddCompanyRequest):
    if body.platform != "greenhouse":
        return JSONResponse(
            status_code=400,
            content={"error": "platform must be 'greenhouse'"},
        )
    exists = any(c["handle"] == body.handle and c["platform"] == body.platform for c in custom_companies)
    if not exists:
        custom_companies.append({"handle": body.handle, "platform": body.platform})
    return {"ok": True}
