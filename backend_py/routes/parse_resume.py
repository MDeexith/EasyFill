import base64
import json
import re
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from openrouter import generate_with_image

router = APIRouter()

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "prompts" / "parseResume.txt").read_text()


@router.post("/")
async def parse_resume(file: UploadFile = File(...)):
    if not file:
        return JSONResponse(status_code=400, content={"error": "No file uploaded"})

    try:
        contents = await file.read()
        image_base64 = base64.b64encode(contents).decode("utf-8")

        prompt = PROMPT_TEMPLATE.replace("{{RESUME_TEXT}}", "[See attached document]")

        raw = await generate_with_image(prompt, image_base64)
        json_str = re.sub(r"^```[a-z]*\n?", "", raw)
        json_str = re.sub(r"\n?```$", "", json_str)
        profile = json.loads(json_str)
        return {"profile": profile}
    except Exception as e:
        print(f"parse-resume error: {e}")
        return JSONResponse(status_code=500, content={"error": "Resume parsing failed"})
