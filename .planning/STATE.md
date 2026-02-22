# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.
**Current focus:** v2.0 Search + Auth + CRUD — Phase 12 complete (all integration gaps closed)

## Current Position

Phase: 12 of 12 (Cross-Phase Integration Fixes)
Plan: 1 of 1 complete
Status: Phase complete
Last activity: 2026-02-22 — 12-01 complete (search index invalidation in 3 CRUD paths, edit route auth guard, script load order fix, mcp-guide added to index.json)

Progress: [████████████] ~100% (v2.0 + integration fixes)

## Performance Metrics

**Velocity:**
- Total plans completed: 14 (3 in v1.0, 7 in v1.1, 4 in v2.0)
- Average duration: ~4 min
- Total execution time: ~47 min

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
| 09-github-api-wrapper | 1 | ~1 min | ~1 min |
| 10-site-doc-crud | 2 (of 2) | ~3 min | ~1.5 min |
| 11-interactive-kanban | 1 (of 1) | ~1 min | ~1 min |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full list.

Recent decisions affecting v2.0:
- Auth method: PAT entry (not full OAuth) — no backend required, appropriate for 1-2 user tool
- Search library: MiniSearch preferred over FlexSearch — cleaner snippet API for this corpus size
- Mobile kanban DnD: explicitly out of scope for v2.0 — HTML5 DnD does not fire on iOS/Android
- MCP doc tools: separate add_doc and edit_doc (not upsert) — descriptions must explicitly exclude each other's use case

Phase 12 decisions:
- searchIndex = null must be paired with buildSearchIndex() immediately after in each CRUD success path — { once: true } focus listener fires only once; null index alone never rebuilds
- return (not break) after auth redirect in router edit branch — hashchange fires async so current invocation must be explicitly stopped
- Remove entire Resources sidebar section (not just mcp-guide li) — section only contained mcp-guide, now rendered naturally by populateDocList()
- const docs = data.docs (no spread) in buildSearchIndex — index.json is single source of truth for all docs including mcp-guide

Phase 11 decisions:
- wireDragAndDrop uses closure state (draggedTaskId/Title/SourceColumn) reset on dragend — avoids stale state if drag cancelled
- getFile called at confirm time inside showMoveModal, not at drag-start — consistent with Phase 9 SHA discipline
- Drop on same column silently ignored via source === target check before showMoveModal
- col-drop-over dragleave uses col.contains(e.relatedTarget) guard — prevents flicker when hovering over card children inside the column

Phase 10 decisions:
- Use HTML entity references (&#9999; &#x2715;) instead of UTF-8 emoji literals for edit/delete icon buttons — avoids encoding ambiguity in template literals
- Set textarea.value after innerHTML assignment — never use innerHTML or template literals for textarea content (anti-pattern per RESEARCH.md)
- Hide textarea during preview (textarea.hidden = true) instead of destroying it — preserves .value without re-fetch
- showDeleteModal stub uses alert() — Plan 02 replaces with full modal implementation
- Two-step write order for create: .md file first, then index.json — safe failure mode if second write fails
- renderCreateView uses getFile (GitHub API) for duplicate slug check — ensures fresh SHA data for subsequent writeFile
- modal-error paragraph reuses .form-error class — consistent error styling without new class

Phase 9 decisions:
- Plain function declarations used in github.js for global exposure — no window.x assignment needed
- github.js loaded with defer after app.js — getAuthToken() (app.js) defined before github.js functions invoked
- writeQueue tail uses result.catch(() => {}) — failed write doesn't block queue; caller still gets real rejected promise
- No X-GitHub-Api-Version header in github.js — consistent with Phase 8 decision to avoid CORS preflight

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
Stopped at: Completed 12-01-PLAN.md (Cross-phase integration fixes: search index invalidation, edit route auth guard, script load order, mcp-guide in index.json — all gaps closed)
Resume with: All phases complete — v2.0 + integration gaps fully resolved
