# Roadmap: Keloia Docs + MCP Server

## Overview

A single repo serves project documentation to humans via GitHub Pages and to AI tools via an MCP server. Both surfaces read the same filesystem — no sync, no duplication, no deploy step for the site.

## Milestones

- ✅ **v1.0 Data Layer + Static Site** — Phases 1-2 (shipped 2026-02-22)
- 📋 **v1.1 MCP Server** — Phases 3-5 (in progress)

## Phases

<details>
<summary>✅ v1.0 Data Layer + Static Site (Phases 1-2) — SHIPPED 2026-02-22</summary>

- [x] **Phase 1: Data Layer** (1/1 plans) — completed 2026-02-21
- [x] **Phase 2: Static Site** (2/2 plans) — completed 2026-02-22

See: `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

- [x] **Phase 3: MCP Foundation** — TypeScript server skeleton, toolchain, and Claude Code registration with provably correct path resolution and zero stdout pollution (completed 2026-02-21)
- [ ] **Phase 4: Read Tools** — All four read tools registered with domain-namespaced names and action-first descriptions; Claude Code can query docs, kanban, and progress
- [ ] **Phase 5: Write Tools + Integration** — Three write tools with Zod validation and atomic writes; README enables a fresh clone to register and run the server

## Phase Details

### Phase 3: MCP Foundation
**Goal**: The MCP server connects to Claude Code and shows "connected" status with zero tools — proving the toolchain, module system, path resolution, and logging discipline are correct before any tool code is written
**Depends on**: Phase 2
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05
**Success Criteria** (what must be TRUE):
  1. Running `npm run build` in `mcp-server/` produces `dist/index.js` with zero TypeScript errors
  2. Running `node dist/index.js` starts the server and exits cleanly on Ctrl+C
  3. The server appears as "connected" in Claude Code's `/mcp` status (zero tools is acceptable at this stage)
  4. `grep -r "console.log" mcp-server/src/` returns zero results — all logging uses `console.error()`
  5. `REPO_ROOT`, `DOCS_DIR`, `KANBAN_DIR`, and `PROGRESS_DIR` log correct absolute paths to stderr at startup, not paths relative to wherever Claude Code was launched
**Plans:** 2/2 plans complete
Plans:
- [ ] 03-01-PLAN.md — MCP server skeleton with TypeScript toolchain, source modules, and build
- [ ] 03-02-PLAN.md — Claude Code registration via .mcp.json and connection verification

### Phase 4: Read Tools
**Goal**: Claude Code can read all project data — documentation, kanban board state, and milestone progress — via MCP tools with descriptions clear enough that Claude selects the correct tool without a prompt hint
**Depends on**: Phase 3
**Requirements**: READ-01, READ-02, READ-03, READ-04, READ-05, INTG-01, INTG-02
**Success Criteria** (what must be TRUE):
  1. Asking Claude to "list available docs" invokes `keloia_list_docs` and returns filenames without a prompt hint specifying the tool name
  2. Asking Claude to "read the architecture doc" invokes `keloia_read_doc` and returns the markdown content
  3. Asking Claude to "show the kanban board" invokes `keloia_get_kanban` and returns all columns with their task objects denormalized
  4. Asking Claude to "check milestone progress" invokes `keloia_get_progress` and returns structured milestone data
  5. Calling any read tool with an invalid slug or missing file returns `isError: true` with a clear human-readable message
**Plans:** 1/2 plans executed
Plans:
- [ ] 04-01-PLAN.md — Implement four read tools in read.ts and wire into server.ts
- [ ] 04-02-PLAN.md — Build, verify tools in Claude Code via natural language queries

### Phase 5: Write Tools + Integration
**Goal**: Claude Code can create tasks, move tasks between columns, and update milestone progress — all mutations are Zod-validated, atomically written, and the server is documented so a fresh clone can register and run it
**Depends on**: Phase 4
**Requirements**: WRITE-01, WRITE-02, WRITE-03, WRITE-04, INTG-03
**Success Criteria** (what must be TRUE):
  1. Asking Claude to "add a task to the backlog" creates a new task file and updates the kanban index with Zod-validated fields and a generated ID
  2. Asking Claude to "move task X to in-progress" updates the task's column atomically — interrupting the write mid-operation leaves valid, parseable JSON
  3. Asking Claude to "update milestone progress" writes new fields to the milestone file atomically and the site renders the updated value on next load
  4. Calling a write tool with an invalid column name returns `isError: true` naming the valid column options
  5. A developer following the README from a fresh clone can install, build, register, and verify the server appears in Claude Code's `/mcp` status
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Data Layer | v1.0 | 1/1 | Complete | 2026-02-21 |
| 2. Static Site | v1.0 | 2/2 | Complete | 2026-02-22 |
| 3. MCP Foundation | 2/2 | Complete    | 2026-02-21 | - |
| 4. Read Tools | 1/2 | In Progress|  | - |
| 5. Write Tools + Integration | v1.1 | 0/? | Not started | - |
