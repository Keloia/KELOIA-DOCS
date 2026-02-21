# Feature Research

**Domain:** Read-write documentation site + MCP server (v2.0 — search, auth, CRUD, interactive kanban)
**Researched:** 2026-02-22
**Confidence:** MEDIUM — GitHub API behavior verified via official docs (HIGH); GitHub OAuth CORS limitation verified via community discussion (HIGH); client-side search library patterns verified via WebSearch (MEDIUM); MCP search tool patterns inferred from existing MCP tools + spec (MEDIUM)

---

## Context: What v2.0 Adds

This file covers only **new** features for v2.0. The existing v1.1 baseline is:

- Static site: markdown rendering, read-only kanban, progress tracker
- MCP server: 7 tools — list_docs, read_doc, get_kanban, add_task, move_task, get_progress, update_progress

**Hard constraints that shape every v2.0 feature:**

- Zero build step for site (no npm, no bundler, no transpiler for site code)
- Vanilla HTML/CSS/JS for site only (no React, Astro, Tailwind)
- GitHub Pages hosting (static files only — no server-side logic, no cookies with HttpOnly, no secret storage)
- Single source of truth: `data/` directory (markdown + JSON files)
- Primary users: Reza (developer) + Claude Code (AI tool)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in a read-write doc site. Missing these = feature is broken or unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Search box with results + snippets | Any doc site over 5 pages needs search; users never accept "use Ctrl+F" | MEDIUM | Client-side full-text search with no backend; index built from fetched markdown at page load; display matching line snippets under results |
| Search results while typing (debounced) | Modern search UX expectation; batch-submit feels broken | LOW | Debounce input ~300ms to avoid re-indexing on every keystroke; search the in-memory index, not re-fetch files |
| Markdown editor for doc editing | Edit must show what the user is editing; raw textarea with markdown is the minimum acceptable | MEDIUM | Textarea with markdown input; preview toggle optional but not required for MVP; must submit via GitHub API |
| Login / logout state visible in UI | Auth without visible state leaves user confused about whether they are logged in | LOW | Show GitHub avatar + username when authenticated; show "Login with GitHub" when not; token stored in localStorage (no alternative on static site) |
| Write operations gated behind auth | Users expect "edit" buttons to require login — unhidden edit controls on unauthenticated state feel broken | LOW | Edit/delete/drag controls hidden or disabled when unauthenticated; show login prompt on click |
| Confirmation before destructive actions | Delete doc, delete task: users expect a "are you sure?" modal | LOW | Simple confirm modal with document title / task title in message; cancel + confirm buttons |
| Drag-and-drop kanban columns | Once kanban is visible, users expect cards to be draggable (static board is perceived as broken in 2026) | MEDIUM | HTML5 Drag and Drop API; draggable cards, droppable column zones; persist column change via existing move_task data write (or GitHub API for site) |
| MCP `search_docs` tool | Claude Code cannot do keyword search without it; `list_docs` + `read_doc` reads all files sequentially — acceptable at 5 docs, awkward at 20+ | MEDIUM | Already deferred from v1.1 ("moved to v2.0" per PROJECT.md) |
| MCP tools for doc CRUD | Symmetric with site CRUD; if human can edit docs via site, Claude Code should also be able to via MCP | MEDIUM | add_doc, edit_doc, delete_doc tools writing directly to `data/docs/` — no GitHub API needed since MCP runs locally against the filesystem |
| MCP setup guide page | Tool is useless until configured; users expect a dedicated "how to set this up" page per IDE | LOW | Static markdown page or inline HTML; cover Cursor, Claude Code, Windsurf — all use JSON config but with different file locations |

### Differentiators (Competitive Advantage)

