// page.js runs in Instagram's page and can't call chrome.* APIs;
// this script relays its download requests to the background worker.
window.addEventListener('message', async (event) => {
  const msg = event.data;
  if (event.source !== window || msg?.source !== 'igss' || msg.type !== 'download') return;

  let result;
  try {
    result = await chrome.runtime.sendMessage({ type: 'download', url: msg.url, filename: msg.filename });
  } catch (e) {
    result = { ok: false, error: 'Extension was reloaded. Refresh the page.' };
  }
  window.postMessage({ source: 'igss-result', requestId: msg.requestId, ...result }, location.origin);
});
