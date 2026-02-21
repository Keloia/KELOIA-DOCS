# Phase 1: Data Layer - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Seed the filesystem with documentation files, define JSON schemas for kanban and progress tracking, and establish the repo file structure. Both the static site and MCP server will read from this shared data layer. No UI, no server code — just data contracts and seed content.

</domain>

<decisions>
## Implementation Decisions

### Repo file structure
- All data lives under a top-level `data/` directory: `data/docs/`, `data/kanban/`, `data/progress/`
- Documentation files are flat inside `data/docs/` — no subdirectories by topic
- Kanban and progress data use split-file approach (one JSON file per entity) rather than monolithic files

### Kanban board design
- Three columns: Backlog, In Progress, Done
- No priority field — column position and ordering imply priority
- Task fields: id, title, column, description, assignee
- Lean schema — no labels, no dates, no tags

### Progress tracker design
- Milestones map directly to roadmap phases (Phase 1 = milestone 1, etc.)
- Progress is task-count driven — calculated from completed/total tasks in kanban, not manually set
- No manual percentage override

### Claude's Discretion
- Kanban file split strategy (file-per-task with columns index, file-per-column, or other)
- Progress file split strategy (file-per-milestone vs single file)
- Whether milestones have sub-modules or single aggregate progress
- Seed task content for initial kanban data
- Schema design details (field types, ID format, validation rules)

</decisions>

<specifics>
## Specific Ideas

- Requirements reference `board.json` and `tracker.json` as single files, but user chose split-by-entity — schema design should account for aggregation when tools need a unified view
- `schemaVersion: 1` field still required per DATA-04, needs to live somewhere in the split structure (likely in an index/meta file)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-data-layer*
*Context gathered: 2026-02-22*