Features that go beyond the baseline and reinforce the core value proposition of "humans and AI share the same live data layer."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Search that covers both site and MCP via same index | Same `data/docs/` source means site search and MCP search are always in sync — no dual-indexing | LOW | MCP search_docs reads files at call time; site search indexes at page load; both operate on the same markdown files. Sync is structural, not a build step |
| MCP doc CRUD writes directly to filesystem | MCP running locally writes to `data/docs/` directly — no GitHub API, no token storage, no CORS problem; changes are immediately visible to git push and site deploy | MEDIUM | Bypasses auth entirely for MCP path. Write entity file (slug.md), update `data/docs/index.json`. Same atomic pattern as kanban writes |
| Drag-and-drop saves without page reload | SPA already; save state update + visual column change in one interaction = instant feedback | LOW | On drop: update DOM immediately (optimistic), then write to data (via existing site write path). Revert on error |
| Search with regex/filter support in MCP | MCP tool is used by LLMs, not humans; regex support lets Claude Code do targeted queries like "find all docs mentioning 'v2.0'" | LOW | `search_docs` accepts optional `query` (substring/regex) and optional `slug` filter; matches against file content loaded in memory at call time |
| Per-IDE MCP setup guide with copy-paste config | Generic MCP docs make users adapt instructions; per-IDE blocks with exact JSON configs reduce setup friction to near-zero | LOW | Three tabbed or sectioned blocks: Cursor (`.cursor/mcp.json`), Claude Code (`.mcp.json` in project root), Windsurf (`~/.codeium/windsurf/mcp_config.json`) |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem natural here but create problems given the constraints.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| GitHub OAuth web flow with client secret on static site | Seems like the "right" auth pattern | GitHub's token exchange endpoint (`/login/oauth/access_token`) has no CORS headers — a browser fetch to it gets blocked. Client secret cannot be stored on a static site. This pattern is fundamentally broken without a backend. | GitHub Device Flow (requires user to visit `github.com/login/device` and enter a code) or PAT entry (user pastes a token they generated manually). Both work without a backend. Device Flow has no CORS issue because the token polling is to the API endpoint, not the auth endpoint — but as of 2026 GitHub still requires CORS-safe polling. PAT entry is simpler and sufficient for a 1-2 user tool. |
| Markdown live preview side-by-side editor | Nice UX for editing | Adds significant DOM management; split-pane CSS in vanilla JS is non-trivial; out of scope for a developer-only tool where the user knows markdown | Simple textarea + separate "Preview" toggle tab. Same content, switched view. |
| Full search engine with relevance ranking (TF-IDF, BM25) | Makes search feel more powerful | Overkill for <20 docs. TF-IDF libraries (lunr.js, flexsearch) add CDN dependency; the zero-dependency constraint on the site is absolute. | Simple substring match over loaded markdown text. Case-insensitive `String.includes()` or `indexOf()` on file content fetched at page load. No library needed. |
| Server-side search (Algolia, Pagefind, etc.) | Production search quality | All options require either a build step (Pagefind), a third-party account (Algolia), or a backend process. All three violate constraints. | Client-side substring search. Sufficient for the corpus size. |
| JWT session tokens with expiry + refresh | Correct for a real auth system | No server to issue or validate JWTs. localStorage token is already a session — it expires when manually cleared. Refresh logic has no server to refresh against. | Store GitHub token (PAT or Device Flow token) in localStorage. Treat it as valid until GitHub returns 401, then prompt re-login. |
| Delete column on kanban | Logical CRUD | Destroys task history; tasks without a valid column break `get_kanban` and `move_task`. Column set is intentionally small and stable. | Admin edits column list directly in `data/kanban/index.json`. Not a UI operation. |
| Real-time collaborative editing | Multiple users editing the same doc simultaneously | No WebSocket, no persistent server, GitHub Pages is static. Shared write access would require last-write-wins via SHA update which GitHub API enforces — concurrent edits to the same file will fail with a SHA conflict. | Sequential editing is fine for a 1-2 user tool. SHA conflict on GitHub API returns 409 — surface this as a clear error ("file was changed by someone else, reload and retry"). |
| WYSIWYG editor (contenteditable / rich text) | "Better" editing experience | Cannot be built without a build step if using a library; contenteditable from scratch is a significant engineering effort. Markdown textarea is the correct tool here — developer users know markdown. | Markdown textarea. |

