# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.
**Current focus:** Milestone v1.1 — MCP Server (all phases complete; v1.1 milestone fully verified)

## Current Position

Phase: 5 — Write Tools
Plan: 3 of 3 complete
Status: Phase 5 complete — write tools built and verified end-to-end in Claude Code (plan 03); all 7 MCP tools confirmed working
Last activity: 2026-02-22 — Write tools verified in Claude Code, all 7 steps passed (plan 03)

Progress: [██████████] 100% (3/3 v1.1 phases complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 8
- Average duration: ~3.5 min
- Total execution time: ~28 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-data-layer | 1 | 2 min | 2 min |
| 02-static-site | 2 | ~12 min | ~6 min |
| 03-mcp-foundation | 2 | ~7 min | ~3.5 min |
| 04-read-tools | 2 | ~7 min | ~3.5 min |
| 05-write-tools | 3 | ~15 min | ~5 min |

*Updated after each plan completion*
| Phase 05-write-tools P01 | 2 | 2 tasks | 2 files |
| Phase 05-write-tools P03 | ~10 | 2 tasks | 4 files |

## Accumulated Context

### Decisions

- Used @modelcontextprotocol/sdk v1.x (not v2 pre-alpha) — v2 not stable, requires Zod 4 which contradicts requirements
- Separate mcp-server/package.json — repo root is a static site, keeps type:module isolated
- Transport in dedicated transport.ts (MCP-05) — swapping to HTTP means editing one file
- Pure import.meta.url path resolution — no KELOIA_REPO_ROOT env override (single-developer, deterministic)
- Gitignore dist/ — developer runs `npm run build` before Claude Code connection
- Committed .mcp.json to repo (project-scoped) — single-developer, shared config is correct approach
- Used node + mcp-server/dist/index.js in .mcp.json (not npx tsx) — built output more reliable for Claude Code process spawning
- args path in .mcp.json is relative to repo root — Claude Code spawns from project root
- Used type: 'text' as const on content array items — TypeScript literal narrowing requires this without explicit return type annotation
- Inline type assertions on JSON.parse results — full Zod file parsing is overkill for internal data files with known schemas
- Pretty-printed JSON (null, 2) in all tool responses — readability aids Claude debugging
- slug allowlist via index.json prevents path traversal in keloia_read_doc
- README at repo root (not mcp-server/README.md) — covers both static site and MCP server, matches GitHub default display location
- [Phase 05-write-tools]: Write task file first, then update index — ensures index only references files that exist
- [Phase 05-write-tools]: atomicWriteJson uses writeFileSync + renameSync pattern — no partial reads possible under concurrent access
- [Phase 05-write-tools]: notes field uses z.string().nullable().optional() — allows null as distinct valid value vs omission

### Pending Todos

- ~~Decide whether to commit `mcp-server/dist/` or gitignore and build locally~~ Resolved: gitignore dist/
- ~~Decide `.mcp.json` scope (project-scoped committed vs local `--scope local`) before starting Phase 3~~ Resolved: committed project-scoped .mcp.json

### Blockers/Concerns

- User must set Pages source to "GitHub Actions" in repository Settings > Pages > Source (v1.0 tech debt)

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 05-write-tools 05-03-PLAN.md — all 7 MCP tools verified end-to-end in Claude Code; v1.1 milestone complete
Resume with: Next milestone planning (v1.1 complete, all 7 MCP tools implemented, documented, and verified)
