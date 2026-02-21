# Project Research Summary

**Project:** Keloia Docs — Static Documentation Site + MCP Server (v2.0)
**Domain:** Static SPA (GitHub Pages, zero build step) + local MCP server (stdio, TypeScript) — v2.0 adds search, auth, doc CRUD, interactive kanban
**Researched:** 2026-02-22
**Confidence:** HIGH (stack and pitfalls fully verified against official sources; architecture confirmed against GitHub API docs and MDN; features shaped by confirmed GitHub API constraints)

## Executive Summary

Keloia is a dual-audience documentation and project management tool: human users interact through a browser-based static site hosted on GitHub Pages, while AI tools (Claude Code, Cursor, Windsurf) interact through a locally-run MCP server over stdio. The v2.0 milestone adds search, authentication, doc CRUD, and interactive kanban drag-and-drop to a v1.1 foundation that already ships read-only views and 7 working MCP tools. The architecture is deliberately minimal — zero build step on the site, vanilla HTML/CSS/JS, and a single shared `data/` directory as the source of truth for both layers. The existing v1.1 codebase already resolves the foundational MCP pitfalls (stdout pollution, atomic writes, path resolution, Zod pinning, tool naming). v2.0 builds on this stable foundation without touching it.

The recommended approach extends both layers independently: the site layer adds functionality via CDN script tags (FlexSearch or MiniSearch for search, SortableJS for drag-and-drop) and new vanilla JS module files loaded as `<script>` tags, while the MCP server adds new tools to existing TypeScript files and recompiles. GitHub authentication for site write operations uses a Personal Access Token entered by the user — GitHub's OAuth web flow token endpoint lacks CORS support and requires a backend proxy, making PAT entry the pragmatic choice for a 1-2 user developer tool. A Cloudflare Worker OAuth proxy is a valid v2.x upgrade path but is not required for v2.0. The most architecturally significant new component is `github-api.js`, which wraps the GitHub Contents API with SHA-aware CRUD operations, Unicode-safe Base64 encoding, and a serialized write queue to prevent 409 Conflict errors from concurrent operations.

The key risks concentrate in two areas. First, GitHub API write operations require strict serialization (concurrent writes cause 409 Conflict) and a mandatory GET-before-PUT SHA fetch — these are non-negotiable constraints with no workarounds, and implementing them incorrectly produces intermittent failures that are difficult to reproduce. Second, the site's JavaScript architecture must prevent a specific set of pitfalls around drag event handling, token storage, and search index building — all well-documented, all preventable with specific code patterns. The MCP layer risks are largely the same as v1.1 (tool count growth degrading selection accuracy, description quality for overlapping tools) and extend naturally from established patterns.

## Key Findings

### Recommended Stack

The site layer requires zero new npm packages. All new client-side libraries load via CDN `<script>` tags: FlexSearch 0.8.212 (or MiniSearch 7.2.0) for full-text search, SortableJS 1.15.7 for kanban drag-and-drop. GitHub REST API calls use native `fetch` with no SDK wrapper — the Contents API exposes only 3 endpoints needed (GET/PUT/DELETE file) with a consistent pattern that requires fewer than 15 lines per operation. The MCP server stack is unchanged from v1.1 — `@modelcontextprotocol/sdk@1.27.0`, `zod@^3.25.0`, TypeScript 5.9.3. GitHub OAuth (if replacing PAT auth) requires a single ~40-line Cloudflare Worker; the free tier (100,000 req/day) is sufficient for a 1-2 user tool.

**Core technologies:**
- Vanilla HTML/CSS/JS: site shell — zero build step is a hard project constraint; no framework satisfies it without a bundler
- marked.js 17.0.3 (CDN, existing): markdown rendering — ~7KB gzipped, no build step, already in use
- GitHub Pages (existing): static hosting — push to `main` = deployed, zero config
- FlexSearch 0.8.212 or MiniSearch 7.2.0 (CDN, new): client-side full-text search — index built lazily from fetched markdown files at first search interaction; MiniSearch preferred for cleaner snippet API
- SortableJS 1.15.7 (CDN, new): kanban drag-and-drop — cross-list support via `group` option, built-in touch support, actively maintained
- GitHub REST API Contents endpoint (native `fetch`, new): file CRUD — `api.github.com` sends `Access-Control-Allow-Origin: *`; direct browser calls supported; no SDK needed
- `@modelcontextprotocol/sdk@1.27.0` (existing, unchanged): MCP protocol — official SDK, stdio transport
- `zod@^3.25.0` (existing, unchanged): input validation — must remain pinned to v3; v4 breaks MCP SDK v1.x internals
- Cloudflare Worker, free tier (new, optional): OAuth proxy — holds `client_secret`, exchanges OAuth code for token; required only if full OAuth replaces PAT auth

