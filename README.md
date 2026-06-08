# Explorium Budget Tracker

Live page: https://plywoodtom.github.io/explorium-budget/

Mobile-first budget tracker for the Explorium build. Tracks **estimated** vs **actual** costs by section and item, with delta + notes.

## How it works

- `index.html` + `app.js` render the page and let you add/edit/delete sections and items in the browser.
- `data.json` is the budget data, committed to this repo.
- A Cloudflare Worker receives `Save` POSTs from the page and commits the updated `data.json` to this repo's `main` branch using a GitHub fine-grained PAT.
- The page is hosted on GitHub Pages (free).

## First-time setup

When you click `Save` for the first time on a new device, the page prompts for an **edit secret**. That secret matches the one stored in the Worker (env var `EDIT_SECRET`). It is saved to your browser's localStorage so you only enter it once per device.

If you forget the secret or want to rotate it: update `EDIT_SECRET` in the Worker's environment, then clear localStorage and re-enter on each device.

## Worker

The Worker is in `worker/`. Deployment is documented there. Required env vars:

- `EDIT_SECRET` - shared secret the page sends in `X-Edit-Secret` header
- `GITHUB_TOKEN` - fine-grained PAT scoped to `contents: write` on this repo
- `GITHUB_REPO` - `plywoodtom/explorium-budget`

## Seeded from

- `EXPLORIUM-HARD-COSTS-REFRESHED.md`
- `EXPLORIUM-CONSUMABLES-WORKSHEET.md`
- `EXPLORIUM-WALL-MATERIALS-WORKSHEET.md` (aggregate only)

Add per-game wall material detail and one-off purchases as they happen.
