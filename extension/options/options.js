import { loadProfile, saveProfile, setOnboarded, saveResumeText } from '../shared/storage.js';
import { parseResume } from '../shared/backend.js';
import { enrichProfile } from '../shared/enrich.js';

// ─── State ───────────────────────────────────────────────────────────────────

let experience = [];
let education  = [];

// ─── Toast ───────────────────────────────────────────────────────────────────

let toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 3000);
}

// ─── Read / write flat profile fields ────────────────────────────────────────

function readForm() {
  const profile = {};
  document.querySelectorAll('[data-key]').forEach(el => {
    const key = el.dataset.key;
    profile[key] = el.value ?? '';
  });
  profile.yearsExperience = Number(profile.yearsExperience) || 0;
  profile.experience = experience;
  profile.education  = education;
  return profile;
}

function populateForm(profile) {
  document.querySelectorAll('[data-key]').forEach(el => {
    const key = el.dataset.key;
    if (profile[key] !== undefined && profile[key] !== null) {
      el.value = profile[key];
    }
  });
}

// ─── Experience list ──────────────────────────────────────────────────────────

const EXP_FIELDS = [
  { key: 'title',       label: 'Job title',          col: 1 },
  { key: 'company',     label: 'Company',             col: 1 },
  { key: 'location',    label: 'Location',            col: 1 },
  { key: 'startDate',   label: 'Start (YYYY-MM)',     col: 1, placeholder: '2021-06' },
  { key: 'endDate',     label: 'End (YYYY-MM or blank for current)', col: 1, placeholder: '2024-01' },
  { key: 'skills',      label: 'Skills (comma-separated)', col: 2 },
  { key: 'description', label: 'Description',         col: 2, textarea: true },
];

const EDU_FIELDS = [
  { key: 'degree',      label: 'Degree',              col: 1 },
  { key: 'institution', label: 'Institution',         col: 1 },
  { key: 'field',       label: 'Field of study',      col: 1 },
  { key: 'year',        label: 'Graduation year',     col: 1, placeholder: '2022' },
  { key: 'startDate',   label: 'Start (YYYY-MM)',     col: 1, placeholder: '2018-09' },
  { key: 'endDate',     label: 'End (YYYY-MM)',       col: 1, placeholder: '2022-05' },
];

function buildEntryCard(entry, fields, index, onDelete, onUpdate) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.index = index;

  // Header — shows title/degree + company/institution as summary
  const primaryKey   = fields[0].key;
  const secondaryKey = fields[1].key;
  const primaryVal   = entry[primaryKey]   || 'Untitled';
  const secondaryVal = entry[secondaryKey] || '';

  card.innerHTML = `
    <div class="entry-header">
      <div style="flex:1;overflow:hidden">
        <div class="entry-title">${escHtml(primaryVal)}</div>
        ${secondaryVal ? `<div class="entry-sub">${escHtml(secondaryVal)}</div>` : ''}
      </div>
      <span class="entry-chevron">▼</span>
    </div>
    <div class="entry-body">
      <div class="grid2" style="margin-bottom:14px">
        ${fields.filter(f => f.col === 1).map(f => `
          <div class="field ${f.col === 2 ? 'col-span-2' : ''}">
            <label>${f.label}</label>
            ${f.textarea
              ? `<textarea data-entry-key="${f.key}" rows="4" placeholder="${f.placeholder||''}">${escHtml(entry[f.key]||'')}</textarea>`
              : `<input type="text" data-entry-key="${f.key}" value="${escHtml(entry[f.key]||'')}" placeholder="${f.placeholder||''}">`
            }
          </div>
        `).join('')}
      </div>
      ${fields.filter(f => f.col === 2).map(f => `
        <div class="field" style="margin-bottom:14px">
          <label>${f.label}</label>
          ${f.textarea
            ? `<textarea data-entry-key="${f.key}" rows="4" placeholder="${f.placeholder||''}">${escHtml(entry[f.key]||'')}</textarea>`
            : `<input type="text" data-entry-key="${f.key}" value="${escHtml(entry[f.key]||'')}" placeholder="${f.placeholder||''}">`
          }
        </div>
      `).join('')}
      <div class="entry-footer">
        <button class="btn btn-danger btn-sm btn-remove">Remove</button>
      </div>
    </div>
  `;

  // Toggle open/close
  card.querySelector('.entry-header').addEventListener('click', () => {
    card.classList.toggle('open');
  });

  // Collect values on any input change
  card.querySelectorAll('[data-entry-key]').forEach(el => {
    el.addEventListener('input', () => {
      const updated = {};
      card.querySelectorAll('[data-entry-key]').forEach(i => {
        updated[i.dataset.entryKey] = i.value;
      });
      onUpdate(index, updated);
      // Update the header preview live
      const titleEl = card.querySelector('.entry-title');
      const subEl   = card.querySelector('.entry-sub');
      if (titleEl) titleEl.textContent = updated[primaryKey] || 'Untitled';
      if (subEl)   subEl.textContent   = updated[secondaryKey] || '';
    });
  });

  card.querySelector('.btn-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    onDelete(index);
  });

  return card;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderExperience() {
  const list = document.getElementById('experience-list');
  list.innerHTML = '';
  if (experience.length === 0) {
    list.innerHTML = '<p class="empty-state">No experience entries yet.</p>';
    return;
  }
  experience.forEach((entry, i) => {
    const card = buildEntryCard(
      entry,
      EXP_FIELDS,
      i,
      (idx) => { experience.splice(idx, 1); renderExperience(); },
      (idx, updated) => { experience[idx] = { ...experience[idx], ...updated }; }
    );
    list.appendChild(card);
  });
}

