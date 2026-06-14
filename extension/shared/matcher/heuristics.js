// Confidence-scored heuristic field matcher.
//
// Each field is scored against multiple signal tiers. The highest-confidence
// non-null match wins. Tiers (high → low):
//
//   1.00  autocomplete token (deterministic, page-declared)
//   0.95  semantic input type (email/tel/url/date)
//   0.85  exact-token regex hit on `name`/`id`
//   0.70  regex hit on `label`/`ariaLabel`
//   0.60  regex hit on `placeholder`
//   0.50  regex hit on `nearbyText`
//
// The combiner (matcher/index.js) decides how to merge these with AI results.

// ── HTML5 autocomplete token → profile key (deterministic) ───────────────────
const AUTOCOMPLETE_MAP = {
  // names
  'name': 'name',
  'given-name': 'firstName',
  'additional-name': 'middleName',
  'family-name': 'lastName',
  'nickname': 'preferredName',
  'honorific-prefix': null,
  'honorific-suffix': null,

  // contact
  'email': 'email',
  'tel': 'phone',
  'tel-national': 'phone',
  'tel-area-code': 'phone',
  'tel-local': 'phone',

  // address
  'street-address': 'address',
  'address-line1': 'address',
  'address-line2': 'address',
  'address-level1': 'state',
  'address-level2': 'city',
  'postal-code': 'zipCode',
  'country': 'country',
  'country-name': 'country',

  // org / work
  'organization': 'currentCompany',
  'organization-title': 'currentTitle',

  // urls / dates
  'url': 'portfolio',
  'bday': 'dateOfBirth',
  'sex': 'gender',
};

// ── semantic type → profile key (deterministic) ──────────────────────────────
const TYPE_MAP = {
  email: 'email',
  tel: 'phone',
  url: 'portfolio',
  // `date` deliberately omitted — could be DOB or start date; let regex decide.
};

// ── label/text patterns, scored ──────────────────────────────────────────────
// Negation rules run first; a negative hit suppresses positive matches that
// would otherwise win on weak signals (e.g. "start date of previous role").
const NEGATION_RULES = [
  {
    key: 'startDate',
    deny: /\b(previous|past|former|prior|last)\s+(job|role|position|company|employment)|degree|graduat|education|university|college|school\b/i,
  },
];

