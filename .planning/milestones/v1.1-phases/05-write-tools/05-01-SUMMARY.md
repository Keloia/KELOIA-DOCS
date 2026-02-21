---
phase: 05-write-tools
plan: 01
subsystem: api
tags: [mcp, typescript, node, file-io, atomic-writes]

# Dependency graph
requires:
  - phase: 04-read-tools
    provides: "registerReadTools pattern, McpServer usage, paths.ts constants"
provides:
  - "keloia_add_task: creates task file and updates kanban index atomically"
  - "keloia_move_task: updates task column with ID validation"
  - "keloia_update_progress: merges fields into milestone file atomically"
  - "atomicWriteJson helper: writeFileSync + renameSync for POSIX-safe writes"
  - "registerWriteTools wired into server.ts alongside registerReadTools"
affects: [06-e2e-verification, future-write-tool-extensions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic write: write to .tmp then renameSync to target — no partial reads possible"
    - "Validation-before-write: check ID exists in index before touching any files"
    - "Field-only merge: spread existing then apply only defined fields (undefined check)"

key-files:
  created:
    - mcp-server/src/tools/write.ts
  modified:
    - mcp-server/src/server.ts

key-decisions:
  - "Write task file first, then update index — ensures index only references files that exist"
  - "nextTaskId parses numeric suffix from existing IDs to allow non-contiguous sequences"
  - "notes field uses z.string().nullable().optional() to allow null as a valid value distinct from omitted"

patterns-established:
  - "atomicWriteJson pattern: all JSON mutations use temp file + renameSync throughout write tools"
  - "Error message pattern: 'Task not found: \"{id}\". Known tasks: {list}' for actionable errors"
  - "Field merge pattern: const updated = { ...existing }; if (field !== undefined) updated.field = field"

requirements-completed: [WRITE-01, WRITE-02, WRITE-03, WRITE-04]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 5 Plan 01: Write Tools Summary

**Three atomic write MCP tools (keloia_add_task, keloia_move_task, keloia_update_progress) using writeFileSync + renameSync pattern wired into server.ts**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-22T17:09:43Z
- **Completed:** 2026-02-22T17:11:31Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Implemented `keloia_add_task` with sequential ID generation and dual atomic write (task file then index)
- Implemented `keloia_move_task` with index-validated ID lookup before mutation
- Implemented `keloia_update_progress` with field-level merge (only provided fields applied)
- Created `atomicWriteJson` helper using writeFileSync + renameSync for all writes
- Wired `registerWriteTools(server)` into server.ts after `registerReadTools(server)`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create write.ts with three write tools and atomic write helper** - `a53ab86` (feat)
2. **Task 2: Wire registerWriteTools into server.ts** - `44aa4fa` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `mcp-server/src/tools/write.ts` - Three write tools + atomicWriteJson and nextTaskId helpers
- `mcp-server/src/server.ts` - Added import and call for registerWriteTools

## Decisions Made
- Write task file before updating index so index never references a missing file
- Used `nextTaskId` with numeric suffix parsing to correctly handle non-contiguous ID sequences
- `notes` field declared as `z.string().nullable().optional()` to accept `null` as a distinct valid value (not just absence)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three write tools registered and TypeScript-verified
- Server now exposes 7 tools total (4 read + 3 write)
- Ready for end-to-end verification of write tools in Claude Code

---
*Phase: 05-write-tools*
*Completed: 2026-02-22*
