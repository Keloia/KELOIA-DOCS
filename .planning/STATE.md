# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.
**Current focus:** Milestone v1.1 — MCP Server (Phase 3: MCP Foundation)

## Current Position

Phase: 4 — Read Tools
Plan: 1 of 1 complete
Status: Phase 4 complete — Four keloia_ read tools implemented and registered with MCP server
Last activity: 2026-02-22 — Four read tools implemented in read.ts, wired into server.ts (Plan 01)

Progress: [██████░░░░] 67% (2/3 v1.1 phases complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: ~4 min
- Total execution time: ~21 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-data-layer | 1 | 2 min | 2 min |
| 02-static-site | 2 | ~12 min | ~6 min |
| 03-mcp-foundation | 2 | ~7 min | ~3.5 min |
| 04-read-tools | 1 | ~5 min | ~5 min |

*Updated after each plan completion*

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

### Pending Todos

- ~~Decide whether to commit `mcp-server/dist/` or gitignore and build locally~~ Resolved: gitignore dist/
- ~~Decide `.mcp.json` scope (project-scoped committed vs local `--scope local`) before starting Phase 3~~ Resolved: committed project-scoped .mcp.json

### Blockers/Concerns

- User must set Pages source to "GitHub Actions" in repository Settings > Pages > Source (v1.0 tech debt)

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 04-read-tools 04-01-PLAN.md — Phase 4 complete
Resume with: `/gsd:execute-phase 05-write-tools` (Phase 5: Write Tools)
