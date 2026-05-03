import json
import re
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from openrouter import generate

router = APIRouter()

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "prompts" / "generate.txt").read_text()


class GenerateRequest(BaseModel):
    profile: dict[str, Any]
    label: Optional[str] = ""
    placeholder: Optional[str] = ""
    nearby: Optional[str] = ""
    host: Optional[str] = ""


def format_profile(profile: dict) -> str:
    lines = []
    for k, v in profile.items():
        if v is None or v == "" or v == []:
            continue
        value_str = v if isinstance(v, str) else json.dumps(v)
        if len(value_str) > 400:
            continue
        lines.append(f"- {k}: {value_str}")
    return "\n".join(lines)


@router.post("/")
async def generate_answer(body: GenerateRequest):
    prompt = (
        PROMPT_TEMPLATE
        .replace("{{PROFILE}}", format_profile(body.profile))
        .replace("{{LABEL}}", body.label or "(none)")
        .replace("{{PLACEHOLDER}}", body.placeholder or "(none)")
        .replace("{{NEARBY}}", body.nearby or "(none)")
        .replace("{{HOST}}", body.host or "(unknown)")
    )

    try:
        raw = await generate(prompt)
        text = re.sub(r"^```[a-z]*\n?", "", raw, flags=re.IGNORECASE)
        text = re.sub(r"\n?```$", "", text)
        text = re.sub(r'^["\']|["\']$', "", text).strip()
        return {"text": text}
    except Exception as e:
        print(f"generate error: {e}")
        return JSONResponse(status_code=500, content={"error": "LLM call failed"})
