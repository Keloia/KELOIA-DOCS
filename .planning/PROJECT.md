# Keloia Docs + MCP Server

## What This Is

A single repo that serves Keloia project documentation to humans via a GitHub Pages static site and to AI tools via an MCP server. Markdown and JSON files are the single source of truth — the site renders them for humans, the MCP server serves them to Claude Code. No duplication, no build step for the site, zero-friction editing.

The static site is a vanilla JS SPA with hash routing, dark theme, markdown rendering via marked.js + DOMPurify, kanban board with drag-and-drop, progress tracker, full-text search, and GitHub PAT-authenticated doc CRUD. GitHub Actions deploys on push to main with no build step.

The MCP server is a TypeScript server with 11 tools (4 read, 3 write, 4 doc management) that gives Claude Code full access to project docs, kanban board, milestone progress, and doc search/CRUD. Zod validation, atomic writes, and natural language tool selection work out of the box.

## Core Value

When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.

## Requirements

### Validated

- ✓ Seed docs/ directory with markdown files (architecture, value proposition) — v1.0
- ✓ Kanban JSON schema with split-file pattern (index.json + individual task files) — v1.0
- ✓ Progress JSON schema with split-file pattern (index.json + individual milestone files) — v1.0
- ✓ schemaVersion: 1 on both JSON index files — v1.0
- ✓ SPA shell with sidebar navigation listing docs, kanban, and progress views — v1.0
- ✓ Markdown doc rendering via marked.js CDN with DOMPurify XSS protection — v1.0
- ✓ Kanban board view with column-based color-coded cards — v1.0
- ✓ Progress tracker view with computed progress bars — v1.0
- ✓ Dark theme CSS with responsive layout — v1.0
- ✓ Active sidebar link highlighting on navigation — v1.0
- ✓ All data fetches use relative paths for GitHub Pages compat — v1.0
- ✓ GitHub Actions workflow deploys site on push to main — v1.0
- ✓ MCP server with list_docs and read_doc tools — v1.1
- ✓ MCP server with get_kanban tool (denormalized board) — v1.1
- ✓ MCP server with add_task and move_task write tools (Zod-validated, atomic writes) — v1.1
- ✓ MCP server with get_progress and update_progress tools — v1.1
- ✓ MCP server runs locally via stdio transport for Claude Code integration — v1.1
- ✓ MCP server structured for future HTTP/SSE transport (transport.ts separation) — v1.1
- ✓ .mcp.json config for Claude Code project-scope registration — v1.1
- ✓ README with setup instructions (clone, install, build, register) — v1.1
- ✓ Full-text doc search in sidebar with MiniSearch (lazy index, debounced, snippets) — v2.0
- ✓ MCP search tool (keloia_search_docs with keyword/regex + slug filter) — v2.0
- ✓ MCP doc CRUD tools (keloia_add_doc, keloia_edit_doc, keloia_delete_doc) — v2.0
- ✓ Static MCP setup guide page with Cursor, Claude Code, Windsurf configs — v2.0
- ✓ GitHub PAT authentication with localStorage persistence — v2.0
- ✓ CSS-class-gated write controls (body.authenticated toggles .auth-only) — v2.0
- ✓ Site doc CRUD — create, edit with preview toggle, delete with confirmation modal — v2.0
- ✓ All site writes via GitHub Contents API with SHA-aware updates — v2.0
- ✓ Serialized write queue preventing 409 Conflicts — v2.0
- ✓ Unicode-safe Base64 via TextEncoder/TextDecoder — v2.0
- ✓ Interactive kanban drag-and-drop with confirmation modal — v2.0
- ✓ Search index invalidation after every CRUD operation — v2.0
- ✓ Edit route auth guard redirecting unauthenticated users — v2.0

### Active

(None — planning next milestone)

### Out of Scope

- Frameworks (React, Astro, Docusaurus, VitePress) — zero build step is a hard constraint
- CSS frameworks (Tailwind, etc.) — adds build step
- Database (SQLite, D1) — filesystem is the database for <100 tasks
- Full GitHub OAuth flow — PAT is sufficient for 1-2 user tool
- WYSIWYG / rich text editor — adds build step or massive complexity; markdown textarea sufficient
- Real-time collaborative editing — no WebSocket/persistent server; GitHub Pages is static
- Server-side search (Algolia, Pagefind) — requires build step or third-party account
- Side-by-side live preview editor — preview toggle is sufficient
- Mobile drag-and-drop — HTML5 DnD doesn't work on touch; defer to future
- Delete kanban columns — destroys task history; column set is intentionally small and stable
- GitHub Issues sync — adds external API dependency
- Testing framework (Jest, Vitest) — tools under 20 lines each, test by using
- Remote MCP transport in v2 — stdio first, remote when needed
- WebSocket live updates — requires persistent server; GitHub Pages is static
- Column/assignee filters on get_kanban — deferred
- Computed percentComplete on get_progress — deferred
- Schema version assertion on reads — deferred

