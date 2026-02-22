---
phase: 10-site-doc-crud
plan: 01
subsystem: ui
tags: [vanilla-js, markdown, marked, dompurify, github-api, spa, routing, crud]

requires:
  - phase: 09-github-api-wrapper
    provides: writeFile global function with SHA-aware writes and serialized write queue
  - phase: 08-github-auth
    provides: body.authenticated CSS gate and getAuthToken() global function

provides:
  - renderEditView(slug) — edit view with textarea pre-filled from fetch, preview toggle, save via writeFile
  - Router extension for #/docs/slug/edit and #/docs/new (stub) routes
  - populateDocList() with auth-gated edit/delete icon buttons per doc entry
  - showDeleteModal stub (Plan 02 implements real delete modal)

affects: [10-site-doc-crud plan 02]

tech-stack:
  added: []
  patterns:
    - "Set textarea.value after innerHTML assignment — never use innerHTML or template literals for textarea content"
    - "Hide textarea during preview (textarea.hidden = true) instead of destroying it — preserves .value without re-fetch"
    - "Event delegation on docList for edit/delete buttons — single listener survives innerHTML replacement"

key-files:
  created: []
  modified:
    - app.js
    - style.css

key-decisions:
  - "Use HTML entity references (&#9999; &#x2715;) instead of UTF-8 emoji literals for edit/delete icon buttons — avoids any encoding ambiguity in template literals"
  - "showDeleteModal stub uses alert() — Plan 02 replaces with full modal implementation"
  - "renderCreateView stub uses mainEl.innerHTML directly — Plan 02 replaces with full create form"
  - "Inline error for save failure appended after .edit-toolbar via insertAdjacentElement pattern — no extra wrapper needed in HTML template"

patterns-established:
  - "Edit view pattern: fetch markdown -> set mainEl.innerHTML with empty textarea -> set textarea.value after -> wire event listeners"
  - "Router subview pattern: parts[3] = subview for nested routes (#/docs/slug/edit)"

requirements-completed: [CRUD-02, CRUD-03]

duration: 1min
completed: 2026-02-22
---

# Phase 10 Plan 01: Site Doc CRUD — Edit View Summary

**Inline markdown editor wired into the SPA router with textarea pre-fill, marked.parse + DOMPurify preview toggle, writeFile save, and auth-gated per-doc edit/delete sidebar buttons**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-02-22T09:12:19Z
- **Completed:** 2026-02-22T09:13:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended router to handle `#/docs/slug/edit` and `#/docs/new` (stub) via `parts[3]` subview parsing
- Created `renderEditView(slug)` with textarea pre-fill, preview toggle (marked.parse + DOMPurify), save button (writeFile), and cancel button
- Updated `populateDocList()` with flex layout and auth-gated edit/delete icon buttons with event delegation
- Added full CSS section for edit view: textarea fills viewport, toolbar buttons, preview area, sidebar action buttons with hover-reveal, auth-gated display:flex override

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend router and add renderEditView with preview toggle and sidebar action buttons** - `5dde2dc` (feat)
2. **Task 2: Add edit view and sidebar action button CSS styles** - `972599b` (feat)

## Files Created/Modified
- `app.js` - Added renderEditView, showDeleteModal stub, extended router for subview routing, updated populateDocList with edit/delete buttons and event delegation
- `style.css` - Added Doc Edit View section with edit-view, edit-toolbar, edit-textarea, edit-preview, btn-action, btn-secondary, doc-list-item, doc-actions, btn-icon, btn-danger-icon, edit-error styles

## Decisions Made
- Used HTML entity references (`&#9999;` pencil, `&#x2715;` X) instead of raw UTF-8 emoji characters in template literals — avoids potential encoding issues
- `showDeleteModal` is a stub with `alert()` — Plan 02 wires the real delete confirmation modal
- Textarea value set via `textarea.value = markdown` AFTER `mainEl.innerHTML` assignment — follows the documented anti-pattern warning from RESEARCH.md (never innerHTML for textarea)
- Error paragraph for save failure created dynamically with `document.createElement` and appended after toolbar — keeps HTML template clean

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Edit view is complete and functional (CRUD-02, CRUD-03 satisfied)
- Plan 02 can now implement: real `showDeleteModal` with `deleteFile` + index.json update, `renderCreateView` with slug/title/body form, and sidebar "New Doc" button
- The `showDeleteModal` stub and `renderCreateView` stub are already wired into the router and sidebar — Plan 02 replaces them in place

---
*Phase: 10-site-doc-crud*
*Completed: 2026-02-22*
