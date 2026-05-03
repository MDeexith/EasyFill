import json
import re
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ollama import generate

router = APIRouter()

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "prompts" / "match.txt").read_text()


class FieldItem(BaseModel):
    id: str
    name: Optional[str] = None
    type: Optional[str] = None
    inputType: Optional[str] = None
    autocomplete: Optional[str] = None
    label: Optional[str] = None
    placeholder: Optional[str] = None
    ariaLabel: Optional[str] = None
    nearbyText: Optional[str] = None
    pattern: Optional[str] = None
    maxLength: Optional[int] = None
    required: Optional[bool] = None
    role: Optional[str] = None


class MatchRequest(BaseModel):
    fields: list[FieldItem]
    profile: dict[str, Any]


def _normalise_decisions(raw: Any) -> dict[str, dict[str, Any]]:
    """Accept both legacy `{id: "key"}` and new `{id: {key, confidence}}` shapes."""
    decisions: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return decisions
    for fid, val in raw.items():
        if val is None:
            continue
        if isinstance(val, str):
            decisions[fid] = {"key": val, "confidence": 0.7}
        elif isinstance(val, dict) and val.get("key"):
            try:
                conf = float(val.get("confidence", 0.7))
            except (TypeError, ValueError):
                conf = 0.7
            decisions[fid] = {"key": val["key"], "confidence": conf}
    return decisions


@router.post("/")
async def match_fields(body: MatchRequest):
    profile_keys = ", ".join(body.profile.keys())
    fields_json = json.dumps([f.model_dump(exclude_none=True) for f in body.fields])

    prompt = (
        PROMPT_TEMPLATE
        .replace("{{FIELDS}}", fields_json)
        .replace("{{PROFILE_KEYS}}", profile_keys)
    )

    try:
        raw = await generate(prompt)
        json_str = re.sub(r"^```[a-z]*\n?", "", raw)
        json_str = re.sub(r"\n?```$", "", json_str)
        parsed = json.loads(json_str)
        decisions = _normalise_decisions(parsed)

        # Back-compat: also expose a flat mapping for older app builds.
        mapping = {fid: dec["key"] for fid, dec in decisions.items()}
        return {"mapping": mapping, "decisions": decisions}
    except Exception as e:
        print(f"match error: {e}")
        return JSONResponse(status_code=500, content={"error": "LLM call failed"})
