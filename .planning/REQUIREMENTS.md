# Requirements: Keloia Docs + MCP Server

**Defined:** 2026-02-21
**Core Value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Data Layer

- [ ] **DATA-01**: Seed `docs/` directory with existing markdown files (architecture, value proposition)
- [ ] **DATA-02**: Create `kanban/board.json` with schema: columns array, tasks with id/title/column/priority/assignee/labels/description/dates
- [ ] **DATA-03**: Create `progress/tracker.json` with schema: milestones with modules, progress percentages, task counts, notes
- [ ] **DATA-04**: Add `schemaVersion: 1` field to both JSON files for future migration safety

### Static Site

- [ ] **SITE-01**: SPA shell (`index.html`) with sidebar navigation listing docs, kanban, and progress views
- [ ] **SITE-02**: Markdown doc rendering via marked.js from CDN with DOMPurify XSS protection
- [ ] **SITE-03**: Kanban board view rendering columns and cards from `board.json` with priority color-coding
- [ ] **SITE-04**: Progress tracker view rendering milestone modules with progress bars from `tracker.json`
- [ ] **SITE-05**: Dark theme CSS with responsive layout (CSS custom properties, flexbox)
- [ ] **SITE-06**: Active sidebar link highlighting on navigation
- [ ] **SITE-07**: All data fetches use relative paths for GitHub Pages subdirectory compatibility
- [ ] **SITE-08**: GitHub Actions workflow deploys site on push to main

### MCP Server

- [ ] **MCP-01**: `list_docs` tool returns available documentation filenames
- [ ] **MCP-02**: `read_doc` tool reads a markdown file by slug and returns content
- [ ] **MCP-03**: `get_kanban` tool reads board with optional column/label/assignee filters
- [ ] **MCP-04**: `add_task` tool creates a new kanban task with Zod-validated input
- [ ] **MCP-05**: `move_task` tool moves a task between columns with validation
- [ ] **MCP-06**: `get_progress` tool reads milestone progress data
- [ ] **MCP-07**: `update_progress` tool updates module progress with Zod-validated input
- [ ] **MCP-08**: All write tools use atomic JSON writes (write-to-temp-then-rename)
- [ ] **MCP-09**: Server uses `console.error()` exclusively — no stdout logging
- [ ] **MCP-10**: Proper MCP error responses with `isError: true` for failure cases
- [ ] **MCP-11**: Descriptive tool names and descriptions for accurate AI tool selection
- [ ] **MCP-12**: Stdio transport via `StdioServerTransport`
- [ ] **MCP-13**: Code structured so transport layer is swappable for future HTTP/SSE

### Integration

- [ ] **INTG-01**: `.mcp.json` config file for Claude Code project-scope MCP registration
- [ ] **INTG-02**: README with setup instructions (git clone, npm install, build, register)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### MCP Enhancements

- **MCP-14**: `docs://` resource template for alternative MCP access pattern
- **MCP-15**: Structured `outputSchema` on read tools for response validation
- **MCP-16**: `search_docs` tool with keyword matching across all files
- **MCP-17**: HTTP/SSE remote transport option alongside stdio

### Site Enhancements

- **SITE-09**: Full-text search across docs (lunr.js or similar)
- **SITE-10**: Milestone progress history / trend display
- **SITE-11**: Enhanced card styling with label colors and assignee avatars

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| JS frameworks (React, Astro, Docusaurus) | Zero build step is a hard constraint |
| CSS frameworks (Tailwind, Bootstrap) | Adds build step or unnecessary weight |
| Database (SQLite, D1) | Filesystem is the database for <100 tasks |
| Authentication on the site | Repo visibility controls access |
| GitHub Issues sync | Adds external API dependency, breaks offline-first |
| Testing framework (Jest, Vitest) | 7 tools under 20 lines each; test by using |
| WebSocket live updates | Requires persistent server process; GitHub Pages is static |
| Edit-in-place on site | Requires GitHub API auth; adds complexity beyond v1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | — | Pending |
| DATA-02 | — | Pending |
| DATA-03 | — | Pending |
| DATA-04 | — | Pending |
| SITE-01 | — | Pending |
| SITE-02 | — | Pending |
| SITE-03 | — | Pending |
| SITE-04 | — | Pending |
| SITE-05 | — | Pending |
| SITE-06 | — | Pending |
| SITE-07 | — | Pending |
| SITE-08 | — | Pending |
| MCP-01 | — | Pending |
| MCP-02 | — | Pending |
| MCP-03 | — | Pending |
| MCP-04 | — | Pending |
| MCP-05 | — | Pending |
| MCP-06 | — | Pending |
| MCP-07 | — | Pending |
| MCP-08 | — | Pending |
| MCP-09 | — | Pending |
| MCP-10 | — | Pending |
| MCP-11 | — | Pending |
| MCP-12 | — | Pending |
| MCP-13 | — | Pending |
| INTG-01 | — | Pending |
| INTG-02 | — | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 0
- Unmapped: 27

---
*Requirements defined: 2026-02-21*
*Last updated: 2026-02-21 after initial definition*
