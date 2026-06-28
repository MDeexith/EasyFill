import os
import asyncio
from openai import AsyncOpenAI

# OpenRouter fallback routing supports max 3 models — sorted best to worst for JSON/instruction tasks
FREE_MODELS = [
    "openai/gpt-oss-120b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen3-coder:free",
]


# FastRouter — paid fallback when all OpenRouter free models are rate-limited
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


async def _call(messages: list) -> str:
    response = await asyncio.wait_for(
        _client().chat.completions.create(
            model=FREE_MODELS[0],
            extra_body={"models": FREE_MODELS, "route": "fallback"},
            messages=messages,
            temperature=0,
        ),
        timeout=60.0,
    )
    chosen = getattr(response, "model", FREE_MODELS[0])
    print(f"[openrouter] answered by {chosen}")
    return response.choices[0].message.content.strip()


def _is_quota_error(e) -> bool:
    status = getattr(e, "status_code", None) or getattr(getattr(e, "response", None), "status_code", None)
    if status in (402, 429):
        return True
    msg = str(e).lower()
    return any(s in msg for s in ("rate limit", "rate-limit", "quota", "402", "429", "insufficient", "payment required"))


async def generate(prompt: str, *, allow_fastrouter_fallback: bool = False) -> str:
    messages = [{"role": "user", "content": prompt}]
    try:
        return await _call(messages)
    except Exception as e:
        print(f"[openrouter] all free models failed: {e}")
        if allow_fastrouter_fallback and _is_quota_error(e):
            print(f"[openrouter] switching to FastRouter ({FASTROUTER_MODEL})")
            result = await _call_fastrouter(messages)
            print(f"[openrouter] answered by FastRouter: {FASTROUTER_MODEL}")
            return result
        raise


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
    return await _call(messages)
