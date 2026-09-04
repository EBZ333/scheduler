# Scheduler

A static webpage that reads your Canvas assignments from your **calendar feed** and displays them grouped by due date.

No API token needed. In Canvas go to Calendar → **Calendar Feed** and copy the URL. It looks like
`https://yourschool.instructure.com/feeds/calendars/user_XXXX.ics`. The code in that URL is all this page needs.

## How it works

Browsers can't fetch Canvas or Google Calendar feeds directly (no CORS headers, and public CORS proxies are dead). So a GitHub Actions workflow (`.github/workflows/fetch.yml`) fetches both feeds hourly, encrypts them with a passphrase (AES-256-GCM, PBKDF2), and commits them to `data/`. The page fetches those files and decrypts them in the browser. Nothing readable is stored in the repo.

## Setup (once)

Add three repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `CANVAS_FEED_URL` | Canvas → Calendar → Calendar Feed URL (`https://…instructure.com/feeds/calendars/user_XXXX.ics`) |
| `SCHEDULE_FEED_URL` | Google Calendar → Settings → your schedule calendar → Integrate calendar → **Secret address in iCal format** |
| `DATA_PASSPHRASE` | Any passphrase you choose. You type it into the page once. |

Then run the **Fetch calendar feeds** workflow from the Actions tab (it also runs hourly). Open the GitHub Pages site and enter the passphrase.

## Block schedule

Events named `Block 1` … `Block 8` in the Google calendar are detected as blocks; map each block to a Canvas course in the UI. Each day then shows its blocks, and each assignment shows whether that class meets on the due day (and if not, when the last class before the deadline is).

## Files

- `index.html` / `style.css`: page and styling
- `ics.js`: ICS parser with RRULE expansion (daily/weekly, EXDATE, overrides); splits Canvas titles like `Essay 2 [English 10]` into title + course
- `app.js`: decrypting, caching, block mapping, rendering
- `scripts/fetch.js`: the Actions-side fetch + encrypt

## Credits

The `fluid` backgrounds use [WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) by Pavel Dobryakov, as adapted by Thomas Kabalin in [WebGL-Fluid-Background](https://github.com/tkabalin/WebGL-Fluid-Background). MIT licensed; see the header of `fluid.js`.
