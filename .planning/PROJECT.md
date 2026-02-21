# Keloia Docs + MCP Server

## What This Is

A single repo that serves Keloia project documentation to humans via a GitHub Pages static site and to AI tools via an MCP server. Markdown and JSON files are the single source of truth — the site renders them for humans, the MCP server serves them to Claude Code. No duplication, no build step for the site, zero-friction editing.

The static site is shipped and live: a vanilla JS SPA with hash routing, dark theme, markdown rendering via marked.js + DOMPurify, kanban board with color-coded columns, and progress tracker with computed bars. GitHub Actions deploys on push to main with no build step.

The MCP server is shipped: a TypeScript server with 7 tools (4 read, 3 write) that gives Claude Code full access to project docs, kanban board, and milestone progress. Zod validation, atomic writes, and natural language tool selection work out of the box.

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

## Current Milestone: v2.0 Search + Auth + CRUD

**Goal:** Transform the site from read-only to read-write with GitHub OAuth authentication, add full-text search across both surfaces, interactive kanban, and MCP setup documentation.

**Target features:**
- Full-text doc search on site (sidebar search box, results with snippets)
- MCP search tool (keloia_search_docs with regex/filter support)
- MCP setup guide page (Cursor, Claude Code, Windsurf)
- GitHub OAuth login for write operations
- Doc CRUD on site (add, edit via markdown textarea, delete) via GitHub API
- Doc CRUD MCP tools (add_doc, edit_doc, delete_doc)
- Interactive kanban with drag-and-drop and confirmation modal (requires login)

### Active

### Out of Scope

- Frameworks (React, Astro, Docusaurus, VitePress) — zero build step is a hard constraint
- CSS frameworks (Tailwind, etc.) — adds build step
- Database (SQLite, D1) — filesystem is the database for <100 tasks
- ~~Authentication on the site~~ — moved to v2.0 (GitHub OAuth)
- ~~Search across docs~~ — moved to v2.0 (full-text search)
- GitHub Issues sync — adds external API dependency
- Testing framework (Jest, Vitest) — tools under 20 lines each, test by using
- Remote MCP transport in v1 — stdio first, remote when needed
- WebSocket live updates — requires persistent server; GitHub Pages is static
- ~~Edit-in-place on site~~ — moved to v2.0 (doc CRUD via GitHub API)
- Column/assignee filters on get_kanban — deferred to v2 (READ-06)
- Computed percentComplete on get_progress — deferred to v2 (READ-07)
- Schema version assertion on reads — deferred to v2 (READ-08)
- ~~keloia_search_docs keyword search~~ — moved to v2.0

## Context

Shipped v1.0 with 846 lines of site code (HTML/CSS/JS) plus 14 data files.
Shipped v1.1 with 386 lines of TypeScript MCP server code (6 source modules, 7 tools).
Tech stack: Vanilla HTML/CSS/JS for site, TypeScript + @modelcontextprotocol/sdk + Zod for MCP server, GitHub Actions for deploy.
Data layer uses split-file JSON pattern: index.json as schema anchor + one file per entity.
Both surfaces (site + MCP) read the same `data/` directory — no duplication, no sync.

**Target users:** Reza (primary developer) and Claude Code (AI assistant) — both have full read/write access to project context.

## Constraints

- **Zero build step for site**: No `npm install`, no bundler, no transpiler. Push to main = deployed.
- **Minimal dependencies**: 3 production deps for MCP server (SDK, Zod, TypeScript). Zero for the site.
- **Single source of truth**: Markdown and JSON files. No duplication between site and MCP server.
- **Tech stack**: Vanilla HTML/CSS/JS for site, TypeScript + MCP SDK for server, GitHub Pages for hosting.
- **File structure**: `data/docs/` (markdown), `data/kanban/` (split-file JSON), `data/progress/` (split-file JSON), root (SPA), `mcp-server/` (TypeScript MCP server).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla JS over any framework | Zero build step is a hard constraint; site is read-mostly for 1-2 users | ✓ Good — 846 LOC, instant deploy |
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

---
*Last updated: 2026-02-22 after v2.0 milestone started*
