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
  willingToRelocate: '',
  noticePeriod: '',

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
  willingToRelocate: 'Willing to Relocate',
  noticePeriod: 'Notice Period',

  salary: 'Expected Salary (legacy)',
  currentSalary: 'Current Salary',
  expectedSalary: 'Expected Salary',
  startDate: 'Available Start Date',

  coverLetter: 'Cover Letter',
  skills: 'Skills (comma-separated)',
  languages: 'Languages',
  references: 'References',
};
