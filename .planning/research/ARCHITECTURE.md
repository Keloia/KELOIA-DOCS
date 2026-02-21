# Architecture Research

**Domain:** Static SPA + MCP Server — v2.0 feature integration (Search, Auth, CRUD, Kanban DnD)
**Researched:** 2026-02-22
**Confidence:** HIGH (GitHub REST API CORS confirmed from official docs; OAuth proxy pattern confirmed from working implementation; HTML5 DnD from MDN; MiniSearch CDN availability confirmed)

## Standard Architecture

### System Overview (v2.0 State)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Browser (GitHub Pages SPA)                         │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │  Search UI   │  │  Doc CRUD UI │  │  Kanban DnD  │  │   Auth UI   │  │
│  │  (sidebar    │  │  (edit/add/  │  │  (drag cards │  │  (login btn │  │
│  │  search box  │  │   delete via │  │  + confirm   │  │  + badge,   │  │
│  │  + results)  │  │   textarea)  │  │  modal)      │  │  logout)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │
│         │                 │                  │                 │          │
│  ┌──────▼─────────────────▼──────────────────▼─────────────────▼──────┐  │
│  │                     app.js (SPA router + view dispatch)              │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │  search.js     │  github-api.js  │  kanban-dnd.js  │  auth.js       │  │
│  │  (MiniSearch   │  (Contents API  │  (dragstart/    │  (popup OAuth, │  │
│  │   index build) │   wrapper)      │   drop/confirm) │   localStorage)│  │
│  └────────────────────────────────────────────────────────────────────┘  │
│         │ fetch                     │ fetch + token                       │
│         │ data/ (static files)      │ api.github.com                      │
└─────────┼─────────────────────────-─┼─────────────────────────────────────┘
          │                           │
          ▼                           ▼
