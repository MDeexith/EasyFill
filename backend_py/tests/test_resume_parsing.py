import unittest
from unittest.mock import AsyncMock, patch

import httpx

from main import app
from resume_extractor import _split_sections, extract_profile_from_text
from routes.parse_resume import MAX_PDF_BYTES, _calculate_yoe, _merge, _run_ai


SAMPLE_TEXT = """Jane Doe
jane@example.com
Title: Software Engineer
Acme Corp
Experience
Software Engineer - Jan 2021 - Present
Acme Corp
Education
B.S. Computer Science - 2020
Example University
Skills
Python, React, SQL
"""


class ResumeParsingTests(unittest.TestCase):
    def test_null_ai_fields_preserve_regex_values(self):
        merged = _merge(
            {"email": None, "yearsExperience": None, "firstName": None},
            {"email": "jane@example.com", "yearsExperience": 5, "firstName": "Jane"},
        )
        self.assertEqual(merged["email"], "jane@example.com")
        self.assertEqual(merged["yearsExperience"], 5)
        self.assertEqual(merged["firstName"], "Jane")

    def test_invalid_ai_types_are_ignored(self):
        merged = _merge(
            {"name": ["wrong"], "yearsExperience": "many", "experience": {"title": "wrong"}},
            {"name": "Jane Doe", "yearsExperience": 4, "experience": [{"title": "Engineer", "company": "Acme"}]},
        )
        self.assertEqual(merged["name"], "Jane Doe")
        self.assertEqual(merged["yearsExperience"], 4)
        self.assertEqual(len(merged["experience"]), 1)

    def test_partial_work_history_is_completed_and_unmatched_jobs_are_kept(self):
        merged = _merge(
            {"experience": [{"title": "Engineer", "company": "Acme", "startDate": "2021-01", "description": "Built APIs"}]},
            {"experience": [
                {"title": "Engineer", "company": "Acme", "startDate": "2021-01", "endDate": "2022-12"},
                {"title": "Developer", "company": "Other", "startDate": "2019-01", "endDate": "2020-12"},
            ]},
        )
        self.assertEqual(len(merged["experience"]), 2)
        self.assertEqual(merged["experience"][0]["endDate"], "2022-12")
        self.assertEqual(merged["experience"][0]["description"], "Built APIs")

    def test_blank_ai_template_does_not_hide_education(self):
        merged = _merge(
            {"education": [{"institution": "", "degree": ""}]},
            {"education": [{"institution": "Example University", "degree": "B.S", "year": "2020"}]},
        )
        self.assertEqual(len(merged["education"]), 1)
        self.assertEqual(merged["education"][0]["institution"], "Example University")

    def test_regex_extracts_degree_field_institution_and_current_role(self):
        profile = extract_profile_from_text(SAMPLE_TEXT)
        self.assertEqual(profile["currentTitle"], "Software Engineer")
        self.assertEqual(profile["currentCompany"], "Acme Corp")
        self.assertEqual(profile["education"][0]["institution"], "Example University")
        self.assertEqual(profile["education"][0]["field"], "Computer Science")

    def test_numeric_experience_dates_and_country_from_location(self):
        profile = extract_profile_from_text(
            "Jane Doe\nWork Authorization: US Citizen\nMumbai, India\n"
            "Experience\nEngineer 2020-01 to 2022-12\nAcme Corp\n"
        )
        self.assertEqual(profile["country"], "India")
        self.assertEqual(profile["currentTitle"], "Engineer")
        self.assertEqual(profile["experience"][0]["startDate"], "2020-01")
        self.assertEqual(profile["experience"][0]["endDate"], "2022-12")

    def test_missing_role_remains_empty(self):
        profile = extract_profile_from_text("Jane Doe\nWork Authorization: US Citizen\nMumbai, India\n")
        self.assertEqual(profile["currentTitle"], "")

    def test_dates_are_not_phone_numbers(self):
        profile = extract_profile_from_text(
            "Jane Doe\nExperience\nEngineer 2020-01-01 - 2022-12-31\nAcme Corp\n"
            "Education\nB.S. Computer Science - 2018-05-31\nExample University\n"
        )
        self.assertEqual(profile["phone"], "")
        self.assertEqual(profile["experience"][0]["startDate"], "2020-01")
        self.assertEqual(profile["experience"][0]["endDate"], "2022-12")

    def test_repeat_sections_are_not_lost(self):
        sections = _split_sections("Experience\nFirst job\nExperience\nSecond job\n")
        self.assertIn("First job", sections["experience"])
        self.assertIn("Second job", sections["experience"])

    def test_overlapping_jobs_count_once(self):
        self.assertEqual(_calculate_yoe([
            {"startDate": "2020-01", "endDate": "2022-12"},
            {"startDate": "2021-01", "endDate": "2023-12"},
        ]), 4.0)

    def test_invalid_and_future_dates_are_ignored(self):
        self.assertEqual(_calculate_yoe([
            {"startDate": "not a date", "endDate": ""},
            {"startDate": "2099-01", "endDate": ""},
        ]), 0)


class ResumeApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_rejects_non_pdf(self):
        response = await self.client.post("/parse-resume", files={"file": ("resume.txt", b"not a PDF")})
        self.assertEqual(response.status_code, 400)

    async def test_requires_file(self):
        response = await self.client.post("/parse-resume")
        self.assertEqual(response.status_code, 422)

    async def test_rejects_oversized_pdf(self):
        response = await self.client.post(
            "/parse-resume", files={"file": ("resume.pdf", b"%PDF-" + b"x" * MAX_PDF_BYTES)},
        )
        self.assertEqual(response.status_code, 413)

    async def test_rejects_corrupt_pdf(self):
        response = await self.client.post("/parse-resume", files={"file": ("resume.pdf", b"%PDF-broken")})
        self.assertEqual(response.status_code, 422)

    async def test_regex_profile_survives_ai_failure(self):
        with patch("routes.parse_resume._extract_text", new=AsyncMock(return_value=SAMPLE_TEXT)), \
             patch("routes.parse_resume._extract_hyperlinks", new=AsyncMock(return_value={})), \
             patch("routes.parse_resume.generate", new=AsyncMock(side_effect=RuntimeError("model unavailable"))):
            response = await self.client.post("/parse-resume", files={"file": ("resume.pdf", b"%PDF-test")})
        self.assertEqual(response.status_code, 200)
        profile = response.json()["profile"]
        self.assertEqual(profile["email"], "jane@example.com")
        self.assertEqual(profile["education"][0]["institution"], "Example University")

    async def test_unusable_text_is_not_reported_as_a_parsed_profile(self):
        with patch("routes.parse_resume._extract_text", new=AsyncMock(return_value="[unreadable]")), \
             patch("routes.parse_resume._extract_hyperlinks", new=AsyncMock(return_value={})), \
             patch("routes.parse_resume.generate", new=AsyncMock(side_effect=RuntimeError("model unavailable"))):
            response = await self.client.post("/parse-resume", files={"file": ("resume.pdf", b"%PDF-test")})
        self.assertEqual(response.status_code, 422)

    async def test_non_object_ai_response_falls_back(self):
        with patch("routes.parse_resume.generate", new=AsyncMock(return_value="[]")):
            self.assertEqual(await _run_ai(SAMPLE_TEXT), {})


if __name__ == "__main__":
    unittest.main()
