---
phase: 12-cross-phase-fixes
plan: 01
subsystem: ui
tags: [minisearch, vanilla-js, spa-routing, auth, mcp]

# Dependency graph
requires:
  - phase: 06-site-search-guide
    provides: buildSearchIndex, searchIndex module variable, MiniSearch integration
  - phase: 07-mcp-search-crud
    provides: keloia_search_docs reads index.json to enumerate docs
  - phase: 08-github-auth
    provides: getAuthToken, initAuth, setAuthState
  - phase: 09-github-api-wrapper
    provides: getFile, writeFile, deleteFile globals in github.js
  - phase: 10-site-doc-crud
    provides: renderCreateView, renderEditView, showDeleteModal CRUD operations
provides:
  - Search index invalidation after every CRUD operation (INT-01, FLOW-01, FLOW-02)
  - Edit route auth guard in router redirects unauthenticated users (INT-02)
  - Correct script load order — github.js before app.js (INT-03)
  - mcp-guide as first-class doc in index.json, visible to MCP search tools (INT-04)
affects: [all future phases using search, auth, or MCP doc tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "searchIndex = null + buildSearchIndex() non-blocking call in each CRUD success path"
    - "Router auth guard with return after hash redirect to stop current invocation"
    - "Single source of truth for doc list in data/docs/index.json (no hardcoded exceptions)"

key-files:
  created: []
  modified:
    - app.js
    - index.html
    - data/docs/index.json

key-decisions:
  - "searchIndex = null followed immediately by buildSearchIndex() in each CRUD success path — avoids { once: true } focus listener problem where stale null index would never rebuild"
  - "Use return (not break) after auth redirect in router edit branch — prevents current invocation from continuing after hash assignment"
  - "Remove entire Resources sidebar section (not just mcp-guide li) — section only contained mcp-guide; empty sections are worse than removing them"
  - "const docs = data.docs (not spread with hardcoded mcp-guide) — index.json is now single source of truth"

patterns-established:
  - "Pattern: After any CRUD write success, invalidate and rebuild search index — searchIndex = null; buildSearchIndex();"
  - "Pattern: Router auth guard using return after redirect to stop current invocation"

requirements-completed: [INT-01, INT-02, INT-03, INT-04, FLOW-01, FLOW-02]

# Metrics
duration: 6min
completed: 2026-02-22
---

# Phase 12 Plan 01: Cross-Phase Integration Fixes Summary

**Six cross-phase wiring gaps closed: search index invalidation after CRUD (3 paths), edit route auth guard, script load order fix, and mcp-guide added to index.json as first-class doc**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-02-22T10:05:54Z
- **Completed:** 2026-02-22T10:11:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- INT-01 + FLOW-01 + FLOW-02: `searchIndex = null; buildSearchIndex()` added to renderCreateView, renderEditView save handler, and showDeleteModal confirm handler — search updates immediately after any doc write or delete without page refresh
- INT-02: `if (!getAuthToken()) { return; }` guard in router edit branch — direct URL navigation to `#/docs/slug/edit` redirects unauthenticated users to `#/docs/slug`
- INT-03: Swapped `<script defer>` order in index.html — github.js now loads before app.js, eliminating the dependency inversion maintenance hazard
- INT-04: mcp-guide added to data/docs/index.json, hardcoded spread removed from buildSearchIndex, Resources sidebar section removed — mcp-guide is now a first-class doc visible to keloia_search_docs and site search

## Task Commits

Each task was committed atomically:

1. **Task 1: Search index invalidation + edit route auth guard in app.js** - `aa2a3d3` (feat)
2. **Task 2: Script order fix + mcp-guide in index.json + sidebar cleanup** - `9895f85` (feat)

## Files Created/Modified

- `app.js` - searchIndex = null + buildSearchIndex() in 3 CRUD paths; getAuthToken() guard in router; const docs = data.docs
- `index.html` - github.js before app.js in defer order; Resources section removed
- `data/docs/index.json` - mcp-guide entry added as third doc

## Decisions Made

- `searchIndex = null` must be paired with `buildSearchIndex()` call immediately after — the `{ once: true }` focus listener on search-input fires only once at first focus; after that, a null searchIndex would never rebuild unless explicitly triggered
- `return` used (not `break`) after the auth redirect hash assignment — hashchange fires async so current router invocation must be explicitly stopped to prevent double render
- Entire Resources `<section>` removed from sidebar — it contained only the mcp-guide link, which is now rendered by `populateDocList()` as part of the Docs list
- `data.docs` (no spread) replaces the hardcoded `[...data.docs, { slug: 'mcp-guide', ... }]` — avoids MiniSearch duplicate-id error when mcp-guide is in both index.json and the hardcoded spread

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. MCP server build passed with no source changes (`npm run build` clean output).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All six v2.0 audit gaps (INT-01 through INT-04, FLOW-01, FLOW-02) are closed
- Search, auth, and MCP tool integration are now correctly wired end-to-end
- No blockers — v2.0 milestone is complete with all integration gaps resolved

## Self-Check: PASSED

- app.js: FOUND
- index.html: FOUND
- data/docs/index.json: FOUND
- 12-01-SUMMARY.md: FOUND
- Commit aa2a3d3: FOUND (feat(12-01): search index invalidation + edit route auth guard + remove hardcoded mcp-guide)
- Commit 9895f85: FOUND (feat(12-01): script order fix + mcp-guide in index.json + sidebar cleanup)

---
*Phase: 12-cross-phase-fixes*
*Completed: 2026-02-22*
