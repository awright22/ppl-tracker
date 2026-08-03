# PPL Tracker — install it on your phone (PWA + Google Sheets backend)

The tracker ships three ways from this repo:

- **PWA** — the pre-built app in `docs/`, served by GitHub Pages, installable from
  Safari. Data lives on the phone (localStorage), with an optional Google Sheet as
  backup/sync backend. **← this guide**
- **Claude artifact** — paste `ppl-workout-tracker.jsx` into Claude.ai (storage lives with Claude).
- The `workout-pwa/` folder is the PWA's source; `npm install && npm run build` regenerates `docs/`.

## 1. Turn on GitHub Pages (one time, ~1 minute)

1. This repo → **Settings → Pages**.
2. Source: **Deploy from a branch** → branch **main** → folder **/docs** → Save.
3. After ~1 minute the app is live at `https://awright22.github.io/ppl-tracker/`.

Note: the page is public (it's just app code — no workout data; data stays on your
phone and in your private sheet).

## 2. Add it to your home screen

1. Open the URL in **Safari** on your iPhone.
2. Share button → **Add to Home Screen**.
3. Launch from the icon: full-screen, dark, works offline in the gym.

## 3. Connect a Google Sheet (one time, ~5 minutes)

The sheet is the durable backend: every finished workout syncs up (queued while
offline), a wiped or new phone restores everything from it, and you get readable
`Sessions` / `Sets` tabs for pivot tables.

1. Create a Google Sheet (e.g. "PPL Tracker Data").
2. **Extensions → Apps Script**, delete the sample code, paste in
   [`workout-pwa/apps-script.gs`](./apps-script.gs).
3. Change `TOKEN = "CHANGE_ME"` to your own secret.
4. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**  ← required; anything else returns a Google
     login page instead of JSON and sync fails. The token is what gates writes.
5. Authorize when prompted (the "unverified app" warning is normal for your own
   scripts: Advanced → Go to project → Allow), copy the Web app URL (ends in `/exec`),
   and paste URL + token into the tracker's sync panel (the ☁︎ strip).

The strip shows live state: `synced`, `N pending` (offline queue), or an error.
Tap it anytime for **Sync now**, **Export backup**, and **Import**.

## How syncing behaves

- **Local-first**: logging always writes to the phone instantly; the sheet is
  mirrored in the background. No signal in the gym is fine.
- Synced keys: exercise config, the session index, and each workout. In-progress
  drafts stay on the device until finished.
- **Restore / second device**: connect the same URL + token on a fresh device and
  it pulls the whole history down, then reloads.
- Conflicts resolve last-write-wins per record (fine for one human); edit workouts
  in the app, not in the sheet — the readable tabs are regenerated on every push.

## Caveats worth knowing

- iPhone browser storage can theoretically be evicted if the phone is critically
  low on space — that's exactly what the sheet backup (and Export) protects against.
- The Apps Script side was developed against a faithful mock of its contract; after
  you deploy it, do one test workout in Safari and check the sheet's tabs fill in
  before trusting it. If sync errors mention HTML or login, re-check step 4's
  "Anyone" setting.
- The Apple Health flow (Copy for Apple Health + the "Log Lift" shortcut) works the
  same in the PWA as in the artifact.
