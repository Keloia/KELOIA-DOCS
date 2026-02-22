# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.
**Current focus:** v2.0 Search + Auth + CRUD — Phase 8 plan 01 complete, Phase 9 next

## Current Position

Phase: 8 of 11 (GitHub Auth)
Plan: 1 of 1 complete
Status: Phase complete
Last activity: 2026-02-22 — 08-01 complete (GitHub PAT auth: verifyToken, setAuthState, initAuth, login/logout handlers, CSS gating)

Progress: [████░░░░░░] ~25% (v2.0)

## Performance Metrics

**Velocity:**
- Total plans completed: 12 (3 in v1.0, 7 in v1.1, 2 in v2.0)
- Average duration: ~4 min
- Total execution time: ~46 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-data-layer | 1 | 2 min | 2 min |
| 02-static-site | 2 | ~12 min | ~6 min |
| 03-mcp-foundation | 2 | ~7 min | ~3.5 min |
| 04-read-tools | 2 | ~7 min | ~3.5 min |
| 05-write-tools | 3 | ~15 min | ~5 min |
| 06-site-search-guide | 2 | ~9 min | ~4.5 min |
| 07-mcp-search-crud | 1 | ~4 min | ~4 min |
| 08-github-auth | 1 | ~3 min | ~3 min |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full list.

Recent decisions affecting v2.0:
- Auth method: PAT entry (not full OAuth) — no backend required, appropriate for 1-2 user tool
- Search library: MiniSearch preferred over FlexSearch — cleaner snippet API for this corpus size
- Mobile kanban DnD: explicitly out of scope for v2.0 — HTML5 DnD does not fire on iOS/Android
- MCP doc tools: separate add_doc and edit_doc (not upsert) — descriptions must explicitly exclude each other's use case

Phase 8 decisions:
- verifyToken omits X-GitHub-Api-Version header — avoids CORS preflight on browser fetch
- initAuth() called non-blocking (no await) — page renders immediately, auth state resolves in background
- getAuthToken() exposed as module-level function — Phase 9 can access Bearer token without coupling
- CSS gating via body.authenticated class + stylesheet rules rather than JS show/hide

Phase 7 decisions:
- atomicWriteText duplicated locally in docs.ts rather than imported from write.ts — keeps modules independent, no circular dependency
- delete_doc updates index.json FIRST before unlinkSync — ensures consistent state even on partial failure
- keloia_search_docs resets compiled.lastIndex = 0 before every exec() — prevents match skipping across lines with stateful RegExp

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
Stopped at: Completed 08-01-PLAN.md (GitHub PAT auth: verifyToken, setAuthState, getAuthToken, initAuth, login/logout handlers, body.authenticated CSS gating)
Resume with: `/gsd:execute-phase 9` (Phase 9 — GitHub API wrapper)
