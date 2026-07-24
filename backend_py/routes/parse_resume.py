import asyncio
import json
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

# from ollama import generate
from openrouter import generate

from resume_extractor import extract_text_from_pdf_bytes, extract_profile_from_text, extract_hyperlinks_from_pdf_bytes

router = APIRouter()

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "prompts" / "parseResume.txt").read_text()

STRING_FIELDS = [
    "firstName", "lastName", "name", "email", "phone", "address",
    "city", "state", "zipCode", "country", "linkedIn", "portfolio",
    "github", "currentTitle", "currentCompany", "skills",
    "workAuthorization", "languages",
]
FLOAT_FIELDS = ["yearsExperience"]
ARRAY_FIELDS = ["experience", "education"]


def _truthy(v) -> bool:
    if isinstance(v, list): return len(v) > 0
    if isinstance(v, int):  return v != 0
    return bool(str(v).strip())


def _merge(ai: dict, regex: dict) -> dict:
    merged = {}
    for f in STRING_FIELDS:
        merged[f] = ai.get(f, "") if _truthy(ai.get(f, "")) else regex.get(f, "")
    for f in FLOAT_FIELDS:
        ai_val = ai.get(f, 0)
        merged[f] = float(ai_val) if _truthy(ai_val) else float(regex.get(f, 0))
    for f in ARRAY_FIELDS:
        merged[f] = ai.get(f, []) if _truthy(ai.get(f, [])) else regex.get(f, [])
    return merged


async def _extract_text(pdf_bytes: bytes) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, extract_text_from_pdf_bytes, pdf_bytes)


async def _extract_hyperlinks(pdf_bytes: bytes) -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, extract_hyperlinks_from_pdf_bytes, pdf_bytes)


async def _run_ai(text: str) -> dict:
    try:
        prompt = PROMPT_TEMPLATE.replace("{{RESUME_TEXT}}", text[:10000])
        raw = await generate(prompt)
        s = re.sub(r"^```[a-z]*\n?", "", raw)
        s = re.sub(r"\n?```$", "", s)
        return json.loads(s)
    except Exception as e:
        print(f"[ai extractor] failed: {e}")
        return {}


async def _run_regex(text: str) -> dict:
    try:
        return extract_profile_from_text(text)
    except Exception as e:
        print(f"[regex extractor] failed: {e}")
        return {}


@router.post("/")
@router.post("")
async def parse_resume(file: UploadFile = File(...)):
    if not file:
        return JSONResponse(status_code=400, content={"error": "No file uploaded"})

    contents = await file.read()

    try:
        text, hyperlinks = await asyncio.gather(
            _extract_text(contents),
            _extract_hyperlinks(contents),
        )
    except Exception as e:
        print(f"[pdf extract] failed: {e}")
        return JSONResponse(status_code=500, content={"error": "Could not read PDF"})

    if not text.strip():
        return JSONResponse(status_code=422, content={"error": "PDF has no extractable text (scanned image PDF?)"})

    ai_result, regex_result = await asyncio.gather(_run_ai(text), _run_regex(text))

    if not ai_result and not regex_result:
        return JSONResponse(status_code=500, content={"error": "Resume parsing failed"})

    merged = _merge(ai_result, regex_result)

    # Fill in LinkedIn/GitHub/email from PDF hyperlink annotations if text extraction missed them
    for key in ("linkedIn", "github", "email"):
        if not merged.get(key) and hyperlinks.get(key):
            merged[key] = hyperlinks[key]

    # Calculate YOE from experience dates, merging continuous same-company tenures
    if not merged.get("yearsExperience"):
        merged["yearsExperience"] = _calculate_yoe(merged.get("experience", []))

    # Clear state if it doesn't look like a real US state code in context
    if merged.get("state") and not merged.get("city"):
        merged["state"] = ""

    # If city is known but state is missing, ask AI to derive it
    if not merged.get("state") and merged.get("city"):
        merged["state"] = await _derive_state(merged["city"], merged.get("country", ""))


    return {"profile": merged, "resumeText": text[:6000]}



async def _derive_state(city: str, country: str) -> str:
    try:
        prompt = (
            f'What is the state or province that "{city}" is in'
            + (f' ({country})' if country else '') + '? '
            'Reply with ONLY the state/province name, nothing else. '
            'Use 2-letter abbreviation for US states (e.g. CA). '
            'For other countries use the full state/province name (e.g. Maharashtra).'
        )
        result = await generate(prompt)
        return result.strip().strip('."\'')
    except Exception:
        return ""


def _calculate_yoe(experience: list) -> int:
    """Calculate years of experience, merging continuous same-company tenure."""
    company_ranges: dict[str, list] = {}
    for exp in experience:
        company = (exp.get("company") or "").strip().lower()
        start_s = exp.get("startDate") or ""
        end_s   = exp.get("endDate")   or ""
        try:
            s = datetime.strptime(start_s, "%Y-%m")
            e = datetime.strptime(end_s,   "%Y-%m") if end_s else datetime.now()
        except ValueError:
            continue
        company_ranges.setdefault(company, []).append((s, e))

    total_months = 0
    for ranges in company_ranges.values():
        ranges.sort(key=lambda x: x[0])
        merged: list[list] = []
        for s, e in ranges:
            if merged and (s - merged[-1][1]).days <= 62:   # ≤2-month gap = continuous
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        for s, e in merged:
            # +1 to count both start and end month (Jan–Dec = 12, not 11)
            total_months += (e.year - s.year) * 12 + (e.month - s.month) + 1

    return round(total_months / 12, 1) if total_months > 0 else 0
