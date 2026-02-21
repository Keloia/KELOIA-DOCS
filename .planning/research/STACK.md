# Stack Research

**Domain:** Static docs site + local MCP server (dual-audience: humans via browser, AI tools via stdio)
**Researched:** 2026-02-22 (updated for MCP server milestone)
**Confidence:** HIGH (all versions verified against npm registry and official documentation)

## Recommended Stack

### Site Layer — Zero Build Step

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Vanilla HTML/CSS/JS | — | Site shell | Zero build step is a hard constraint; no framework satisfies it without a bundler. A single `index.html` + `style.css` + `app.js` pushed to `main` is deployed instantly. |
| marked.js | 17.0.3 (CDN) | Markdown-to-HTML rendering in the browser | Lightest CommonMark-compliant renderer that ships a UMD build loadable via `<script>` tag with no npm install. ~7KB gzipped. Used by 10,000+ packages. Actively maintained (v17.0.3 released 2026-02-17). |
| GitHub Pages | — | Static hosting | Serves the raw repo as static files with zero config. No build step. Push to `main` = deployed. No Netlify/Cloudflare account needed. Unlimited bandwidth for public repos. |

**CDN URLs for marked.js:**
```html
<!-- UMD (recommended for vanilla JS with global `marked` object) -->
<script src="https://cdn.jsdelivr.net/npm/marked@17.0.3/lib/marked.umd.js"></script>

<!-- ESM alternative -->
<script type="module">
  import { marked } from 'https://cdn.jsdelivr.net/npm/marked@17.0.3/lib/marked.esm.js';
</script>
```

### MCP Server Layer

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 20.x LTS (minimum) | Runtime | SDK requires Node >=20 (verified from SDK package.json). Node 24 LTS is the current Active LTS; either works. |
| TypeScript | 5.9.3 (stable) | Type-safe server authoring | v5.9.3 is latest stable. v6.0 beta exists but is pre-release; skip it. TypeScript compiles away at build time — zero runtime cost. |
| @modelcontextprotocol/sdk | 1.27.0 | MCP protocol implementation | Official Anthropic TypeScript SDK. Provides `McpServer` class, `StdioServerTransport`, tool/resource/prompt registration, and all JSON-RPC plumbing. v1.x is the current stable production branch; v2 is pre-alpha. 26,000+ downstream projects use v1.x. |
| zod | 3.25.x or 4.x | Input schema validation for tools | Required peer dependency of the MCP SDK. SDK supports Zod v3.25+ via subpath imports and uses Zod v4 internally. Use `^3.25.0` for maximum compatibility with the v1.x SDK, or `^4.0.0` if you want the current stable version. Basic `z.object()`, `z.string()`, `z.number()` API is identical in both. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsx | Run TypeScript directly during development | `npx tsx src/index.ts` — no compile step in dev. Replaces ts-node for Node 20+. Use as `dev` script only; ship compiled JS. |
| tsc | Compile TypeScript to JavaScript for production | Output to `dist/`. Required because Claude Code launches the server via `node dist/index.js`. |
| @types/node | Node.js type definitions | Required for `fs`, `path`, `process` types in TypeScript. |

---

## v2.0 Stack Additions

These are the **only** new libraries needed for v2.0 features. Everything else carries forward unchanged.

### Full-Text Search (Client-Side, No Build Step)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| FlexSearch | 0.8.212 (CDN) | Full-text search index built in the browser at page load | Fastest client-side full-text search library (benchmarks 1M+ queries/sec). Zero dependencies. Ships a UMD bundle loadable via `<script>` tag — no build step. `Document` index supports multi-field search (title + body). v0.8 is the current npm stable version. |

**CDN URL:**
```html
<script src="https://cdn.jsdelivr.net/npm/flexsearch@0.8.212/dist/flexsearch.bundle.min.js"></script>
```

**Browser global after script tag:** `window.FlexSearch` — access as `new FlexSearch.Document(...)`.

**Why not Fuse.js:** Fuse.js (7.1.0) is a fuzzy-search library, not full-text search. It scores approximate string matches but cannot rank by term frequency or field weighting — which produces poor results when searching markdown bodies. Fuse.js is the right choice for small lists (sidebar navigation, autocomplete); FlexSearch is right for document corpus search. This project needs the latter.