**Critical version notes:** FlexSearch must be 0.8.x (0.7.x has different API). MiniSearch must be 7.2.0+ (UMD build confirmed on jsDelivr). SortableJS 1.15.7 is current stable (dragula.js is abandoned since 2016). TypeScript 6.0 beta exists but must be avoided — breaking changes possible. Do not use bare `btoa()` for GitHub API content encoding — use `TextEncoder`-based encode.

### Expected Features

The v2.0 scope is already narrowly defined in PROJECT.md. Research confirms the feature list is appropriate and complete for this scale of tool. Several commonly-requested features must be actively rejected because they violate the zero-build-step constraint or the GitHub static site limitations.

**Must have (table stakes for v2.0):**
- Site full-text search with snippets — any doc site over 5 pages requires search; substring/MiniSearch match is sufficient at this corpus size; users never accept "use Ctrl+F"
- MCP `search_docs` tool — already deferred from v1.1; Claude Code cannot efficiently navigate 20+ docs without keyword search; supports regex/substring patterns
- MCP setup guide page — static markdown content, zero implementation risk, high value; users cannot configure the tool without IDE-specific setup instructions
- GitHub Auth (PAT entry) — gate for all site write operations; simpler than Device Flow or OAuth web flow for a 1-2 user tool; no backend required
- Doc CRUD on site (add, edit, delete via GitHub API) — the most complex site feature; requires auth, SHA-aware GitHub API wrapper, and index.json synchronization
- MCP doc CRUD (add_doc, edit_doc, delete_doc) — writes directly to filesystem, no GitHub API or auth required; symmetric with site CRUD for Claude Code users
- Interactive kanban drag-and-drop — static board perceived as broken in 2026; requires auth for persistence; confirmation modal before write

**Should have (v2.x, after validation):**
- Markdown preview toggle on doc edit — add when editing raw markdown proves friction in practice
- Search filter by doc slug/title — add when corpus exceeds ~15 docs and results become noisy
- SHA conflict error with clear user messaging — add when a real 409 Conflict occurs in practice

**Defer to v3+:**
- HTTP/SSE transport for MCP server (remote access, explicitly deferred in PROJECT.md)
- Real-time search index updates without page reload
- Full OAuth web flow (only if PAT proves confusing for new users — requires Cloudflare Worker)

**Active anti-features (must not build):**
- GitHub OAuth web flow in client JS — token endpoint has no CORS; `client_secret` in browser JS is a security failure with no workaround
- Parallel GitHub API writes — GitHub explicitly documents that concurrent writes to the same file cause 409 Conflict; must be serialized
- Live split-pane markdown editor — significant DOM complexity, out of scope for a developer tool; textarea is sufficient
- WYSIWYG/contenteditable editor — cannot build without a library; `contenteditable` from scratch is a major engineering effort; not appropriate here
- Full-text search using Pagefind — requires a post-build CLI step, violating the zero-build constraint
- Delete column on kanban — destroys task history; column set is intentionally small and stable; admin edits index.json directly

### Architecture Approach

The v2.0 architecture extends the existing SPA by adding four new JS module files loaded as `<script>` tags in dependency order. No bundler, no ES module imports — each file exposes globally-scoped functions that `app.js` calls as a thin dispatcher. The `data/` directory remains the single source of truth for both the site (reads via `fetch`, writes via GitHub Contents API) and the MCP server (reads/writes via Node.js `fs`). Two key integration points are new: the GitHub Contents API write path (requires SHA fetch-before-write and serialized write queue) and the GitHub OAuth or PAT auth flow (token stored in `localStorage`, not `sessionStorage`, to allow popup-to-main-window communication).