const RULES = [
  // ── identity ────────────────────────────────────────────────────────────
  { key: 'firstName',         pattern: /\b(first[\s_-]?name|fname|given[\s_-]?name|forename)\b/i },
  { key: 'middleName',        pattern: /\b(middle[\s_-]?name|mname|middle[\s_-]?initial|mi)\b/i },
  { key: 'lastName',          pattern: /\b(last[\s_-]?name|lname|surname|family[\s_-]?name)\b/i },
  { key: 'preferredName',     pattern: /\b(preferred[\s_-]?name|nickname|goes[\s_-]?by|known[\s_-]?as)\b/i },
  { key: 'name',              pattern: /\b(full[\s_-]?name|your[\s_-]?name|applicant[\s_-]?name|candidate[\s_-]?name|legal[\s_-]?name)\b/i },
  { key: 'pronouns',          pattern: /\b(pronoun(s)?|preferred[\s_-]?pronouns?)\b/i },
  { key: 'dateOfBirth',       pattern: /\b(date[\s_-]?of[\s_-]?birth|dob|birth[\s_-]?date|birthday|bday)\b/i },
  { key: 'gender',            pattern: /\b(gender|sex)\b/i },

  // ── contact ─────────────────────────────────────────────────────────────
  { key: 'email',             pattern: /\b(e[\s_-]?mail|email[\s_-]?address|your[\s_-]?email)\b/i },
  { key: 'phone',             pattern: /\b(phone|mobile|cell|telephone|tel|contact[\s_-]?number|ph\.?)\b/i },

  // ── address ─────────────────────────────────────────────────────────────
  { key: 'address',           pattern: /\b(street[\s_-]?address|address[\s_-]?line[\s_-]?1?|mailing[\s_-]?address|home[\s_-]?address|residential[\s_-]?address)\b/i },
  { key: 'city',              pattern: /\b(city|town|locality)\b/i },
  { key: 'state',             pattern: /\b(state|province|region|county)\b/i },
  { key: 'zipCode',           pattern: /\b(zip[\s_-]?code|postal[\s_-]?code|zip|pincode|pin[\s_-]?code|post[\s_-]?code)\b/i },
  { key: 'country',           pattern: /\bcountry\b/i },

  // ── social / urls ───────────────────────────────────────────────────────
  { key: 'linkedIn',          pattern: /\b(linkedin|linked[\s_-]?in[\s_-]?(url|profile|link)?)\b/i },
  { key: 'github',            pattern: /\b(github|git[\s_-]?hub[\s_-]?(url|profile|link)?)\b/i },
  { key: 'portfolio',         pattern: /\b(portfolio|personal[\s_-]?website|website[\s_-]?url|website|blog|personal[\s_-]?url)\b/i },

  // ── job / work ──────────────────────────────────────────────────────────
  { key: 'currentTitle',      pattern: /\b(current[\s_-]?(job[\s_-]?)?title|current[\s_-]?role|current[\s_-]?position|present[\s_-]?title|job[\s_-]?title|designation)\b/i },
  { key: 'currentCompany',    pattern: /\b(current[\s_-]?company|present[\s_-]?company|employer|company[\s_-]?name|organization|organisation)\b/i },
  { key: 'yearsExperience',   pattern: /\b(years?[\s_-]?of[\s_-]?experience|experience[\s_-]?years|total[\s_-]?experience|exp[\s_-]?years|yoe)\b/i },
  { key: 'workAuthorization', pattern: /\b(work[\s_-]?authoriz(ation|ed)|legally[\s_-]?(authorized|allowed)[\s_-]?to[\s_-]?work|sponsorship|require[\s_-]?sponsorship|visa[\s_-]?status|right[\s_-]?to[\s_-]?work)\b/i },
  { key: 'willingToRelocate', pattern: /\b(willing[\s_-]?to[\s_-]?relocate|open[\s_-]?to[\s_-]?relocat(ion|e)|relocation)\b/i },
  { key: 'noticePeriod',      pattern: /\b(notice[\s_-]?period|days?[\s_-]?of[\s_-]?notice)\b/i },

  // ── compensation (split current vs expected) ────────────────────────────
  { key: 'currentSalary',     pattern: /\b(current[\s_-]?(salary|ctc|compensation|pay)|present[\s_-]?(salary|ctc))\b/i },
  { key: 'expectedSalary',    pattern: /\b(expected[\s_-]?(salary|ctc|compensation|pay)|desired[\s_-]?salary|salary[\s_-]?expectation|salary[\s_-]?range|pay[\s_-]?expectation)\b/i },
  // Generic salary catch-all (lower than the specific ones above; same tier text)
  { key: 'expectedSalary',    pattern: /\b(salary|compensation|ctc)\b/i, weight: 0.6 },

  // ── availability ────────────────────────────────────────────────────────
  { key: 'startDate',         pattern: /\b(available[\s_-]?(start[\s_-]?)?date|earliest[\s_-]?start[\s_-]?date|joining[\s_-]?date|when[\s_-]?can[\s_-]?you[\s_-]?start|availability|start[\s_-]?date)\b/i },

  // ── long-form ───────────────────────────────────────────────────────────
  { key: 'coverLetter',       pattern: /\b(cover[\s_-]?letter|why[\s_-]?(are|do|should|would)\s+you|tell[\s_-]?us|about[\s_-]?yourself|motivation|why[\s_-]?(apply|interested))\b/i },
  { key: 'coverLetter',       pattern: /\b(summary|professional[\s_-]?summary|bio|about|headline|objective)\b/i },

  // ── skills / languages / references ─────────────────────────────────────
  { key: 'skills',            pattern: /\b(skills|technical[\s_-]?skills|key[\s_-]?skills|core[\s_-]?skills|competencies|tech[\s_-]?stack|tools|technologies)\b/i },
  { key: 'languages',         pattern: /\b(languages?[\s_-]?(spoken|known)?|spoken[\s_-]?languages?)\b/i },
  { key: 'references',        pattern: /\b(references?|referee(s)?)\b/i },
];

