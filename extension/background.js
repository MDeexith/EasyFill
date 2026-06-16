// Service worker — relays messages between popup and the active tab's content script.
// Also receives status broadcasts from content scripts (used to update the badge).

chrome.runtime.onMessage.addListener((msg, sender) => {
  // Update badge when content script reports fields found
  if (msg.type === 'FIELDS_FOUND' && sender.tab?.id) {
    const count = msg.count ?? 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: sender.tab.id });
  }
});
