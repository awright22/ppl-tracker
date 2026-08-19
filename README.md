# PPL Tracker

A personal Push / Pull / Legs workout tracker with body-weight logging and
GPS-tracked (or manual) runs, installable on iPhone as a PWA, with an optional
Google Sheets backend for backup/sync and an Apple Health logging flow via the
iOS Shortcuts app. Run GPS data stays on the phone — only distance, time, and
mile splits are stored.

**Live app:** https://awright22.github.io/ppl-tracker/ (served from `docs/` by GitHub Pages)

## Privacy

This repo is public but contains **no personal data** — only app code. Workout
history lives in the phone's local storage and (optionally) in a private Google
Sheet. The sync token is entered at runtime and never stored in this repo.

## Layout

- `docs/` — the built app that GitHub Pages serves (Settings → Pages → `main` + `/docs`)
- `workout-pwa/` — PWA source: storage shell, sheet sync client, build script, and
  `apps-script.gs` (the paste-in Google Apps Script backend)
- `ppl-workout-tracker.jsx` — the whole tracker as one self-contained React
  component; also works pasted into Claude.ai as an artifact
- `workout-pwa/SETUP.md` — step-by-step setup (hosting, install, sheet, Health shortcut)

## Rebuild

```bash
cd workout-pwa
npm install
npm run build   # regenerates ../docs
```
