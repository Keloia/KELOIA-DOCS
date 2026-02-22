# Requirements: Keloia Docs v2.0

**Defined:** 2026-02-22
**Core Value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.

## v2.0 Requirements

Requirements for v2.0 release. Each maps to roadmap phases.

### Search

- [x] **SRCH-01**: User can type in a search box at the top of the sidebar to search doc content
- [x] **SRCH-02**: Search results update live as user types (debounced)
- [x] **SRCH-03**: Search results show doc name and a text snippet with the matching content
- [x] **SRCH-04**: User can click a search result to navigate to that doc
- [x] **SRCH-05**: MCP tool `keloia_search_docs` searches doc content by keyword or regex
- [x] **SRCH-06**: MCP tool `keloia_search_docs` supports filtering by doc slug

### Authentication

- [x] **AUTH-01**: User can enter a GitHub Personal Access Token to authenticate
- [x] **AUTH-02**: Token is stored in localStorage and persists across sessions
- [x] **AUTH-03**: User can log out (clears stored token)
- [x] **AUTH-04**: Write UI controls (edit, add, delete, drag) are hidden when not authenticated

### Doc CRUD

- [x] **CRUD-01**: Authenticated user can create a new doc with title and markdown content
- [x] **CRUD-02**: Authenticated user can edit an existing doc in a markdown textarea
- [x] **CRUD-03**: User can toggle a preview of the rendered markdown while editing
- [x] **CRUD-04**: Authenticated user can delete a doc with a confirmation modal
- [x] **CRUD-05**: All site doc writes go through the GitHub Contents API (commit to repo)
- [x] **CRUD-06**: MCP tool `keloia_add_doc` creates a new doc file in data/docs/
- [x] **CRUD-07**: MCP tool `keloia_edit_doc` updates an existing doc file
- [x] **CRUD-08**: MCP tool `keloia_delete_doc` removes a doc file

### Kanban

- [x] **KNBN-01**: Authenticated user can drag kanban cards between columns
- [x] **KNBN-02**: A confirmation modal appears before saving the column change
- [x] **KNBN-03**: Column change is persisted via GitHub Contents API

### Guide

- [x] **GUID-01**: MCP setup guide page is accessible from the site navigation
- [x] **GUID-02**: Guide includes setup instructions with copy-paste config for Cursor, Claude Code, and Windsurf

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Auth

- **AUTH-05**: Full GitHub OAuth flow with "Sign in with GitHub" button
- **AUTH-06**: User avatar and username displayed in UI when authenticated

### Enhanced Search

- **SRCH-07**: Search highlights matching terms within the doc when navigated to
- **SRCH-08**: Search covers kanban tasks and progress milestones (not just docs)

### Enhanced Kanban

- **KNBN-04**: User can reorder cards within the same column
- **KNBN-05**: Column/assignee filters on get_kanban MCP tool

### Enhanced MCP

- **MCP-01**: Computed percentComplete on get_progress
- **MCP-02**: Schema version assertion on reads

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| WYSIWYG / rich text editor | Adds build step or massive complexity; markdown textarea sufficient for developer users |
| Real-time collaborative editing | No WebSocket/persistent server; GitHub Pages is static; 1-2 users don't need it |
| Server-side search (Algolia, Pagefind) | Requires build step or third-party account; violates constraints |
| Full search engine with TF-IDF/BM25 ranking | Overkill for <20 docs; simple matching is sufficient |
| Side-by-side live preview editor | Non-trivial split-pane CSS in vanilla JS; preview toggle is sufficient |
| Mobile drag-and-drop | HTML5 DnD doesn't work on touch; polyfill adds complexity; defer to future |
| Delete kanban columns | Destroys task history; column set is intentionally small and stable |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SRCH-01 | Phase 6 | Complete |
| SRCH-02 | Phase 6 | Complete |
| SRCH-03 | Phase 6 | Complete |
| SRCH-04 | Phase 6 | Complete |
| GUID-01 | Phase 6 | Complete |
| GUID-02 | Phase 6 | Complete |
| SRCH-05 | Phase 7 | Complete |
| SRCH-06 | Phase 7 | Complete |
| CRUD-06 | Phase 7 | Complete |
| CRUD-07 | Phase 7 | Complete |
| CRUD-08 | Phase 7 | Complete |
| AUTH-01 | Phase 8 | Complete |
| AUTH-02 | Phase 8 | Complete |
| AUTH-03 | Phase 8 | Complete |
| AUTH-04 | Phase 8 | Complete |
| CRUD-05 | Phase 9 | Complete |
| CRUD-01 | Phase 10 | Complete |
| CRUD-02 | Phase 10 | Complete |
| CRUD-03 | Phase 10 | Complete |
| CRUD-04 | Phase 10 | Complete |
| KNBN-01 | Phase 11 | Complete |
| KNBN-02 | Phase 11 | Complete |
| KNBN-03 | Phase 11 | Complete |

**Coverage:**
- v2.0 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after roadmap creation (v2.0 Phases 6-11)*
