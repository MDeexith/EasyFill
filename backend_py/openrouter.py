import os
import asyncio
from openai import AsyncOpenAI

# OpenRouter fallback routing supports max 3 models — sorted best to worst for JSON/instruction tasks.
# Free models get delisted without notice; override via OPENROUTER_FREE_MODELS (comma-separated)
# so a delisting is a config change, not a code deploy.
_DEFAULT_FREE_MODELS = "nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free,z-ai/glm-5.2:free"
FREE_MODELS = [
    m.strip()
    for m in os.environ.get("OPENROUTER_FREE_MODELS", _DEFAULT_FREE_MODELS).split(",")
    if m.strip()
][:3]


def _client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    )


async def _call(messages: list) -> str:
    response = await asyncio.wait_for(
        _client().chat.completions.create(
            model=FREE_MODELS[0],
            extra_body={"models": FREE_MODELS, "route": "fallback"},
            messages=messages,
            temperature=0,
        ),
        # Free-tier models routinely take 50-60s on long prompts; cap the call
        # at 80s to stay within the app's client timeout.
        timeout=80.0,
    )
    chosen = getattr(response, "model", FREE_MODELS[0])
    print(f"[openrouter] answered by {chosen}")
    return response.choices[0].message.content.strip()


async def generate(prompt: str) -> str:
    messages = [{"role": "user", "content": prompt}]
    try:
        return await _call(messages)
    except Exception as e:
        print(f"[openrouter] all free models failed: {e!r}")
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
