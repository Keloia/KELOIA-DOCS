# Keloia Docs + MCP Server

## What This Is

A single repo that serves Keloia project documentation to humans via a GitHub Pages static site and to AI tools via an MCP server. Markdown and JSON files are the single source of truth — the site renders them for humans, the MCP server serves them to Claude Code. No duplication, no build step for the site, zero-friction editing.

## Core Value

When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Static site renders markdown docs from `docs/` with sidebar navigation
- [ ] Static site renders kanban board from `kanban/board.json` with column layout
- [ ] Static site renders progress tracker from `progress/tracker.json` with progress bars
- [ ] Site works on GitHub Pages with zero build step (vanilla HTML/CSS/JS + marked.js from CDN)
- [ ] MCP server exposes `list_docs` and `read_doc` tools to read documentation
- [ ] MCP server exposes `get_kanban` tool with filtering by column, label, assignee
- [ ] MCP server exposes `add_task` and `move_task` tools for kanban write operations
- [ ] MCP server exposes `get_progress` and `update_progress` tools for milestone tracking
- [ ] MCP server runs locally via stdio transport for Claude Code integration
- [ ] MCP server code is structured so adding HTTP/SSE remote transport later is straightforward
- [ ] Data layer uses only filesystem — markdown files in `docs/`, JSON in `kanban/` and `progress/`
- [ ] GitHub Actions workflow deploys the site on push to main

### Out of Scope

- Frameworks (React, Astro, Docusaurus, VitePress) — zero build step is a hard constraint
- CSS frameworks (Tailwind, etc.) — adds build step
- Database (SQLite, D1) — filesystem is the database for <100 tasks
- Authentication on the site — repo visibility controls access
- Search across docs — add when >20 docs justify it
- GitHub Issues sync — adds external API dependency
- Testing framework (Jest, Vitest) — 7 tools under 20 lines each, test by using
- Remote MCP transport in v1 — stdio first, remote when needed

## Context

This repo is the **opposite** of the main Keloia app. The main app (Hono, Drizzle, D1, Workers, React) optimizes for type safety and scalability. This repo optimizes for zero friction — instantly editable, instantly readable, instantly queryable by AI.

Existing markdown docs (architecture, value proposition, etc.) are ready to drop into `docs/`. The kanban board and progress tracker use JSON because it's native to JS, GitHub renders it, and MCP tools read/write it trivially.

The site is a single-page app: one `index.html` shell, one `style.css`, one `app.js`. It fetches markdown and JSON at runtime via relative paths. GitHub Pages serves the entire repo as static files.

The MCP server is a single `index.ts` (~150 lines) with 4 helpers, 1 resource, and 7 tools. Dependencies: `@modelcontextprotocol/sdk`, `zod`, and TypeScript for compilation. That's it.

**Target users:** Reza (primary developer) and Claude Code (AI assistant) — both need access to the same project context.

## Constraints

- **Zero build step for site**: No `npm install`, no bundler, no transpiler. Push to main = deployed.
- **Minimal dependencies**: 3 production deps for MCP server (SDK, Zod, TypeScript). Zero for the site.
- **Single source of truth**: Markdown and JSON files. No duplication between site and MCP server.
- **Tech stack**: Vanilla HTML/CSS/JS for site, TypeScript + MCP SDK for server, GitHub Pages for hosting.
- **File structure**: `docs/` (markdown), `kanban/` (board.json), `progress/` (tracker.json), `site/` (SPA), `mcp-server/` (TypeScript MCP server).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla JS over any framework | Zero build step is a hard constraint; site is read-mostly for 1-2 users | — Pending |
| marked.js from CDN | ~7KB gzipped, zero config, CommonMark-compliant, no npm install needed | — Pending |
| JSON over YAML/SQLite for task data | Native to JS, GitHub renders it, MCP tools read/write trivially | — Pending |
| Single-file MCP server | 7 tools under 20 lines each, no abstraction layers needed at this scale | — Pending |
| Stdio transport first | Local Claude Code usage is the primary use case; remote transport deferred | — Pending |
| GitHub Pages over Cloudflare/Vercel | Serves raw files from repo with zero config, no build step required | — Pending |

---
*Last updated: 2026-02-21 after initialization*
