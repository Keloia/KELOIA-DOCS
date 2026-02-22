# Milestones

## v1.0 Data Layer + Static Site (Shipped: 2026-02-22)

**Phases completed:** 2 phases, 3 plans, 9 tasks
**Timeline:** 1 day (2026-02-21 → 2026-02-22)
**Files:** 39 files changed, +5,090 lines
**LOC (site):** 846 lines (HTML/CSS/JS/YAML)
**Git range:** cef32e4..2999541

**Delivered:** Filesystem data layer with split-file JSON schemas and a vanilla JS SPA that renders docs, kanban board, and progress tracker — deployed via GitHub Pages with zero build step.

**Key accomplishments:**
- Filesystem data layer with split-file JSON schemas for kanban and progress tracking
- Seed documentation (architecture, value proposition) for dual-surface access
- Vanilla JS SPA with hash routing, dark theme, and marked.js + DOMPurify doc rendering
- Kanban board with 3 color-coded columns fetching from split-file JSON
- Progress tracker with computed progress bars from milestone data
- GitHub Actions no-build deploy to GitHub Pages

**Key decisions:**
- Split-file pattern (index.json + one file per entity) over monolithic JSON
- Hash routing over History API (mandatory for GitHub Pages subdirectory)
- DOMPurify wraps all marked.parse output (XSS protection)
- Relative fetch paths everywhere (no leading slash for Pages compat)
- Column-based color-coding interprets priority requirement (task schema has no priority field)

**Tech debt accepted:**
- GitHub Pages source must be manually set to "GitHub Actions" in repo Settings
- 8 browser-level visual verification items not yet human-tested

**Archive:** `.planning/milestones/v1.0-ROADMAP.md`, `.planning/milestones/v1.0-REQUIREMENTS.md`

---


## v1.1 MCP Server (Shipped: 2026-02-22)

**Phases completed:** 3 phases, 7 plans
**Timeline:** 1 day (2026-02-21 → 2026-02-22)
**Files:** 35 files changed, +3,672 lines
**LOC (server):** 386 lines TypeScript (mcp-server/src/)
**Git range:** 91aa3bc..811b6a1

**Delivered:** TypeScript MCP server with 7 tools (4 read, 3 write) that gives Claude Code full access to project docs, kanban board, and milestone progress — with Zod validation, atomic writes, and natural language tool selection.

**Key accomplishments:**
- TypeScript MCP server with Node16 ESM, stdio transport, and import.meta.url path resolution
- Four read tools (list_docs, read_doc, get_kanban, get_progress) with pagination and error handling
- Three write tools (add_task, move_task, update_progress) with Zod validation and atomic writes
- All 7 tools wired through single createServer() entry point with keloia_ prefix
- README enabling fresh-clone setup in 4 commands
- Claude Code selects correct tool from natural language without prompt hints

**Key decisions:**
- @modelcontextprotocol/sdk v1.x (not v2 pre-alpha) — stable, works with Zod 3
- Separate mcp-server/package.json — isolates type:module from static site
- Transport in dedicated transport.ts — swapping to HTTP means editing one file
- Pure import.meta.url path resolution — no env override needed (single developer)
- Write task file first, then update index — ensures index only references existing files
- atomicWriteJson uses writeFileSync + renameSync — no partial reads under concurrent access

**Tech debt accepted:** None

**Archive:** `.planning/milestones/v1.1-ROADMAP.md`, `.planning/milestones/v1.1-REQUIREMENTS.md`

---


## v2.0 Search + Auth + CRUD (Shipped: 2026-02-22)

**Phases completed:** 7 phases, 9 plans
**Timeline:** 1 day (2026-02-22)
**Files:** 55 files changed, +11,579 / -942 lines
**LOC (site):** 1,992 lines (HTML/CSS/JS)
**LOC (server):** 731 lines TypeScript (mcp-server/src/)
**Git range:** v1.1..f1f757c

**Delivered:** Transformed the site from read-only to read-write with GitHub PAT authentication, full-text search across both surfaces, interactive kanban drag-and-drop, doc CRUD via GitHub API, and MCP doc management tools.

**Key accomplishments:**
- Full-text doc search with MiniSearch (lazy index, debounced, snippets) + static MCP setup guide
- MCP search + doc CRUD tools (keloia_search_docs, keloia_add_doc, keloia_edit_doc, keloia_delete_doc)
- GitHub PAT authentication with localStorage persistence and CSS-class-gated write controls
- Site doc CRUD — create, edit with preview toggle, delete via GitHub API with SHA-aware writes
- Interactive kanban drag-and-drop with confirmation modal and GitHub API persistence
- Cross-phase integration: search index invalidation after CRUD, edit route auth guard, script order fix

**Key decisions:**
- MiniSearch over FlexSearch — cleaner snippet API for this corpus size
- PAT entry (not full OAuth) — no backend required, appropriate for 1-2 user tool
- CSS class gating (body.authenticated) — stylesheet rules toggle .auth-only/.unauth-only display
- Serialized write queue in github.js — prevents 409 Conflicts on rapid successive writes
- Unicode-safe Base64 via TextEncoder/TextDecoder — avoids InvalidCharacterError on non-ASCII
- Index-first delete order for MCP, file-first create order for site — each has consistent safe failure mode
- HTML5 DnD API (not library) — sufficient for desktop; mobile drag explicitly deferred

**Tech debt accepted:**
- mcp-guide.md tool reference table missing 4 Phase 7 tools
- #/docs/new route auth guard missing at router level (write blocked safely at API level)
- Kanban drag-and-drop requires live browser testing (human_needed verification)

**Archive:** `.planning/milestones/v2.0-ROADMAP.md`, `.planning/milestones/v2.0-REQUIREMENTS.md`, `.planning/milestones/v2.0-MILESTONE-AUDIT.md`

---

