# Roadmap: Keloia Docs + MCP Server

## Overview

A single repo serves project documentation to humans via GitHub Pages and to AI tools via an MCP server. Both surfaces read the same filesystem — no sync, no duplication, no deploy step for the site.

## Milestones

- ✅ **v1.0 Data Layer + Static Site** — Phases 1-2 (shipped 2026-02-22)
- ✅ **v1.1 MCP Server** — Phases 3-5 (shipped 2026-02-22)
- 🚧 **v2.0 Search + Auth + CRUD** — Phases 6-11 (in progress)

## Phases

<details>
<summary>✅ v1.0 Data Layer + Static Site (Phases 1-2) — SHIPPED 2026-02-22</summary>

- [x] **Phase 1: Data Layer** (1/1 plans) — completed 2026-02-21
- [x] **Phase 2: Static Site** (2/2 plans) — completed 2026-02-22

See: `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.1 MCP Server (Phases 3-5) — SHIPPED 2026-02-22</summary>

- [x] **Phase 3: MCP Foundation** (2/2 plans) — completed 2026-02-21
- [x] **Phase 4: Read Tools** (2/2 plans) — completed 2026-02-22
- [x] **Phase 5: Write Tools + Integration** (3/3 plans) — completed 2026-02-22

See: `.planning/milestones/v1.1-ROADMAP.md` for full details.

</details>

### 🚧 v2.0 Search + Auth + CRUD (In Progress)

**Milestone Goal:** Transform the site from read-only to read-write with GitHub PAT authentication, full-text search across both surfaces, interactive kanban drag-and-drop, and MCP doc CRUD tools.

- [ ] **Phase 6: Site Search + Guide** — Full-text doc search in the sidebar and static MCP setup guide page
- [ ] **Phase 7: MCP Search + Doc CRUD Tools** — `keloia_search_docs`, `keloia_add_doc`, `keloia_edit_doc`, `keloia_delete_doc` MCP tools
- [ ] **Phase 8: GitHub Auth** — PAT entry modal, localStorage persistence, and auth-gated write UI
- [ ] **Phase 9: GitHub API Wrapper** — SHA-aware Contents API wrapper with serialized write queue
- [ ] **Phase 10: Site Doc CRUD** — Authenticated add, edit (with preview), and delete for docs via the GitHub API
- [ ] **Phase 11: Interactive Kanban** — Authenticated drag-and-drop kanban with confirmation modal and GitHub API persistence

## Phase Details

### Phase 6: Site Search + Guide
**Goal**: Users can search doc content from the sidebar and access an MCP setup guide from site navigation
**Depends on**: Nothing (no auth, no API — reads existing data/ files)
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04, GUID-01, GUID-02
**Success Criteria** (what must be TRUE):
  1. A search box is visible at the top of the sidebar on any page
  2. Typing in the search box shows results within the same keystroke cycle, with doc name and a text snippet showing matched content
  3. Clicking a search result navigates to that doc
  4. The MCP setup guide is listed in the sidebar navigation and renders as a full doc page
  5. The search index is not built at page load — it builds on first focus of the search box
**Plans:** 1/2 plans executed
Plans:
- [ ] 06-01-PLAN.md — Guide page + HTML/CSS scaffolding (MiniSearch CDN, search input, guide content)
- [ ] 06-02-PLAN.md — Search JS logic (lazy index build, debounced search, result rendering)

### Phase 7: MCP Search + Doc CRUD Tools
**Goal**: Claude Code can search docs by keyword or regex and create, edit, or delete doc files directly via MCP tools
**Depends on**: Nothing (runs locally, writes to filesystem, no auth or GitHub API dependency)
**Requirements**: SRCH-05, SRCH-06, CRUD-06, CRUD-07, CRUD-08
**Success Criteria** (what must be TRUE):
  1. `keloia_search_docs` returns matching docs with slug, title, snippet, and line number for a keyword or regex pattern
  2. `keloia_search_docs` accepts an optional slug filter that narrows results to a single doc
  3. `keloia_add_doc` creates a new markdown file in data/docs/ and updates the doc index — fails if slug already exists
  4. `keloia_edit_doc` overwrites an existing doc file — fails if slug does not exist
  5. `keloia_delete_doc` removes the doc file and removes the slug from the index — index is updated before file deletion
**Plans**: TBD

### Phase 8: GitHub Auth
**Goal**: Users can authenticate with a GitHub Personal Access Token so that write UI controls become available
**Depends on**: Nothing (client-side only, no GitHub API calls beyond token verification)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):
  1. A login button or prompt allows the user to enter a GitHub PAT; the token is verified against the GitHub `/user` API before being accepted
  2. The token persists in localStorage across browser sessions — closing and reopening the tab does not require re-entry
  3. Clicking logout clears the token and returns the UI to unauthenticated state
  4. Edit, add, delete, and drag-and-drop controls are hidden when not authenticated and appear when authenticated
**Plans**: TBD

### Phase 9: GitHub API Wrapper
**Goal**: All site write operations reach the GitHub Contents API safely — with SHA-aware updates, Unicode-safe Base64, and serialized writes that prevent 409 Conflicts
**Depends on**: Phase 8 (token required for API calls)
**Requirements**: CRUD-05
**Success Criteria** (what must be TRUE):
  1. Writing the same file twice in rapid succession completes without a 409 Conflict error
  2. Saving a doc containing non-ASCII characters (em dash, smart quotes, curly quotes) completes without an `InvalidCharacterError`
  3. Decoding a file fetched from the GitHub API succeeds in all browsers without whitespace errors
  4. Every update and delete operation fetches the current file SHA immediately before the write — no cached SHAs are reused
**Plans**: TBD

### Phase 10: Site Doc CRUD
**Goal**: Authenticated users can create, edit, and delete docs from the site, with all changes committed to the repository via the GitHub Contents API
**Depends on**: Phase 8 (auth) and Phase 9 (GitHub API wrapper)
**Requirements**: CRUD-01, CRUD-02, CRUD-03, CRUD-04
**Success Criteria** (what must be TRUE):
  1. An authenticated user can create a new doc by entering a slug, title, and markdown body — the doc appears in the sidebar navigation after creation
  2. An authenticated user can open an existing doc in a markdown textarea and save changes — the updated content renders on next view
  3. While editing, the user can toggle a rendered preview of the markdown without leaving the edit view
  4. An authenticated user can delete a doc via a confirmation modal that names the doc title — the doc is removed from the sidebar after deletion
**Plans**: TBD

### Phase 11: Interactive Kanban
**Goal**: Authenticated users can drag kanban cards between columns, confirm the move, and have the column change persisted to the repository
**Depends on**: Phase 8 (auth) and Phase 9 (GitHub API wrapper)
**Requirements**: KNBN-01, KNBN-02, KNBN-03
**Success Criteria** (what must be TRUE):
  1. An authenticated user can drag a kanban card from one column and drop it on another column
  2. A confirmation modal appears after the drop, naming the task title and destination column — the move is not saved until the user confirms
  3. After confirmation, the card appears in the new column on the board and the change is persisted via the GitHub Contents API
  4. Drag handles and drop zones are not present when the user is not authenticated
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Data Layer | v1.0 | 1/1 | Complete | 2026-02-21 |
| 2. Static Site | v1.0 | 2/2 | Complete | 2026-02-22 |
| 3. MCP Foundation | v1.1 | 2/2 | Complete | 2026-02-21 |
| 4. Read Tools | v1.1 | 2/2 | Complete | 2026-02-22 |
| 5. Write Tools + Integration | v1.1 | 3/3 | Complete | 2026-02-22 |
| 6. Site Search + Guide | 1/2 | In Progress|  | - |
| 7. MCP Search + Doc CRUD Tools | v2.0 | 0/TBD | Not started | - |
| 8. GitHub Auth | v2.0 | 0/TBD | Not started | - |
| 9. GitHub API Wrapper | v2.0 | 0/TBD | Not started | - |
| 10. Site Doc CRUD | v2.0 | 0/TBD | Not started | - |
| 11. Interactive Kanban | v2.0 | 0/TBD | Not started | - |
