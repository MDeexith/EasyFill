import base64
import json
import re
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from ollama import generate
from resume_extractor import extract_text_from_pdf_bytes, extract_profile_from_text

router = APIRouter()

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "prompts" / "parseResume.txt").read_text()

STRING_FIELDS = [
    "firstName", "lastName", "name", "email", "phone", "address",
    "city", "state", "zipCode", "country", "linkedIn", "portfolio",
    "github", "currentTitle", "currentCompany", "skills",
]
INT_FIELDS   = ["yearsExperience"]
ARRAY_FIELDS = ["experience", "education"]


def _truthy(v) -> bool:
    if isinstance(v, list): return len(v) > 0
    if isinstance(v, int):  return v != 0
    return bool(str(v).strip())


def _merge(ai: dict, regex: dict) -> dict:
    merged = {}
    for f in STRING_FIELDS:
        merged[f] = ai.get(f, "") if _truthy(ai.get(f, "")) else regex.get(f, "")
    for f in INT_FIELDS:
        merged[f] = ai.get(f, 0) if _truthy(ai.get(f, 0)) else regex.get(f, 0)
    for f in ARRAY_FIELDS:
        merged[f] = ai.get(f, []) if _truthy(ai.get(f, [])) else regex.get(f, [])
    return merged


async def _extract_text(pdf_bytes: bytes) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, extract_text_from_pdf_bytes, pdf_bytes)


async def _run_ai(text: str) -> dict:
    try:
        prompt = PROMPT_TEMPLATE.replace("{{RESUME_TEXT}}", text[:6000])
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

    try:
        text = await _extract_text(contents)
    except Exception as e:
        print(f"parse-resume error: {e}")
        return JSONResponse(status_code=500, content={"error": "Resume parsing failed"})

    return {"profile": _merge(ai_result, regex_result)}
