// Cloudflare Worker - commits data.json edits from the Explorium Budget page
// to the GitHub repo. Single endpoint:
//
// POST /         body = new data.json contents (JSON), header X-Edit-Secret = shared secret
//
// Environment variables (set via `wrangler secret put` or dashboard):
//   EDIT_SECRET   - shared secret the page sends
//   GITHUB_TOKEN  - fine-grained PAT scoped to `contents: write` on the repo
//   GITHUB_REPO   - "plywoodtom/explorium-budget"
//   FILE_PATH     - "data.json"  (default)

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Edit-Secret",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    // Auth
    const secret = req.headers.get("X-Edit-Secret");
    if (!secret || secret !== env.EDIT_SECRET) {
      return new Response("Unauthorized", { status: 401, headers: cors });
    }

    // Parse body
    let payload;
    try {
      payload = await req.json();
    } catch (e) {
      return new Response("Invalid JSON: " + e.message, { status: 400, headers: cors });
    }

    if (!payload || typeof payload !== "object" || !Array.isArray(payload.sections)) {
      return new Response("Payload must be an object with `sections` array", { status: 400, headers: cors });
    }

    const repo = env.GITHUB_REPO;
    const filePath = env.FILE_PATH || "data.json";
    const token = env.GITHUB_TOKEN;
    if (!repo || !token) {
      return new Response("Worker not configured (missing GITHUB_REPO or GITHUB_TOKEN env)", { status: 500, headers: cors });
    }

    // Fetch current file SHA (required for PUT update)
    const getUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const getRes = await fetch(getUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "explorium-budget-worker"
      }
    });
    let currentSha = null;
    if (getRes.ok) {
      const current = await getRes.json();
      currentSha = current.sha;
    } else if (getRes.status !== 404) {
      const txt = await getRes.text();
      return new Response(`GitHub GET failed: ${getRes.status} ${txt}`, { status: 502, headers: cors });
    }

    // Encode new content as base64
    const json = JSON.stringify(payload, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(json)));

    // PUT the update
    const putBody = {
      message: `Update budget (${new Date().toISOString()})`,
      content: encoded,
      branch: "main"
    };
    if (currentSha) putBody.sha = currentSha;

    const putRes = await fetch(getUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "explorium-budget-worker"
      },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const txt = await putRes.text();
      return new Response(`GitHub PUT failed: ${putRes.status} ${txt}`, { status: 502, headers: cors });
    }

    const result = await putRes.json();
    return new Response(JSON.stringify({ ok: true, commit: result.commit?.sha?.slice(0, 7) }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};
