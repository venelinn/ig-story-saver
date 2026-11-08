// Runs in Instagram's own page (MAIN world) so it can read React data and
// call Instagram's API with the user's session.
(() => {
  const FALLBACK_APP_ID = '936619743392459';
  const STORY_BUTTON_SIZE = 36;
  const GAP = 12;
  const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  // Outline + filled bookmark ("Save") icons, plus their English labels as a fallback.
  const BOOKMARK_SVG = [
    'svg:has(> polygon[points="20 21 12 13.44 4 21 4 3 20 3 20 21"])',
    'svg:has(> path[d^="M20 22a.999.999 0 0 1-.687-.273L12 14.815"])',
    'svg[aria-label="Save"]',
    'svg[aria-label="Remove"]',
  ].join(', ');

  const ICONS = {
    idle: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />',
    all: '<path d="M8 3h11a2 2 0 0 1 2 2v11" /><rect x="3" y="7" width="14" height="14" rx="2" /><path d="M10 10.5v6m0 0-2.75-2.75M10 16.5l2.75-2.75" />',
    busy: '<path d="M12 3a9 9 0 1 0 9 9" />',
    done: '<path d="m5 12.5 4.5 4.5L19 7.5" />',
    error: '<path d="M12 7v6m0 4h.01" />',
  };

  let requestCounter = 0;
  const pending = new Map();

  // ---------- Ids ----------

  function toMediaId(value) {
    const id = String(value ?? '').split('_')[0];
    return /^\d{10,}$/.test(id) ? id : null;
  }

  // Post shortcode (/p/<code>/) → numeric media id. Only the first 11
  // characters encode the id; private posts append extra characters.
  function shortcodeToId(code) {
    let id = 0n;
    for (const char of code.slice(0, 11)) id = id * 64n + BigInt(SHORTCODE_ALPHABET.indexOf(char));
    return id.toString();
  }

  // Instagram image URLs carry ig_cache_key=<base64 of the item's media id>.
  function idFromImageUrl(url) {
    try {
      const key = new URL(url, location.href).searchParams.get('ig_cache_key');
      return key ? toMediaId(atob(key.split('.')[0])) : null;
    } catch {
      return null;
    }
  }

  // Walk up React's component tree from a DOM node and collect every media
  // id it mentions (props like media.pk, or keys shaped "<media>_<user>").
  function idsFromReact(el) {
    const ids = [];
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? el[fiberKey] : null;

    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      const p = fiber.memoizedProps;
      for (const value of [p?.media?.pk, p?.item?.pk, p?.mediaId, p?.post?.id]) {
        const id = toMediaId(value);
        if (id && !ids.includes(id)) ids.push(id);
      }
      const key = typeof fiber.key === 'string' ? fiber.key : '';
      if (/^\d+_\d+$/.test(key) || /^\d{18,}$/.test(key)) {
        const id = toMediaId(key);
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  }

  // ---------- Instagram API ----------

  function igAppId() {
    try {
      return window.require('PolarisConfig').getIGAppID() || FALLBACK_APP_ID;
    } catch {
      return FALLBACK_APP_ID;
    }
  }

  async function fetchMediaInfo(id) {
    const res = await fetch(`/api/v1/media/${id}/info/`, {
      headers: { 'x-ig-app-id': igAppId() },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Instagram answered ${res.status}`);
    const media = (await res.json()).items?.[0];
    if (!media) throw new Error('Instagram returned no media');
    return media;
  }

  function bestUrl(item) {
    const options = item.video_versions?.length ? item.video_versions : item.image_versions2?.candidates || [];
    const best = options.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a), options[0]);
    if (!best?.url) throw new Error('No photo or video found');
    return best.url;
  }

  // `position` (1-based) is added when saving a whole carousel so the files
  // sort in the same order as the post.
  function fileName(owner, item, url, position) {
    const ext = new URL(url).pathname.split('.').pop() || (item.video_versions ? 'mp4' : 'jpg');
    const takenAt = item.taken_at || owner.taken_at || Date.now() / 1000;
    const date = new Date(takenAt * 1000).toISOString().slice(0, 10);
    const user = (owner.user?.username || 'instagram').replace(/[^\w.-]/g, '_');
    const suffix = position ? `_${String(position).padStart(2, '0')}` : '';
    return `${user}_${date}_${toMediaId(item.pk || item.id)}${suffix}.${ext}`;
  }

  // ---------- Hand-off to the extension ----------

  function saveFile(url, filename) {
    const requestId = ++requestCounter;
    return new Promise((resolve, reject) => {
      pending.set(requestId, (result) => (result.ok ? resolve() : reject(new Error(result.error))));
      window.postMessage({ source: 'igss', type: 'download', requestId, url, filename }, location.origin);
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (event.source !== window || msg?.source !== 'igss-result') return;
    pending.get(msg.requestId)?.(msg);
    pending.delete(msg.requestId);
  });

  // ---------- Buttons ----------

  // `getFiles` resolves to a list of { url, filename } to save.
  function createButton(className, label, getFiles, idleIcon = ICONS.idle) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    let resetTimer;

    function setState(state, title) {
      clearTimeout(resetTimer);
      button.dataset.state = state;
      button.title = title;
      button.setAttribute('aria-label', title);
      const icon = state === 'idle' ? idleIcon : ICONS[state];
      button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
      if (state === 'done' || state === 'error') {
        resetTimer = setTimeout(() => setState('idle', label), state === 'error' ? 4000 : 1500);
      }
    }
    setState('idle', label);

    // Keep Instagram from reading clicks on the button as pause / next / open post.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) {
      button.addEventListener(type, (e) => e.stopPropagation());
    }

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      if (button.dataset.state === 'busy') return;
      setState('busy', 'Downloading…');
      try {
        const files = await getFiles(button);
        for (const [i, { url, filename }] of files.entries()) {
          if (files.length > 1) setState('busy', `Downloading ${i + 1} of ${files.length}…`);
          await saveFile(url, filename);
        }
        setState('done', files.length > 1 ? `Saved ${files.length} files` : `Saved ${files[0].filename}`);
      } catch (err) {
        console.warn('[IG Story Saver]', err);
        setState('error', `Download failed: ${err.message}`);
      }
    });

    return button;
  }

  // ---------- Stories ----------

  function currentStoryElement() {
    if (!location.pathname.startsWith('/stories/')) return null;
    return (
      document
        .elementsFromPoint(innerWidth / 2, innerHeight / 2)
        .find((el) => el.matches('video, img') && el.getBoundingClientRect().width > 150) ?? null
    );
  }

  async function downloadStory() {
    const el = currentStoryElement();
    const id =
      toMediaId(location.pathname.split('/')[3]) ||
      (el?.tagName === 'IMG' && idFromImageUrl(el.currentSrc || el.src)) ||
      (el && idsFromReact(el)[0]);
    if (!id) throw new Error("Couldn't find this story. Let it start playing and try again.");

    const media = await fetchMediaInfo(id);
    const url = bestUrl(media);
    return [{ url, filename: fileName(media, media, url) }];
  }

  const storyButton = createButton('igss-button', 'Download this story', downloadStory);
  storyButton.hidden = true;
  document.body.append(storyButton);

  // Sit just right of the story at header height; move inside the story's
  // top-right corner when the window is too narrow.
  function placeStoryButton() {
    const el = currentStoryElement();
    if (!el) {
      storyButton.hidden = true;
      return;
    }
    const rect = el.getBoundingClientRect();
    const outside = rect.right + GAP + STORY_BUTTON_SIZE <= innerWidth - GAP;

    storyButton.style.left = `${outside ? rect.right + GAP : rect.right - GAP - STORY_BUTTON_SIZE}px`;
    storyButton.style.top = `${outside ? rect.top + 20 : rect.top + 72}px`;
    storyButton.hidden = false;
  }

  // ---------- Feed / post page ----------

  function postScope(el) {
    return el.closest('article') || el.closest('[role="dialog"]') || el.closest('main') || document.body;
  }

  function postId(scope) {
    const link = scope.querySelector('a[href*="/p/"]:has(time), a[href*="/reel/"]:has(time)');
    const path = link ? new URL(link.href).pathname : location.pathname;
    const code = path.match(/\/(?:p|reel|reels)\/([\w-]+)/)?.[1];
    return code ? shortcodeToId(code) : null;
  }

  // The slide actually on screen: the photo/video covering the most of the
  // post's visible area (other carousel slides sit outside it).
  function visibleMedia(scope) {
    const frame = scope.getBoundingClientRect();
    let best = null;
    let bestArea = 0;
    for (const el of scope.querySelectorAll('img, video')) {
      const r = el.getBoundingClientRect();
      if (r.width < 150) continue; // avatars, emoji
      const w = Math.min(r.right, frame.right, innerWidth) - Math.max(r.left, frame.left, 0);
      const h = Math.min(r.bottom, frame.bottom, innerHeight) - Math.max(r.top, frame.top, 0);
      if (w > 0 && h > 0 && w * h > bestArea) {
        best = el;
        bestArea = w * h;
      }
    }
    return best;
  }

  function pickCarouselItem(post, mediaEl) {
    const items = post.carousel_media;
    if (!items?.length) return post;
    if (!mediaEl) throw new Error("Couldn't tell which slide is showing");

    const slide = mediaEl.closest('li') || mediaEl.parentElement;
    const candidates = [
      mediaEl.tagName === 'IMG' && idFromImageUrl(mediaEl.currentSrc || mediaEl.src),
      ...[...(slide?.querySelectorAll('img') || [])].map((img) => idFromImageUrl(img.currentSrc || img.src)),
      ...idsFromReact(mediaEl),
    ].filter(Boolean);

    const item = candidates.map((id) => items.find((it) => toMediaId(it.pk || it.id) === id)).find(Boolean);
    if (!item) throw new Error("Couldn't tell which slide is showing");
    return item;
  }

  async function fetchPost(button) {
    const scope = postScope(button);
    const id = postId(scope);
    if (!id) throw new Error("Couldn't find this post");
    return { scope, post: await fetchMediaInfo(id) };
  }

  async function downloadPost(button) {
    const { scope, post } = await fetchPost(button);
    const item = pickCarouselItem(post, visibleMedia(scope));
    const url = bestUrl(item);
    return [{ url, filename: fileName(post, item, url) }];
  }

  async function downloadWholePost(button) {
    const { post } = await fetchPost(button);
    const items = post.carousel_media?.length ? post.carousel_media : [post];
    return items.map((item, i) => {
      const url = bestUrl(item);
      return { url, filename: fileName(post, item, url, items.length > 1 ? i + 1 : undefined) };
    });
  }

  // Carousels keep at least the current and the next slide in the DOM, each
  // in its own <li>; single posts have one big photo/video.
  function isCarousel(scope) {
    const slides = new Set();
    for (const el of scope.querySelectorAll('li img, li video')) {
      if (el.getBoundingClientRect().width >= 150) slides.add(el.closest('li'));
    }
    return slides.size > 1;
  }

  // Put a download icon just left of every post's Save (bookmark) icon, plus
  // a "download all" icon on posts with several photos/videos.
  //
  // Instagram opens its "Save to collection" popover when the pointer enters
  // the wrapper around the Save icon, so the icons must sit *outside* it:
  // climb past every wrapper that holds only the Save icon and attach to the
  // action bar itself. The bar only lays out its own two items (actions left,
  // Save right), so the icons are absolutely positioned over it instead of
  // joining its flow.
  const postGroups = new Map(); // .igss-actions → its Save block

  function addPostButtons() {
    if (location.pathname.startsWith('/stories/')) return;
    for (const svg of document.querySelectorAll(BOOKMARK_SVG)) {
      let saveBlock = svg.closest('[role="button"], button');
      while (saveBlock?.parentElement && saveBlock.parentElement.children.length === 1) {
        saveBlock = saveBlock.parentElement;
      }
      const bar = saveBlock?.parentElement;
      if (!bar) continue;

      let group = bar.querySelector(':scope > .igss-actions');
      if (!group) {
        group = document.createElement('div');
        group.className = 'igss-actions';
        group.append(createButton('igss-inline', 'Download this photo/video', downloadPost));
        if (getComputedStyle(bar).position === 'static') bar.classList.add('igss-bar');
        bar.append(group);
        postGroups.set(group, saveBlock);
      }
      if (!group.querySelector('.igss-inline-all') && isCarousel(postScope(bar))) {
        group.append(
          createButton('igss-inline igss-inline-all', 'Download all photos/videos', downloadWholePost, ICONS.all),
        );
      }
    }
    placePostButtons();
  }

  // Anchor each group's right edge to the left edge of Save, vertically centred on it.
  function placePostButtons() {
    for (const [group, saveBlock] of postGroups) {
      if (!group.isConnected || !saveBlock.isConnected) {
        group.remove();
        postGroups.delete(group);
        continue;
      }
      const bar = group.parentElement.getBoundingClientRect();
      const save = saveBlock.getBoundingClientRect();
      group.style.right = `${bar.right - save.left}px`;
      group.style.top = `${save.top - bar.top + (save.height - group.offsetHeight) / 2}px`;
    }
  }

  // ---------- Wiring ----------

  let scanQueued = false;
  new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      addPostButtons();
    }, 300);
  }).observe(document.body, { childList: true, subtree: true });

  addPostButtons();
  setInterval(placeStoryButton, 200);
  addEventListener('resize', () => {
    placeStoryButton();
    placePostButtons();
  });
})();
