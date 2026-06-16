import { loadProfile, getBackendUrl, setBackendUrl } from '../shared/storage.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const noProfile   = $('no-profile');
const ready       = $('ready');
const noFields    = $('no-fields');
const statFields  = $('stat-fields');
const statMapped  = $('stat-mapped');
const pageUrl     = $('page-url');
const settingsPanel = $('settings-panel');
const backendUrlInput = $('backend-url');

// ─── Active tab helpers ───────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tab, msg) {
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    return null;
  }
}

// ─── Render states ────────────────────────────────────────────────────────────

function showState(state) {
  [noProfile, ready, noFields].forEach(el => el.classList.add('hidden'));
  state.classList.remove('hidden');
}

function renderStatus(status) {
  if (!status || status.fieldsFound === 0) {
    showState(noFields);
    return;
  }
  showState(ready);
  statFields.textContent = status.fieldsFound;
  statMapped.textContent = status.fieldsMapped ?? '—';
  try {
    const u = new URL(status.url || '');
    pageUrl.textContent = u.hostname + u.pathname;
  } catch {
    pageUrl.textContent = status.url || '—';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const profile = await loadProfile();
  const hasProfile = profile && (profile.firstName || profile.email || profile.name);

  if (!hasProfile) {
    showState(noProfile);
    return;
  }

  const tab = await getActiveTab();
  if (!tab) { showState(noFields); return; }

  const status = await sendToTab(tab, { type: 'GET_STATUS' });
  renderStatus(status);

  const url = await getBackendUrl();
  backendUrlInput.value = url;
}

// ─── Event listeners ──────────────────────────────────────────────────────────

$('btn-setup').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$('btn-edit-profile').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$('btn-settings').addEventListener('click', async () => {
  const isOpen = !settingsPanel.classList.contains('hidden');
  if (isOpen) {
    settingsPanel.classList.add('hidden');
  } else {
    const url = await getBackendUrl();
    backendUrlInput.value = url;
    settingsPanel.classList.remove('hidden');
  }
});

$('btn-cancel-settings').addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

$('btn-save-url').addEventListener('click', async () => {
  const url = backendUrlInput.value.trim();
  if (!url) return;
  await setBackendUrl(url);
  settingsPanel.classList.add('hidden');
});

async function triggerFill() {
  const tab = await getActiveTab();
  if (!tab) return;
  await sendToTab(tab, { type: 'TRIGGER_FILL' });
}

async function triggerRescan() {
  const tab = await getActiveTab();
  if (!tab) return;
  await sendToTab(tab, { type: 'RESCAN' });
  setTimeout(async () => {
    const status = await sendToTab(tab, { type: 'GET_STATUS' });
    renderStatus(status);
  }, 1500);
}

$('btn-fill').addEventListener('click', triggerFill);
$('btn-rescan').addEventListener('click', triggerRescan);
$('btn-rescan2').addEventListener('click', triggerRescan);

// ─── Listen for live updates from content script ──────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'FIELDS_FOUND') {
    if (msg.count > 0) {
      statFields.textContent = msg.count;
      showState(ready);
      pageUrl.textContent = '';
      try { const u = new URL(msg.url || ''); pageUrl.textContent = u.hostname + u.pathname; } catch {}
    }
  }
  if (msg.type === 'FILL_COMPLETE') {
    statMapped.textContent = msg.filled ?? '—';
  }
});

init();