---

## Feature Dependencies

```
[GitHub Auth (PAT or Device Flow)]
    └──enables──> [Doc CRUD on site (add, edit, delete)]
    └──enables──> [Interactive kanban save (drag + persist)]
    └──NOT required for──> [MCP doc CRUD] (MCP runs locally, writes filesystem directly)
    └──NOT required for──> [Site search] (read-only, no auth needed)
    └──NOT required for──> [MCP search_docs] (read-only, no auth needed)

[Doc CRUD on site]
    └──requires──> [GitHub API file contents endpoint]
                       └──requires──> [SHA fetch before every update/delete]
                       └──requires──> [Base64 encode/decode of file content]
    └──requires──> [data/docs/index.json update] on add/delete
    └──enhances──> [Site search] (new docs immediately searchable after add)

[Site full-text search]
    └──requires──> [data/docs/index.json] to enumerate files
    └──requires──> [Fetch all doc files at page load] to build in-memory corpus
    └──NOT requires──> [Auth] (read-only)
    └──NOT requires──> [Any library] (substring match is sufficient)

[MCP search_docs]
    └──requires──> [Existing list_docs / read_doc infrastructure]
    └──NOT requires──> [Auth] (MCP runs locally, filesystem access)
    └──enhances──> [MCP doc CRUD] (find docs before editing)

[MCP doc CRUD (add_doc, edit_doc, delete_doc)]
    └──requires──> [data/docs/index.json update] on add/delete (same atomic pattern as add_task)
    └──requires──> [Zod validation] on inputs (same pattern as add_task / update_progress)
    └──NOT requires──> [GitHub API] (MCP writes directly to filesystem)
    └──NOT requires──> [Auth] (MCP is local; filesystem access = access)

[Interactive kanban drag-and-drop]
    └──requires──> [Auth] to persist column changes (write gate)
    └──requires──> [HTML5 Drag and Drop API] (no library)
    └──uses──> [existing move_task data write path on site] to save on drop
    └──enhances──> existing static kanban view (replaces read-only board)

[MCP setup guide page]
    └──requires──> NOTHING — static content
    └──NOT requires──> [Auth]
    └──NOT requires──> [Any new data file]
```

### Dependency Notes

- **Auth is NOT required for search or MCP features.** The gate is specifically for site write operations (doc CRUD, kanban saves).
- **MCP doc CRUD bypasses auth entirely.** The MCP server runs locally and writes to the filesystem directly. No GitHub API call, no token. This is intentional and correct for a local developer tool.
- **SHA is a required parameter for GitHub API update and delete.** Every edit/delete flow on the site must first GET the file to retrieve its current SHA, then include that SHA in the PUT/DELETE. Forgetting SHA = 422 Unprocessable Entity error. This is a non-negotiable workflow step.
- **Drag-and-drop on kanban needs the same write path as manual task moves.** On static site, "saving" a drag means calling the same data write used for add_task/move_task. This path should be extracted as a shared utility before building drag-and-drop.
- **search_docs and site search use the same source files, but different mechanisms.** Site search fetches markdown via HTTP and indexes in the browser. MCP search reads markdown via `fs.readFileSync` on the local filesystem. They converge on the same content, with no sync required.

---

## MVP Definition

### Launch With (v2.0)

All features listed in PROJECT.md v2.0 goal are the MVP. No further trimming is needed — the scope is already narrowly defined for a 1-2 user developer tool.

- [ ] **Site full-text search** — Sidebar search box, in-memory index at page load, results with snippets. Table stakes for any doc site.
- [ ] **MCP `search_docs` tool** — Keyword/regex search across docs. Already deferred from v1.1, users will notice the gap.
- [ ] **MCP setup guide page** — Static page with per-IDE config blocks for Cursor, Claude Code, Windsurf. Zero risk, high value.
- [ ] **GitHub Auth (PAT entry or Device Flow)** — Gate for all site write operations. Choose PAT entry first (simpler, no CORS issue, sufficient for 1-2 users).
- [ ] **Doc CRUD on site** — Add (new markdown file via GitHub API), edit (textarea + PUT with SHA), delete (DELETE with SHA + confirm modal).
- [ ] **MCP doc CRUD tools** — add_doc, edit_doc, delete_doc. Symmetric with site; writes directly to filesystem.
- [ ] **Interactive kanban drag-and-drop** — Replace static board; drag card to new column, persist on drop, confirmation modal for moves, gated behind auth.