**Major components:**
1. `auth.js` (new) — PAT entry modal or OAuth popup, `localStorage` token management, `isAuthenticated()`, `getToken()`, `logout()`; loaded first as all write-capable modules depend on it
2. `github-api.js` (new) — wraps GitHub Contents API: `getFileSha()`, `createDoc()`, `updateDoc()`, `deleteDoc()`, `updateJsonFile()`; serialized write queue (`writeQueue = writeQueue.then(() => op())`); Unicode-safe Base64 via `TextEncoder`; depends on `auth.js`
3. `search.js` (new) — lazy index builder (triggered on first search focus, not page load), parallel doc fetch via `Promise.all`, query executor, snippet extractor; no auth dependency; can ship independently of auth
4. `kanban-dnd.js` (new) — HTML5 `dragstart`/`dragover`/`drop` event wiring via delegation on stable board container (not direct card attachment), confirmation modal, auth-gated; depends on `github-api.js`
5. `app.js` (modify) — add `#/search` route, auth guard on write UI elements, call new module functions; stays thin as dispatcher only; does not implement auth, API calls, or DnD logic
6. `cloudflare-worker/oauth-proxy.js` (new, optional) — ~40 lines, holds `client_secret` in Cloudflare env var, exchanges OAuth code for token, returns HTML that writes token to popup's `localStorage` and closes popup; only required if full OAuth replaces PAT
7. `mcp-server/src/tools/read.ts` (modify) — add `keloia_search_docs`: regex/substring match across all doc files via `readFileSync` loop; returns `{ slug, title, snippet, lineNumber }` array
8. `mcp-server/src/tools/write.ts` (modify) — add `keloia_add_doc`, `keloia_edit_doc`, `keloia_delete_doc`: filesystem writes using existing `atomicWriteJson` helper; slug validation via index check; atomic file creation then index update

**Key patterns enforced by research:**
- Script loading order: `auth.js` → `github-api.js` → `search.js` → `kanban-dnd.js` → `app.js` (dependency-driven)
- All GitHub API writes through a Promise-chain write queue (prevents 409 Conflict from concurrent operations)
- Event delegation on stable board container for drag listeners (direct attachment to dynamic card elements is lost after DOM re-render)
- Search index built lazily on first search focus, docs fetched in parallel (not sequentially, not at page load)
- Token in `localStorage` only — `sessionStorage` is not shared between popup window and main SPA window
- OAuth callback reads `?code=` from `window.location.search` (not hash) — hash is stripped in HTTP redirects

### Critical Pitfalls

The v1.1 foundation already resolves pitfalls 1-13 (stdout pollution, non-atomic writes, EXDEV temp file, path resolution, ESM/CJS mismatch, Zod v3/v4, Zod transforms, tool descriptions, tool name collisions, N+1 reads, restart requirement, `.mcp.json` scope, XSS). These must not regress as v2.0 tools are added. The v2.0-specific pitfalls are new and concrete:

1. **GitHub OAuth token exchange requires a backend — no client-side workaround exists** — GitHub's `/login/oauth/access_token` endpoint has no CORS headers; browser `fetch` is blocked before JS can read the response. `client_secret` in client-side JS is also a security failure. Prevention: use PAT entry (recommended, no backend) or Cloudflare Worker (full OAuth). Make this decision before writing any auth code.

2. **GitHub API update and delete require current file SHA — concurrent writes cause 409 Conflict** — Every PUT update and DELETE must be preceded by a GET to retrieve the current blob SHA. Two concurrent writes to the same file will conflict because the second write uses a SHA that was valid before the first write committed. Prevention: always GET-before-PUT; serialize all GitHub writes through a Promise queue.

3. **`btoa()` throws on non-ASCII content; GitHub responses include newlines that break `atob()`** — `window.btoa()` only handles Latin-1. Any markdown with em dashes, smart quotes, curly quotes, or non-ASCII throws `InvalidCharacterError`. GitHub API base64 responses also include `\n` every 60 characters, which breaks `atob()` in some browsers. Prevention: use `TextEncoder`-based encode from the first line of code; strip `\n` from GitHub API responses before `atob()`.

4. **`drop` event never fires without `dragover` calling `preventDefault()`** — The HTML5 DnD API suppresses `drop` on elements that have not signaled acceptance via `dragover` + `event.preventDefault()`. Without this, cards silently snap back. Prevention: always wire `dragover` + `preventDefault()` before any drop logic.

