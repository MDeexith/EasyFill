import axios from 'axios';

let BASE_URL = 'http://192.168.0.106:8000';

export function setBackendUrl(url) {
  BASE_URL = url.replace(/\/$/, '');
}

export function getBackendUrl() {
  return BASE_URL;
}

export async function matchFields(fields, profile) {
  const res = await axios.post(`${BASE_URL}/match`, { fields, profile });
  return res.data.mapping;
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