### Add After Validation (v2.x)

Add when daily usage reveals the gap.

- [ ] **Markdown preview toggle on doc edit** — Add when editing raw markdown proves friction for non-trivial docs.
- [ ] **Search filter by doc slug/title** — Add when corpus exceeds ~15 docs and results become noisy.
- [ ] **SHA conflict error with clear user message** — Add the first time a real 409 occurs in practice.

### Future Consideration (v3+)

Defer until a clear need emerges.

- [ ] **HTTP/SSE transport for MCP server** — Enables remote Claude Code access. Out of scope per PROJECT.md until needed.
- [ ] **Real-time search index updates** — Update index on doc add/delete without full page reload. Only needed if doc churn is high.
- [ ] **OAuth web flow with a minimal backend** — Consider if Device Flow proves confusing for new users. Requires a tiny proxy (Cloudflare Worker or similar).

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| MCP setup guide page | HIGH | LOW | P1 — pure content, no risk |
| Site full-text search | HIGH | MEDIUM | P1 — table stakes |
| MCP `search_docs` tool | HIGH | LOW | P1 — builds on existing list_docs/read_doc |
| GitHub Auth (PAT entry) | HIGH | LOW | P1 — enables all write ops; PAT simpler than Device Flow |
| MCP doc CRUD (add_doc, edit_doc, delete_doc) | HIGH | MEDIUM | P1 — extends existing write tool pattern |
| Doc CRUD on site | HIGH | HIGH | P1 — GitHub API SHA dance + markdown editor + auth gate |
| Interactive kanban drag-and-drop | MEDIUM | MEDIUM | P1 — described in v2.0 goals; replaces static board |
| Markdown preview toggle | LOW | MEDIUM | P2 |
| Device Flow auth | LOW | HIGH | P3 — PAT is sufficient; Device Flow adds complexity for minimal gain |

**Priority key:**
- P1: Must have for v2.0 launch
- P2: Should have, add in v2.x when gap appears
- P3: Nice to have, v3+ consideration

---

## Implementation Behavior Reference

Detailed expected behaviors for each v2.0 feature, for use in phase planning.

### GitHub Auth: PAT Entry (Recommended)

**How it works:**

1. User clicks "Login" in sidebar
2. Modal prompts for a GitHub Personal Access Token (PAT) with `repo` scope
3. Site calls `GET /user` on GitHub API with the token to verify it is valid and retrieve username + avatar
4. On success: token stored in `localStorage`, avatar + username shown in sidebar, write controls revealed
5. On failure: clear error message ("Token invalid or missing repo scope")
6. "Logout" clears `localStorage` and hides write controls

**Required token scope:** `repo` (to read/write file contents in the repository)

**Why PAT over Device Flow:** Device Flow requires user to open `github.com/login/device` in a separate tab and enter a user code. Adds 2 extra steps with no security benefit for a 1-2 user private tool. PAT entry is 1 step: paste token, done.

**Why PAT over OAuth web flow:** GitHub's `/login/oauth/access_token` token exchange endpoint does not support CORS. A browser fetch to it is blocked. No workaround exists without a backend. PKCE support was added by GitHub (July 2025) but the CORS restriction on the token endpoint was not resolved at time of research. Device Flow also still requires CORS-safe polling that GitHub has not confirmed as available.

**Security note:** PAT in localStorage is visible to JavaScript. Acceptable for a developer-only tool on a trusted machine. Not acceptable for a public-facing consumer app.

### GitHub API: Doc CRUD

**Create doc (add):**

