---
phase: 09-github-api-wrapper
plan: 01
subsystem: api
tags: [github, fetch, base64, textencode, promise-queue, browser]

requires:
  - phase: 08-github-auth
    provides: getAuthToken() global function for Bearer token retrieval

provides:
  - GitHub Contents API wrapper (github.js) with getFile, writeFile, deleteFile globals
  - Serialized write queue via enqueueWrite preventing concurrent PUT/DELETE conflicts
  - Unicode-safe Base64 pipeline using TextEncoder/TextDecoder
  - Fresh-SHA-before-every-write pattern (no cached SHAs)

affects:
  - 10-doc-crud
  - 11-kanban-crud

tech-stack:
  added: []
  patterns:
    - "Write queue: Promise chain serializes all mutating API calls — tail tracks only catches so failed write doesn't block queue"
    - "Unicode Base64: TextEncoder bytes -> binary string -> btoa (encode); atob -> strip whitespace first -> TextDecoder (decode)"
    - "Fresh SHA: getFile called inside _writeFileImpl and _deleteFileImpl, never cached across calls"
    - "No X-GitHub-Api-Version header: omitted to avoid CORS preflight failures in browser"

key-files:
  created:
    - github.js
  modified:
    - index.html

key-decisions:
  - "Plain function declarations used (not window.x assignment) — function declarations are automatically global in browser scripts"
  - "github.js loaded with defer after app.js so getAuthToken() is defined before any github.js function is invoked"
  - "writeQueue tail uses result.catch(() => {}) not result — so a rejected write clears the tail without surfacing to caller; caller receives the original result promise and sees the rejection"
  - "X-GitHub-Api-Version header omitted from all requests — matches Phase 8 verifyToken decision to avoid CORS preflight"

patterns-established:
  - "Enqueue pattern: all mutating ops go through enqueueWrite; reads (getFile) run concurrently without queuing"
  - "Auth gate: authHeaders() throws synchronously if token absent — callers get immediate rejection, not silent failure"

requirements-completed: [CRUD-05]

duration: 1min
completed: 2026-02-22
---

# Phase 9 Plan 01: GitHub API Wrapper Summary

**github.js with getFile/writeFile/deleteFile globals: serialized write queue, Unicode-safe Base64 via TextEncoder, fresh SHA before every PUT/DELETE**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-02-22T08:54:34Z
- **Completed:** 2026-02-22T08:55:22Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `github.js` with three public API functions callable from browser console or any script
- Write queue serializes all PUT/DELETE operations so rapid successive writes never produce 409 Conflict errors
- Unicode-safe Base64 encoding/decoding handles em dashes, smart quotes, and all non-ASCII content correctly
- Fresh SHA fetched inside every `_writeFileImpl` and `_deleteFileImpl` call — no stale SHA risk
- `index.html` updated to load `github.js` after `app.js` with `defer` maintaining correct execution order

## Task Commits

Each task was committed atomically:

1. **Task 1: Create github.js module with Contents API wrapper** - `f83b3b3` (feat)
2. **Task 2: Add github.js script tag to index.html** - `e02aab2` (feat)

## Files Created/Modified

- `github.js` - GitHub Contents API wrapper (93 lines): getFile, writeFile, deleteFile, write queue, Unicode Base64, auth headers
- `index.html` - Added `<script src="github.js" defer></script>` after app.js script tag

## Decisions Made

- Plain `function` declarations for public API — no `window.x` assignment needed; function declarations are inherently global in browser script context
- `github.js` loaded with `defer` after `app.js` — ensures `getAuthToken()` (from app.js) is defined before any github.js function is called at runtime
- `writeQueue` tail uses `result.catch(() => {})` — failed write doesn't poison the queue; caller still receives the real rejected promise
- No `X-GitHub-Api-Version` header — consistent with Phase 8 decision to avoid CORS preflight failures in browser fetch

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `github.js` is ready for Phase 10 (doc CRUD) and Phase 11 (kanban CRUD) to call `writeFile(path, content, msg)` without handling SHA, Base64, or concurrency
- Phase 10/11 can verify the API surface in browser console: `typeof writeFile === 'function'` should return `true`
- Auth guard is in place: calling any write function without logging in will reject with "Not authenticated"

---
*Phase: 09-github-api-wrapper*
*Completed: 2026-02-22*
