import os
import httpx

OLLAMA_BASE = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL = "gemma3:4b"
TIMEOUT = 60.0


async def generate(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        res = await client.post(
            f"{OLLAMA_BASE}/api/generate",
            json={"model": MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0}},
        )
        res.raise_for_status()
        return res.json()["response"].strip()


async def generate_with_image(prompt: str, image_base64: str) -> str:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        res = await client.post(
            f"{OLLAMA_BASE}/api/generate",
            json={
                "model": MODEL,
                "prompt": prompt,
                "images": [image_base64],
                "stream": False,
                "options": {"temperature": 0},
            },
        )
        res.raise_for_status()
        return res.json()["response"].strip()
