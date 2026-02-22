/**
 * GitHub API client for reading/writing files in the keloia-docs repo.
 *
 * Reads use raw.githubusercontent.com (fast, no auth needed for public repos).
 * Writes use the GitHub Contents API (requires GITHUB_TOKEN).
 */

export interface Env {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_TOKEN?: string;
}

/** Fetch raw file content from the repo. Returns null if file not found. */
export async function readFile(env: Env, path: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`GitHub raw fetch failed (${res.status}): ${url}`);
  }
  return res.text();
}

/** Fetch and parse a JSON file from the repo. Returns null if not found. */
export async function readJson<T = unknown>(env: Env, path: string): Promise<T | null> {
  const text = await readFile(env, path);
  if (text === null) return null;
  return JSON.parse(text) as T;
}

/** Get the current SHA of a file via the Contents API. Returns null if not found. */
export async function getFileSha(env: Env, path: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: githubHeaders(env),
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`GitHub Contents API GET failed (${res.status}): ${path}`);
  }
  const data = (await res.json()) as { sha: string };
  return data.sha;
}

/**
 * Create or update a file via the GitHub Contents API.
 * If `sha` is provided, the file is updated; otherwise it's created.
 */
export async function writeFile(
  env: Env,
  path: string,
  content: string,
  message: string,
  sha?: string | null,
): Promise<void> {
  requireToken(env);
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: env.GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub Contents API PUT failed (${res.status}): ${text}`);
  }
}

/** Delete a file via the GitHub Contents API. Requires the current file SHA. */
export async function deleteFile(
  env: Env,
  path: string,
  sha: string,
  message: string,
): Promise<void> {
  requireToken(env);
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message,
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub Contents API DELETE failed (${res.status}): ${text}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function githubHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "keloia-mcp-worker",
  };
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }
  return headers;
}

function requireToken(env: Env): void {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is required for write operations. Set it via: wrangler secret put GITHUB_TOKEN");
  }
}
