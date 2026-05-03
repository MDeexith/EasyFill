import os
import asyncio
from openai import AsyncOpenAI

PRIMARY_MODEL = "google/gemma-4-26b-a4b-it:free"
FALLBACK_MODEL = "openai/gpt-oss-120b:free"


def _client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url="https://openrouter.ai/api/v1",
    )


async def _call(model: str, messages: list) -> str:
    response = await _client().chat.completions.create(
        model=model,
        messages=messages,
        temperature=0,
    )
    return response.choices[0].message.content.strip()


async def _parallel_with_fallback(messages: list) -> str:
    """
    Fire both models concurrently. Return the primary (gemma) response if it
    succeeds; if it fails, return the already-running fallback (gpt-oss) response.
    """
    primary_task = asyncio.create_task(_call(PRIMARY_MODEL, messages))
    fallback_task = asyncio.create_task(_call(FALLBACK_MODEL, messages))

    try:
        result = await primary_task
        fallback_task.cancel()
        return result
    except Exception as e:
        print(f"[openrouter] primary ({PRIMARY_MODEL}) failed: {e} — using fallback")
        return await fallback_task


async def generate(prompt: str) -> str:
    messages = [{"role": "user", "content": prompt}]
    return await _parallel_with_fallback(messages)


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
    return await _parallel_with_fallback(messages)
