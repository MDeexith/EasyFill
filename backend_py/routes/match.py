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
    label: Optional[str] = None
    placeholder: Optional[str] = None
    ariaLabel: Optional[str] = None
    nearbyText: Optional[str] = None


class MatchRequest(BaseModel):
    fields: list[FieldItem]
    profile: dict[str, Any]


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
        mapping = json.loads(json_str)
        return {"mapping": mapping}
    except Exception as e:
        print(f"match error: {e}")
        return JSONResponse(status_code=500, content={"error": "LLM call failed"})
