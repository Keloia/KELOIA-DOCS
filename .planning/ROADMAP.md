# Roadmap: Keloia Docs + MCP Server

## Overview

A single repo serves project documentation to humans via GitHub Pages and to AI tools via an MCP server. Both surfaces read the same filesystem — no sync, no duplication, no deploy step for the site.

## Milestones

- ✅ **v1.0 Data Layer + Static Site** — Phases 1-2 (shipped 2026-02-22)
- 📋 **Next** — Phases 3-5 (MCP server — planned, not started)

## Phases

<details>
<summary>✅ v1.0 Data Layer + Static Site (Phases 1-2) — SHIPPED 2026-02-22</summary>

- [x] **Phase 1: Data Layer** (1/1 plans) — completed 2026-02-21
- [x] **Phase 2: Static Site** (2/2 plans) — completed 2026-02-22

See: `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

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

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Data Layer | v1.0 | 1/1 | Complete | 2026-02-21 |
| 2. Static Site | v1.0 | 2/2 | Complete | 2026-02-22 |
| 3. MCP Foundation | Next | 0/? | Not started | - |
| 4. MCP Read Tools | Next | 0/? | Not started | - |
| 5. MCP Write Tools + Integration | Next | 0/? | Not started | - |
