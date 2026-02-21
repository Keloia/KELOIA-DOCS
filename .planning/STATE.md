# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.
**Current focus:** v2.0 Search + Auth + CRUD — Phase 6 complete, Phase 7 next

## Current Position

Phase: 6 of 11 (Site Search + Guide)
Plan: 2 of 2 complete
Status: Phase complete
Last activity: 2026-02-22 — 06-02 complete (MiniSearch JS logic: lazy index build, debounced search, snippet extraction, navigation clearing)

Progress: [██░░░░░░░░] ~10% (v2.0)

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
| 06-site-search-guide | 2 | ~9 min | ~4.5 min |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full list.

Recent decisions affecting v2.0:
- Auth method: PAT entry (not full OAuth) — no backend required, appropriate for 1-2 user tool
- Search library: MiniSearch preferred over FlexSearch — cleaner snippet API for this corpus size
- Mobile kanban DnD: explicitly out of scope for v2.0 — HTML5 DnD does not fire on iOS/Android
- MCP doc tools: separate add_doc and edit_doc (not upsert) — descriptions must explicitly exclude each other's use case

Phase 6 decisions:
- mcp-guide excluded from data/docs/index.json — router handles #/docs/mcp-guide directly, avoids duplicate sidebar entries
- MiniSearch CDN placed before app.js defer tag to ensure MiniSearch global is synchronously available
- handleSearch declared as const (not function) so debounce wrapping executes at definition time
- buildSearchIndex guards with both searchIndex and indexBuilding flags — prevents double-build race during async fetch
- Search state cleared at top of router() on every hashchange — defensive clear on all navigation paths

### Blockers/Concerns

- [v1.0] User must set Pages source to "GitHub Actions" in repository Settings > Pages > Source
- [v2.0] GitHub API writes require strict SHA-fetch-before-write discipline — Phase 9 must be verified in isolation before Phase 10 or 11 depend on it

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 06-02-PLAN.md (MiniSearch JS logic: lazy index build, debounced search, snippet extraction, navigation clearing)
Resume with: `/gsd:execute-phase 7` (Phase 7 — Auth)