5. **Drag listeners attached directly to card elements are lost after DOM re-render** — When `column.innerHTML = ...` replaces card elements, event listeners attached to the old nodes are garbage-collected. Drag stops working after the first move. Prevention: use event delegation — attach one `dragstart` listener to the stable board container; check `e.target.closest('[data-task-id]')`.

6. **Search index built at page load blocks time-to-interactive** — Fetching all docs at load time (N HTTP requests concurrent with page render) slows the site for users who never search. Prevention: trigger index build on first search focus only; fetch docs in parallel with `Promise.all`; show a loading state in the search input during build.

7. **MCP tool count growth degrades Claude's tool selection accuracy** — v2.0 adds 4 tools (search_docs, add_doc, edit_doc, delete_doc) to the existing 7, reaching 11 total. Each tool definition consumes context window tokens on every turn. Similar tools (add_doc vs edit_doc) require descriptions that explicitly exclude the other's use case. Prevention: keep total under 15 tools; write descriptions with explicit disambiguation ("Use keloia_edit_doc to modify an existing doc. Use keloia_add_doc only when the file does not yet exist.").

## Implications for Roadmap

Research identified a clear dependency graph that strongly determines phase ordering. The ARCHITECTURE.md document proposes a 7-step build order, confirmed by the feature dependency tree in FEATURES.md. The roadmap should follow this ordering. Phases 1, 2, and 3 (search, MCP tools, static guide page) are independent of auth and can ship to users before any auth infrastructure exists. Phases 4-6 (auth, GitHub API wrapper, doc CRUD UI, kanban DnD) have a strict linear dependency and must execute in order.

### Phase 1: Full-Text Search

**Rationale:** Zero-dependency, zero-auth, zero-risk. Delivers immediate value to human users. Sets up the search index pattern that the MCP search tool mirrors. Building this first validates the index build approach and snippet extraction before adding auth and write complexity. Can ship to users immediately after merge.

**Delivers:** Sidebar search box, lazy-built in-memory index from markdown files fetched in parallel on first search focus, results list with text snippets and navigation to matching docs. MCP setup guide page (static markdown + index.json entry) ships alongside as a free content addition.

**Addresses features:** Site full-text search, MCP setup guide page.

**Avoids:** Search index blocking page load (P19 — build lazily on first focus); search results without snippets (P20 — implement snippet extraction as part of rendering, not a follow-up).

**Research flag:** Standard pattern — FlexSearch/MiniSearch CDN usage is well-documented with working examples. Snippet extraction is a standard string algorithm. No research phase needed.

### Phase 2: MCP Search + Doc CRUD Tools

**Rationale:** MCP tools are independent of site auth — they run locally and write directly to the filesystem. Building these before site auth allows shipping value to Claude Code users without any infrastructure setup (no Cloudflare Worker, no OAuth app registration, no PAT entry). Also validates the new tool registration pattern before tool count grows higher.

**Delivers:** `keloia_search_docs` (regex/substring search across all docs, returns slug + title + snippet + lineNumber), `keloia_add_doc` (slug validation + file write + index update), `keloia_edit_doc` (slug existence check + overwrite), `keloia_delete_doc` (index update first, then file delete — inverse order of add ensures index never points to a deleted file).

**Addresses features:** MCP `search_docs` tool, MCP doc CRUD (add_doc, edit_doc, delete_doc).

