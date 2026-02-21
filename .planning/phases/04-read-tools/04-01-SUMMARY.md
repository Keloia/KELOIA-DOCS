---
phase: 04-read-tools
plan: 01
subsystem: mcp
tags: [mcp, typescript, zod, node-fs, tool-registration]

# Dependency graph
requires:
  - phase: 03-mcp-foundation
    provides: McpServer skeleton registered with Claude Code via .mcp.json and dist/index.js
provides:
  - Four keloia_ read tools registered on the MCP server (keloia_list_docs, keloia_read_doc, keloia_get_kanban, keloia_get_progress)
  - registerReadTools(server) function in mcp-server/src/tools/read.ts
  - Path traversal protection on keloia_read_doc via slug allowlist validation
affects: [05-write-tools, future-mcp-clients]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "server.registerTool() with raw Zod shape inputSchema (v1.26.0 API)"
    - "Single registerReadTools(server) export wires all tools; server.ts stays thin"
    - "Validate slug against index.json allowlist before constructing any file path"
    - "Return isError: true with content text for user-facing errors; catch all exceptions"
    - "readFileSync per-call — never cache; always fresh off disk"
    - "type: 'text' as const to satisfy TypeScript literal type narrowing"

key-files:
  created: []
  modified:
    - mcp-server/src/tools/read.ts
    - mcp-server/src/server.ts

key-decisions:
  - "Used type: 'text' as const on all content items — TypeScript narrows string literals without the cast"
  - "Inline type assertions (as { slug: string }[]) on JSON.parse results — full Zod file parsing is overkill for Phase 4 internal data"
  - "Pretty-printed JSON (null, 2) in all tool responses — readability aids Claude debugging"

patterns-established:
  - "Pattern: registerReadTools(server) — one export per feature domain, called from server.ts"
  - "Pattern: slug allowlist via index.json — safe file access without custom path regex"
  - "Pattern: try/catch isError return — never throw for user-facing errors in tool handlers"

requirements-completed: [READ-01, READ-02, READ-03, READ-04, READ-05, INTG-01, INTG-02]

# Metrics
duration: 5min
completed: 2026-02-22
---

# Phase 04 Plan 01: Read Tools Summary

**Four keloia_ MCP read tools using server.registerTool() with Zod schemas, slug allowlist path protection, and isError error handling — all reading fresh from split-file JSON data layer**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-21T20:51:11Z
- **Completed:** 2026-02-21T20:56:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Implemented all four read tools in `mcp-server/src/tools/read.ts` with action-first descriptions (INTG-02)
- Added slug allowlist validation on keloia_read_doc to prevent path traversal (READ-05)
- Wired registerReadTools(server) into server.ts — project builds with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement four read tools in read.ts** - `ccd050d` (feat)
2. **Task 2: Wire read tools into server.ts and build** - `5ee7974` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `mcp-server/src/tools/read.ts` - All four read tools: keloia_list_docs, keloia_read_doc (with pagination + path protection), keloia_get_kanban (denormalized board), keloia_get_progress (milestone progress)
- `mcp-server/src/server.ts` - Import and call registerReadTools(server); write tools comment updated for Phase 5

## Decisions Made
- Used `type: "text" as const` on all content array items — TypeScript literal type narrowing requires this without explicit return type annotation
- Inline `as { field: type }` assertions on JSON.parse results — avoids Zod double-parsing internal data files with known schemas
- Pretty-printed JSON with `null, 2` — readability aids debugging when Claude displays tool results

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Developer must run `npm run build` in `mcp-server/` before Claude Code picks up tool changes (established in Phase 3).

## Next Phase Readiness

- All four read tools live on the MCP server; Claude Code will see them after `npm run build` + MCP reconnect
- Phase 5 (write tools) can now import from the established `registerReadTools` pattern
- server.ts has a placeholder comment `// Write tools registered in Phase 5`

---
*Phase: 04-read-tools*
*Completed: 2026-02-22*