function renderEducation() {
  const list = document.getElementById('education-list');
  list.innerHTML = '';
  if (education.length === 0) {
    list.innerHTML = '<p class="empty-state">No education entries yet.</p>';
    return;
  }
  education.forEach((entry, i) => {
    const card = buildEntryCard(
      entry,
      EDU_FIELDS,
      i,
      (idx) => { education.splice(idx, 1); renderEducation(); },
      (idx, updated) => { education[idx] = { ...education[idx], ...updated }; }
    );
    list.appendChild(card);
  });
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function doSave() {
  const raw = readForm();
  const profile = enrichProfile(raw);
  await saveProfile(profile);
  await setOnboarded(true);
  // Sync the name fields that enrichProfile may have derived
  if (profile.name !== raw.name) {
    const nameEl = document.querySelector('[data-key="name"]');
    if (nameEl) nameEl.value = profile.name;
  }
  toast('Profile saved ✓');
}

// ─── Resume upload ────────────────────────────────────────────────────────────

async function doUpload(file) {
  const btn = document.getElementById('btn-upload');
  const label = document.getElementById('upload-label');
  btn.disabled = true;
  label.innerHTML = '<span class="spinner"></span> Parsing…';

  try {
    const { profile: parsed, resumeText } = await parseResume(file);
    if (!parsed) throw new Error('No profile returned');

    // Save raw resume text for context when generating open-ended answers later
    if (resumeText) await saveResumeText(resumeText);

    // Normalise skills array → comma-separated string (backend sometimes returns array)
    if (Array.isArray(parsed.skills)) parsed.skills = parsed.skills.join(', ');

    // Merge into form: backend value wins only when it's non-empty
    const current = readForm();
    const merged = { ...current };
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined && v !== null && v !== '' && k !== 'experience' && k !== 'education') {
        merged[k] = v;
      }
    }
    populateForm(merged);

    // Merge array fields — normalise field keys to match the form
    if (Array.isArray(parsed.experience) && parsed.experience.length > 0) {
      experience = parsed.experience.map(e => ({
        ...e,
        // skills may come back as an array from some AI models
        skills: Array.isArray(e.skills) ? e.skills.join(', ') : (e.skills || ''),
      }));
      renderExperience();
    }
    if (Array.isArray(parsed.education) && parsed.education.length > 0) {
      education = parsed.education.map(e => ({
        ...e,
        // older prompt used graduationYear; new prompt uses year — support both
        year: e.year || e.graduationYear || '',
      }));
      renderEducation();
    }

    toast('Résumé parsed — review and save ✓');
  } catch (err) {
    console.error('[EasyFill] Resume parse error:', err);
    toast('Parse failed: ' + (err?.message || 'unknown error'), 'error');
  } finally {
    btn.disabled = false;
    label.textContent = 'Upload PDF';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const profile = await loadProfile();
  populateForm(profile);
  experience = Array.isArray(profile.experience) ? profile.experience : [];
  education  = Array.isArray(profile.education)  ? profile.education  : [];
  renderExperience();
  renderEducation();

  // Save buttons
  document.getElementById('btn-save').addEventListener('click', doSave);
  document.getElementById('btn-save-bottom').addEventListener('click', doSave);

  // Resume upload
  const resumeInput = document.getElementById('resume-input');
  document.getElementById('btn-upload').addEventListener('click', () => resumeInput.click());
  resumeInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
    resumeInput.value = '';
  });

  // Add experience / education
  document.getElementById('btn-add-exp').addEventListener('click', () => {
    experience.unshift({});
    renderExperience();
    // Auto-open the new card
    const firstCard = document.querySelector('#experience-list .entry-card');
    if (firstCard) firstCard.classList.add('open');
  });

  document.getElementById('btn-add-edu').addEventListener('click', () => {
    education.unshift({});
    renderEducation();
    const firstCard = document.querySelector('#education-list .entry-card');
    if (firstCard) firstCard.classList.add('open');
  });
}

init();
