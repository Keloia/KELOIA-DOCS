# Requirements: Keloia Docs v2.0

**Defined:** 2026-02-22
**Core Value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.

## v2.0 Requirements

Requirements for v2.0 release. Each maps to roadmap phases.

### Search

- [ ] **SRCH-01**: User can type in a search box at the top of the sidebar to search doc content
- [ ] **SRCH-02**: Search results update live as user types (debounced)
- [ ] **SRCH-03**: Search results show doc name and a text snippet with the matching content
- [ ] **SRCH-04**: User can click a search result to navigate to that doc
- [ ] **SRCH-05**: MCP tool `keloia_search_docs` searches doc content by keyword or regex
- [ ] **SRCH-06**: MCP tool `keloia_search_docs` supports filtering by doc slug

### Authentication

- [ ] **AUTH-01**: User can enter a GitHub Personal Access Token to authenticate
- [ ] **AUTH-02**: Token is stored in localStorage and persists across sessions
- [ ] **AUTH-03**: User can log out (clears stored token)
- [ ] **AUTH-04**: Write UI controls (edit, add, delete, drag) are hidden when not authenticated

### Doc CRUD

- [ ] **CRUD-01**: Authenticated user can create a new doc with title and markdown content
- [ ] **CRUD-02**: Authenticated user can edit an existing doc in a markdown textarea
- [ ] **CRUD-03**: User can toggle a preview of the rendered markdown while editing
- [ ] **CRUD-04**: Authenticated user can delete a doc with a confirmation modal
- [ ] **CRUD-05**: All site doc writes go through the GitHub Contents API (commit to repo)
- [ ] **CRUD-06**: MCP tool `keloia_add_doc` creates a new doc file in data/docs/
- [ ] **CRUD-07**: MCP tool `keloia_edit_doc` updates an existing doc file
- [ ] **CRUD-08**: MCP tool `keloia_delete_doc` removes a doc file

### Kanban

- [ ] **KNBN-01**: Authenticated user can drag kanban cards between columns
- [ ] **KNBN-02**: A confirmation modal appears before saving the column change
- [ ] **KNBN-03**: Column change is persisted via GitHub Contents API

### Guide

- [ ] **GUID-01**: MCP setup guide page is accessible from the site navigation
- [ ] **GUID-02**: Guide includes setup instructions with copy-paste config for Cursor, Claude Code, and Windsurf

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
| SRCH-01 | — | Pending |
| SRCH-02 | — | Pending |
| SRCH-03 | — | Pending |
| SRCH-04 | — | Pending |
| SRCH-05 | — | Pending |
| SRCH-06 | — | Pending |
| AUTH-01 | — | Pending |
| AUTH-02 | — | Pending |
| AUTH-03 | — | Pending |
| AUTH-04 | — | Pending |
| CRUD-01 | — | Pending |
| CRUD-02 | — | Pending |
| CRUD-03 | — | Pending |
| CRUD-04 | — | Pending |
| CRUD-05 | — | Pending |
| CRUD-06 | — | Pending |
| CRUD-07 | — | Pending |
| CRUD-08 | — | Pending |
| KNBN-01 | — | Pending |
| KNBN-02 | — | Pending |
| KNBN-03 | — | Pending |
| GUID-01 | — | Pending |
| GUID-02 | — | Pending |

**Coverage:**
- v2.0 requirements: 23 total
- Mapped to phases: 0
- Unmapped: 23 ⚠️

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after initial definition*
