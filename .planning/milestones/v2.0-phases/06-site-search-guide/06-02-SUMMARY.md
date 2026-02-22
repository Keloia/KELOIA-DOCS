---
phase: 06-site-search-guide
plan: 02
subsystem: ui
tags: [minisearch, search, spa, vanilla-js, debounce, lazy-loading]

# Dependency graph
requires:
  - phase: 06-site-search-guide (plan 01)
    provides: MiniSearch 7.2.0 global via CDN, #search-input and #search-results DOM elements, search CSS classes

provides:
  - buildSearchIndex: lazy async MiniSearch index build on first search-input focus
  - extractSnippet: window-based snippet extraction centered around query match
  - renderSearchResults: populates #search-results dropdown with title + snippet per result
  - handleSearch: debounced (150ms) MiniSearch search with prefix/fuzzy/boost
  - debounce: utility function added to Utility section
  - Search state clearing in router() — cleared on every hashchange navigation
  - Click-outside listener — closes dropdown and clears input
  - mcp-guide manually included in search index (excluded from index.json)

affects:
  - All future JS additions in app.js (search module is now established between Utility and Router sections)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Lazy index build on first focus using { once: true } event listener
    - debounce wraps handleSearch (not applied to raw MiniSearch call)
    - mcp-guide manually appended to docs array in buildSearchIndex (not in index.json)
    - Search state cleared at top of router() before switch — defensive clear on every navigation

key-files:
  created: []
  modified:
    - app.js

key-decisions:
  - "debounce defined as a standard 3-line utility alongside escapeHtml in the Utility section"
  - "handleSearch declared with const (not function) so debounce wrapping is clear at call site"
  - "buildSearchIndex guard checks both searchIndex and indexBuilding — prevents double-build race during async fetch"
  - "After index build completes, check for pending input value — handles user typing during index build"
  - "Click-outside and result-click clearing both implemented: click-outside clears + hides, result-click clears + hides before hashchange fires"
  - "Search clearing in router() uses getElementById each call (not closure) — safe for any future DOM restructuring"

patterns-established:
  - "Site Search section: placed between Utility and Router sections in app.js"
  - "Lazy resource loading: { once: true } focus listener pattern for deferred expensive operations"

requirements-completed: [SRCH-02, SRCH-03, SRCH-04]

# Metrics
duration: 5min
completed: 2026-02-22
---

# Phase 6 Plan 02: Site Search Guide — JS Logic Summary

**MiniSearch full-text search wired end-to-end: lazy index build on first focus, debounced live results with title + snippet, and search state clearing on all navigation paths**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-21T22:55:13Z
- **Completed:** 2026-02-21T23:00:00Z
- **Tasks:** 2
- **Files modified:** 1 (app.js)

## Accomplishments

- Implemented `buildSearchIndex()`: fetches `data/docs/index.json`, manually adds `mcp-guide`, fetches all markdown files in parallel via `Promise.all`, creates `new MiniSearch({ fields: ['title', 'text'], storeFields: ['title', 'slug', 'text'] })`, and builds the index. Guard prevents double-build. After build, checks for pending query typed while indexing.
- Implemented `extractSnippet(text, query, windowSize=120)`: splits query into terms, finds first term occurrence in text, slices a 120-char window centered 40 chars before the match, adds ellipsis at truncated ends. Falls back to first 120 chars if no match.
- Implemented `renderSearchResults(results, query)`: renders `<li class="search-result-item">` with title and snippet per result, shows/hides `#search-results` container, attaches click listeners for immediate state clearing.
- Implemented `handleSearch` as a 150ms debounced function wrapping MiniSearch `search()` with `{ prefix: true, boost: { title: 2 }, fuzzy: 0.2, limit: 5 }`.
- Added `debounce(fn, delay)` utility to the Utility section (3-line setTimeout/clearTimeout pattern).
- Added search event listeners in `DOMContentLoaded` bootstrap: `focus` with `{ once: true }` triggers index build, `input` triggers debounced search.
- Added click-outside listener on `document` to close dropdown and clear input when clicking outside `.search-container`.
- Added search state clearing at the TOP of `router()` — clears input value and hides results on every hashchange navigation.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement search module in app.js** - `be8f9af` (feat)
2. **Task 2: Add search state clearing on navigation** - `4178d75` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `app.js` — Added debounce utility, Site Search section (buildSearchIndex, extractSnippet, renderSearchResults, handleSearch), search event listeners in bootstrap, search clearing in router, click-outside handler

## Decisions Made

- `handleSearch` is a `const` not a `function` declaration — the debounce wrapper must execute at definition time, making it a module-level constant
- Guard in `buildSearchIndex` checks both `searchIndex` and `indexBuilding` flags — handles the race where multiple focus events could fire before the first fetch completes
- After index build, check if `searchInput.value.trim()` is non-empty — this handles users who started typing during the async index build and immediately get results
- Click-outside listener always clears the input value (not just hides results) — prevents ghost state where input shows text but results are hidden
- Search clearing in `router()` uses `getElementById` at call time rather than closure — safe defensive pattern

## Deviations from Plan

None — plan executed exactly as written. Task 2's requirements for click-listener-on-results and click-outside-listener were already implemented as part of Task 1 (both are logically part of the search module), so Task 2 only added the router clearing. This is consistent with the plan's intent.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Search is fully functional: lazy build, live results, snippet display, click-to-navigate, all clearing paths covered
- `MiniSearch` global, all DOM elements, and all CSS classes from Plan 01 are consumed correctly
- Phase 7 (Auth) can proceed — no dependencies on search module
- No regressions to Docs, Kanban, or Progress views

## Self-Check: PASSED

- FOUND: app.js (modified — contains buildSearchIndex, extractSnippet, renderSearchResults, handleSearch, debounce)
- FOUND commit: be8f9af (Task 1)
- FOUND commit: 4178d75 (Task 2)

---
*Phase: 06-site-search-guide*
*Completed: 2026-02-22*