**Why not Pagefind:** Pagefind requires a post-build CLI step to crawl the built site and produce a search index. This project's hard constraint is zero build step — no post-processing allowed. FlexSearch builds the index at runtime by fetching and parsing the same markdown files the site already renders.

**Search index construction pattern (no build step):**
```javascript
// Build index at startup from fetched doc content
const index = new FlexSearch.Document({
  document: {
    id: "id",
    index: ["title", "body"],
    store: ["title", "filename", "snippet"]
  }
});

// For each doc in data/docs/index.json:
// 1. Fetch the markdown file (already done for rendering)
// 2. Add to index: index.add({ id, title, body: plaintext, filename })
// Search: index.search(query, { enrich: true, limit: 10 })
```

### MCP Search Tool (Server-Side, Regex/Filter)

No new npm packages required. The `keloia_search_docs` tool is implemented using Node.js built-in `fs.readFileSync` + `String.prototype.includes` / `RegExp` matching across the `data/docs/` directory. The MCP server already reads these files for `read_doc`. Search is a loop over those same file reads.

**Why no search library for MCP:** The document corpus is small (<50 files, <100KB total). A linear scan with regex is faster to implement and has zero overhead. FlexSearch on the MCP side would add an in-memory index that must be rebuilt on every tool invocation (no persistence across stdio calls), making it slower than direct file reads.

### GitHub OAuth (Static Site + Cloudflare Worker)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Cloudflare Worker | free tier | OAuth code-for-token exchange (server-side secret required) | GitHub OAuth requires a server-side `client_secret` that must never ship in browser JS. A Cloudflare Worker handles only the token exchange — ~40 lines of JS. Free tier: 100,000 req/day, which is more than sufficient for a 1-2 user internal tool. No npm, no deploy pipeline — paste code into Cloudflare dashboard and set env vars. |

**Why a worker is unavoidable:** GitHub's OAuth Web Flow has a mandatory server-side step: exchanging the authorization `code` for an `access_token` requires a POST to `https://github.com/login/oauth/access_token` that includes the `client_secret`. Exposing the secret in browser JS allows anyone to impersonate the OAuth app. There is no pure-client workaround — the Device Flow also requires a backend relay per the GitHub docs.

**OAuth flow architecture:**
```
Browser                    Cloudflare Worker              GitHub
  |                               |                          |
  |-- open popup window --------> |                          |
  |                               |-- redirect to ---------> |
  |                               |   github.com/login/...   |
  |                               |                          |
  |                               |<-- ?code=XYZ ----------- |
  |                               |                          |
  |                               |-- POST /access_token --> |
  |                               |   (includes secret)      |
  |                               |<-- { access_token } ---- |
  |                               |                          |
  |                               |-- set localStorage ----> |
  |<-- poll localStorage -------> |                          |
  |   (detect token)              |                          |
```

