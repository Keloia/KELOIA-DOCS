# Phase 3: MCP Foundation - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

TypeScript MCP server skeleton that connects to Claude Code with zero tools — proving the toolchain, module system, path resolution, and logging discipline are correct before any tool code is written. Tools are added in phases 4-5.

</domain>

<decisions>
## Implementation Decisions

### Source organization
- Modular from the start: src/tools/, src/utils/, src/types/ directories created in phase 3 even if mostly empty
- Tools grouped by domain: tools/read.ts (all 4 read tools) and tools/write.ts (all 3 write tools) in phases 4-5
- Transport wiring is a separate module — swapping stdio for HTTP later means changing one import, not refactoring index.ts

### Dev workflow
- tsx for dev (instant TypeScript execution, no build step), tsc for production builds
- Watch mode included: npm run dev:watch for auto-restart on file changes
- npm run dev (tsx), npm run build (tsc), npm run dev:watch (tsx --watch or tsc --watch)

### Claude's Discretion
- Constants location: whether REPO_ROOT, DOCS_DIR, etc. live in a dedicated paths.ts or a broader config.ts — Claude picks what fits
- Entry point style: thin index.ts vs all-in-one — Claude picks based on server complexity
- .mcp.json target: built output (node dist/index.js) vs tsx source — Claude picks based on reliability tradeoffs
- Package scope: separate mcp-server/package.json vs shared root — Claude picks what keeps things clean
- Env var overrides for paths: whether to allow KELOIA_REPO_ROOT override or stick with pure import.meta.url resolution
- Path validation timing: startup validation vs per-tool validation
- .mcp.json command format: relative path vs npx/npm script

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User cares about clean modularity and fast dev iteration; implementation details are Claude's call.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-mcp-foundation*
*Context gathered: 2026-02-22*