## Context

Shipped v1.0 with 846 lines of site code (HTML/CSS/JS) plus 14 data files.
Shipped v1.1 with 386 lines of TypeScript MCP server code (6 source modules, 7 tools).
Shipped v2.0 with 1,992 lines of site code and 731 lines of MCP server code (11 tools total).
Tech stack: Vanilla HTML/CSS/JS for site, TypeScript + @modelcontextprotocol/sdk + Zod for MCP server, GitHub Actions for deploy.
Data layer uses split-file JSON pattern: index.json as schema anchor + one file per entity.
Both surfaces (site + MCP) read the same `data/` directory — no duplication, no sync.

**Target users:** Reza (primary developer) and Claude Code (AI assistant) — both have full read/write access to project context.

## Constraints

- **Zero build step for site**: No `npm install`, no bundler, no transpiler. Push to main = deployed.
- **Minimal dependencies**: 3 production deps for MCP server (SDK, Zod, TypeScript). Zero for the site (CDN only: marked.js, DOMPurify, MiniSearch).
- **Single source of truth**: Markdown and JSON files. No duplication between site and MCP server.
- **Tech stack**: Vanilla HTML/CSS/JS for site, TypeScript + MCP SDK for server, GitHub Pages for hosting.
- **File structure**: `data/docs/` (markdown), `data/kanban/` (split-file JSON), `data/progress/` (split-file JSON), root (SPA), `mcp-server/` (TypeScript MCP server).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla JS over any framework | Zero build step is a hard constraint; site is read-mostly for 1-2 users | ✓ Good — 1,992 LOC, instant deploy |
| marked.js from CDN | ~7KB gzipped, zero config, CommonMark-compliant, no npm install needed | ✓ Good — works reliably |
| JSON over YAML/SQLite for task data | Native to JS, GitHub renders it, MCP tools read/write trivially | ✓ Good — split-file pattern works well |
| Split-file pattern (index.json + per-entity files) | Prevents unbounded file growth, enables atomic updates | ✓ Good — clean separation |
| Hash routing over History API | GitHub Pages project sites serve from subdirectory; pushState 404s on refresh | ✓ Good — mandatory for Pages |
| DOMPurify wraps all marked output | marked.parse produces raw HTML; direct innerHTML is XSS vulnerable | ✓ Good — security baseline |
| Relative fetch paths everywhere | Leading slash resolves to github.io root, not project subdirectory | ✓ Good — Pages compat verified |
| Column-based color-coding for kanban | Task schema has no priority field; column membership is semantic equivalent | ✓ Good — cleaner than adding unused fields |
| Stdio transport first | Local Claude Code usage is the primary use case; remote transport deferred | ✓ Good — works reliably, transport.ts ready for swap |
| GitHub Pages over Cloudflare/Vercel | Serves raw files from repo with zero config, no build step required | ✓ Good — working |
| @modelcontextprotocol/sdk v1.x | v2 not stable, requires Zod 4 which contradicts requirements | ✓ Good — stable, works with Zod 3 |
| Separate mcp-server/package.json | Repo root is a static site, keeps type:module isolated | ✓ Good — clean separation |
| import.meta.url path resolution | No env override needed; single developer, deterministic paths | ✓ Good — works reliably |
| Write task file then update index | Ensures index only references files that exist on disk | ✓ Good — prevents dangling refs |
| atomicWriteJson (writeFileSync + renameSync) | No partial reads possible under concurrent access | ✓ Good — crash-safe writes |
| MiniSearch over FlexSearch | Cleaner snippet API, sufficient for <20 docs corpus | ✓ Good — lazy index, debounced search |
| PAT entry over full GitHub OAuth | No backend required, appropriate for 1-2 user tool | ✓ Good — simple, works |
| CSS class gating (body.authenticated) | Stylesheet rules toggle display; no JS show/hide per element | ✓ Good — clean pattern |
| Serialized write queue in github.js | Promise chain prevents concurrent PUT/DELETE 409 conflicts | ✓ Good — no conflicts observed |
| Unicode-safe Base64 via TextEncoder | Avoids InvalidCharacterError on non-ASCII content | ✓ Good — handles em dashes, smart quotes |
| HTML5 DnD API (no library) | Sufficient for desktop; mobile drag explicitly deferred | ✓ Good — 0 dependencies added |
| Index-first delete, file-first create | Each operation has consistent safe failure mode | ✓ Good — prevents dangling refs |

---
*Last updated: 2026-02-22 after v2.0 milestone*