┌──────────────────┐     ┌─────────────────────────────────────────────────┐
│  data/ (in repo) │     │  GitHub REST API (api.github.com)                │
│  docs/*.md       │     │  CORS: Access-Control-Allow-Origin: *            │
│  kanban/*.json   │     │  GET  /repos/OWNER/REPO/contents/PATH            │
│  progress/*.json │     │  PUT  /repos/OWNER/REPO/contents/PATH            │
└──────────────────┘     │  DELETE /repos/OWNER/REPO/contents/PATH          │
                         └─────────────────────────────────────────────────┘
                                              ▲
                                              │ token in Authorization header
┌─────────────────────────────────────────────┴─────────────────────────────┐
│  Cloudflare Worker — oauth-proxy (~30 lines)                               │
│  POST /token: receives OAuth code, holds client_secret, exchanges with     │
│  github.com/login/oauth/access_token, returns HTML that writes token to    │
│  localStorage and closes the popup window                                  │
└────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  MCP Server (stdio, local — unchanged transport)                             │
│  mcp-server/src/tools/read.ts   — ADD keloia_search_docs                    │
│  mcp-server/src/tools/write.ts  — ADD keloia_add_doc, keloia_edit_doc,      │
│                                       keloia_delete_doc                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | v2.0 Status |
|-----------|----------------|-------------|
| `app.js` (router) | Hash routing, view dispatch, nav highlighting | Existing — add `#/search` route case, load new scripts |
| `index.html` | SPA shell, script loading | Existing — add search input to sidebar, login button, new `<script>` tags |
| `style.css` | Dark theme, responsive layout | Existing — add search results, edit UI overlay, drag-over highlight, auth badge styles |
| `search.js` (new) | Build MiniSearch index from all fetched docs, render results with snippets | New file |
| `auth.js` (new) | GitHub OAuth popup flow, localStorage token management, login/logout state, auth guard | New file |
| `github-api.js` (new) | Wrap GitHub Contents API (GET sha, PUT content, DELETE) with Base64 encoding and serialized writes | New file |
| `kanban-dnd.js` (new) | HTML5 dragstart/dragover/drop wiring on kanban cards and column targets, confirmation modal, auth-gated | New file (or inline in renderKanban refactor) |
| Cloudflare Worker (new) | Hold client_secret, exchange OAuth code for token, write token to popup localStorage | New — single function, ~30 LOC |
| `tools/read.ts` (modify) | Add `keloia_search_docs` — regex/string match over all doc markdown files | Modify existing |
| `tools/write.ts` (modify) | Add `keloia_add_doc`, `keloia_edit_doc`, `keloia_delete_doc` — filesystem write using existing atomic helpers | Modify existing |
| `data/docs/` | Markdown files — single source of truth for doc content | Existing — no schema change; add `mcp-setup.md` |

## Recommended Project Structure

```
keloia-docs/
├── index.html              # MODIFY: add sidebar search input, login button, new <script> tags
├── app.js                  # MODIFY: add #/search route, call renderSearch(), guard write UI on isAuthenticated()
├── style.css               # MODIFY: search results, edit textarea overlay, drag-over column highlight, auth badge
├── search.js               # NEW: MiniSearch index builder + search render + snippet extraction
├── auth.js                 # NEW: OAuth popup, localStorage token, isAuthenticated(), getToken(), logout()
├── github-api.js           # NEW: getFileSha(), createDoc(), updateDoc(), deleteDoc(), updateJsonFile()
├── kanban-dnd.js           # NEW: dragstart/dragover/drop handlers + confirmation modal (or inline in app.js)
├── data/
│   └── docs/
│       ├── index.json      # MODIFY: add { slug: "mcp-setup", title: "MCP Setup Guide" } entry
│       └── mcp-setup.md    # NEW: static markdown doc (Cursor, Claude Code, Windsurf setup)
├── mcp-server/
│   └── src/
│       └── tools/
│           ├── read.ts     # MODIFY: add keloia_search_docs tool registration
│           └── write.ts    # MODIFY: add keloia_add_doc, keloia_edit_doc, keloia_delete_doc tool registrations
└── cloudflare-worker/
    └── oauth-proxy.js      # NEW: Cloudflare Worker — OAuth code exchange proxy
```

### Structure Rationale

- **Separate JS files (search.js, auth.js, github-api.js, kanban-dnd.js):** The zero-build constraint means no bundler, no ES module imports. Each concern is a separate `<script>` tag loaded in dependency order in `index.html`. Functions are globally scoped. Keeps `app.js` as a thin dispatcher rather than a 600-line monolith.
- **Script loading order in index.html:** `auth.js` first (no deps), then `github-api.js` (needs `getToken()` from auth.js), then `search.js` (no auth dep but loads after others), then `kanban-dnd.js` (needs `github-api.js`), then `app.js` last (calls everything).
- **cloudflare-worker/ at repo root:** Keeps the proxy code auditable and version-controlled. Deployed separately via `wrangler deploy` — NOT served by GitHub Pages (no .html extension, no route in the SPA).
- **No new data directory structure:** Doc CRUD via GitHub Contents API operates on the same `data/docs/*.md` and `data/docs/index.json` files. Zero schema migration.

## Architectural Patterns

### Pattern 1: OAuth Popup + localStorage Poll (Auth Flow)

**What:** The SPA opens the Cloudflare Worker URL in a popup window. The Worker handles the GitHub OAuth redirect, exchanges the authorization code for an access token server-side (where the `client_secret` is safe as an environment variable), then returns an HTML page whose `<script>` writes `localStorage.setItem('github_token', token)` and calls `window.close()`. The SPA polls `localStorage` on a 1-second interval until the token appears, then stops polling and updates the UI.

**When to use:** Any static site (GitHub Pages, Netlify, etc.) that needs GitHub write access without a persistent backend. The `github.com/login/oauth/access_token` endpoint does not support CORS — it cannot be called from the browser directly. The Cloudflare Worker is the minimal viable proxy.

**Trade-offs:** Token lives in `localStorage` (XSS-readable — acceptable for a single-developer tool accessing a non-sensitive repo). No refresh token — user re-authenticates on token expiry. The 30-line Worker is the only server-side component in the entire system.

**Example:**
```javascript
// auth.js
let _token = localStorage.getItem('github_token') || null;

function isAuthenticated() { return !!_token; }
function getToken() { return _token; }

function login() {
  const state = crypto.randomUUID();
  sessionStorage.setItem('oauth_state', state);
  const popup = window.open(
    `https://YOUR_WORKER.workers.dev/oauth/start?state=${state}`,
    'github-oauth',
    'width=600,height=700'
  );
  const poll = setInterval(() => {
    const token = localStorage.getItem('github_token');
    if (token) {
      clearInterval(poll);
      _token = token;
      popup.close();
      onAuthSuccess();
    }
  }, 1000);
}

function logout() {
  localStorage.removeItem('github_token');
  _token = null;
  onAuthChange();
}
```

### Pattern 2: GitHub Contents API Write (Fetch-First SHA)

**What:** All writes to `data/` files in the GitHub repo use the GitHub Contents API at `api.github.com`. GitHub's REST API sends `Access-Control-Allow-Origin: *` on all responses — direct browser `fetch()` is supported. However, updating or deleting a file requires the current blob SHA from a preceding GET. The write sequence is always: GET file metadata (extract `sha`), then PUT or DELETE with that `sha`.

**When to use:** Every doc CRUD operation and every kanban task column update that the site persists to the repository. This is the only write path available on a static GitHub Pages site.

**Trade-offs:** Each write is 2 network round-trips (GET sha + PUT/DELETE). Operations must be serialized — GitHub explicitly states that concurrent writes to the same repo conflict. Write latency is ~500ms–2s on good connections. The change triggers a GitHub Actions deploy; the live site reflects the change after ~30 seconds (acceptable for this use case).

**Example:**
```javascript
// github-api.js
const REPO_API = 'https://api.github.com/repos/OWNER/REPO/contents';

async function updateDoc(path, markdownContent) {
  const token = getToken(); // from auth.js
  const url = `${REPO_API}/${path}`;

  // Step 1: GET current SHA
  const meta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  }).then(r => r.json());

  // Step 2: PUT updated content
  // btoa() with encodeURIComponent handles non-ASCII characters (UTF-8 safe Base64)
  const encoded = btoa(unescape(encodeURIComponent(markdownContent)));
  await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json'
    },
    body: JSON.stringify({
      message: `docs: update ${path}`,
      content: encoded,
      sha: meta.sha
    })
  });
}
```

### Pattern 3: Client-Side Full-Text Search with MiniSearch (CDN)

**What:** On first search interaction (lazy-load on demand, not on page load), fetch all doc markdown files listed in `data/docs/index.json`, build an in-memory MiniSearch index. MiniSearch 7.2.0 is available as a UMD build via jsDelivr CDN. Search is instant after index build — no subsequent network calls. Results include slug, title, and a surrounding text snippet.

**When to use:** Static sites with <200 documents where a one-time index build is acceptable. For the current doc set (2–20 files), total index build time is under 200ms.

**Trade-offs:** Index rebuilds on every page load (no persistent cache). MiniSearch ~22KB gzipped. For the current doc scale, this is the correct approach — no build step for a pre-built index file, no server needed.

**Example:**
```javascript
// search.js — loads after MiniSearch UMD from CDN
let _searchIndex = null;

async function getOrBuildIndex() {
  if (_searchIndex) return _searchIndex;
  const { docs } = await fetch('data/docs/index.json').then(r => r.json());
  const entries = await Promise.all(
    docs.map(async ({ slug, title }) => {
      const text = await fetch(`data/docs/${slug}.md`).then(r => r.text());
      return { id: slug, title, text };
    })
  );
  _searchIndex = new MiniSearch({
    fields: ['title', 'text'],
    storeFields: ['title'],
    searchOptions: { prefix: true, fuzzy: 0.2 }
  });
  _searchIndex.addAll(entries);
  return _searchIndex;
}

async function renderSearch(query) {
  const idx = await getOrBuildIndex();
  const results = idx.search(query);
  // render results with title + snippet
}
```

### Pattern 4: HTML5 Drag and Drop for Kanban (Auth-Gated)

**What:** Add `draggable="true"` to rendered kanban card elements. Attach `dragstart` to cards (store `taskId` via `dataTransfer.setData('text/plain', taskId)`). Column containers get `dragover` (call `event.preventDefault()` to enable drop) and `drop` handlers that extract `taskId` from `dataTransfer`, show a confirmation modal ("Move [task title] to [column]?"), and on confirmation call `github-api.updateTaskFile()`. Drag attributes and event listeners are only wired when `isAuthenticated()` is true.

**When to use:** Any vanilla JS kanban where touch support is not required. The HTML5 DnD API is built into every modern browser with no dependencies. Touch support (mobile) is not a requirement for this single-developer desktop-first tool.

**Trade-offs:** HTML5 DnD API has known rough edges (no touch events, limited drag image customization). Acceptable for this use case. The confirmation modal prevents accidental moves from triggering API calls.

## Data Flow

### Search Flow (new)

```
User types in sidebar search box
    → debounce 300ms
    → getOrBuildIndex()
        → IF index cached: skip fetch
        → ELSE: fetch data/docs/index.json → fan-out fetch all *.md files → build MiniSearch index
    → idx.search(query)
    → render result list: [{ slug, title, snippet }]
    → user clicks result → window.location.hash = '#/docs/slug'
```

### Auth Flow (new)

```
User clicks Login button
    → window.open(cloudflare_worker_url + '?state=' + state, popup)
    → GitHub OAuth consent screen (user approves)
    → GitHub redirects to Worker callback URL with code
    → Worker POSTs code + client_secret to github.com/login/oauth/access_token
    → Worker receives token, returns HTML page
    → HTML page: localStorage.setItem('github_token', token) + window.close()
    → SPA poll (setInterval 1s) detects token in localStorage
    → _token set, poll cleared, onAuthSuccess() called
    → Login button → username badge, logout option
    → Write-gated UI elements (Edit, Add, Delete, drag handles) become visible
```

### Doc CRUD Flow (new — site)

```
Edit doc:
    User clicks Edit → mainEl shows <textarea> pre-filled with markdown + Save/Cancel
    User edits, clicks Save
    → github-api.updateDoc('data/docs/SLUG.md', newContent)
        → GET sha, PUT content (2 round-trips)
    → on success: navigate to #/docs/SLUG (re-renders from updated raw file ~30s post-deploy)

Add doc:
    User clicks + Add Doc → form with slug + title + textarea
    → github-api.createDoc('data/docs/SLUG.md', content)
        → PUT (no sha needed for new files)
    → github-api.updateJsonFile('data/docs/index.json', addEntry)
        → GET sha, PUT updated index JSON
    → re-populate sidebar doc list from updated index

Delete doc:
    User clicks Delete → confirm dialog
    → github-api.deleteDoc('data/docs/SLUG.md')
        → GET sha, DELETE
    → github-api.updateJsonFile('data/docs/index.json', removeEntry)
    → navigate away, re-populate sidebar
```

### Kanban Drag-and-Drop Flow (new — site)

```
Authenticated user drags card to new column
    → dragstart: dataTransfer.setData('text/plain', taskId)
    → dragover on column: event.preventDefault()
    → drop: extract taskId, identify target column
    → show confirmation modal: "Move '[title]' to '[column]'?"
    → user confirms
    → github-api.updateTaskFile(taskId, targetColumn)
        → GET data/kanban/TASK_ID.json sha, PUT updated task with new column
    → on success: re-render kanban board
```

### MCP Doc Search Flow (new — MCP server)

```
Claude calls: keloia_search_docs({ query: "authentication", options: { regex: false } })
    → readFileSync(DOCS_DIR/index.json) → get all slugs
    → for each slug: readFileSync(DOCS_DIR/slug.md)
    → match query string (or regex) against title + content
    → return array of { slug, title, snippet (100 chars around match) }
```

### MCP Doc Write Flow (new — MCP server)

```
Claude calls: keloia_add_doc({ slug: "deployment", title: "Deployment Guide", content: "# ..." })
    → Zod validate: slug /^[a-z0-9-]+$/, title non-empty, content non-empty
    → Check slug not already in index (prevent overwrite)
    → writeFileSync(DOCS_DIR/slug.md, content) — no atomicWriteJson needed (new file, no sha conflict)
    → Read docs index, push { slug, title }, atomicWriteJson(index) — existing helper
    → Return: "Created docs/slug.md and updated index"

Claude calls: keloia_edit_doc({ slug: "architecture", content: "# Updated..." })
    → Zod validate: slug in index, content non-empty
    → atomicWriteJson equivalent: write to .tmp, rename
    → Return: "Updated docs/architecture.md"

Claude calls: keloia_delete_doc({ slug: "old-doc" })
    → Zod validate: slug in index
    → unlinkSync(DOCS_DIR/slug.md)
    → Remove slug from index.docs array, atomicWriteJson(index)
    → Return: "Deleted docs/old-doc.md and updated index"
```

## Integration Points

### New vs. Modified Components

| File | Action | What Changes |
|------|--------|--------------|
| `index.html` | MODIFY | Add `<input id="search-box">` in sidebar; add `<div id="auth-bar">` in sidebar header; add `<script>` tags for auth.js, github-api.js, search.js, kanban-dnd.js, MiniSearch CDN |
| `app.js` | MODIFY | Add `#/search` route case; add Edit/Add/Delete buttons to renderDoc(); guard write UI with isAuthenticated(); refactor renderKanban() to support DnD wiring |
| `style.css` | MODIFY | Search results dropdown styles; edit overlay/textarea styles; kanban drag-over column highlight; auth badge + login button styles; confirmation modal |
| `search.js` | NEW | MiniSearch index builder, search executor, result renderer |
| `auth.js` | NEW | OAuth popup, localStorage token, isAuthenticated(), getToken(), logout() |
| `github-api.js` | NEW | getFileSha(), createDoc(), updateDoc(), deleteDoc(), updateJsonFile() |
| `kanban-dnd.js` | NEW | DnD event wiring helpers, confirmation modal show/hide |
| `mcp-server/src/tools/read.ts` | MODIFY | Add `keloia_search_docs` tool registration |
| `mcp-server/src/tools/write.ts` | MODIFY | Add `keloia_add_doc`, `keloia_edit_doc`, `keloia_delete_doc` tool registrations |
| `data/docs/index.json` | MODIFY | Add `{ slug: "mcp-setup", title: "MCP Setup Guide" }` entry |
| `data/docs/mcp-setup.md` | NEW | Static markdown: setup instructions for Cursor, Claude Code, Windsurf |
| `cloudflare-worker/oauth-proxy.js` | NEW | GitHub OAuth code-for-token exchange proxy |

### External Services

| Service | Integration Pattern | Auth | CORS? | Notes |
|---------|---------------------|------|-------|-------|
| `api.github.com` (Contents API) | Direct browser `fetch()` with `Authorization: Bearer TOKEN` | OAuth token in header | YES — `Access-Control-Allow-Origin: *` confirmed | Rate limit: 5000 req/hr per authenticated user |
| `github.com/login/oauth/*` | Via Cloudflare Worker ONLY — never direct from browser | client_id + client_secret | NO — OAuth endpoints do not support CORS | Worker holds client_secret as environment variable |
| jsDelivr CDN | `<script src="...">` in index.html | None | N/A | `https://cdn.jsdelivr.net/npm/minisearch@7.2.0/dist/umd/index.min.js` |
| Cloudflare Workers | Popup redirect target for OAuth flow | client_secret in env var | Worker sets CORS headers itself | Free tier: 100k req/day — sufficient |

### Internal Boundaries

| Boundary | Communication | Dependency Direction |
|----------|---------------|---------------------|
| `app.js` → `auth.js` | Calls `isAuthenticated()`, `getToken()`, `login()`, `logout()` — global functions | app.js depends on auth.js |
| `app.js` → `github-api.js` | Calls `updateDoc()`, `createDoc()`, `deleteDoc()`, `updateJsonFile()` | app.js depends on github-api.js |
| `app.js` → `search.js` | Calls `renderSearch(query)` for search route | app.js depends on search.js |
| `app.js` → `kanban-dnd.js` | Calls `wireKanbanDnD(columns, tasks)` after kanban DOM renders | app.js depends on kanban-dnd.js |
| `github-api.js` → `auth.js` | Calls `getToken()` inside each API function — never stores token itself | github-api.js depends on auth.js |
| `kanban-dnd.js` → `github-api.js` | Calls `updateTaskColumn(taskId, column)` on confirmed drop | kanban-dnd.js depends on github-api.js |
| MCP `tools/read.ts` ↔ `data/docs/` | `readFileSync` — same `DOCS_DIR` constant already defined in `paths.ts` | No new dependency |
| MCP `tools/write.ts` ↔ `data/docs/` | `writeFileSync` + `renameSync` + `unlinkSync` for delete — follows existing atomic write pattern | No new dependency |

## Build Order (Dependency-Driven)

```
Phase 1 — Full-text search (no auth, no writes — lowest risk, immediate value)
  1a. Add MiniSearch CDN script tag to index.html
  1b. Write search.js (index builder + render)
  1c. Add search input to sidebar HTML
  1d. Add #/search route to app.js router
  Verify: search works end-to-end without login

Phase 2 — MCP search + doc CRUD tools (independent of site auth)
  2a. Add keloia_search_docs to tools/read.ts
  2b. Add keloia_add_doc, keloia_edit_doc, keloia_delete_doc to tools/write.ts
  2c. npm run build in mcp-server/, verify tools register
  Verify: Claude Code can search and CRUD docs via MCP

Phase 3 — MCP setup guide page (static content, no code changes)
  3a. Write data/docs/mcp-setup.md
  3b. Add entry to data/docs/index.json
  Verify: page appears in sidebar, renders correctly

Phase 4 — GitHub OAuth (required before any site write features)
  4a. Create GitHub OAuth App, note client_id + client_secret
  4b. Write cloudflare-worker/oauth-proxy.js
  4c. Deploy Worker, set CLIENT_SECRET env var
  4d. Write auth.js (popup, poll, token management)
  4e. Add login button + auth badge to index.html
  4f. Wire login/logout in app.js
  Verify: login flow completes, token appears in localStorage

Phase 5 — GitHub API wrapper (requires auth)
  5a. Write github-api.js (getFileSha, createDoc, updateDoc, deleteDoc, updateJsonFile)
  Verify: can call api.github.com with token, PUT a test file

Phase 6 — Doc CRUD UI (requires auth + GitHub API)
  6a. Add Edit/Save/Cancel buttons to renderDoc() in app.js
  6b. Add Add Doc form to sidebar or main area
  6c. Add Delete with confirmation
  Verify: full CRUD round-trip (edit saves to GitHub, re-renders correctly)

Phase 7 — Interactive kanban with drag-and-drop (requires auth + GitHub API)
  7a. Write kanban-dnd.js (DnD event wiring + confirmation modal)
  7b. Refactor renderKanban() to call wireKanbanDnD() after DOM render
  7c. Add drag-over column highlight CSS
  Verify: drag card to new column → confirm → API updates task file → board re-renders
```

**Why this order:** Search is zero-risk and ships value immediately. MCP tools are independent of site auth and use the established write pattern. OAuth is the hardest integration point — it gates all other write features. Auth before API before UI ensures each layer is verified before depending on it. Kanban DnD last because it combines auth, API, and DOM complexity.

## Anti-Patterns

### Anti-Pattern 1: Direct OAuth Token Exchange from Browser

**What people do:** POST directly to `https://github.com/login/oauth/access_token` from JavaScript in the browser, sometimes trying to put the client_secret in a config file or environment variable.

**Why it's wrong:** GitHub's OAuth token endpoints do NOT send CORS headers — the browser blocks the response before JavaScript can read it. The client_secret would also be exposed in the site source code, allowing anyone to create tokens on behalf of your app.

**Do this instead:** Use a Cloudflare Worker (or equivalent serverless function) to hold the client_secret in an environment variable and perform the code-for-token exchange server-side. The SPA only ever receives and stores the final token.

### Anti-Pattern 2: Parallel GitHub Contents API Writes

**What people do:** Fan out multiple PUT or DELETE requests concurrently to save time when making compound changes (e.g., create file + update index.json at the same time).

**Why it's wrong:** GitHub's official documentation explicitly warns: "If you use this endpoint and the Delete a file endpoint in parallel, the concurrent requests will conflict and you will receive errors." The SHA used to authenticate a write becomes stale the moment any other write completes.

**Do this instead:** Serialize all write operations. For compound changes (add doc file + update index.json), always complete the first write, await the response, then start the second write.

### Anti-Pattern 3: Growing app.js with Auth + API + DOM Logic

**What people do:** Add authentication state checks, GitHub API calls, and DnD event handlers directly into `app.js` alongside the existing router and renderers.

**Why it's wrong:** `app.js` is already 263 lines and owns routing, doc rendering, kanban rendering, and progress rendering. Adding auth, GitHub API, search, and DnD to it produces an 800+ line file where unrelated concerns are entangled. Debugging a search bug means reading through kanban DnD code.

**Do this instead:** Keep `app.js` as a dispatcher only. Each new concern gets its own file loaded as a separate `<script>` tag. Functions are globally scoped (no module system, no bundler). `app.js` calls `renderSearch()`, `login()`, `updateDoc()` — it doesn't implement them.

### Anti-Pattern 4: sessionStorage for the OAuth Token

**What people do:** Write the GitHub token to `sessionStorage` instead of `localStorage`, reasoning it's safer because it doesn't persist across browser restarts.

**Why it's wrong:** The OAuth popup window and the main SPA window are separate browser contexts. `sessionStorage` is NOT shared between windows — `localStorage` IS. The popup cannot write a token that the main window can read if `sessionStorage` is used. The poll loop will never detect the token.

**Do this instead:** Write the token to `localStorage` from the popup. Provide an explicit logout function that calls `localStorage.removeItem('github_token')`. For a single-developer tool, token persistence across sessions is a feature, not a vulnerability.

### Anti-Pattern 5: Triggering Index Rebuild on Every Keystroke

**What people do:** Call `buildIndex()` inside the search input handler without caching, rebuilding the MiniSearch index on every keystroke.

**Why it's wrong:** Building the index requires fetching all doc files via HTTP — N network requests on every keystroke. This is N×keystroke rate fetches, hammering GitHub Pages with redundant requests.

**Do this instead:** Build the index once (lazy, on first search interaction) and cache it in a module-level variable. Subsequent searches use the cached index with zero network traffic.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-2 users (current) | Current approach is correct — localStorage token, client-side search, direct GitHub API writes, no server persistence needed |
| 10-50 users | GitHub Contents API rate limits (5000 req/hr per token) become relevant if users share a token. Move to per-user OAuth (already planned). Consider pre-building search index as a committed JSON file, regenerated in GitHub Actions on push. |
| 100+ users | GitHub API rate limits per user become a real constraint at write-heavy usage. Concurrent writes need client-side queuing. At this scale, re-evaluate the zero-build constraint — a lightweight backend (Cloudflare Workers KV or Vercel Edge) would be appropriate. |

### Scaling Priorities

1. **First bottleneck:** Search index build time if docs grow beyond ~50 files. Fix: pre-build `data/docs/search-index.json` in GitHub Actions (`npm run build-index`), load from CDN instead of fetching all markdown files at runtime.
2. **Second bottleneck:** Write conflicts if multiple users edit simultaneously. Fix: optimistic SHA freshness — if a PUT fails due to stale SHA, re-fetch SHA and retry once before showing an error.

## Sources

- [GitHub REST API CORS support — official docs](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) — HIGH confidence. `Access-Control-Allow-Origin: *` confirmed from official GitHub documentation.
- [GitHub Contents API endpoints — official docs](https://docs.github.com/en/rest/repos/contents) — HIGH confidence. GET/PUT/DELETE endpoints, SHA requirement, serialization warning confirmed.
- [GitHub OAuth App authorization flows — official docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) — HIGH confidence. Device flow requires client_secret for polling; web flow requires server-side exchange.
- [OAuth web flow endpoints don't support CORS — GitHub issue #330](https://github.com/isaacs/github/issues/330) — HIGH confidence. Longstanding documented limitation.
- [Simon Willison: GitHub OAuth for static sites via Cloudflare Workers](https://til.simonwillison.net/cloudflare/workers-github-oauth) — MEDIUM confidence. Working implementation demonstrating popup + localStorage pattern. Not official docs, but a live reference implementation.
- [gr2m/cloudflare-worker-github-oauth-login](https://github.com/gr2m/cloudflare-worker-github-oauth-login) — MEDIUM confidence. Production-ready Cloudflare Worker for GitHub OAuth token exchange.
- [MiniSearch v7.2.0 on jsDelivr CDN](https://www.jsdelivr.com/package/npm/minisearch) — HIGH confidence. Version 7.2.0, September 2025. ESM + CJS + UMD builds available.
- [MDN: Kanban board with HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Kanban_board) — HIGH confidence. Official MDN reference, no external library required.

---
*Architecture research for: Keloia Docs v2.0 — Search + Auth + CRUD + Kanban DnD integration*
*Researched: 2026-02-22*
