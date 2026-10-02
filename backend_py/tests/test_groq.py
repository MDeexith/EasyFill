import json
import os
import unittest
from unittest.mock import patch

import httpx
from openai import AsyncOpenAI, RateLimitError

import groq_client
from main import app


class GroqTests(unittest.IsolatedAsyncioTestCase):
    async def call_with_transport(self, handler, prompt="Question"):
        def make_client(**kwargs):
            return AsyncOpenAI(
                **kwargs,
                http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
            )

        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key", "GROQ_MODEL": ""}), patch(
            "groq_client.AsyncOpenAI", side_effect=make_client
        ):
            return await groq_client.generate(prompt)

    async def test_one_groq_request_returns_only_final_answer(self):
        requests = []

        def handler(request):
            requests.append(request)
            self.assertEqual(str(request.url), "https://api.groq.com/openai/v1/chat/completions")
            self.assertEqual(request.headers["authorization"], "Bearer test-key")
            body = json.loads(request.content)
            self.assertEqual(body["model"], "openai/gpt-oss-120b")
            self.assertEqual(body["reasoning_effort"], "low")
            self.assertFalse(body["include_reasoning"])
            self.assertNotIn("models", body)
            self.assertNotIn("route", body)
            return httpx.Response(200, json={
                "choices": [{"finish_reason": "stop", "message": {
                    "role": "assistant", "content": " Final answer ", "reasoning": "Internal reasoning"
                }}]
            })

        self.assertEqual(await self.call_with_transport(handler), "Final answer")
        self.assertEqual(len(requests), 1)

    async def test_rate_limit_does_not_retry_or_fallback(self):
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(429, json={"error": {"message": "Rate limited"}})

        with self.assertRaises(RateLimitError):
            await self.call_with_transport(handler)
        self.assertEqual(len(requests), 1)

    async def test_missing_key_has_clear_error(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            with self.assertRaisesRegex(RuntimeError, "GROQ_API_KEY"):
                await groq_client.generate("Question")

    async def test_incomplete_or_empty_answer_is_rejected(self):
        for content, finish in (("Partial answer", "length"), (None, "stop"), (" ", "stop")):
            with self.subTest(content=content, finish=finish):
                def handler(request):
                    return httpx.Response(200, json={"choices": [{
                        "finish_reason": finish,
                        "message": {"role": "assistant", "content": content},
                    }]})

                with self.assertRaises(RuntimeError):
                    await self.call_with_transport(handler)

    async def test_generate_sends_resume_job_and_question_in_one_call(self):
        from unittest.mock import AsyncMock

        mock = AsyncMock(return_value="I build reliable APIs.")
        with patch("routes.generate.generate", mock):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/generate/", json={
                    "profile": {"name": "Jane Doe"},
                    "resumeText": "Built Python APIs at Acme",
                    "jobDescription": "Backend engineer working with Python",
                    "label": "Why are you a good fit?",
                    "wordLimit": 80,
                })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"text": "I build reliable APIs."})
        mock.assert_awaited_once()
        prompt = mock.call_args.args[0]
        for value in ("Built Python APIs at Acme", "Backend engineer working with Python", "Why are you a good fit?", "at most 80 words"):
            self.assertIn(value, prompt)

    async def test_invalid_word_limit_does_not_call_llm(self):
        from unittest.mock import AsyncMock

        mock = AsyncMock()
        with patch("routes.generate.generate", mock):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/generate/", json={"profile": {}, "wordLimit": 0})
        self.assertEqual(response.status_code, 422)
        mock.assert_not_awaited()
