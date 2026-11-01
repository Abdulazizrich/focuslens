const field = document.getElementById('domains');
const enabled = document.getElementById('enabled');
const status = document.getElementById('status');
chrome.storage.local.get(['domains','enabled']).then(data => { field.value = (data.domains || ['youtube.com','instagram.com','tiktok.com']).join('\n'); enabled.checked = Boolean(data.enabled); });
document.getElementById('save').addEventListener('click', async () => {
  const domains = field.value.split(/[\n,]+/).map(d=>d.trim().toLowerCase().replace(/^https?:\/\//,'').split('/')[0]).filter(Boolean);
  if (domains.length > 100 || domains.some(d=>!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(d))) { status.textContent='Domenni tekshiring: misol youtube.com'; return; }
  await chrome.storage.local.set({domains,enabled:enabled.checked});
  status.textContent=enabled.checked ? 'Bloklash yoqildi.' : 'Bloklash o‘chirildi.';
});
