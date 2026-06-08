# Cloudflare Worker - explorium-budget-worker

This Worker takes Save POSTs from the Budget Tracker page and commits the updated `data.json` to the GitHub repo.

## One-time setup

1. **Cloudflare account** (free tier is fine): https://dash.cloudflare.com

2. **Install Wrangler CLI** (Cloudflare's deployment tool):
   ```
   npm install -g wrangler
   ```
   Or use the dashboard-only path (see below).

3. **Create a GitHub fine-grained Personal Access Token**:
   - GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Repository access: `plywoodtom/explorium-budget`
   - Permissions: `Contents` = `Read and write`
   - Copy the token (starts with `github_pat_...`)

4. **Pick a strong edit secret** (any random string, e.g., 32 chars). You'll enter this in the browser the first time you click Save.

## Deploy via Wrangler CLI

```bash
cd worker
wrangler login          # opens browser
wrangler secret put EDIT_SECRET     # paste your secret
wrangler secret put GITHUB_TOKEN    # paste your fine-grained PAT
wrangler deploy
```

The output will print a URL like `https://explorium-budget-worker.<your-subdomain>.workers.dev`.

## Update the page to point at your Worker

Edit `app.js` in this repo:

```js
const WORKER_URL = "https://explorium-budget-worker.<your-subdomain>.workers.dev";
```

Commit and push. GitHub Pages will redeploy in ~1 minute.

## Deploy via dashboard (no Wrangler)

If you'd rather avoid the CLI:

1. Cloudflare Dashboard → Workers & Pages → Create → "Hello World" template.
2. Replace the code with `worker/index.js` from this repo.
3. Settings tab:
   - Variables: add `GITHUB_REPO = plywoodtom/explorium-budget`, `FILE_PATH = data.json`
   - Secrets: add `EDIT_SECRET` (your random string) and `GITHUB_TOKEN` (your PAT)
4. Deploy.
5. Copy the `*.workers.dev` URL into `app.js` (`WORKER_URL` constant).

## Test

From the budget page:
1. Click "Save".
2. Browser prompts for the edit secret. Enter it.
3. Status should change to "Saving..." then "Saved".
4. Check the repo - you should see a fresh commit on `main`.

If it fails, the status bar shows the HTTP error. Common ones:
- `401 Unauthorized` - secret mismatch between browser and Worker.
- `502 GitHub PUT failed: 403` - PAT lacks `Contents: write` permission.
- `502 GitHub PUT failed: 404` - `GITHUB_REPO` env var wrong, or repo is private and PAT doesn't see it.
