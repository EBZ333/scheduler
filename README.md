# Scheduler

A static webpage that reads your Canvas assignments from your **calendar feed** and displays them grouped by due date.

No API token needed. In Canvas go to Calendar → **Calendar Feed** and copy the URL. It looks like
`https://yourschool.instructure.com/feeds/calendars/user_XXXX.ics`. The code in that URL is all this page needs.

## Use it

Open the GitHub Pages site, paste the feed URL, click **Load assignments**.

The URL is saved only in your browser's localStorage. If the feed can't be fetched directly (Canvas doesn't send CORS headers), the page falls back to a public CORS proxy. You can also upload or paste the `.ics` file.

## Files

- `index.html` / `style.css`: page and styling
- `ics.js`: ICS parser with RRULE expansion (daily/weekly, EXDATE, overrides); splits Canvas titles like `Essay 2 [English 10]` into title + course
- `app.js`: fetching, caching, filtering, rendering

## Block schedule

Paste your Google Calendar **Secret address in iCal format** (Settings → the calendar → Integrate calendar). Events named `Block 1` … `Block 8` are detected as blocks; map each block to a Canvas course in the UI. Each day then shows its blocks, and each assignment shows whether that class meets on the due day (and if not, when the last class before the deadline is).
