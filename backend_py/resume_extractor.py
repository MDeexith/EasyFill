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


def extract_hyperlinks_from_pdf_bytes(pdf_bytes: bytes) -> dict:
    """Return linkedin/github/email URLs found in PDF hyperlink annotations."""
    result = {"linkedIn": "", "github": "", "email": ""}
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages[:5]:
                links = getattr(page, "hyperlinks", None) or []
                for link in links:
                    uri = link.get("uri", "") or ""
                    if not uri:
                        continue
                    low = uri.lower()
                    if low.startswith("mailto:"):
                        addr = uri[7:].split("?")[0].strip()
                        if addr and not result["email"]:
                            result["email"] = addr
                    elif "linkedin.com" in low and not result["linkedIn"]:
                        result["linkedIn"] = uri
                    elif "github.com" in low and not result["github"]:
                        result["github"] = uri
    except Exception:
        pass
    return result


_MONTH_MAP = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
}
_DATE_TOKEN = r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(?:20|19)\d{2}'
_DATE_RANGE_RE = re.compile(
    rf'({_DATE_TOKEN})\s*[–\-—to]+\s*({_DATE_TOKEN}|Present|Current|Now)',
    re.I
)
_SECTION_SPLIT_RE = re.compile(
    r'(?m)^(?:Technical\s+|Work\s+)?(Summary|Experience|Education|Skills?|Projects?|'
    r'Certifications?|Languages?|Interests?|Objective|Profile|Contact|Awards?)[\s:]*$',
    re.I
)


def _fmt_date(token: str) -> str:
    """Convert 'Jan 2026' → '2026-01', 'Present' → ''."""
    token = token.strip()
    if re.match(r'(?:Present|Current|Now)$', token, re.I):
        return ''
    m = re.match(r'([A-Za-z]+)\.?\s+(\d{4})', token)
    if m:
        month = _MONTH_MAP.get(m.group(1)[:3].lower(), '01')
        return f"{m.group(2)}-{month}"
    return ''


def _split_sections(text: str) -> dict:
    sections: dict[str, str] = {}
    matches = list(_SECTION_SPLIT_RE.finditer(text))
    for i, m in enumerate(matches):
        name = m.group(1).lower()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections[name] = text[start:end].strip()
    return sections


def _parse_experience_section(section: str) -> list:
    lines = [l.strip() for l in section.split('\n') if l.strip()]
    entries = []

    # Find lines that contain a date range — those mark an entry header
    date_idx_list = [i for i, l in enumerate(lines) if _DATE_RANGE_RE.search(l)]

    for pos, date_line_idx in enumerate(date_idx_list):
        next_date_line_idx = date_idx_list[pos + 1] if pos + 1 < len(date_idx_list) else len(lines)

        date_line = lines[date_line_idx]
        dr_m = _DATE_RANGE_RE.search(date_line)
        start_date = _fmt_date(dr_m.group(1)) if dr_m else ''
        end_date   = _fmt_date(dr_m.group(2)) if dr_m else ''

        # Title = part of the date line before the date range, or the line above
        title = _DATE_RANGE_RE.sub('', date_line).strip().rstrip('|–- ').strip()
        if not title and date_line_idx > 0:
            prev = lines[date_line_idx - 1]
            if not _DATE_RANGE_RE.search(prev) and not prev.startswith('•'):
                title = prev.strip()

        # Company = first non-bullet, non-date line after the date line
        company, location = '', ''
        body_start = date_line_idx + 1
        for j in range(body_start, min(body_start + 3, next_date_line_idx)):
            l = lines[j].lstrip('•–- ').strip()
            if l and not _DATE_RANGE_RE.search(l) and not l.startswith('•') and not l.startswith('–'):
                company = l
                body_start = j + 1
                break

        # Collect bullets for description — join continuation lines to previous bullet
        bullets = []
        for j in range(body_start, next_date_line_idx):
            l = lines[j]
            if l.startswith('•') or l.startswith('–') or l.startswith('-'):
                bullets.append(l.lstrip('•–- ').strip())
            elif bullets and l and not _DATE_RANGE_RE.search(l) and not _SECTION_SPLIT_RE.search(l):
                bullets[-1] = bullets[-1] + ' ' + l

        entries.append({
            'title':       title,
            'company':     company,
            'location':    location,
            'startDate':   start_date,
            'endDate':     end_date,
            'description': '\n'.join(bullets),
            'skills':      '',
        })

    return entries


