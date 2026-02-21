---
phase: 03-mcp-foundation
plan: 01
subsystem: infra
tags: [mcp, typescript, node16, esm, stdio, @modelcontextprotocol/sdk, zod, tsx]

# Dependency graph
requires:
  - phase: 01-data-layer
    provides: data/ directory structure (docs/, kanban/, progress/) that paths.ts validates at startup
provides:
  - mcp-server/ standalone ESM package with TypeScript toolchain
  - McpServer skeleton with zero-tool stdio transport
  - Path resolution from import.meta.url (REPO_ROOT, DOCS_DIR, KANBAN_DIR, PROGRESS_DIR)
  - Modular source structure ready for tool registration in phases 4-5
affects:
  - 03-02 (MCP-04 .mcp.json registration)
  - 04-read-tools (tool registration in server.ts)
  - 05-write-tools (tool registration in server.ts)

# Tech tracking
tech-stack:
  added:
    - "@modelcontextprotocol/sdk ^1.7.0 (v1.x line, ESM-only)"
    - "zod ^3.25.0"
    - "typescript ^5.7.0"
    - "tsx ^4.19.0 (esbuild-powered, ESM-native dev runner)"
    - "@types/node ^22.0.0"
  patterns:
    - "ESM-only package with type: module"
    - "Node16 moduleResolution — all relative imports require .js extension"
    - "import.meta.url path resolution (never process.cwd())"
    - "console.error-only logging discipline (stdout is JSON-RPC channel)"
    - "Thin entry point (index.ts) with separate factory modules"
    - "Swappable transport layer (transport.ts separate from server.ts)"

key-files:
  created:
    - mcp-server/package.json
    - mcp-server/tsconfig.json
    - mcp-server/.gitignore
    - mcp-server/src/index.ts
    - mcp-server/src/server.ts
    - mcp-server/src/transport.ts
    - mcp-server/src/paths.ts
    - mcp-server/src/tools/read.ts
    - mcp-server/src/tools/write.ts
    - mcp-server/src/utils/.gitkeep
    - mcp-server/src/types/.gitkeep
  modified: []

key-decisions:
  - "Used @modelcontextprotocol/sdk v1.x (not v2 pre-alpha) with zod ^3.25.0 — v2 not stable"
  - "Separate mcp-server/package.json — repo root has no package.json (static site), keeps type:module isolated"
  - "Transport in dedicated transport.ts for MCP-05 swappability — swapping stdio for HTTP means editing one file"
  - "Pure import.meta.url path resolution — no KELOIA_REPO_ROOT env override (single-developer, deterministic)"
  - "Startup path validation with existsSync — warn on stderr, do not exit (non-fatal)"
  - "Gitignore dist/ — build locally before Claude Code registration"

patterns-established:
  - "Pattern: All relative TypeScript imports use .js extension (Node16 ESM requirement)"
  - "Pattern: All diagnostic output via console.error(), never console.log()"
  - "Pattern: Path constants derived from import.meta.url + fileURLToPath, not process.cwd()"
  - "Pattern: Factory function (createServer) for McpServer construction — enables testing later"
  - "Pattern: connectStdio() accepts McpServer — transport is injectable, not hardcoded"

requirements-completed: [MCP-01, MCP-02, MCP-03, MCP-05]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 3 Plan 01: MCP Server Skeleton Summary

**Zero-tool McpServer skeleton with ESM+Node16 toolchain, import.meta.url path resolution, stdio transport, and console.error-only logging discipline — buildable and runnable.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-21T20:21:46Z
- **Completed:** 2026-02-21T20:23:49Z
- **Tasks:** 2
- **Files modified:** 11 created, 0 modified

## Accomplishments
- Standalone mcp-server/ ESM package with all dependencies installed (@modelcontextprotocol/sdk 1.x, zod 3.x, typescript, tsx)
- Four source modules (index.ts, server.ts, transport.ts, paths.ts) with correct Node16 ESM imports
- `npm run build` compiles with zero TypeScript errors producing dist/index.js
- Server starts from repo root and logs correct absolute paths to stderr: REPO_ROOT=/Users/enjat/Github/keloia/keloia-docs

## Task Commits

Each task was committed atomically:

1. **Task 1: Create mcp-server package with TypeScript toolchain** - `91aa3bc` (chore)
2. **Task 2: Create server source modules and build** - `1e81dd7` (feat)

**Plan metadata:** *(final commit below)*

## Files Created/Modified
- `mcp-server/package.json` - Standalone ESM package: type:module, scripts (dev/build/dev:watch/start), deps
- `mcp-server/tsconfig.json` - TypeScript with Node16 moduleResolution, ES2022 target, strict mode
- `mcp-server/.gitignore` - Ignores node_modules/ and dist/
- `mcp-server/src/paths.ts` - REPO_ROOT, DOCS_DIR, KANBAN_DIR, PROGRESS_DIR from import.meta.url + logPaths()
- `mcp-server/src/server.ts` - createServer() factory returning McpServer (zero tools, ready for phases 4-5)
- `mcp-server/src/transport.ts` - connectStdio() accepting McpServer, StdioServerTransport wiring
- `mcp-server/src/index.ts` - Thin entry point: logPaths(), createServer(), connectStdio()
- `mcp-server/src/tools/read.ts` - Placeholder for Phase 4 read tools
- `mcp-server/src/tools/write.ts` - Placeholder for Phase 5 write tools
- `mcp-server/src/utils/.gitkeep` - Preserves utils/ directory
- `mcp-server/src/types/.gitkeep` - Preserves types/ directory

## Decisions Made
- Used @modelcontextprotocol/sdk v1.x (not v2 pre-alpha) — v2 not stable, requires Zod 4 which contradicts requirements
- Separate mcp-server/package.json — repo root is a static site with no package.json
- Transport in dedicated transport.ts module per MCP-05 — swapping to HTTP/SSE means editing one file
- Pure import.meta.url resolution — no KELOIA_REPO_ROOT env override (adds complexity with no Phase 3 benefit)
- Gitignore dist/ — standard practice; developer runs `npm run build` before Claude Code connection

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Build succeeded on first attempt. Path depth math (dirname + ../.. = repo root) was correct as documented in research.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 02 (MCP-04): .mcp.json registration at repo root — server is ready to be registered
- Phase 4 (read tools): server.ts has empty tool registration area, tools/ directory has placeholders
- Phase 5 (write tools): same as phase 4

---
*Phase: 03-mcp-foundation*
*Completed: 2026-02-22*
