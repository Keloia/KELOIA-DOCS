# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.
**Current focus:** Phase 2 — Static Site

## Current Position

Phase: 2 of 5 (Static Site)
Plan: 2 of 2 in current phase
Status: Phase 2 complete
Last activity: 2026-02-22 — 02-02 Kanban board and progress tracker views complete

Progress: [████████░░] 80%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 2 min
- Total execution time: 0.06 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-data-layer | 1 | 2 min | 2 min |
| 02-static-site | 2 | ~12 min | ~6 min |

**Recent Trend:**
- Last 5 plans: 01-01 (2 min), 02-01 (2 min), 02-02 (~10 min)
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Setup]: Vanilla JS over any framework — zero build step is a hard constraint
- [Setup]: marked.js from CDN — no npm install, UMD global
- [Setup]: JSON over YAML/SQLite for task data — native to JS, GitHub renders it
- [Setup]: Stdio transport first — local Claude Code usage is primary use case
- [01-01]: Split-file pattern — one JSON file per entity with index.json as registry; prevents unbounded file growth and enables atomic updates
- [01-01]: schemaVersion: 1 on all index files — enables future consumers to detect and handle schema migrations
- [01-01]: No computed fields stored in progress files — consumers calculate tasksCompleted/tasksTotal at read time
- [01-01]: null for absent optional fields — consistent for JSON consumers, clearer than omission
- [02-01]: Hash routing mandatory — GitHub Pages project sites serve from /keloia-docs/ subdirectory; History API routes 404 on refresh
- [02-01]: DOMPurify.sanitize wraps all marked.parse output — no direct innerHTML assignment of raw markdown HTML
- [02-01]: data/docs/index.json as doc registry — serves sidebar population and future MCP list_docs tool
- [02-01]: Relative fetch paths enforced — no leading slash on any URL for GitHub Pages subdirectory compat
- [02-01]: CDN scripts have no async/defer — app.js depends on marked and DOMPurify globals being available synchronously
- [02-02]: Column-based color-coding interprets SITE-03 priority requirement — task schema has no priority field; column membership is semantic equivalent
- [02-02]: escapeHtml() on all JSON data before innerHTML — JSON data treated as untrusted; consistent with DOMPurify approach for markdown
- [02-02]: Mobile kanban stacks columns vertically — flex-direction: column on small screens, more usable than horizontal overflow

### Pending Todos

None yet.

### Blockers/Concerns

- Decide `.mcp.json` scope (project-scoped committed vs local `~/.claude.json`) before Phase 3
- User must set Pages source to "GitHub Actions" in repository Settings > Pages > Source after pushing deploy.yml

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 02-02-PLAN.md — Kanban board and progress tracker views, Phase 2 complete
Resume file: None
