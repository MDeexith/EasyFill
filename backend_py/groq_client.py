import asyncio
import os

from openai import AsyncOpenAI

DEFAULT_MODEL = "openai/gpt-oss-120b"
REQUEST_TIMEOUT = 80.0


async def generate(prompt: str) -> str:
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is required for LLM requests")

    # Groq's OpenAI-compatible API lets us keep the existing SDK dependency.
    # No provider/model fallback or SDK retries: each request makes one call.
    async with AsyncOpenAI(
        api_key=api_key,
        base_url="https://api.groq.com/openai/v1",
        timeout=REQUEST_TIMEOUT,
        max_retries=0,
    ) as client:
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model=os.environ.get("GROQ_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                reasoning_effort="low",
                extra_body={"include_reasoning": False},
                max_completion_tokens=4096,
            ),
            timeout=REQUEST_TIMEOUT,
        )
    if not response.choices or response.choices[0].finish_reason == "length":
        raise RuntimeError("Groq returned no complete answer")
    content = response.choices[0].message.content
    if not content or not content.strip():
        raise RuntimeError("Groq returned an empty answer")
    return content.strip()
