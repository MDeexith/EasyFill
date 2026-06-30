export function enrichProfile(raw) {
  const p = { ...raw };
  if (!p.firstName && !p.lastName && p.name) {
    const parts = p.name.trim().split(/\s+/);
    p.firstName = parts[0] || '';
    p.lastName = parts.slice(1).join(' ') || '';
  }
  if (!p.name && (p.firstName || p.lastName)) {
    p.name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  }

  // Derive current title/company/yoe from experience[] when those keys are
  // empty, so the matcher has more profile keys to satisfy.
  const xp = Array.isArray(p.experience) ? p.experience : [];
  if (xp.length > 0) {
    const latest = xp[0] || {};
    if (!p.currentTitle && latest.title) p.currentTitle = latest.title;
    if (!p.currentCompany && latest.company) p.currentCompany = latest.company;
    if (!p.yearsExperience || p.yearsExperience === 0) {
      let totalMonths = 0;
      for (const e of xp) {
        const start = e.startDate ? new Date(e.startDate) : null;
        // Treat empty string, "Present", "present", "Now", "Current", etc. as today
        const endRaw = e.endDate;
        const end = (!endRaw || /^(present|current|now|ongoing)$/i.test(endRaw.trim()))
          ? new Date()
          : new Date(endRaw);
        if (start && !isNaN(start) && end && !isNaN(end) && end > start) {
          totalMonths += (end - start) / (1000 * 60 * 60 * 24 * 30.44);
        }
      }
      if (totalMonths > 0) p.yearsExperience = Math.round(totalMonths / 12);
    }
  }

  // Back-compat: legacy `salary` resolves to expectedSalary if the latter
  // is empty.
  if (!p.expectedSalary && p.salary) p.expectedSalary = p.salary;

  // Compose skills with any per-experience skills arrays.
  const skillSet = new Set();
  if (typeof p.skills === 'string' && p.skills.trim()) {
    p.skills.split(',').map(s => s.trim()).filter(Boolean).forEach(s => skillSet.add(s));
  }
  for (const e of xp) {
    if (Array.isArray(e.skills)) e.skills.forEach(s => s && skillSet.add(s));
  }
  if (skillSet.size > 0) p.skills = Array.from(skillSet).join(', ');

  return p;
}
