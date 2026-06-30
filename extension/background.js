// Service worker — relays messages between popup and the active tab's content script.
// Also receives status broadcasts from content scripts (used to update the badge).
// Proxies backend fetch calls from content scripts (which are subject to CORS)
// through the service worker (which bypasses CORS via host_permissions).

import { getBackendUrl } from './shared/storage.js';

async function proxyFetch(path, body, timeoutMs = 15000) {
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
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// Ping the backend when a tab finishes loading so Render wakes up before
// the form match call fires. Fire-and-forget; errors are intentionally ignored.
async function warmUpBackend() {
  try {
    const base = await getBackendUrl();
    await fetch(`${base}/health`, { method: 'GET', signal: AbortSignal.timeout(60000) });
  } catch (_) {}
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') warmUpBackend();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Update badge when content script reports fields found
  if (msg.type === 'FIELDS_FOUND' && sender.tab?.id) {
    const count = msg.count ?? 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: sender.tab.id });
    return;
  }

  // Proxy backend fetches from content scripts to bypass CORS
  if (msg.type === 'BACKEND_FETCH') {
    proxyFetch(msg.path, msg.body, msg.timeoutMs).then(sendResponse);
    return true; // keep message channel open for async response
  }
});
