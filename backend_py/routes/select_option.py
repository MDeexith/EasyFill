import json
import re
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from openrouter import generate

router = APIRouter()

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "prompts" / "selectOption.txt").read_text()


class OptionItem(BaseModel):
    value: Optional[str] = None
    label: Optional[str] = None


class SelectItem(BaseModel):
    fieldId: str
    label: Optional[str] = None
    profileKey: Optional[str] = None
    profileValue: Optional[str] = None
    options: list[OptionItem] = []


class SelectOptionRequest(BaseModel):
    items: list[SelectItem]


def _normalise(raw: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if not isinstance(raw, dict):
        return out
    for fid, val in raw.items():
        if val is None:
            continue
        if isinstance(val, str) and val.strip():
            out[fid] = val.strip()
    return out


@router.post("/")
async def select_option(body: SelectOptionRequest):
    if not body.items:
        return {"selections": {}}

    # Compact payload for the prompt: only label + value + the option labels
    # (and values when distinct) matter to the model.
    items_payload = []
    for it in body.items:
        items_payload.append({
            "fieldId": it.fieldId,
            "label": it.label or "",
            "value": it.profileValue or "",
            "options": [
                {"label": o.label or "", "value": o.value or ""}
                for o in it.options
            ],
        })

    prompt = PROMPT_TEMPLATE.replace("{{ITEMS}}", json.dumps(items_payload))

    try:
        raw = await generate(prompt, allow_fastrouter_fallback=True)
        json_str = re.sub(r"^```[a-z]*\n?", "", raw)
        json_str = re.sub(r"\n?```$", "", json_str)
        parsed = json.loads(json_str)
        return {"selections": _normalise(parsed)}
    except Exception as e:
        print(f"select-option error: {e}")
        return JSONResponse(status_code=500, content={"error": "LLM call failed"})
