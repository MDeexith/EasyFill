import io
import re

import pdfplumber


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    pages = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages[:10]:
            t = page.extract_text(x_tolerance=3, y_tolerance=3)
            if t:
                pages.append(t)
    return "\n".join(pages)


def extract_profile_from_text(text: str) -> dict:
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    def first(pattern, flags=0):
        m = re.search(pattern, text, flags)
        return m.group(0).strip() if m else ""

    email    = first(r'[\w.+\-]+@[\w\-]+\.[\w.]{2,}')
    phone    = first(r'(?:\+?\d[\d\s\-().]{6,14}\d)')
    linkedin = first(r'(?:https?://)?(?:www\.)?linkedin\.com/in/[\w\-_%]+/?', re.I)
    github   = first(r'(?:https?://)?(?:www\.)?github\.com/[\w\-]+/?', re.I)

    portfolio_m = re.search(
        r'https?://(?!(?:www\.)?(?:linkedin|github)\.com)[\w\-./?=&#%]+', text, re.I
    )
    portfolio = portfolio_m.group(0).strip() if portfolio_m else ""

    yoe_m = re.search(r'(\d+)\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp)', text, re.I)
    yoe   = int(yoe_m.group(1)) if yoe_m else 0

    skills_m = re.search(
        r'(?:skills?|technologies|tech\s+stack|tools?|competencies)[:\-\s\n]+([^\n]{10,300})', text, re.I
    )
    skills = re.sub(r'\s+', ' ', skills_m.group(1).strip()) if skills_m else ""

    full_name = ""
    for line in lines[:8]:
        if re.search(r'[@/\\|#]|http|www\.|resume|curriculum|vitae', line, re.I):
            continue
        if re.match(r'^\d', line):
            continue
        if 3 <= len(line) <= 60 and re.match(r'^[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4}$', line):
            full_name = line
            break
    parts      = full_name.strip().split()
    first_name = parts[0] if parts else ""
    last_name  = " ".join(parts[1:]) if len(parts) > 1 else ""

    title_m    = re.search(r'(?:title|position|role|currently)[:\s]+([A-Z][^\n,|]{3,60})', text, re.I)
    curr_title = title_m.group(1).strip() if title_m else ""
    if not curr_title:
        skipped = 0
        for line in lines[:10]:
            if re.search(r'[@/\\]|http|www\.|\d{5}', line, re.I):
                continue
            if re.match(r'^\d', line):
                continue
            skipped += 1
            if skipped == 2 and len(line) < 80:
                curr_title = line
                break

    company_m = re.search(
        r'(?:company|employer|organization|at\s)[:\s]+([A-Z][^\n,|]{2,50})', text, re.I
    )
    curr_co = company_m.group(1).strip() if company_m else ""

    city_m  = re.search(r'([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*(?:[A-Z]{2}|[A-Z][a-z]+)', text)
    city    = city_m.group(1).strip() if city_m else ""

    state_m = re.search(r'[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*([A-Z]{2})\b', text)
    state   = state_m.group(1) if state_m else ""

    zip_m    = re.search(r'\b\d{5}(?:-\d{4})?\b', text)
    zip_code = zip_m.group(0) if zip_m else ""

    country_m = re.search(
        r'\b(United States|USA|US|India|Canada|UK|United Kingdom|Australia|Germany|France|Singapore)\b',
        text, re.I
    )
    country = country_m.group(1) if country_m else ""

    return {
        "name": full_name, "firstName": first_name, "lastName": last_name,
        "email": email, "phone": phone,
        "linkedIn": linkedin, "github": github, "portfolio": portfolio,
        "currentTitle": curr_title, "currentCompany": curr_co,
        "yearsExperience": yoe, "skills": skills,
        "city": city, "state": state, "zipCode": zip_code, "country": country,
        "address": "", "experience": [], "education": [],
    }
