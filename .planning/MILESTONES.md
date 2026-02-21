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

