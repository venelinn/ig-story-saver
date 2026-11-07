// Runs in Instagram's own page (MAIN world) so it can read React data and
// call Instagram's API with the user's session.
(() => {
  const FALLBACK_APP_ID = '936619743392459';
  const BUTTON_SIZE = 36;
  const GAP = 12;

  const ICONS = {
    idle: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />',
    busy: '<path d="M12 3a9 9 0 1 0 9 9" />',
    done: '<path d="m5 12.5 4.5 4.5L19 7.5" />',
    error: '<path d="M12 7v6m0 4h.01" />',
  };

  let requestCounter = 0;
  const pending = new Map();

  // ---------- Finding the current story ----------

  function currentMediaElement() {
    if (!location.pathname.startsWith('/stories/')) return null;
    return (
      document
        .elementsFromPoint(innerWidth / 2, innerHeight / 2)
        .find((el) => el.matches('video, img') && el.getBoundingClientRect().width > 150) ?? null
    );
  }

  function toMediaId(value) {
    const id = String(value ?? '').split('_')[0];
    return /^\d{10,}$/.test(id) ? id : null;
  }

  // Walk up React's component tree from the <video>/<img> until a component
  // holding the story item (or keyed by "<media>_<user>") shows up.
  function mediaIdFromReact(el) {
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? el[fiberKey] : null;

    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      const p = fiber.memoizedProps;
      const fromProps =
        toMediaId(p?.media?.pk) || toMediaId(p?.item?.pk) || toMediaId(p?.mediaId) || toMediaId(p?.post?.id);
      if (fromProps) return fromProps;

      const key = typeof fiber.key === 'string' ? fiber.key : '';
      if (/^\d+_\d+$/.test(key) || /^\d{18,}$/.test(key)) return toMediaId(key);
    }
    return null;
  }

  function currentMediaId(el) {
    const fromUrl = location.pathname.split('/')[3];
    return toMediaId(fromUrl) || mediaIdFromReact(el);
  }

  function igAppId() {
    try {
      return window.require('PolarisConfig').getIGAppID() || FALLBACK_APP_ID;
    } catch {
      return FALLBACK_APP_ID;
    }
  }

  // ---------- Download ----------

  async function fetchMedia(id) {
    const res = await fetch(`/api/v1/media/${id}/info/`, {
      headers: { 'x-ig-app-id': igAppId() },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Instagram answered ${res.status}`);

    const media = (await res.json()).items?.[0];
    const url = media?.video_versions?.[0]?.url || media?.image_versions2?.candidates?.[0]?.url;
    if (!url) throw new Error('No photo or video found for this story');

    const ext = new URL(url).pathname.split('.').pop() || (media.video_versions ? 'mp4' : 'jpg');
    const date = new Date((media.taken_at || Date.now() / 1000) * 1000).toISOString().slice(0, 10);
    const user = (media.user?.username || 'story').replace(/[^\w.-]/g, '_');
    return { url, filename: `${user}_${date}_${id}.${ext}` };
  }

  function sendToExtension(url, filename) {
    const requestId = ++requestCounter;
    return new Promise((resolve) => {
      pending.set(requestId, resolve);
      window.postMessage({ source: 'igss', type: 'download', requestId, url, filename }, location.origin);
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (event.source !== window || msg?.source !== 'igss-result') return;
    pending.get(msg.requestId)?.(msg);
    pending.delete(msg.requestId);
  });

  // ---------- Button ----------

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'igss-button';
  button.hidden = true;
  document.body.append(button);

  let resetTimer;
  function setState(state, title) {
    clearTimeout(resetTimer);
    button.dataset.state = state;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[state]}</svg>`;
    if (state === 'done' || state === 'error') {
      resetTimer = setTimeout(() => setState('idle', 'Download this story'), state === 'error' ? 4000 : 1500);
    }
  }
  setState('idle', 'Download this story');

  // Keep Instagram from treating clicks on the button as "pause / next story".
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) {
    button.addEventListener(type, (e) => e.stopPropagation());
  }

  button.addEventListener('click', async () => {
    if (button.dataset.state === 'busy') return;

    const el = currentMediaElement();
    const id = el && currentMediaId(el);
    if (!id) return setState('error', "Couldn't find this story. Let it start playing and try again.");

    setState('busy', 'Downloading…');
    try {
      const { url, filename } = await fetchMedia(id);
      const result = await sendToExtension(url, filename);
      if (!result.ok) throw new Error(result.error);
      setState('done', `Saved ${filename}`);
    } catch (e) {
      console.warn('[IG Story Saver]', e);
      setState('error', `Download failed: ${e.message}`);
    }
  });

  // Sit just right of the story at header height; move inside the story's
  // top-right corner when the window is too narrow.
  function place() {
    const el = currentMediaElement();
    if (!el) {
      button.hidden = true;
      return;
    }
    const rect = el.getBoundingClientRect();
    const outside = rect.right + GAP + BUTTON_SIZE <= innerWidth - GAP;

    button.style.left = `${outside ? rect.right + GAP : rect.right - GAP - BUTTON_SIZE}px`;
    button.style.top = `${outside ? rect.top + 20 : rect.top + 72}px`;
    button.hidden = false;
  }

  setInterval(place, 200);
  addEventListener('resize', place);
})();
