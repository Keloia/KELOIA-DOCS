---
phase: 07-mcp-search-crud
plan: 01
subsystem: api
tags: [mcp, typescript, zod, atomic-write, search, crud, documentation]

# Dependency graph
requires:
  - phase: 04-read-tools
    provides: keloia_read_doc pattern (index validation, path traversal protection, isError shape)
  - phase: 05-write-tools
    provides: atomicWriteJson pattern, write.ts conventions for MCP tool registration
provides:
  - keloia_search_docs: keyword and regex search across all doc files with optional slug filter
  - keloia_add_doc: create new markdown doc file with index registration and collision guard
  - keloia_edit_doc: overwrite existing doc content with optional title update in index
  - keloia_delete_doc: deregister from index first, then delete file (index-first ordering)
affects:
  - 08-auth
  - 09-github-api-writes
  - future doc management workflows

# Tech tracking
tech-stack:
  added: []
  patterns:
    - atomicWriteText: writeFileSync to .tmp then renameSync to target (parallel to atomicWriteJson)
    - slug validation: SLUG_RE regex for lowercase alphanumeric + internal hyphens
    - lastIndex reset: compiled.lastIndex = 0 before every regex exec() call prevents match-skipping
    - index-first deletion: update index.json before unlinkSync to ensure consistent state on partial failure
    - dual collision guard: check both index AND existsSync(filePath) before add_doc to prevent orphaned files

key-files:
  created:
    - mcp-server/src/tools/docs.ts
  modified:
    - mcp-server/src/server.ts

key-decisions:
  - "atomicWriteText duplicated locally in docs.ts rather than imported from write.ts — keeps modules independent, no circular dependency"
  - "delete_doc updates index FIRST before unlinkSync — ensures index is consistent even if file delete fails"
  - "slug format validated with SLUG_RE before any filesystem operations — prevents path traversal and invalid filenames"
  - "keloia_search_docs caps at 50 results and extracts 150-char snippets centered on match — balances context richness with token efficiency"
  - "is_regex=false uses case-insensitive indexOf, is_regex=true uses RegExp with i flag — consistent case handling across modes"

patterns-established:
  - "registerDocTools(server): follows registerReadTools/registerWriteTools naming convention"
  - "All doc tools use try/catch returning isError shape on any error"
  - "Atomic writes via tmp file + rename for both JSON (index) and text (markdown) files"

requirements-completed: [SRCH-05, SRCH-06, CRUD-06, CRUD-07, CRUD-08]

# Metrics
duration: 4min
completed: 2026-02-22
---

# Phase 7 Plan 01: MCP Search + Doc CRUD Tools Summary

**Four MCP tools (keloia_search_docs, keloia_add_doc, keloia_edit_doc, keloia_delete_doc) implemented in docs.ts with atomic writes, slug validation, index-first deletion, and regex lastIndex reset**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-22T08:07:49Z
- **Completed:** 2026-02-22T08:11:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Implemented `keloia_search_docs` with keyword (case-insensitive indexOf) and regex (lastIndex reset before each exec()) modes, optional slug filter with isError on unknown slug, 50-result cap, 150-char centered snippets
- Implemented `keloia_add_doc` with SLUG_RE format validation, dual collision check (index AND disk), atomic write of markdown then index append
- Implemented `keloia_edit_doc` with existence check, atomic content overwrite, optional title update in index
- Implemented `keloia_delete_doc` with existence check, index updated FIRST via atomicWriteJson, then unlinkSync — guaranteed consistent state
- Registered all four tools in server.ts via `registerDocTools(server)` — server now has 11 keloia_ MCP tools total
- TypeScript type check and npm run build pass with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create docs.ts with all five MCP doc tools** - `d315451` (feat)
2. **Task 2: Register doc tools in server.ts, build, and verify** - `7243939` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `mcp-server/src/tools/docs.ts` - All four doc tool registrations with atomicWriteText, atomicWriteJson, SLUG_RE, DocsIndex type
- `mcp-server/src/server.ts` - Added registerDocTools import and call in createServer()

## Decisions Made
- Duplicated `atomicWriteText` and `atomicWriteJson` locally in docs.ts rather than importing from write.ts — keeps modules independent and avoids circular dependency risk
- Used `compiled.lastIndex = 0` reset before every `exec()` call in regex search — critical for correctness when the regex has the `g` flag implied by multi-line iteration
- `keloia_delete_doc` updates index.json FIRST before calling unlinkSync — if file delete fails, index is already consistent (doc is no longer registered)
- Slug validation with `SLUG_RE` applied before any filesystem operations — prevents path traversal attacks and invalid filenames at entry point

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Minor: `mcp-server/dist/` is gitignored so compiled output was not committed — this is correct behavior (build output excluded from VCS per project convention). Only source files committed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four doc CRUD MCP tools are live and registered
- MCP server now has 11 total tools: 4 read + 3 write + 4 doc
- Ready for Phase 8 (Auth) — no blockers from this phase

## Self-Check: PASSED

- mcp-server/src/tools/docs.ts: FOUND
- mcp-server/src/server.ts: FOUND
- .planning/phases/07-mcp-search-crud/07-01-SUMMARY.md: FOUND
- Commit d315451: FOUND
- Commit 7243939: FOUND

---
*Phase: 07-mcp-search-crud*
*Completed: 2026-02-22*
