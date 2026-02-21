# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.
**Current focus:** v2.0 Search + Auth + CRUD — Phase 6 in progress (Plan 01 complete)

## Current Position

Phase: 6 of 11 (Site Search + Guide)
Plan: 1 of 2 complete
Status: In progress
Last activity: 2026-02-22 — 06-01 complete (MCP guide page + MiniSearch CDN + search input HTML/CSS)

Progress: [█░░░░░░░░░] ~5% (v2.0)

## Performance Metrics

**Velocity:**
- Total plans completed: 10 (3 in v1.0, 7 in v1.1)
- Average duration: ~4 min
- Total execution time: ~43 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-data-layer | 1 | 2 min | 2 min |
| 02-static-site | 2 | ~12 min | ~6 min |
| 03-mcp-foundation | 2 | ~7 min | ~3.5 min |
| 04-read-tools | 2 | ~7 min | ~3.5 min |
| 05-write-tools | 3 | ~15 min | ~5 min |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full list.

Recent decisions affecting v2.0:
- Auth method: PAT entry (not full OAuth) — no backend required, appropriate for 1-2 user tool
- Search library: MiniSearch preferred over FlexSearch — cleaner snippet API for this corpus size
- Mobile kanban DnD: explicitly out of scope for v2.0 — HTML5 DnD does not fire on iOS/Android
- MCP doc tools: separate add_doc and edit_doc (not upsert) — descriptions must explicitly exclude each other's use case

Phase 6 Plan 01 decisions:
- mcp-guide excluded from data/docs/index.json — router handles #/docs/mcp-guide directly, avoids duplicate sidebar entries
- MiniSearch CDN placed before app.js defer tag to ensure MiniSearch global is synchronously available

### Blockers/Concerns

- [v1.0] User must set Pages source to "GitHub Actions" in repository Settings > Pages > Source
- [v2.0] GitHub API writes require strict SHA-fetch-before-write discipline — Phase 9 must be verified in isolation before Phase 10 or 11 depend on it

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 06-01-PLAN.md (MCP guide page + MiniSearch CDN + search input HTML/CSS)
Resume with: `/gsd:execute-phase 6` (Plan 02 — search JS logic)
