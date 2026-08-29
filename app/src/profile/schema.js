export const EMPTY_PROFILE = {
  // ── identity ──────────────────────────────────────────────────────────────
  firstName: '',
  middleName: '',
  lastName: '',
  preferredName: '',
  name: '',
  pronouns: '',
  dateOfBirth: '',
  gender: '',

  // ── contact ───────────────────────────────────────────────────────────────
  email: '',
  phone: '',

  // ── address ───────────────────────────────────────────────────────────────
  address: '',
  city: '',
  state: '',
  zipCode: '',
  country: '',

  // ── social / urls ─────────────────────────────────────────────────────────
  linkedIn: '',
  portfolio: '',
  github: '',

  // ── job / work ────────────────────────────────────────────────────────────
  currentTitle: '',
  currentCompany: '',
  yearsExperience: 0,
  workAuthorization: '',
  authorizedToWork: '',
  requiresSponsorship: '',
  willingToRelocate: '',
  noticePeriod: '',

  // ── equal-opportunity (US applications) ───────────────────────────────────
  // Defaults to decline; populated only when the user opts in.
  hispanicLatino: '',
  veteranStatus: '',
  disabilityStatus: '',

  // ── application misc ──────────────────────────────────────────────────────
  heardAboutUs: '',

  // ── compensation / availability ───────────────────────────────────────────
  // `salary` is kept as a deprecated alias resolving to expectedSalary.
  salary: '',
  currentSalary: '',
  expectedSalary: '',
  startDate: '',

  // ── content ───────────────────────────────────────────────────────────────
  coverLetter: '',
  skills: '',
  languages: '',
  references: '',

  // ── enrichment sources (arrays — not directly mapped, used by enrichProfile) ─
  experience: [],
  education: [],
};

export const PROFILE_FIELD_LABELS = {
  firstName: 'First Name',
  middleName: 'Middle Name',
  lastName: 'Last Name',
  preferredName: 'Preferred Name',
  name: 'Full Name',
  pronouns: 'Pronouns',
  dateOfBirth: 'Date of Birth',
  gender: 'Gender',

  email: 'Email',
  phone: 'Phone',

  address: 'Address',
  city: 'City',
  state: 'State',
  zipCode: 'Zip Code',
  country: 'Country',

  linkedIn: 'LinkedIn URL',
  portfolio: 'Portfolio URL',
  github: 'GitHub URL',

  currentTitle: 'Current Job Title',
  currentCompany: 'Current Company',
  yearsExperience: 'Years of Experience',
  workAuthorization: 'Work Authorization',
  authorizedToWork: 'Authorized to Work',
  requiresSponsorship: 'Requires Visa Sponsorship',
  willingToRelocate: 'Willing to Relocate',
  noticePeriod: 'Notice Period',

  hispanicLatino: 'Hispanic / Latino',
  veteranStatus: 'Veteran Status',
  disabilityStatus: 'Disability Status',

  heardAboutUs: 'How You Heard About the Job',

  salary: 'Expected Salary (legacy)',
  currentSalary: 'Current Salary',
  expectedSalary: 'Expected Salary',
  startDate: 'Available Start Date',

  coverLetter: 'Cover Letter',
  skills: 'Skills (comma-separated)',
  languages: 'Languages',
  references: 'References',
};

// ── Profile editor layout ────────────────────────────────────────────────────
// Which keys the Profile tab exposes for editing, and in what grouping.
// Lives here (rather than in ProfileScreen) so it can be asserted against
// EMPTY_PROFILE without loading the screen — ProfileScreen pulls in MMKV via
// profile/store.js and cannot be imported under Jest.
//
// Every fillable key MUST appear in exactly one section: onboarding is the
// only other place these get set, and it is gated behind `isOnboarded()`, so
// a key missing from here is a key an existing user can never change.
export const PROFILE_EDITOR_SECTIONS = [
  { title: 'Identity', fields: ['firstName', 'lastName', 'email', 'phone', 'pronouns', 'dateOfBirth'] },
  { title: 'Location', fields: ['city', 'state', 'country', 'zipCode'] },
  { title: 'Links', fields: ['linkedIn', 'portfolio', 'github'] },
  { title: 'Work', fields: ['currentTitle', 'currentCompany', 'yearsExperience', 'salary', 'startDate', 'skills', 'heardAboutUs'] },
  // For yes/no questions enter exactly "Yes" or "No" — the autofill engine
  // matches these against radio/select option labels at fill time.
  {
    title: 'Eligibility',
    fields: ['authorizedToWork', 'requiresSponsorship', 'workAuthorization', 'willingToRelocate', 'noticePeriod'],
    note: 'Answer the Yes/No questions with exactly "Yes" or "No" — that is what gets matched against the form\'s options.',
  },
  // `gender` moved here from Identity so all four EEO answers live together
  // under one banner about how they are handled. These values are never sent
  // to the backend (see api/backend.js redactSensitive); they are filled
  // on-device only.
  {
    title: 'Equal opportunity (optional)',
    fields: ['gender', 'hispanicLatino', 'veteranStatus', 'disabilityStatus'],
    note: 'US applications ask for these. They stay on your device and are never sent to our servers or to any AI model.',
  },
  { title: 'Cover letter', fields: ['coverLetter'] },
];

// Stored profiles predate later schema additions, so a profile read from disk
// can be missing keys entirely. Merging against EMPTY_PROFILE guarantees every
// key exists without clobbering anything the user has already set.
export function mergeWithSchema(stored) {
  return { ...EMPTY_PROFILE, ...(stored || {}) };
}
