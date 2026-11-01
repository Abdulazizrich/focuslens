async function syncRules() {
  const { enabled = false, domains = ['youtube.com', 'instagram.com', 'tiktok.com'] } = await chrome.storage.local.get(['enabled', 'domains']);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const clean = [...new Set(domains)].filter(d => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(d)).slice(0, 100);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(rule => rule.id),
    addRules: enabled ? clean.map((domain, i) => ({ id: i + 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: `||${domain}^`, resourceTypes: ['main_frame'] } })) : []
  });
}
chrome.runtime.onInstalled.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') syncRules(); });
