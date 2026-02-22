---
phase: 10-site-doc-crud
plan: 02
subsystem: frontend-crud
tags: [create, delete, modal, validation, github-api]
dependency_graph:
  requires: [10-01, 09-01]
  provides: [CRUD-01, CRUD-04]
  affects: [app.js, style.css, index.html]
tech_stack:
  added: []
  patterns: [two-step-write, optimistic-ui, auth-gated-ui, slug-validation]
key_files:
  created: []
  modified:
    - app.js
    - style.css
    - index.html
decisions:
  - "Two-step write order for create: .md file first, then index.json — mirrors delete order (index first, then file) so each operation has a consistent safe failure mode"
  - "renderCreateView uses getFile (GitHub API) for duplicate slug check rather than fetch() — ensures index is fresh SHA data needed for the subsequent writeFile call"
  - "modal-error paragraph placed inside modal-box above action buttons — form-error class reused for consistent error color without new class"
  - "New Doc button uses .btn-icon.auth-only classes — reuses existing auth-gating pattern from doc action buttons, no new CSS needed"
metrics:
  duration: ~2 min
  completed: 2026-02-22
  tasks_completed: 2
  files_modified: 3
---

# Phase 10 Plan 02: Create and Delete Doc CRUD Summary

**One-liner:** Full doc create (slug-validated, two-step write) and delete (title-confirmed modal, two-step delete) via GitHub API, with auth-gated New Doc sidebar button.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | renderCreateView, showDeleteModal, New Doc button | 2b21c69 | app.js, index.html |
| 2 | Create form, modal overlay, form field CSS | 2f31bcb | style.css |

## What Was Built

### renderCreateView (app.js)

New async function that renders a create form in `#main` with:
- Slug field with validation regex `/^[a-z0-9]+(-[a-z0-9]+)*$/`
- Title and content (textarea) fields
- Preview toggle using same `marked.parse` + `DOMPurify.sanitize` + `textarea.hidden` pattern as edit view
- Inline error display (`#create-error`)
- Create flow: validate → duplicate check via `getFile('data/docs/index.json')` → write `.md` first → update `index.json` → `populateDocList()` → navigate to new doc
- Cancel navigates to `#/docs`

### showDeleteModal (app.js)

Replaced alert() stub with full implementation:
- Creates `#delete-modal` overlay appended to `document.body`
- Modal box shows doc title in confirmation message using `escapeHtml(title)`
- Cancel button and click-outside both remove overlay
- Delete flow: update `index.json` first (filter out slug) → `deleteFile()` the `.md` → remove overlay → `populateDocList()` → navigate to `#/docs`
- Error state re-enables button and shows inline `#modal-error`

### Router update (app.js)

Changed `#/docs/new` case from stub placeholder to `await renderCreateView()`.

### New Doc button (index.html + app.js)

- `index.html`: Wrapped Docs section `<h3>` and new `<button class="btn-icon auth-only" id="new-doc-btn">+</button>` in `.nav-section-header` div
- `app.js`: Added click listener in DOMContentLoaded to set `window.location.hash = '#/docs/new'`

### CSS additions (style.css)

- `.nav-section-header`: flex row for Docs title + New Doc button alignment
- `.create-view`, `.create-view h1`: create page layout
- `.form-field`, `.form-field label`, `.form-input`, `.form-input:focus`: form field styles using dark theme variables
- `.field-hint`, `.form-error`, `.form-actions`: helper text and action row
- `.modal-overlay`: fixed fullscreen overlay with semi-transparent black background
- `.modal-box`, `.modal-box h2`, `.modal-box p`, `.modal-actions`: modal dialog card
- `.btn-danger`, `.btn-danger:hover`: red destructive action button

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `renderCreateView` function exists in app.js (line 465)
- [x] `showDeleteModal` full implementation exists in app.js (line 587)
- [x] Router calls `await renderCreateView()` for `#/docs/new` (line 671)
- [x] New Doc button event listener in DOMContentLoaded (line 707)
- [x] `#new-doc-btn` button in index.html inside `.nav-section-header` (line 34)
- [x] `.modal-overlay` class in style.css (line 817)
- [x] Commits: 2b21c69, 2f31bcb both exist
