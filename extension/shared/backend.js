import { getBackendUrl } from './storage.js';

// Route POST requests through the background service worker to bypass CORS.
// Service workers have cross-origin fetch privileges via host_permissions;
// content scripts do not, so direct fetch from a content script can be blocked.
async function post(path, body, timeoutMs = 15000) {
  const result = await chrome.runtime.sendMessage({
    type: 'BACKEND_FETCH',
    path,
    body,
    timeoutMs,
  });
  if (!result?.ok) throw new Error(result?.error ?? 'Backend fetch failed');
  return result.data;
}

export async function matchFields(fields, profile) {
  const slim = fields.map(({ options, ...rest }) => rest);
  const data = await post('/match', { fields: slim, profile }, 60000);
  return data.mapping;
}

export async function selectOptions(items) {
  const data = await post('/select-option', { items }, 12000);
  return data.selections ?? {};
}

export async function generateText({ profile, label, placeholder, nearby, host, resumeText }) {
  const data = await post('/generate', { profile, label, placeholder, nearby, host, resumeText: resumeText || '' }, 90000);
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
    return { profile: data.profile, resumeText: data.resumeText || '' };
  } finally {
    clearTimeout(timer);
  }
}
