const RULES = [
  { pattern: /\b(first[\s_-]?name|fname|given[\s_-]?name)\b/i, key: 'firstName' },
  { pattern: /\b(last[\s_-]?name|lname|surname|family[\s_-]?name)\b/i, key: 'lastName' },
  { pattern: /\b(full[\s_-]?name|your[\s_-]?name)\b/i, key: 'name' },
  { pattern: /\b(e[\s_-]?mail|email[\s_-]?address)\b/i, key: 'email' },
  { pattern: /\b(phone|mobile|cell|telephone|tel)\b/i, key: 'phone' },
  { pattern: /\b(street[\s_-]?address|address[\s_-]?line[\s_-]?1|mailing[\s_-]?address)\b/i, key: 'address' },
  { pattern: /\bcity\b/i, key: 'city' },
  { pattern: /\b(state|province|region)\b/i, key: 'state' },
  { pattern: /\b(zip[\s_-]?code|postal[\s_-]?code|zip)\b/i, key: 'zipCode' },
  { pattern: /\bcountry\b/i, key: 'country' },
  { pattern: /\b(linkedin|linked[\s_-]?in[\s_-]?url|linkedin[\s_-]?profile)\b/i, key: 'linkedIn' },
  { pattern: /\b(portfolio|personal[\s_-]?website|website[\s_-]?url|website)\b/i, key: 'portfolio' },
  { pattern: /\b(github|git[\s_-]?hub[\s_-]?url|github[\s_-]?profile)\b/i, key: 'github' },
  { pattern: /\b(job[\s_-]?title|current[\s_-]?title|position|role)\b/i, key: 'currentTitle' },
  { pattern: /\b(current[\s_-]?company|employer|company[\s_-]?name)\b/i, key: 'currentCompany' },
  { pattern: /\b(years[\s_-]?of[\s_-]?experience|experience[\s_-]?years)\b/i, key: 'yearsExperience' },
  { pattern: /\b(cover[\s_-]?letter|why[\s_-]?are[\s_-]?you|tell[\s_-]?us)\b/i, key: 'coverLetter' },
  { pattern: /\b(salary[\s_-]?expectation|expected[\s_-]?salary|desired[\s_-]?salary|compensation)\b/i, key: 'salary' },
  { pattern: /\b(start[\s_-]?date|available[\s_-]?date|availability)\b/i, key: 'startDate' },
  { pattern: /\b(skills|technical[\s_-]?skills|key[\s_-]?skills)\b/i, key: 'skills' },
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
