export function questionText(field) {
  return (field.question || field.label || field.ariaLabel || '').replace(/\s+/g, ' ').trim();
}

export function isAcknowledgment(field) {
  return /acknowledg|\bcertify\b|\battest(?:ation)?\b|consent|\bi agree\b|terms (and|&) conditions/i.test(questionText(field));
}

export function answerKey(field, url) {
  const question = questionText(field).replace(/\s+/g, ' ').toLowerCase();
  if (!question) return null;
  try {
    const site = new URL(url);
    // Shared ATS hosts distinguish employers by path or the Greenhouse tenant.
    const scope = site.hostname + '/' + (site.searchParams.get('for') || site.pathname.split('/').filter(Boolean)[0] || '');
    return JSON.stringify(['site-answer-v1', scope, question]);
  } catch { return null; }
}

export function remainingQuestions(fields, outcomes = {}) {
  return fields.filter(f => f.visible !== false && !f.disabled && !f.hasValue &&
    ((f.hasValue === false && f.widget !== 'checkbox') || outcomes[f.id] !== 'filled') && f.type !== 'password' && questionText(f) &&
    ['text', 'textarea', 'contenteditable', 'select', 'button-dropdown', 'combobox-input', 'checkbox'].includes(f.widget));
}

export function savedAnswers(fields, url, memory) {
  const answers = {};
  for (const field of remainingQuestions(fields)) {
    if (isAcknowledgment(field)) continue;
    const key = answerKey(field, url);
    if (key && typeof memory[key] === 'string' && memory[key].trim()) answers[field.id] = memory[key];
  }
  return answers;
}

export function answersToRemember(fields, answers, outcomes, url) {
  const memory = {};
  for (const field of fields) {
    const value = answers[field.id];
    const key = answerKey(field, url);
    if (key && !isAcknowledgment(field) && outcomes[field.id] === 'filled' && typeof value === 'string' && value.trim()) {
      memory[key] = (field.options?.find(option => option.value === value)?.label || value).trim();
    }
  }
  return memory;
}