**Worker implementation (no npm, no external libraries):**
```javascript
// Environment variables set in Cloudflare dashboard:
// GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URI

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");

    if (!code) {
      // Step 1: redirect to GitHub auth
      const state = crypto.randomUUID();
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&state=${state}&scope=repo`;
      return Response.redirect(authUrl, 302);
    }

    // Step 2: exchange code for token
    const resp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code
      })
    });
    const { access_token } = await resp.json();

    // Step 3: return HTML that stores token and closes popup
    return new Response(
      `<script>localStorage.setItem('github_token', '${access_token}'); window.close();</script>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }
};
```

**GitHub OAuth App setup:** Register at `github.com/settings/developers`. Set callback URL to the Cloudflare Worker URL. Required scope: `repo` (for file CRUD on the repository). Scope `public_repo` is sufficient if the repo is public and less permissive.

**Client-side integration:**
```javascript
// In app.js — trigger OAuth
function login() {
  window.open(CLOUDFLARE_WORKER_URL, "oauth", "width=600,height=700");
  const poll = setInterval(() => {
    const token = localStorage.getItem("github_token");
    if (token) { clearInterval(poll); onLogin(token); }
  }, 500);
}

// Token stored in localStorage — persists across page loads
// Token passed as Authorization header to GitHub API calls
```

### GitHub API File CRUD

No new npm packages required. The GitHub REST API is called directly from browser JS using the native `fetch` API. No Octokit SDK needed — the endpoint surface is narrow (3 operations) and the raw API is straightforward.

**Endpoints used:**

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| Read file (get SHA) | GET | `/repos/{owner}/{repo}/contents/{path}` | Returns `{ sha, content }` — SHA required for update/delete |
| Create file | PUT | `/repos/{owner}/{repo}/contents/{path}` | Body: `{ message, content: base64(body) }` |
| Update file | PUT | `/repos/{owner}/{repo}/contents/{path}` | Body: `{ message, content: base64(body), sha }` — sha from prior GET |
| Delete file | DELETE | `/repos/{owner}/{repo}/contents/{path}` | Body: `{ message, sha }` |

**Required auth header:** `Authorization: Bearer <github_token>` (token from localStorage after OAuth)

**Content encoding:** All file content must be Base64-encoded in PUT requests. In the browser: `btoa(unescape(encodeURIComponent(content)))` for UTF-8 safety. Decode with `decodeURIComponent(escape(atob(base64)))`.

**Critical constraint — SHA required for mutations:** Every PUT update and DELETE requires the current file SHA. The flow is always: GET the file first (to obtain `sha`), then PUT/DELETE. Never cache SHA across writes — concurrent edits from another client will change it.

**Concurrency note:** GitHub API docs explicitly warn that PUT and DELETE to the same path in parallel will conflict. All file operations must be serial (await each call before the next).

**No Octokit needed because:** Octokit is a 50KB+ SDK. This project calls 3 endpoints with a consistent pattern. The raw fetch pattern is 10-15 lines per operation and has zero runtime overhead.

### Interactive Kanban Drag-and-Drop

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| SortableJS | 1.15.7 (CDN) | Cross-list drag-and-drop for kanban columns | Only drag-and-drop library with proven cross-list support, touch device support, no jQuery, no build step, and active maintenance. 29k GitHub stars. Ships UMD bundle via CDN. The `group` option enables dragging cards between kanban columns — this is the specific feature needed. |

**CDN URL:**
```html
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js"></script>
```

**Why not native HTML5 Drag and Drop API directly:** The native API has no touch support on mobile (Safari/Chrome on iOS/Android). Touch support requires either SortableJS (which polyfills internally) or adding a separate `@dragdroptouch/drag-drop-touch` polyfill. SortableJS handles both mouse and touch in a single library with a clean API.

**Why not dragula.js:** Dragula is abandoned (last release 2016). SortableJS is actively maintained (1.15.7 released 2024).

**Cross-column drag pattern:**
```javascript
// Initialize once per column div (all share the same group name)
document.querySelectorAll(".kanban-column").forEach(col => {
  Sortable.create(col, {
    group: "kanban",       // same group = cards can move between columns
    sort: true,            // allow reordering within same column
    animation: 150,        // smooth 150ms animation
    onEnd(evt) {
      const cardId = evt.item.dataset.taskId;
      const newColumn = evt.to.dataset.column;
      const oldColumn = evt.from.dataset.column;
      if (newColumn !== oldColumn) {
        // show confirmation modal, then call GitHub API on confirm
        confirmMove(cardId, oldColumn, newColumn);
      }
    }
  });
});
```

**Confirmation modal:** Built with vanilla JS + CSS (no library). A `<dialog>` element or a div with position:fixed. Standard pattern — no additional dependency.

---

## Installation

```bash
# MCP server dependencies (from mcp-server/ directory) — UNCHANGED from v1.1
npm install @modelcontextprotocol/sdk zod

# Dev dependencies — UNCHANGED from v1.1
npm install -D typescript @types/node tsx

# v2.0 adds NO new npm packages to mcp-server/
# Site additions are all CDN script tags — no npm install
```

**New CDN script tags for site (add to index.html):**
```html
<!-- Full-text search -->
<script src="https://cdn.jsdelivr.net/npm/flexsearch@0.8.212/dist/flexsearch.bundle.min.js"></script>

<!-- Drag-and-drop kanban -->
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js"></script>
```

**Cloudflare Worker:** No deploy pipeline. Paste ~40 lines of JS into the Cloudflare dashboard. Set three env vars (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`). One-time setup, no CI/CD needed.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| FlexSearch 0.8 | Fuse.js 7.1 | Choose Fuse.js when you need fuzzy/typo-tolerant autocomplete on small lists (<200 items). Choose FlexSearch for full-text document search — it handles term frequency and field weighting. |
| FlexSearch 0.8 | Pagefind | Choose Pagefind if you already have a build step (e.g. Astro, Hugo). It produces a static search index that loads fast. Not viable here — requires post-build CLI. |
| FlexSearch 0.8 | Lunr.js | Lunr.js is unmaintained (last commit 2021). FlexSearch is faster and maintained. |
| Cloudflare Worker | Netlify Edge Function | Equivalent functionality; choose Netlify if the site already deploys via Netlify. This site deploys via GitHub Pages — adding Netlify just for OAuth is more infrastructure. |
| Cloudflare Worker | Vercel Serverless Function | Same tradeoff as Netlify — adds a deploy dependency. Cloudflare Worker is free, standalone, no project coupling. |
| Cloudflare Worker | GitHub App (vs OAuth App) | GitHub Apps use installation tokens and are for multi-user platforms. OAuth Apps are simpler for single-user authorization. Use GitHub App only if you need org-level webhook events or GitHub Actions context. |
| SortableJS | dragula.js | Never — dragula is abandoned since 2016. |
| SortableJS | interact.js | interact.js supports more gesture types but is heavier. Choose for complex resize/rotate interactions. Overkill for kanban card drag. |
| SortableJS | Native DnD + dragdroptouch polyfill | Valid, zero-dependency approach. Adds ~30 lines of implementation code vs SortableJS's one function call. Choose if bundle size is a constraint (it is not here — CDN). |
| GitHub REST API (raw fetch) | Octokit.js | Use Octokit when you need pagination helpers, retry logic, or many endpoints. For 3 CRUD endpoints, raw fetch is simpler and lighter. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| React / Astro / VitePress / Docusaurus | All require a build step. Zero-build is a hard project constraint. | Vanilla HTML/CSS/JS + marked.js from CDN |
| Tailwind CSS | Requires PostCSS build step. | Handwritten CSS |
| ts-node | Broken with ESM modules in Node 20+. | tsx |
| FlexSearch 0.7.x | Older API. 0.8.x is the current npm stable (0.8.212 published). Use 0.8. | FlexSearch 0.8.212 |
| Pagefind | Requires a build step (post-build CLI crawl of the site). Violates zero-build constraint. | FlexSearch (runtime index build) |
| Octokit SDK for GitHub API | 50KB+ runtime overhead for 3 endpoints. The raw REST surface is documented and stable. | Native fetch + Authorization header |
| GitHub Personal Access Token (PAT) hardcoded in JS | Exposes write access to the repository to anyone who views source. | GitHub OAuth — user authenticates and grants their own token |
| GitHub Device Flow in browser | GitHub blocks direct device flow calls from browser JS due to CORS. A backend relay is required either way. | Cloudflare Worker OAuth Web Flow |
| dragula.js | Abandoned since 2016, no security updates. | SortableJS 1.15.7 |
| console.log() in MCP server | Writes to stdout, corrupts the JSON-RPC transport stream. Claude Code loses connection silently. | console.error() for all server-side logging |
| TypeScript 6.0 beta | Pre-release as of Feb 2026. Breaking changes possible. | TypeScript 5.9.3 (latest stable) |
| dotenv in MCP server | dotenv v17+ may print to stdout on load, which corrupts stdio transport. | Pass env vars via the `env` field in `.mcp.json` configuration |

## Stack Patterns by Variant

**If the site moves to a build step later (e.g. v3.0):**
- Replace FlexSearch runtime indexing with Pagefind (better performance for large doc sets)
- This is a pure swap — no architectural change needed
- Keep SortableJS, Cloudflare Worker, GitHub API patterns unchanged

**If OAuth needs to be removed (e.g. public read-only mode):**
- Drop the Cloudflare Worker entirely
- Remove the `Authorization` header from GitHub API calls
- GET endpoints (read file, list contents) work without auth for public repos
- Write operations are simply unavailable without auth — that's the expected degraded behavior

**If the kanban board grows beyond 200 cards:**
- SortableJS handles this without changes
- The GitHub API file-per-task pattern starts to show latency (200 GET requests on load)
- At that scale, consolidate tasks into a single `kanban.json` and use a single GET

**If adding HTTP/SSE transport to MCP server later:**
- Add `express` or `Hono` to the MCP server
- The `McpServer` class is transport-agnostic; swap `StdioServerTransport` for `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/http.js`
- No new npm packages required — HTTP transport is bundled in the SDK
- Keep tool registrations identical — transport is just the connection layer

**If Zod v4 is required by SDK upgrade:**
- Change `"zod": "^3.25.0"` to `"^4.0.0"` in package.json
- `import { z } from "zod"` stays identical — no code changes needed
- Breaking changes are only in error customization APIs (`message` → `error` param)

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| @modelcontextprotocol/sdk@1.27.0 | zod@>=3.25, zod@4.x | SDK v1.25+ added Zod v4 schema support. Both v3 (3.25+) and v4 work as peer deps. |
| @modelcontextprotocol/sdk@1.27.0 | node@>=20 | Verified from SDK repository package.json. Node 20 LTS is the minimum; Node 24 is preferred. |
| marked@17.0.3 | All modern browsers | UMD build works with `<script>` tag. No IE11 support. |
| TypeScript@5.9.3 | node@>=14.17 | No conflicts with Node 20 or 24. |
| tsx@^4.7.0 | node@>=20, TypeScript@>=5 | Dev runner only; not needed in production. |
| FlexSearch@0.8.212 | All modern browsers | UMD bundle via CDN. Global: `window.FlexSearch`. No IE11 support. |
| SortableJS@1.15.7 | All modern browsers + mobile touch | Built-in touch support. No IE9 support. |
| GitHub REST API (contents) | Any OAuth token with `repo` scope | API version `2022-11-28` is current stable. No version pinning needed for basic CRUD. |
| Cloudflare Worker (free tier) | GitHub OAuth Web Flow | 100,000 req/day limit — sufficient for 1-2 users. Worker JS environment supports `fetch`, `crypto.randomUUID()`, `Response`. |

## Sources

- [GitHub: nextapps-de/flexsearch](https://github.com/nextapps-de/flexsearch) — v0.8.212 latest, CDN bundle URL, `window.FlexSearch` global, Document index API (MEDIUM confidence — official repo, no separate release notes reviewed)
- [npm: flexsearch](https://www.npmjs.com/package/flexsearch) — v0.8.212 confirmed as latest published version via `npm view flexsearch version` (HIGH confidence — npm registry)
- [GitHub REST API: repository contents](https://docs.github.com/en/rest/repos/contents) — PUT/DELETE endpoints, SHA requirement, Base64 encoding, auth scopes (HIGH confidence — official GitHub docs)
- [Simon Willison: GitHub OAuth with Cloudflare Workers](https://til.simonwillison.net/cloudflare/workers-github-oauth) — flow architecture, localStorage polling pattern, state/CSRF pattern (MEDIUM confidence — verified practitioner, aligns with GitHub OAuth docs)
- [GitHub: SortableJS/Sortable](https://github.com/SortableJS/Sortable) — v1.15.7 latest, `group` option for cross-list drag, CDN availability, touch support (HIGH confidence — official repo)
- [npm: sortablejs](https://www.jsdelivr.com/package/npm/sortablejs) — v1.15.7 confirmed via `npm view sortablejs version` (HIGH confidence — npm registry)
- [npm: fuse.js](https://www.fusejs.io/) — v7.1.0 latest, fuzzy-search characteristics, why it differs from full-text search (HIGH confidence — npm registry)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — 100,000 req/day free tier (HIGH confidence — official Cloudflare docs)
- [GitHub OAuth authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) — Web Flow vs Device Flow, client_secret requirement (HIGH confidence — official GitHub docs)
- [MDN: HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Kanban_board) — native DnD capabilities and limitations (HIGH confidence — MDN)

---
*Stack research for: Keloia Docs + MCP Server*
*Researched: 2026-02-22 (updated for MCP server milestone; site layer unchanged from v1.0)*