// ── confidence tiers per signal source ───────────────────────────────────────
const TIER = {
  autocomplete: 1.0,
  type: 0.95,
  nameId: 0.85,
  label: 0.70,
  placeholder: 0.60,
  nearby: 0.50,
};

function normalise(s) {
  return (s || '').toString().toLowerCase().trim();
}

function isNegated(field, key) {
  for (const neg of NEGATION_RULES) {
    if (neg.key !== key) continue;
    const text = [field.label, field.ariaLabel, field.nearbyText, field.placeholder]
      .filter(Boolean).join(' ');
    if (neg.deny.test(text)) return true;
  }
  return false;
}

function bestRegexMatch(text, source) {
  if (!text) return null;
  let best = null;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      const tier = TIER[source] || 0.5;
      const conf = rule.weight ? Math.min(tier, rule.weight) : tier;
      if (!best || conf > best.confidence) {
        best = { key: rule.key, confidence: conf, source };
      }
    }
  }
  return best;
}

// Score one field against every signal source; return the best decision
// (or null if nothing matched).
export function scoreField(field) {
  const candidates = [];

  // Tier 1: autocomplete token (deterministic)
  const ac = normalise(field.autocomplete);
  if (ac && ac !== 'off' && ac !== 'on') {
    // autocomplete may be a space-separated list ("section-foo shipping email");
    // take the last token, which per spec is the field token.
    const token = ac.split(/\s+/).filter(Boolean).pop();
    if (token && Object.prototype.hasOwnProperty.call(AUTOCOMPLETE_MAP, token)) {
      const key = AUTOCOMPLETE_MAP[token];
      if (key) candidates.push({ key, confidence: TIER.autocomplete, source: 'autocomplete' });
    }
  }

  // Tier 2: semantic type
  const t = normalise(field.inputType || field.type);
  if (t && Object.prototype.hasOwnProperty.call(TYPE_MAP, t)) {
    candidates.push({ key: TYPE_MAP[t], confidence: TIER.type, source: 'type' });
  }

  // Tier 3-6: regex on each text source independently
  const sources = [
    ['nameId',      [field.name, field.domId].filter(Boolean).join(' ')],
    ['label',       [field.label, field.ariaLabel].filter(Boolean).join(' ')],
    ['placeholder', field.placeholder || ''],
    ['nearby',      field.nearbyText || ''],
  ];
  for (const [srcKey, text] of sources) {
    const m = bestRegexMatch(text, srcKey);
    if (m) candidates.push(m);
  }

  if (candidates.length === 0) return null;

  // Highest confidence wins; ties broken by deterministic source order.
  candidates.sort((a, b) => b.confidence - a.confidence);
  const winner = candidates[0];

  if (isNegated(field, winner.key)) {
    // Try the next-best candidate that isn't negated for the same key.
    for (let i = 1; i < candidates.length; i++) {
      if (!isNegated(field, candidates[i].key)) return candidates[i];
    }
    return null;
  }
  return winner;
}

// Backwards-compatible API: returns { mapping, unmatched, decisions }.
// `mapping[id]` is the resolved profile key (or null).
// `decisions[id]` carries { key, confidence, source } for the combiner/UI.
export function applyHeuristics(fields) {
  const mapping = {};
  const decisions = {};
  const unmatched = [];

  for (const field of fields) {
    const decision = scoreField(field);
    if (decision) {
      mapping[field.id] = decision.key;
      decisions[field.id] = decision;
    } else {
      mapping[field.id] = null;
      unmatched.push(field);
    }
  }

  return { mapping, decisions, unmatched };
}
