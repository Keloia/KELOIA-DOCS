# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.
**Current focus:** Phase 1 — Data Layer

## Current Position

Phase: 1 of 5 (Data Layer)
Plan: 1 of 1 in current phase
Status: Phase 1 Plan 1 complete
Last activity: 2026-02-21 — 01-01 data layer created, data contracts locked

Progress: [██░░░░░░░░] 20%

## Performance Metrics

**Velocity:**
- Total plans completed: 1
- Average duration: 2 min
- Total execution time: 0.03 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-data-layer | 1 | 2 min | 2 min |

**Recent Trend:**
- Last 5 plans: 01-01 (2 min)
- Trend: -

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

### Pending Todos

None yet.

### Blockers/Concerns

- Confirm deployed GitHub Pages URL format (`github.io/keloia-docs/` vs `github.io/`) before writing any `fetch()` paths in Phase 2
- Decide `.mcp.json` scope (project-scoped committed vs local `~/.claude.json`) before Phase 3

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 01-01-PLAN.md — data layer schemas and seed content complete
Resume file: None
