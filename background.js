// Saves a file handed over by bridge.js into Downloads/instagram-stories/.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'download') return;

  chrome.downloads.download(
    { url: msg.url, filename: `instagram-stories/${msg.filename}`, conflictAction: 'uniquify' },
    (downloadId) => {
      const error = chrome.runtime.lastError?.message;
      reply(error || downloadId === undefined ? { ok: false, error: error || 'Download refused' } : { ok: true });
    },
  );
  return true; // reply asynchronously
});
