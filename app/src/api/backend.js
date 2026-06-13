import axios from 'axios';

let BASE_URL = 'https://easyfill.onrender.com';

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
  const res = await axios.post(`${BASE_URL}/match`, { fields: slim, profile }, { timeout: 12000 });
  return res.data.mapping;
}

export async function selectOptions(items) {
  const res = await axios.post(`${BASE_URL}/select-option`, { items }, { timeout: 12000 });
  return res.data.selections || {};
}

export async function generateText({ profile, label, placeholder, nearby, host }) {
  const res = await axios.post(`${BASE_URL}/generate`, {
    profile, label, placeholder, nearby, host,
  }, { timeout: 90000 });
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
