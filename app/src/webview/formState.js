// Values/options change during filling; only the question's identity matters.
export function fieldIdentity(field) {
  return JSON.stringify([
    field.id, field.domId, field.name, field.question || field.label || field.ariaLabel,
    field.type, field.widget, field.autocomplete, field.placeholder,
  ]);
}

export function selectChangedFields(previous, current) {
  const before = new Map(previous.map(field => [field.id, field]));
  return current.filter(field => {
    if (field.disabled || (field.visible === false && field.widget !== 'file')) return false;
    const old = before.get(field.id);
    return !old || (old.visible === false && field.visible !== false) || old.disabled ||
      fieldIdentity(old) !== fieldIdentity(field);
  });
}


export function selectResumeFields(fields) {
  return fields.filter(field => {
    if (field.widget !== 'file' && field.type !== 'file') return false;
    const label = [field.label, field.ariaLabel, field.placeholder].filter(Boolean).join(' ');
    const identity = label || [field.name, field.nearbyText].filter(Boolean).join(' ');
    return /resume|\bcv\b|curriculum/i.test(identity);
  });
}