1. Validate slug (no spaces, no special chars, `.md` extension not needed in slug)
2. Build content string (markdown textarea value)
3. Base64 encode content (`btoa(unescape(encodeURIComponent(content)))` for Unicode safety)
4. `PUT /repos/{owner}/{repo}/contents/data/docs/{slug}.md` with `{ message, content }` (no SHA needed for new file)
5. On success: update in-memory doc list, update sidebar nav, re-index search corpus
6. On conflict (file already exists): GitHub returns 422 — surface as "A doc with that slug already exists"

**Update doc (edit):**

1. Fetch current file: `GET /repos/{owner}/{repo}/contents/data/docs/{slug}.md`
2. Extract `sha` from response (required for update)
3. Show current content in textarea (`atob(response.content)` decoded from Base64)
4. User edits and submits
5. `PUT /repos/{owner}/{repo}/contents/data/docs/{slug}.md` with `{ message, content, sha }`
6. On 409 conflict (SHA stale — someone else updated the file): surface error "File changed since you opened it. Reload and retry."

**Delete doc:**

1. Confirm modal: "Delete [title]? This cannot be undone."
2. Fetch current file to get SHA
3. `DELETE /repos/{owner}/{repo}/contents/data/docs/{slug}.md` with `{ message, sha }`
4. Update `data/docs/index.json` — remove entry (requires second PUT with index file's SHA)
5. On success: remove from sidebar, re-index search corpus

**SHA rule (HIGH confidence — official GitHub REST API docs):** SHA is mandatory on update and delete. It is the mechanism GitHub uses for optimistic concurrency control — it ensures you are replacing the exact version you read. There is no way to bypass this requirement.

### Site Full-Text Search

**Expected UX:**

1. Search box in sidebar (always visible)
2. User types query (minimum 2 characters)
3. After 300ms debounce: search in-memory corpus
4. Results: matching doc titles + a 1-2 line snippet of the matching content (context around the match)
5. Click result → navigate to that doc
6. Empty query or <2 chars → hide results panel, show normal sidebar

**Implementation approach (no library):**

- At page load: fetch all docs listed in `data/docs/index.json`, store `{ slug, title, content }` array in memory
- Search: `corpus.filter(doc => doc.content.toLowerCase().includes(query.toLowerCase()))`
- Snippet: find the index of the match in content, extract ~100 chars before and after, add ellipsis
- No library needed for this corpus size (<20 docs). FlexSearch/MiniSearch are overkill and violate the zero-dependency site constraint.

**Limitation:** Index is stale if docs are added/deleted during the same session (without a reload). Mitigate by re-indexing after any doc CRUD operation completes.

### MCP `search_docs` Tool

**Expected behavior:**

```
search_docs(query: string, slug?: string) → { matches: [{ slug, title, snippet, lineNumber }] }
```

- `query`: substring or regex string
- `slug`: optional — if provided, search only that doc; otherwise search all docs
- Match: try as regex first (`new RegExp(query, 'i')`), fall back to case-insensitive substring if regex invalid
- Snippet: 1-2 lines of context around the match
- Returns empty array (not error) if no matches found
- Returns `isError: true` if slug provided but file does not exist

**Why regex support:** LLMs (Claude Code) benefit from precise pattern matching — e.g., "find all headings mentioning 'milestone'" → `^## .*milestone`. Natural language callers can use plain strings; regex is opt-in via the same field.

### Interactive Kanban Drag-and-Drop

**Expected UX:**

1. Cards have `draggable="true"` attribute
2. User drags card from one column to another
3. On drop: confirmation modal — "Move '[task title]' to [column name]?"
4. Confirm → update column in data, update DOM
5. Cancel → return card to original column (no DOM change)
6. Drag-and-drop controls are hidden (or cards are `draggable="false"`) when not authenticated

**Implementation (HTML5 Drag and Drop API — no library):**

- `dragstart` on card: store task ID in `event.dataTransfer.setData('text/plain', taskId)`
- `dragover` on column: `event.preventDefault()` to allow drop
- `drop` on column: retrieve task ID, get column name, show confirmation modal
- On confirm: call existing data write path (update task file's column field, update index if needed), then update DOM

**Data persistence for site:** Unlike MCP (filesystem write), site kanban saves go through the GitHub API (same as doc edits). Move = fetch task file → get SHA → PUT with updated column field. This is the same SHA dance as doc edit.

**Constraint:** Auth required. Unauthenticated users see the board but cannot drag.

### MCP Doc CRUD Tools

**add_doc:**

```
add_doc(slug: string, title: string, content: string) → success message with file path
```

- Validate slug (no slashes, no `.md` extension in param — tool appends it)
- Check file does not already exist (avoid silent overwrite)
- Write `data/docs/{slug}.md` with content
- Update `data/docs/index.json` — append `{ slug, title }` to docs array
- Atomic: write file first, then update index

**edit_doc:**

```
edit_doc(slug: string, content: string, message?: string) → success message
```

- Validate slug exists
- Overwrite `data/docs/{slug}.md` with new content
- No index update needed (slug and title unchanged)
- Optional: accept `title` param to update the index entry's title field

**delete_doc:**

```
delete_doc(slug: string) → success message
```

- Validate slug exists
- Delete `data/docs/{slug}.md`
- Update `data/docs/index.json` — remove entry from docs array
- Atomic: update index first (remove entry), then delete file — inverse of add_doc order; ensures index never points to a deleted file

### MCP Setup Guide Page

**Content required per IDE:**

| IDE | Config file location | Config format | Restart required? |
|-----|---------------------|---------------|-------------------|
| Claude Code | `.mcp.json` in project root | `{ "mcpServers": { "keloia": { "type": "stdio", "command": "node", "args": ["mcp-server/dist/index.js"] } } }` | No — per-project scope auto-loads |
| Cursor | `.cursor/mcp.json` in project root | Same JSON structure | Yes — restart Cursor |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` (global) | Same JSON structure | Yes — restart Windsurf |

**Page structure:**

1. Prerequisites section (Node.js installed, repo cloned, `npm install && npm run build` in `mcp-server/`)
2. Per-IDE tabbed or sectioned blocks with copy-paste JSON config
3. Verification step ("Ask Claude: 'List the docs in this project'")
4. Troubleshooting section (common failures: wrong working directory, server not built, stale config)

---

## Sources

- [GitHub REST API: Repository Contents](https://docs.github.com/en/rest/repos/contents) — SHA requirement for update/delete, Base64 encoding, endpoint structure (HIGH confidence)
- [GitHub OAuth CORS issue — persistent as of 2025](https://github.com/isaacs/github/issues/330) — token exchange endpoint does not support CORS (HIGH confidence)
- [GitHub PKCE support announcement + CORS status](https://github.com/orgs/community/discussions/15752) — PKCE added July 2025 but CORS on token endpoint still unresolved (HIGH confidence)
- [GitHub Device Flow in browser — requires backend](https://www.zonca.dev/posts/2025-01-29-github-auth-browser-device-flow) — confirmed: GitHub blocks direct device flow calls from browser (MEDIUM confidence — third-party article, consistent with GitHub docs)
- [MDN: Kanban board with HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Kanban_board) — HTML5 Drag API behavior, dragstart/dragover/drop pattern (HIGH confidence)
- [MCP setup guides: Cursor, Claude Code, Windsurf](https://help.yourgpt.ai/article/mcp-setup-guide-for-claude-desktop-cursor-and-windsurf-1789) — per-IDE config file locations and JSON structure (MEDIUM confidence — third-party guide, consistent across multiple sources)
- [FlexSearch](https://github.com/nextapps-de/flexsearch), [MiniSearch](https://github.com/lucaong/minisearch) — client-side full-text search library options (not recommended for this project — zero-dependency constraint)

---

*Feature research for: Keloia Docs + MCP Server v2.0 (search, auth, CRUD, interactive kanban)*
*Researched: 2026-02-22*
