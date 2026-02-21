# Roadmap: Keloia Docs + MCP Server

## Overview

A single repo serves project documentation to humans via GitHub Pages and to AI tools via an MCP server. The build order is dictated by shared data schemas: lock the data layer first, then build the static site against real files, then establish the MCP server foundation, then implement read tools, then write tools. Both surfaces read the same filesystem — no sync, no duplication, no deploy step for the site.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Data Layer** - Seed docs, define JSON schemas, establish repo file structure
- [ ] **Phase 2: Static Site** - Complete human-facing SPA with GitHub Pages deploy
- [ ] **Phase 3: MCP Foundation** - Server skeleton with correct transport, logging, and path resolution
- [ ] **Phase 4: MCP Read Tools** - All read tools verified end-to-end in Claude Code
- [ ] **Phase 5: MCP Write Tools + Integration** - Write tools with atomic writes and final Claude Code wiring

## Phase Details

### Phase 1: Data Layer
**Goal**: The shared filesystem data contracts are locked and populated so both the site and MCP server have stable schemas to build against
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. `docs/` directory contains at least one real markdown file viewable in the GitHub UI
  2. `kanban/board.json` exists with at least one column and one task, and validates against the defined schema
  3. `progress/tracker.json` exists with at least one milestone and progress entry, and validates against the defined schema
  4. Both JSON files contain a `schemaVersion: 1` field
**Plans:** 1 plan
Plans:
- [ ] 01-01-PLAN.md — Seed docs, create kanban and progress schemas with split-file structure

### Phase 2: Static Site
**Goal**: Reza can open the deployed GitHub Pages URL and read docs, view the kanban board, and check milestone progress — no build step, no local server
**Depends on**: Phase 1
**Requirements**: SITE-01, SITE-02, SITE-03, SITE-04, SITE-05, SITE-06, SITE-07, SITE-08
**Success Criteria** (what must be TRUE):
  1. Visiting the deployed `github.io/keloia-docs/` URL loads the site without any local build step
  2. Clicking a doc in the sidebar renders its markdown content in the main area with XSS protection active
  3. The kanban view shows columns with cards color-coded by priority from `board.json`
  4. The progress view shows milestone modules with CSS progress bars from `tracker.json`
  5. Pushing a change to `main` triggers GitHub Actions and the updated site is live within two minutes
**Plans**: TBD

### Phase 3: MCP Foundation
**Goal**: The MCP server connects to Claude Code and shows "connected" status — no tools yet, but the foundation is provably correct
**Depends on**: Phase 2
**Requirements**: MCP-09, MCP-12, MCP-13, INTG-01
**Success Criteria** (what must be TRUE):
  1. Running `npm run build` in `mcp-server/` produces `dist/index.js` without errors
  2. The MCP server registers in Claude Code and shows as "connected" in `/mcp` status
  3. The codebase contains zero `console.log` calls — only `console.error` for server-side logging
  4. All file paths in the server are resolved from `import.meta.url`, not `process.cwd()`
**Plans**: TBD

### Phase 4: MCP Read Tools
**Goal**: Claude Code can query all documentation, kanban state, and milestone progress through MCP tools without ambiguity about which tool to use
**Depends on**: Phase 3
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-06, MCP-10, MCP-11
**Success Criteria** (what must be TRUE):
  1. Asking Claude to "list available docs" correctly invokes `list_docs` and returns filenames without a prompt hint
  2. Asking Claude to "read the architecture doc" correctly invokes `read_doc` and returns the markdown content
  3. Asking Claude to "show the kanban board filtered by column" correctly invokes `get_kanban` with the filter parameter
  4. Asking Claude to "check milestone progress" correctly invokes `get_progress` and returns structured data
  5. Invalid tool calls (bad filename, missing required param) return MCP error responses with `isError: true`
**Plans**: TBD

### Phase 5: MCP Write Tools + Integration
**Goal**: Claude Code can create tasks, move tasks between columns, and update milestone progress — all mutations are safe, validated, and documented for Reza to use
**Depends on**: Phase 4
**Requirements**: MCP-04, MCP-05, MCP-07, MCP-08, INTG-02
**Success Criteria** (what must be TRUE):
  1. Asking Claude to "add a task to the backlog" creates a new card in `board.json` with a generated ID and Zod-validated fields
  2. Asking Claude to "move task X to in-progress" updates the task's column in `board.json` atomically (no truncated JSON on interrupted write)
  3. Asking Claude to "update module Y progress to 80%" writes the new value to `tracker.json` atomically
  4. The README contains setup instructions that a fresh clone can follow to get the MCP server running in Claude Code
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Layer | 0/1 | Planned | - |
| 2. Static Site | 0/? | Not started | - |
| 3. MCP Foundation | 0/? | Not started | - |
| 4. MCP Read Tools | 0/? | Not started | - |
| 5. MCP Write Tools + Integration | 0/? | Not started | - |
