import axios from 'axios';

let BASE_URL = 'https://easyfill.onrender.com';

// Every LLM-backed route shares one budget. The backend allows an 80s
// OpenRouter call plus a ~30s paid-tier fallback, so a shorter client timeout
// just aborts work the server would have finished: /match on a 10-field form
// measures 13-20s on free models, which the old 12s ceiling cut off every time.
const LLM_TIMEOUT = 90000;

export function setBackendUrl(url) {
  BASE_URL = url.replace(/\/$/, '');
}

export function getBackendUrl() {
  return BASE_URL;
}

export async function matchFields(fields, profile) {
  // The /match endpoint only does key-matching and ignores dropdown options;
  // strip the (potentially large) options arrays to keep the payload small.
  const slim = fields.map(({ options, ...rest }) => rest);
  const res = await axios.post(`${BASE_URL}/match`, { fields: slim, profile }, { timeout: LLM_TIMEOUT });
  // Prefer `decisions` — it carries per-field confidence, which the matcher
  // needs to rank AI against regex. `mapping` is the flat legacy shape kept
  // for older backends; normaliseAi() accepts either.
  return res.data.decisions || res.data.mapping;
}

export async function selectOptions(items) {
  const res = await axios.post(`${BASE_URL}/select-option`, { items }, { timeout: LLM_TIMEOUT });
  return res.data.selections || {};
}

export async function generateText({ profile, label, placeholder, nearby, host }) {
  const res = await axios.post(`${BASE_URL}/generate`, {
    profile, label, placeholder, nearby, host,
  }, { timeout: LLM_TIMEOUT });
  return res.data.text;
}

export async function parseResume(fileUri, fileName) {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: 'application/pdf',
  });

  const res = await axios.post(`${BASE_URL}/parse-resume`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return res.data.profile;
}