**Avoids:** Tool count exceeding 15 (P24 — verify total before adding); poor description disambiguation (P8 — add_doc vs edit_doc descriptions must explicitly exclude each other's use case); `console.log` regression in new handlers (P1 — grep check before merge).

**Research flag:** Standard pattern — directly extends established v1.1 write tool pattern. No new SDK surface area. No research phase needed.

### Phase 3: GitHub Auth (PAT Entry)

**Rationale:** Auth gates all remaining site write features. Must be solved and verified before doc CRUD UI or kanban persistence can be implemented. PAT entry is the recommended approach — eliminates the Cloudflare Worker dependency, avoids the OAuth hash-routing conflict, and is appropriate for a 1-2 user developer tool. The auth/no-auth decision must be made before writing any auth code.

**Delivers:** Login modal (PAT entry form), `auth.js` with `isAuthenticated()`, `getToken()`, `logout()`, GitHub `/user` API verification of token validity, auth badge (username + avatar) in sidebar, login button, write-gated UI elements conditionally visible, token persisted in `localStorage`.

**Addresses features:** GitHub Auth.

**Avoids:** OAuth token exchange in client JS (P14 — PAT entry bypasses this entirely); token in `sessionStorage` (P4 architecture — popup and main window cannot share sessionStorage; use `localStorage` only); token lost on SPA navigation (P25 — store in `localStorage`, load in `auth.js` init, use single `githubFetch` wrapper).

**Research flag:** PAT auth is straightforward — no research phase needed. If the decision changes to full OAuth, a targeted research pass on Cloudflare Worker deployment and CORS configuration reduces risk. The `?code=` callback detection pattern (read from `window.location.search` before routing, then `history.replaceState` to clean URL) must be implemented before registering any OAuth App redirect URI.

### Phase 4: GitHub API Wrapper

**Rationale:** The GitHub API wrapper is a shared utility that both doc CRUD UI and kanban persistence depend on. Isolating it as a distinct phase ensures SHA handling, Base64 encoding, and the write queue are fully tested in isolation before any UI features depend on them. A bug in the wrapper will manifest as intermittent 409 Conflicts that are difficult to reproduce without controlled test cases.

**Delivers:** `github-api.js` with `getFileSha()`, `createDoc()`, `updateDoc()`, `deleteDoc()`, `updateJsonFile()` — all writes routed through a serialized write queue (`let writeQueue = Promise.resolve(); writeQueue = writeQueue.then(() => op())`). Base64 encode via `TextEncoder`. Base64 decode with newline stripping before `atob()`.

**Avoids:** GET-before-PUT pattern missing (P16 — every update and delete must call `getFileSha()` first); `btoa()` on non-ASCII content (P17 — use TextEncoder-based encode from day one); GitHub response newlines breaking `atob()` (P18 — strip `\n` before decode); concurrent write race condition (P26 — write queue prevents 409 on rapid successive operations).

**Research flag:** GitHub Contents API is fully documented in official GitHub docs. No research phase needed. Verification checklist: update same file twice in rapid succession (no 409), save a doc containing an em dash (no `InvalidCharacterError`), decode a GitHub API response in Safari (no whitespace error in `atob`).

### Phase 5: Doc CRUD UI

**Rationale:** With auth and the GitHub API wrapper in place, the doc CRUD UI is assembly: textarea editor, save/cancel, confirmation modal for delete, and index.json synchronization. This is the most complex site feature but its dependencies (auth, API wrapper) are now proven. The SHA dance and serialization are already handled by `github-api.js` — this phase only wires the UI to call it.

**Delivers:** Edit doc (textarea pre-filled with decoded markdown content + Save/Cancel buttons in main view), Add doc (form with slug + title + textarea, creates new file + updates index.json), Delete doc (confirmation modal naming the doc title + removes file + removes from index.json). Search corpus re-indexed after each add/delete.

**Addresses features:** Doc CRUD on site.

**Avoids:** SHA bypassed on update (P16 — `updateDoc()` always calls `getFileSha()` first, never reuses cached SHA); index.json update treated as in-memory (the index file is itself a file that requires SHA for updates — use `updateJsonFile()` which calls `getFileSha()` for the index separately); search corpus not updated after CRUD (trigger re-index after successful add/delete).

**Research flag:** Standard pattern built on verified foundation. No research phase needed.

### Phase 6: Interactive Kanban Drag-and-Drop

**Rationale:** Kanban DnD combines auth, GitHub API, and DOM complexity. Comes last because all its dependencies are verified. This phase has the highest concentration of DnD-specific pitfalls (four of the v2.0 pitfalls are DnD-specific). The mobile touch decision must be made before implementation begins — retrofitting touch support after the fact requires significant refactoring.

**Delivers:** Draggable kanban cards (auth-gated — `draggable="true"` and event listeners only wired when `isAuthenticated()` is true), column drop zones with visual highlight during `dragover`, confirmation modal on drop ("Move '[task title]' to '[column]'?"), write-back via `github-api.updateTaskFile()` through the write queue, board re-render on success.

**Addresses features:** Interactive kanban drag-and-drop.

**Avoids:** `drop` event never firing (P21 — `dragover` must call `event.preventDefault()`; wire this first and verify drop fires before implementing any drop logic); drag listeners lost on re-render (P22 — delegate from stable board container, not direct card attachment); mobile drag not working (P23 — explicitly document the decision before implementation; `mobile-drag-drop` polyfill available if needed); rapid drag race condition (P26 — confirmed write queue from Phase 4 handles this).

**Research flag:** HTML5 DnD is comprehensively documented on MDN. SortableJS is an alternative if the native API proves too complex, but research recommends native DnD for this scope. No research phase needed.

### Phase Ordering Rationale

- Search and MCP tools come first because they have no auth dependency and deliver immediate value to both human users (site search) and AI users (MCP search and CRUD tools) without requiring any infrastructure beyond CDN script tags
- Auth before API before UI is a hard dependency chain — each layer must be verified before the next depends on it; combining them produces failures that are impossible to isolate
- Kanban DnD comes last because it combines the most dependencies (auth + API + DOM complexity) and contains the most DnD-specific pitfalls; all dependencies must be stable before adding this complexity
- MCP setup guide page ships with Phase 1 as a zero-risk content addition — it has no code dependencies and immediate value for new users
- MCP tools (Phase 2) and site auth/CRUD (Phases 3-5) can proceed in parallel if needed — they share no dependencies and use different codebases

### Research Flags

Phases with standard patterns — no research phase needed:
- **Phase 1 (Search):** FlexSearch/MiniSearch CDN usage is thoroughly documented. Snippet extraction is a standard algorithm. Pattern confirmed in ARCHITECTURE.md with working code.
- **Phase 2 (MCP Tools):** Directly extends v1.1 write tool pattern. No new SDK surface. Pattern identical to existing `add_task`/`move_task` tools.
- **Phase 3 (Auth — PAT):** PAT entry is straightforward browser-local storage. No backend, no CORS, no OAuth flow.
- **Phase 4 (GitHub API Wrapper):** GitHub Contents API is fully documented. SHA + Base64 + serialization patterns are well-specified.
- **Phase 5 (Doc CRUD UI):** Assembly of Phase 3 + 4 components. Standard textarea/form patterns.
- **Phase 6 (Kanban DnD):** HTML5 DnD API is comprehensively documented on MDN with kanban examples.

Phase that may benefit from targeted research (conditional):
- **Phase 3 (Auth) — only if full OAuth replaces PAT:** Cloudflare Worker deployment, environment variable setup, and CORS configuration from the Worker have multiple implementation variants. Simon Willison's reference implementation is the canonical source but is a third-party article (MEDIUM confidence). If OAuth is chosen, a research pass on Worker setup reduces risk. Estimate: 30 minutes of verification. If PAT is chosen (recommended), no research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry and official SDK package.json. CDN URLs confirmed via jsDelivr. Compatibility matrix verified. `btoa()` limitation confirmed against MDN. SortableJS vs dragula comparison confirmed against GitHub activity. |
| Features | HIGH | GitHub API behavior (SHA, CORS, endpoints) verified against official GitHub docs and confirmed in GitHub issue tracker. OAuth CORS limitation confirmed in GitHub issue #330 (open since 2018). Feature scope shaped by hard constraints from the project, not preferences. |
| Architecture | HIGH | GitHub REST API CORS support confirmed from official docs. OAuth popup+localStorage pattern confirmed via Simon Willison working reference implementation. HTML5 DnD dragover/preventDefault pattern confirmed on MDN. MiniSearch CDN availability confirmed on jsDelivr. |
| Pitfalls | HIGH | v1.1 pitfalls (P1-P13) verified against official Claude Code docs, MCP SDK GitHub issues, and confirmed CVEs — already resolved in shipped code. v2.0 pitfalls (P14-P26) verified against official GitHub docs, MDN, and community discussions. Recovery strategies documented for all pitfalls. |

**Overall confidence:** HIGH

### Gaps to Address

- **Search library choice (MiniSearch vs FlexSearch):** ARCHITECTURE.md references MiniSearch; STACK.md recommends FlexSearch. Both are valid for this corpus size. MiniSearch has a cleaner API for snippet extraction (`searchOptions: { prefix: true, fuzzy: 0.2 }` and built-in result metadata). FlexSearch has faster benchmarks at scale (irrelevant at <20 docs). Recommendation: commit to MiniSearch before Phase 1. This is a 5-minute decision, not a research gap.

- **Auth method (PAT vs full OAuth):** Research strongly recommends PAT entry for a 1-2 user tool. This decision must be locked before Phase 3 begins. If the answer is "full OAuth," Phase 3 expands to include Cloudflare Worker setup and becomes higher risk. Documenting this decision in project requirements prevents scope creep mid-phase.

- **Mobile kanban touch support:** Phase 6 must explicitly state whether mobile drag-and-drop is in scope. HTML5 DnD API does not fire on iOS Safari or Android Chrome. The `mobile-drag-drop` polyfill exists but adds ~15KB and implementation complexity. For a desktop-first developer tool, deferring mobile is the correct call — but it must be stated explicitly before implementation, not discovered during testing.

- **MCP tool consolidation (add_doc vs edit_doc):** Research flags that similar tools degrade Claude's selection accuracy. A single `keloia_upsert_doc` that handles both create and update may be cleaner than separate add/edit tools — it eliminates the "which tool do I call for an existing file?" ambiguity. This is a Phase 2 design decision. If separate tools are kept, descriptions must explicitly exclude the other's use case.

## Sources

### Primary (HIGH confidence)
- [GitHub REST API — Repository Contents](https://docs.github.com/en/rest/repos/contents) — SHA requirement for update/delete, PUT/DELETE endpoints, base64 encoding, serialization warning, CORS support
- [GitHub REST API — CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) — `Access-Control-Allow-Origin: *` on Contents API confirmed
- [GitHub Docs — Authorizing OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) — token endpoint no CORS, `client_secret` required server-side
- [GitHub Community — OAuth web flow CORS issue #330](https://github.com/isaacs/github/issues/330) — longstanding limitation confirmed (open since 2018)
- [GitHub REST API — Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — 60 unauthenticated / 5000 authenticated req/hr
- [npm: flexsearch](https://www.npmjs.com/package/flexsearch) — v0.8.212 confirmed latest
- [npm: sortablejs](https://www.npmjs.com/package/sortablejs) — v1.15.7 confirmed latest
- [MiniSearch v7.2.0 on jsDelivr](https://www.jsdelivr.com/package/npm/minisearch) — CDN availability, UMD build confirmed
- [MDN — HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API) — `dragover preventDefault` required for `drop`, kanban board example
- [MDN — HTMLElement: dragover event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dragover_event) — canceling default enables drop target confirmed
- [MDN — Window: btoa()](https://developer.mozilla.org/en-US/docs/Web/API/Window/btoa) — Latin-1 only; Unicode throws `InvalidCharacterError`
- [web.dev — Base64 encoding in JavaScript](https://web.dev/articles/base64-encoding) — TextEncoder approach for Unicode-safe encoding
- [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp) — stdout reservation, restart requirements, scope behavior (v1.1 baseline)
- [MCP SDK Issue #906](https://github.com/modelcontextprotocol/typescript-sdk/issues/906) — Zod v4 breaking changes in MCP SDK v1.x
- [Claude Code Issue #10668](https://github.com/anthropics/claude-code/issues/10668) — tool name collision with sub-agents; `keloia_` prefix fix confirmed
- [marked.js CVE-2025-24981](https://thesecmaster.com/blog/how-to-fix-cve-2025-24981-mitigating-xss-vulnerability-in-markdown-library-for-we) — XSS via unescaped HTML in markdown; DOMPurify mitigation

### Secondary (MEDIUM confidence)
- [Simon Willison — GitHub OAuth for static sites via Cloudflare Workers](https://til.simonwillison.net/cloudflare/workers-github-oauth) — canonical popup+localStorage OAuth pattern; working reference implementation
- [gr2m/cloudflare-worker-github-oauth-login](https://github.com/gr2m/cloudflare-worker-github-oauth-login) — production-ready Worker for GitHub OAuth token exchange
- [arxiv: MCP Tool Description Quality Study](https://arxiv.org/html/2602.14878v1) — empirical study of 856 tools; tool count and description quality predict selection accuracy
- [timruffles/mobile-drag-drop](https://github.com/timruffles/mobile-drag-drop) — touch shim for HTML5 DnD API on mobile browsers
- [Eclipse Source — MCP and Context Overload](https://eclipsesource.com/blogs/2026/01/22/mcp-context-overload/) — tool count degrades Claude's accuracy (MEDIUM confidence)
- [GitHub Community — Content is not valid Base64, Discussion #41150](https://github.com/orgs/community/discussions/41150) — base64 newline encoding pitfalls confirmed

---
*Research completed: 2026-02-22*
*Ready for roadmap: yes*
