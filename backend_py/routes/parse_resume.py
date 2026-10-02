import asyncio
import json
import math
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from groq_client import generate

from resume_extractor import extract_text_from_pdf_bytes, extract_profile_from_text, extract_hyperlinks_from_pdf_bytes

router = APIRouter()

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "prompts" / "parseResume.txt").read_text()

STRING_FIELDS = [
    "firstName", "lastName", "name", "email", "phone", "address",
    "city", "state", "zipCode", "country", "linkedIn", "portfolio",
    "github", "currentTitle", "currentCompany", "skills",
    "workAuthorization", "languages",
]
ARRAY_FIELDS = ["experience", "education"]
ENTRY_FIELDS = {
    "experience": ("title", "company", "location", "startDate", "endDate", "skills", "description"),
    "education": ("institution", "degree", "field", "year", "startDate", "endDate"),
}
CONTACT_FIELDS = {"email", "phone", "linkedIn", "github", "portfolio"}
MAX_PDF_BYTES = 10 * 1024 * 1024


def _clean_text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _clean_years(value) -> float:
    if isinstance(value, bool):
        return 0.0
    try:
        years = float(value)
    except (TypeError, ValueError):
        return 0.0
    return years if math.isfinite(years) and 0 <= years <= 100 else 0.0


def _clean_entries(value, kind: str) -> list[dict]:
    if not isinstance(value, list):
        return []
    entries = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        entry = {key: _clean_text(raw.get(key)) for key in ENTRY_FIELDS[kind]}
        if kind == "experience" and not (entry["title"] or entry["company"]):
            continue
        if kind == "education" and not (entry["institution"] or entry["degree"]):
            continue
        if kind == "experience" and entry["endDate"].lower() in ("present", "current", "now", "ongoing"):
            entry["endDate"] = ""
        for date_key in ("startDate", "endDate"):
            date = entry[date_key]
            if date:
                try:
                    entry[date_key] = datetime.strptime(date, "%Y-%m").strftime("%Y-%m")
                except ValueError:
                    entry[date_key] = ""
        entries.append(entry)
    return entries


def _same_entry(a: dict, b: dict, kind: str) -> bool:
    identity = ("title", "company", "startDate") if kind == "experience" else ("institution", "degree", "year")
    shared = [key for key in identity if a[key] and b[key]]
    return bool(shared) and all(a[key].casefold() == b[key].casefold() for key in shared)


def _merge_entries(ai_value, regex_value, kind: str) -> list[dict]:
    merged = _clean_entries(ai_value, kind)
    for fallback in _clean_entries(regex_value, kind):
        matches = [entry for entry in merged if _same_entry(entry, fallback, kind)]
        if len(matches) == 1:
            for key in ENTRY_FIELDS[kind]:
                if not matches[0][key]:
                    matches[0][key] = fallback[key]
        else:
            merged.append(fallback)
    return merged


def _merge(ai: dict, regex: dict) -> dict:
    ai = ai if isinstance(ai, dict) else {}
    regex = regex if isinstance(regex, dict) else {}
    merged = {}
    for f in STRING_FIELDS:
        ai_value = _clean_text(ai.get(f))
        regex_value = _clean_text(regex.get(f))
        merged[f] = (regex_value or ai_value) if f in CONTACT_FIELDS else (ai_value or regex_value)
    merged["yearsExperience"] = _clean_years(ai.get("yearsExperience")) or _clean_years(regex.get("yearsExperience"))
    for f in ARRAY_FIELDS:
        merged[f] = _merge_entries(ai.get(f), regex.get(f), f)
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
        s = re.sub(r"^```[a-z]*\n?", "", raw.strip(), flags=re.I)
        s = re.sub(r"\n?```$", "", s)
        try:
            parsed = json.loads(s)
        except json.JSONDecodeError:
            # Some models wrap the JSON in prose — extract the outermost {...} block
            start, end = s.find("{"), s.rfind("}")
            if start != -1 and end > start:
                parsed = json.loads(s[start:end + 1])
            else:
                raise
        if not isinstance(parsed, dict):
            raise ValueError("AI response is not a profile object")
        return parsed
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
    contents = await file.read(MAX_PDF_BYTES + 1)
    if len(contents) > MAX_PDF_BYTES:
        return JSONResponse(status_code=413, content={"error": "PDF is too large (10 MB maximum)"})
    if not contents.startswith(b"%PDF-"):
        return JSONResponse(status_code=400, content={"error": "Upload a valid PDF file"})

    try:
        text, hyperlinks = await asyncio.gather(
            _extract_text(contents),
            _extract_hyperlinks(contents),
        )
    except Exception as e:
        print(f"[pdf extract] failed: {e}")
        return JSONResponse(status_code=422, content={"error": "Could not read PDF"})

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

    # Calculate unique months across all jobs so simultaneous roles are not counted twice.
    computed_yoe = _calculate_yoe(merged.get("experience", []))
    if computed_yoe:
        # A stated total can include earlier jobs not present in the parsed history.
        stated_yoe = _clean_years(regex_result.get("yearsExperience"))
        merged["yearsExperience"] = max(computed_yoe, stated_yoe)

    if not any(merged.get(key) for key in (
        "name", "email", "phone", "linkedIn", "github", "currentTitle",
        "currentCompany", "experience", "education", "skills",
    )):
        return JSONResponse(status_code=422, content={"error": "Could not extract profile details from PDF"})

    return {"profile": merged, "resumeText": text[:6000]}



def _calculate_yoe(experience: list) -> float:
    """Count unique months worked, including simultaneous roles only once."""
    ranges = []
    now = datetime.now()
    current_month = now.year * 12 + now.month
    for exp in experience:
        start_s = exp.get("startDate") or ""
        end_s   = exp.get("endDate")   or ""
        try:
            s = datetime.strptime(start_s, "%Y-%m")
            e = datetime.strptime(end_s, "%Y-%m") if end_s else now
        except (TypeError, ValueError):
            continue
        start_month = s.year * 12 + s.month
        end_month = min(e.year * 12 + e.month, current_month)
        if start_month <= end_month:
            ranges.append((start_month, end_month))

    ranges.sort()
    merged_ranges = []
    for start, end in ranges:
        if merged_ranges and start <= merged_ranges[-1][1] + 1:
            merged_ranges[-1][1] = max(merged_ranges[-1][1], end)
        else:
            merged_ranges.append([start, end])
    total_months = sum(end - start + 1 for start, end in merged_ranges)
    return round(total_months / 12, 1) if total_months > 0 else 0
