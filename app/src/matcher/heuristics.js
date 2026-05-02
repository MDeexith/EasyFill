const RULES = [
  // ── Name ──────────────────────────────────────────────────────────────────
  { pattern: /\b(first[\s_-]?name|fname|given[\s_-]?name|forename)\b/i, key: 'firstName' },
  { pattern: /\b(last[\s_-]?name|lname|surname|family[\s_-]?name)\b/i, key: 'lastName' },
  { pattern: /\b(full[\s_-]?name|your[\s_-]?name|applicant[\s_-]?name|candidate[\s_-]?name)\b/i, key: 'name' },

  // ── Contact ───────────────────────────────────────────────────────────────
  { pattern: /\b(e[\s_-]?mail|email[\s_-]?address|your[\s_-]?email)\b/i, key: 'email' },
  { pattern: /\b(phone|mobile|cell|telephone|tel|contact[\s_-]?number|ph\.?)\b/i, key: 'phone' },

  // ── Address ───────────────────────────────────────────────────────────────
  { pattern: /\b(street[\s_-]?address|address[\s_-]?line[\s_-]?1|mailing[\s_-]?address|home[\s_-]?address)\b/i, key: 'address' },
  { pattern: /\bcity\b/i, key: 'city' },
  { pattern: /\b(state|province|region)\b/i, key: 'state' },
  { pattern: /\b(zip[\s_-]?code|postal[\s_-]?code|zip|pincode|pin[\s_-]?code)\b/i, key: 'zipCode' },
  { pattern: /\bcountry\b/i, key: 'country' },

  // ── Social / URLs ─────────────────────────────────────────────────────────
  { pattern: /\b(linkedin|linked[\s_-]?in[\s_-]?url|linkedin[\s_-]?profile|linkedin[\s_-]?link)\b/i, key: 'linkedIn' },
  { pattern: /\b(github|git[\s_-]?hub[\s_-]?url|github[\s_-]?profile|github[\s_-]?link)\b/i, key: 'github' },
  { pattern: /\b(portfolio|personal[\s_-]?website|website[\s_-]?url|website|blog|personal[\s_-]?url)\b/i, key: 'portfolio' },

  // ── Job / Work ────────────────────────────────────────────────────────────
  { pattern: /\b(job[\s_-]?title|current[\s_-]?title|current[\s_-]?role|current[\s_-]?position|designation)\b/i, key: 'currentTitle' },
  { pattern: /\b(current[\s_-]?company|present[\s_-]?company|employer|company[\s_-]?name|organization)\b/i, key: 'currentCompany' },
  { pattern: /\b(years[\s_-]?of[\s_-]?experience|experience[\s_-]?years|total[\s_-]?experience|exp[\s_-]?years)\b/i, key: 'yearsExperience' },

  // ── Long-form ─────────────────────────────────────────────────────────────
  { pattern: /\b(cover[\s_-]?letter|why[\s_-]?(are|do|should|would)\s+you|tell[\s_-]?us|about[\s_-]?yourself|motivation|why[\s_-]?apply|why[\s_-]?interested)\b/i, key: 'coverLetter' },
  { pattern: /\b(summary|professional[\s_-]?summary|bio|about|headline|objective)\b/i, key: 'coverLetter' },

  // ── Salary / Dates ────────────────────────────────────────────────────────
  { pattern: /\b(salary[\s_-]?expectation|expected[\s_-]?salary|desired[\s_-]?salary|salary[\s_-]?range|current[\s_-]?salary|ctc|compensation|pay[\s_-]?expectation)\b/i, key: 'salary' },
  { pattern: /\b(start[\s_-]?date|available[\s_-]?date|availability|joining[\s_-]?date|notice[\s_-]?period|when[\s_-]?can[\s_-]?you[\s_-]?start)\b/i, key: 'startDate' },

  // ── Skills ────────────────────────────────────────────────────────────────
  { pattern: /\b(skills|technical[\s_-]?skills|key[\s_-]?skills|core[\s_-]?skills|competencies|tech[\s_-]?stack|tools|technologies)\b/i, key: 'skills' },
];

function getFieldText(f) {
  return [f.label, f.name, f.placeholder, f.ariaLabel, f.nearbyText]
    .filter(Boolean)
    .join(' ');
}

export function applyHeuristics(fields) {
  const mapping = {};
  const unmatched = [];

  for (const field of fields) {
    const text = getFieldText(field);
    let matched = false;

    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        mapping[field.id] = rule.key;
        matched = true;
        break;
      }
    }

    if (!matched) {
      mapping[field.id] = null;
      unmatched.push(field);
    }
  }

  return { mapping, unmatched };
}
