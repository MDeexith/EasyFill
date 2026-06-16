import { getBackendUrl } from './storage.js';

async function post(path, body, timeoutMs = 15000) {
  const base = await getBackendUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function matchFields(fields, profile) {
  const slim = fields.map(({ options, ...rest }) => rest);
  const data = await post('/match', { fields: slim, profile }, 12000);
  return data.mapping;
}

export async function selectOptions(items) {
  const data = await post('/select-option', { items }, 12000);
  return data.selections ?? {};
}

export async function generateText({ profile, label, placeholder, nearby, host }) {
  const data = await post('/generate', { profile, label, placeholder, nearby, host }, 90000);
  return data.text;
}

// file is a browser File object (from <input type="file"> or drag-drop)
export async function parseResume(file) {
  const base = await getBackendUrl();
  const formData = new FormData();
  formData.append('file', file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${base}/parse-resume`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.profile;
  } finally {
    clearTimeout(timer);
  }
}