def _parse_education_section(section: str) -> list:
    lines = [l.strip() for l in section.split('\n') if l.strip()]
    entries = []

    DEGREE_RE = re.compile(
        r'\b(Bachelor of [A-Za-z ]+|Master of [A-Za-z ]+|Doctor of [A-Za-z ]+|'
        r'Bachelor|Master|PhD|Ph\.D|Doctor|Associate|B\.?Tech|M\.?Tech|MBA|'
        r'B\.?[SE](?![-\w])|M\.?[SE](?![-\w]))\b', re.I
    )
    GRAD_YEAR_RE = re.compile(r'\b(?:Graduated?|Class of)?\s*((?:May|Jun|Aug|Dec|Jan)\s+)?(\d{4})\b', re.I)

    i = 0
    while i < len(lines):
        line = lines[i]
        # Skip bullet lines
        if line.startswith('•') or line.startswith('–') or line.startswith('-'):
            i += 1
            continue

        # Check if next line (or this line) has a degree keyword
        next_line = lines[i + 1] if i + 1 < len(lines) else ''
        has_degree = DEGREE_RE.search(line) or DEGREE_RE.search(next_line)

        if has_degree:
            # Likely institution on current line if it doesn't have the degree, else same line
            if DEGREE_RE.search(line):
                institution = ''
                degree_line = line
                year_source = line
                if i > 0 and not lines[i - 1].startswith('•'):
                    institution = lines[i - 1]
            else:
                institution = line
                degree_line = next_line
                year_source = next_line
                i += 1  # consume the degree line

            # Extract degree and field
            deg_m = re.search(
                r'(Bachelor of [A-Za-z ]+|Master of [A-Za-z ]+|Doctor of [A-Za-z ]+|'
                r'Bachelor|Master|PhD|Ph\.D|Doctor|Associate|B\.?Tech|M\.?Tech|MBA|'
                r'B\.?[SE](?![-\w])|M\.?[SE](?![-\w]))',
                degree_line, re.I
            )
            degree = re.split(r'\s*[–\-,\|]|\s+in\s', deg_m.group(0))[0].strip() if deg_m else ''

            field_m = re.search(r'\bin\s+([A-Za-z][A-Za-z\s&]{3,50}?)(?:\s*[–\-,]|\s*CGPA|$)', degree_line, re.I)
            field = field_m.group(1).strip() if field_m else ''

            yr_m = GRAD_YEAR_RE.search(year_source)
            year = yr_m.group(2) if yr_m else ''

            entries.append({
                'institution': institution,
                'degree':      degree,
                'field':       field,
                'year':        year,
                'startDate':   '',
                'endDate':     '',
            })

        i += 1

    return entries


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

    work_auth_m = re.search(
        r'\b(US\s+Citizen(?:ship)?|U\.S\.\s+Citizen(?:ship)?|Permanent\s+Resident|Green\s+Card'
        r'|H[-\s]?1B|H1B|OPT|STEM\s+OPT|EAD|L[-\s]?1|TN\s+Visa|TN-?\d?'
        r'|authorized\s+to\s+work|eligible\s+to\s+work)\b',
        text, re.I
    )
    work_auth = work_auth_m.group(0).strip() if work_auth_m else ""

    # Human languages only — stop at end of line to avoid spilling into the next section.
    # Also require the match to NOT be inside a "Technical Skills" / "Languages:" subsection
    # that lists programming languages, by checking it's followed by human language names.
    lang_m = re.search(
        r'(?:^|\n)\s*(?:human\s+)?languages?[:\-\s]+([A-Za-z][A-Za-z,/()\s]{2,80}?)(?:\n|$)',
        text, re.I
    )
    if lang_m:
        raw_lang = lang_m.group(1).strip().rstrip('.,;')
        # Reject if it looks like a programming-language list (Go, PHP, Java…)
        prog_langs = r'\b(Go|PHP|Java(?:Script)?|Python|Ruby|Rust|Swift|Kotlin|C\+\+|C#|Scala)\b'
        if re.search(prog_langs, raw_lang, re.I):
            languages = ""
        else:
            languages = re.sub(r'\s+', ' ', raw_lang)
    else:
        languages = ""

    # Collect all skill lines until a blank line or new section header
    skills_section_m = re.search(
        r'(?:technical\s+)?skills?[:\-\s]*\n((?:(?!^\s*(?:experience|education|summary|projects|certifications)\b).+\n?)+)',
        text, re.I | re.MULTILINE
    )
    if skills_section_m:
        skills_block = skills_section_m.group(1)
        # Strip bullet/label prefixes and join
        skill_parts = []
        for line in skills_block.splitlines():
            line = line.strip()
            if not line:
                break
            # Remove leading label like "Languages:", "Backend & Systems:"
            line = re.sub(r'^[A-Za-z &]+:\s*', '', line)
            if line:
                skill_parts.append(line)
        skills = ', '.join(skill_parts) if skill_parts else ""
    else:
        skills_m = re.search(
            r'(?:skills?|technologies|tech\s+stack|tools?|competencies)[:\-\s]+([^\n]{10,300})', text, re.I
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

    # Section headers to skip when hunting for the current title
    SECTION_HEADERS = re.compile(
        r'^(summary|experience|education|skills?|projects?|certifications?|awards?|'
        r'publications?|references?|languages?|interests?|objective|profile|contact)$',
        re.I
    )

    title_m    = re.search(r'(?:title|position|role|currently)[:\s]+([A-Z][^\n,|]{3,60})', text, re.I)
    curr_title = title_m.group(1).strip() if title_m else ""
    if not curr_title:
        # Try to find the first job title pattern: lines with Date ranges nearby
        # Look for a line that precedes a date line (Jan 20XX – …)
        date_pattern = re.compile(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2}', re.I)
        for i, line in enumerate(lines):
            if date_pattern.search(line):
                # The title is often on the same line before the date, or the line above
                title_candidate = re.sub(r'\s*' + date_pattern.pattern + r'.*', '', line, flags=re.I).strip()
                if title_candidate and 3 < len(title_candidate) < 80 and not SECTION_HEADERS.match(title_candidate):
                    curr_title = title_candidate
                    break
                if i > 0:
                    prev = lines[i - 1].strip()
                    if prev and 3 < len(prev) < 80 and not SECTION_HEADERS.match(prev):
                        curr_title = prev
                        break
    if not curr_title:
        # Last resort: second non-trivial line that isn't a section header
        skipped = 0
        for line in lines[:15]:
            if re.search(r'[@/\\|]|http|www\.|^\d', line, re.I):
                continue
            if SECTION_HEADERS.match(line):
                continue
            skipped += 1
            if skipped == 2 and len(line) < 80:
                curr_title = line
                break

    company_m = re.search(
        r'(?:company|employer|organization|at\s)[:\s]+([A-Z][^\n,|]{2,50})', text, re.I
    )
    curr_co = company_m.group(1).strip() if company_m else ""
    # Also try to find the company name right after the first job title line.
    # Skip the date line (e.g. "Jan 2026 – Present") and take the next non-bullet line.
    if not curr_co and curr_title:
        title_pos = text.find(curr_title)
        if title_pos != -1:
            remaining = text[title_pos + len(curr_title):]
            for co_line in remaining.split('\n'):
                co_line = co_line.strip().lstrip('•–-').strip()
                if not co_line:
                    continue
                if date_pattern.search(co_line):
                    continue  # skip the date range line
                if SECTION_HEADERS.match(co_line):
                    break
                if re.match(r'^[A-Z]', co_line) and len(co_line) <= 60:
                    curr_co = co_line
                    break

    NOT_CITY = re.compile(
        r'\b(Technology|Engineering|Computer|Science|Institute|University|College|'
        r'Management|Backend|Frontend|Software|Systems?|Services?|Solutions?|Academy|'
        r'Department|Faculty|School)\b', re.I
    )
    KNOWN_COUNTRIES = r'(?:India|USA|US|UK|United\s+Kingdom|United\s+States|Canada|Australia|Germany|France|Singapore)'
    US_STATES = r'(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)'

    city = ""
    # Match single-word city first (avoids false positives from "Technology Mumbai, India")
    for cm in re.finditer(rf'\b([A-Z][a-z]{{2,}}),\s*{KNOWN_COUNTRIES}\b', text):
        candidate = cm.group(1).strip()
        if not NOT_CITY.search(candidate):
            city = candidate
            break
    # Also try two-word city (e.g. "New York, India") — only if single-word didn't work
    if not city:
        for cm in re.finditer(rf'\b([A-Z][a-z]{{2,}}\s[A-Z][a-z]{{2,}}),\s*{KNOWN_COUNTRIES}\b', text):
            candidate = cm.group(1).strip()
            if not NOT_CITY.search(candidate):
                city = candidate
                break
    # Fallback: city, US-state pair
    if not city:
        for cm in re.finditer(rf'\b([A-Z][a-z]{{2,}}),\s*({US_STATES})\b(?![-\w])', text):
            candidate = cm.group(1).strip()
            if not NOT_CITY.search(candidate):
                city = candidate
                break

    state = ""
    for sm in re.finditer(rf'\b([A-Z][a-z]{{2,}}(?:\s[A-Z][a-z]{{2,}})?),\s*({US_STATES})\b(?![-\w])', text):
        if not NOT_CITY.search(sm.group(1)):
            state = sm.group(2)
            break

    zip_m    = re.search(r'\b\d{5}(?:-\d{4})?\b', text)
    zip_code = zip_m.group(0) if zip_m else ""

    country_m = re.search(
        r'\b(United States|USA|US|India|Canada|UK|United Kingdom|Australia|Germany|France|Singapore)\b',
        text, re.I
    )
    country = country_m.group(1) if country_m else ""

    sections = _split_sections(text)
    experience = _parse_experience_section(sections.get("experience", sections.get("work experience", "")))
    education  = _parse_education_section(sections.get("education", ""))

    return {
        "name": full_name, "firstName": first_name, "lastName": last_name,
        "email": email, "phone": phone,
        "linkedIn": linkedin, "github": github, "portfolio": portfolio,
        "currentTitle": curr_title, "currentCompany": curr_co,
        "yearsExperience": yoe, "skills": skills,
        "city": city, "state": state, "zipCode": zip_code, "country": country,
        "workAuthorization": work_auth, "languages": languages,
        "address": "", "experience": experience, "education": education,
    }
