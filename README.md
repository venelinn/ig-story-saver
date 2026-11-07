# IG Story Saver

Chrome extension that adds a download button next to the Instagram story you're watching and saves the photo or video in its original quality.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Open or reload a story on instagram.com.

Files are saved to `Downloads/instagram-stories/` as `<user>_<date>_<media id>.<ext>`.

## How it works

| File | Role |
| --- | --- |
| `page.js` | Runs in Instagram's page. Finds the story in the middle of the screen, reads its media id (from the URL, or Instagram's React data), and asks `/api/v1/media/<id>/info/` for the best video/photo URL. Draws the button. |
| `bridge.js` | Relays the download request from the page to the extension (the page can't call `chrome.*`). |
| `background.js` | Saves the file with `chrome.downloads`. |
| `button.css` | Button styles (idle, busy, done, error). |

## Limits

- No "download all": the endpoint that lists a whole story set (`/api/v1/feed/reels_media/`) currently returns 500.
- When the media id isn't in the URL, it's read from Instagram's internal React props, which can change with Instagram updates.
