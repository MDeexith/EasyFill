import os
import asyncio
from openai import AsyncOpenAI

OPENROUTER_MODEL = "openai/gpt-oss-120b:free"

# FastRouter — used only when OpenRouter free quota is exhausted (429/402).
FASTROUTER_BASE_URL = os.environ.get("FASTROUTER_BASE_URL", "https://api.fastrouter.ai/api/v1")
FASTROUTER_MODEL = os.environ.get("FASTROUTER_MODEL", "openai/gpt-5.4-nano")


def _client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url="https://openrouter.ai/api/v1",
    )


def _fastrouter_client():
    key = os.environ.get("FASTROUTER_API_KEY")
    if not key:
        return None
    return AsyncOpenAI(api_key=key, base_url=FASTROUTER_BASE_URL)


def _is_quota_error(e) -> bool:
    """True when an error signals OpenRouter free quota is exhausted (429 rate limit / 402 payment)."""
    if e is None:
        return False
    status = getattr(e, "status_code", None) or getattr(getattr(e, "response", None), "status_code", None)
    if status in (402, 429):
        return True
    msg = str(e).lower()
    return any(s in msg for s in ("rate limit", "rate-limit", "quota", "402", "429", "insufficient", "payment required"))


async def _call(model: str, messages: list) -> str:
    response = await asyncio.wait_for(
        _client().chat.completions.create(
            model=model,
            messages=messages,
            temperature=0,
        ),
        timeout=30.0,
    )
    return response.choices[0].message.content.strip()


async def _call_fastrouter(messages: list) -> str:
    client = _fastrouter_client()
    if client is None:
        raise RuntimeError("FASTROUTER_API_KEY not set")
    response = await asyncio.wait_for(
        client.chat.completions.create(
            model=FASTROUTER_MODEL,
            messages=messages,
            temperature=0,
        ),
        timeout=30.0,
    )
    return response.choices[0].message.content.strip()


async def _call_with_fallback(messages: list, allow_fastrouter: bool = False) -> str:
    """
    Call the OpenRouter free model. If it fails because the free quota is
    exhausted (429/402) and `allow_fastrouter` is set, switch to FastRouter (paid).
    """
    try:
        result = await _call(OPENROUTER_MODEL, messages)
        print(f"[openrouter] answer picked from OPENROUTER: {OPENROUTER_MODEL}")
        return result
    except Exception as e:
        print(f"[openrouter] model ({OPENROUTER_MODEL}) failed: {e}")
        if allow_fastrouter and _is_quota_error(e):
            print(f"[openrouter] free quota exhausted — switching to FastRouter ({FASTROUTER_MODEL})")
            result = await _call_fastrouter(messages)
            print(f"[openrouter] answer picked from FASTROUTER: {FASTROUTER_MODEL}")
            return result
        raise


async def generate(prompt: str, *, allow_fastrouter_fallback: bool = False) -> str:
    messages = [{"role": "user", "content": prompt}]
    return await _call_with_fallback(messages, allow_fastrouter=allow_fastrouter_fallback)


async def generate_with_image(prompt: str, image_base64: str) -> str:
    # OpenRouter multimodal format (OpenAI-compatible)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:application/pdf;base64,{image_base64}"},
                },
            ],
        }
    ]
    return await _call_with_fallback(messages)
