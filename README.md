# IG Story Saver

Chrome extension that adds download buttons to Instagram and saves photos and videos in their original quality:

- **Stories**: a round button just right of the story you're watching.
- **Feed and post pages**: a download icon left of each post's Save icon. On multi-photo posts it saves the slide you're looking at, and a second **download all** icon saves every photo and video in the post (numbered `_01`, `_02`, … in post order).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Open or reload a story on instagram.com.

Files are saved straight to your Downloads folder as `<user>_<date>_<media id>.<ext>`.

## How it works

| File | Role |
| --- | --- |
| `page.js` | Runs in Instagram's page. Works out the media id (story URL, the post's `/p/<shortcode>` link, the `ig_cache_key` in image URLs, or Instagram's React data), asks `/api/v1/media/<id>/info/` for the best video/photo URL, and draws the buttons. |
| `bridge.js` | Relays the download request from the page to the extension (the page can't call `chrome.*`). |
| `background.js` | Saves the file with `chrome.downloads`. |
| `button.css` | Button styles (idle, busy, done, error). |

## Limits

- No "download all": the endpoint that lists a whole story set (`/api/v1/feed/reels_media/`) currently returns 500.
- When the media id isn't in the URL or an image link (e.g. a video slide in a carousel), it's read from Instagram's internal React props, which can change with Instagram updates.
- The feed icon is placed by finding Instagram's bookmark icon; if Instagram redraws that icon, the selector in `BOOKMARK_SVG` needs updating.
