# Project Research Summary

**Project:** Keloia Docs — MCP Server (v1.1)
**Domain:** stdio MCP server exposing filesystem-backed project data (docs, kanban, progress) to Claude Code
**Researched:** 2026-02-22
**Confidence:** HIGH — all four research files verified against official MCP spec, official TypeScript SDK, official Anthropic docs, and live repo data files

## Executive Summary

The keloia-docs project adds an MCP server to an already-built static site (vanilla JS SPA, GitHub Pages, split-file JSON data layer). The MCP server's sole purpose is to give Claude Code structured, domain-specific access to project data that already exists on disk — docs in `data/docs/`, kanban tasks in `data/kanban/`, and milestones in `data/progress/`. This is a well-understood problem class: a local stdio MCP server, TypeScript, single developer, no concurrency, no authentication, no external services. The official Anthropic TypeScript SDK covers the entire protocol layer. The implementation surface is approximately 200 lines of TypeScript across 7 tools.

The recommended approach is to build the server in strict dependency order: server skeleton and toolchain first, then path resolution, then read tools (idempotent, safe to test against live data), then write tools (filesystem-mutating). Every write tool must use the atomic write pattern (write to `.tmp` in the same directory, then `renameSync` to target) and Zod validation before any filesystem operation. Tool naming must be domain-namespaced (e.g. `keloia_list_docs` not `list_docs`) to avoid collisions with Claude Code built-ins that break sub-agent functionality. Tool descriptions must be action-first, precise, and LLM-oriented.

The primary risks are all avoidable with known patterns: stdout pollution corrupting the JSON-RPC channel (use `console.error()` everywhere), non-atomic writes corrupting split-file JSON (use tmp-rename in same directory), ESM/CommonJS mismatch breaking compilation (set `"type": "module"` and `Node16` module resolution from the start), Zod v4 incompatibility with MCP SDK v1.x (pin `zod@^3.25.0`), and path resolution breaking when Claude Code launches the server from a different working directory (derive all paths from `import.meta.url`, never from `process.cwd()`). None of these risks require novel solutions — all have documented, tested prevention patterns.

## Key Findings

### Recommended Stack

The site layer is already built and requires no changes. The MCP server layer adds a TypeScript project in `mcp-server/` with three runtime dependencies: `@modelcontextprotocol/sdk@^1.27.0` (official Anthropic SDK, v1.x stable, 26,000+ downstream projects), `zod@^3.25.0` (input validation, pinned to avoid v4 breaking changes with MCP SDK internals), and Node.js built-in `fs` and `path` modules (no additional packages needed for atomic writes). Development dependencies are `typescript@^5.9.3`, `tsx@^4.7.0` (dev runner, replaces broken `ts-node` on Node 20+), and `@types/node`. The tsconfig must use `"module": "Node16"` and `"moduleResolution": "Node16"` — this is what the official MCP quickstart specifies and it resolves the SDK's `.js` extension imports correctly.

**Core technologies:**
- `@modelcontextprotocol/sdk@^1.27.0`: MCP protocol implementation — official Anthropic SDK; provides `McpServer`, `StdioServerTransport`, tool registration, and all JSON-RPC plumbing
- `zod@^3.25.0`: Input validation on write tools — required peer dependency of MCP SDK; pin v3 until SDK officially supports v4
- `TypeScript@^5.9.3`: Type-safe server authoring — compiles away at runtime; use `tsx` for dev iteration, `tsc` for production output
- Node.js 20+ built-ins (`fs`, `path`, `crypto`): Filesystem I/O and atomic writes — no additional npm packages needed
- GitHub Pages + vanilla JS (existing): Static site hosting — zero changes required for MCP milestone

**What to avoid:** `ts-node` (broken with ESM in Node 20+), `console.log()` in MCP server (corrupts stdio transport), TypeScript 6.0 beta (pre-release), `dotenv` in MCP server (v17+ may print to stdout), SSE transport (deprecated in Claude Code), `"type": "commonjs"` in package.json (MCP SDK is ESM-only), `"moduleResolution": "bundler"` (doesn't resolve SDK's `.js` extension imports), relative paths in `.mcp.json` args (break when Claude Code spawns from arbitrary CWD).

### Expected Features

The MCP server must implement 7 tools. These are all table stakes — missing any one makes the server materially less useful to Claude Code. The read tools (`list_docs`, `read_doc`, `get_kanban`, `get_progress`) are purely additive and safe to build first. The write tools (`add_task`, `move_task`, `update_progress`) mutate the data layer and must include Zod validation and atomic writes before being considered done.

**Must have (table stakes — v1.1 launch):**
- `keloia_list_docs` — LLM cannot discover docs without a catalog; prerequisite for `read_doc`
- `keloia_read_doc` — core reason to expose docs via MCP; slug-validated, clear error on unknown slug
- `keloia_get_kanban` — denormalized full board state (columns + all task objects) in one call
- `keloia_get_progress` — denormalized milestone list with status, task counts, and notes
- `keloia_add_task` with Zod validation — write capability; LLM captures new work during conversations
- `keloia_move_task` with column validation — fundamental kanban workflow action
- `keloia_update_progress` with Zod validation — milestone tracking that would go stale without write access
- Atomic write pattern on all write tools — data integrity is non-negotiable; site renders this data
- `isError: true` error handling on all tool failures — MCP spec requires it; confuses LLM if omitted
- `.mcp.json` project-scope config — server is never loaded without this file at repo root

**Should have (add after validation — v1.x):**
- Column and assignee filters on `keloia_get_kanban` — add when board grows beyond ~10 tasks
- Computed `percentComplete` on `keloia_get_progress` — add when LLM is observed computing this manually
- Human-readable validation error messages listing valid column names — enables LLM self-correction
- Schema version assertion on reads — add when a real schema migration creates the risk

**Defer (v2+):**
- HTTP/SSE transport — add when remote Claude access is needed; project explicitly defers this
- `search_docs` — add when doc count exceeds 20 (project threshold)
- `create_doc` / `update_doc` write tools — docs are human-owned content; MCP server is read-only for docs

**Anti-features to reject explicitly:** Generic `read_file`/`write_file` passthrough (LLM constructs arbitrary paths, bypasses validation), `delete_task` (hard to recover on a filesystem with no undo; move to Done instead), caching/in-memory state (reads are always fresh off disk; no staleness problem), batch write tools (atomicity complexity multiplies with partial batch failure).

### Architecture Approach

The architecture is a dual-consumer single-repo pattern: the static SPA reads `data/` via HTTP `fetch()` at runtime, and the MCP server reads/writes `data/` via Node.js `fs` synchronously. Both consumers share the same filesystem files with no runtime coupling, no network dependency between them, and no caching layer. The MCP server lives in `mcp-server/` (isolated TypeScript subdirectory), compiles to `mcp-server/dist/`, and is registered with Claude Code via `.mcp.json` at the repo root. The server implementation is a single file (`src/index.ts`, ~200 lines) with five core architectural patterns: import.meta.url path resolution, split-file index read (never directory scan), atomic write via tmp+rename, Zod validation before write, and action-first tool descriptions.

**Major components:**
1. `mcp-server/src/index.ts` — server entry: McpServer init, StdioTransport, path constants derived from `import.meta.url`, all 7 tool registrations
2. `data/` (existing) — single source of truth: `docs/`, `kanban/`, `progress/` each with `index.json` + entity files
3. `.mcp.json` (new, at repo root) — Claude Code project-scope MCP registration; prerequisite for all tools
4. `mcp-server/dist/index.js` — compiled output that Claude Code spawns as a child process via `node`
5. Static site (existing, no changes) — reads same `data/` files via GitHub Pages HTTP; unaffected by MCP milestone

**Build order within the milestone** (from ARCHITECTURE.md):
1. Server foundation (package.json, tsconfig.json, skeleton index.ts, verify build + start)
2. Path resolution layer (REPO_ROOT constant, verify paths log correctly to stderr)
3. Read tools (list_docs, read_doc, get_kanban, get_progress — idempotent, safe to test first)
4. Write tools (add_task, move_task, update_progress — atomic writes only after reads verified)
5. Claude Code integration (.mcp.json, verify all tools appear in `/mcp`)

### Critical Pitfalls

1. **stdout pollution kills stdio transport** — Any `console.log()` in the MCP server corrupts the JSON-RPC channel. Use `console.error()` exclusively. Verify with `grep -r "console.log" mcp-server/src/` returning zero results before connecting to Claude Code.

2. **Non-atomic JSON writes corrupt per-entity files** — `writeFileSync(path, content)` directly leaves a corruption window on crash. Always write to `filePath + '.tmp.' + process.pid` (same directory as target, not `/tmp` — different filesystem causes `EXDEV` error) then `renameSync` to the target.

3. **Path resolution breaks when Claude Code's CWD differs from repo root** — `process.cwd()` returns wherever Claude Code was launched from. Derive all data paths from `import.meta.url`: `join(dirname(fileURLToPath(import.meta.url)), "..", "..")` navigates from `mcp-server/dist/index.js` to the repo root. Establish path constants before implementing any file-reading tools.

4. **Tool name collision breaks Claude Code sub-agents** — Generic names like `read_file` or `list_tasks` collide with Claude Code built-ins, causing `tools: Tool names must be unique` (HTTP 400) when sub-agents are spawned. Prefix all tool names with `keloia_`.

5. **Zod v4 breaks MCP SDK v1.x at startup** — `npm install zod` gets v4 by default. MCP SDK v1.x through v1.17.5 fails with `keyValidator.parse is not a function` at startup. Pin `"zod": "^3.25.0"` explicitly in `package.json` before running any install. Verify with `npm ls zod`.

6. **Zod `.transform()` is silently stripped from tool input schemas** — The MCP SDK converts Zod schemas to JSON Schema via `zod-to-json-schema`, which drops `.transform()`. Validation then accepts wrong inputs. Keep tool input schemas free of `.transform()`; put normalization logic inside the tool handler.

7. **Poor tool descriptions cause Claude to misuse or ignore tools** — Empirical research across 856 MCP tools shows description quality directly predicts agent accuracy. Lead descriptions with an imperative verb, state what the tool returns, and note when to call it relative to other tools. Test each tool by asking Claude to use it without a prompt hint.

## Implications for Roadmap

The existing project already has two shipped phases: the static site shell (Phase 01) and the kanban/progress tracker UI (Phase 02). The MCP server is the next milestone (v1.1). Based on research, it decomposes naturally into three sub-phases that must execute in strict dependency order within the milestone.

### Phase 1: MCP Server Foundation

**Rationale:** All 7 tools depend on a compiled, running server with correct path constants, module system, and toolchain configuration. Setting these up first means every pitfall that causes "works in dev, breaks in Claude Code" is resolved before any tool code is written. This is where the highest-density pitfalls concentrate — stdout pollution, ESM/CJS mismatch, Zod version, path resolution, and tool name collisions are all foundation concerns.

**Delivers:** A compilable TypeScript server that starts via `node dist/index.js`, connects to Claude Code via `.mcp.json`, and registers zero tools — but proves the foundation is correct.

**Addresses:** `.mcp.json` project-scope config (FEATURES.md table stakes), server skeleton, path constants, logging discipline

**Avoids:** stdout pollution (Pitfall 1), CWD-relative path breakage (Pitfall 4 from PITFALLS.md), ESM/CJS mismatch (Pitfall 5), Zod v4 incompatibility (Pitfall 6), tool name collisions (Pitfall 9)

**Checklist before moving on:**
- `npm run build` succeeds with zero errors
- `node dist/index.js` starts and exits cleanly on Ctrl+C
- `/mcp` in Claude Code shows server as "connected" (zero tools is fine at this stage)
- `grep -r "console.log" mcp-server/src/` returns zero results
- `npm ls zod` shows `3.x` only
- REPO_ROOT, DOCS_DIR, KANBAN_DIR, PROGRESS_DIR log correct absolute paths to stderr at startup

### Phase 2: Read Tools

**Rationale:** Read tools are idempotent — they cannot corrupt data. Building them before write tools lets you test the data layer integration and tool description quality against live data without risk. Verifying that `keloia_get_kanban` returns the correct denormalized board proves the split-file read pattern and error handling work before adding the complexity of writes.

**Delivers:** `keloia_list_docs`, `keloia_read_doc`, `keloia_get_kanban`, `keloia_get_progress` — Claude Code can read all project data via MCP tools with domain-specific, action-first descriptions.

**Uses:** Split-file read pattern (index.json → entity files, never directory scan), `import.meta.url` path resolution, `isError: true` error handling, slug sanitization (no path traversal in `read_doc`)

**Implements:** Full data layer read integration for all three domains (docs, kanban, progress)

**Avoids:** N+1 read failure modes — per-file try/catch on entity reads so a missing file causes a partial result, not full failure (Pitfall 10 from PITFALLS.md)

**Checklist before moving on:**
- Each tool verified via MCP Inspector before testing in Claude Code
- Delete one task file; confirm `keloia_get_kanban` returns remaining tasks without throwing
- Each tool description verified: Claude selects correct tool without a prompt hint
- `keloia_read_doc` with an unknown slug returns `isError: true` with a clear message

### Phase 3: Write Tools

**Rationale:** Write tools mutate the shared data layer used by both the site and Claude Code. They must only be built after reads are proven correct (correct reads are needed to verify write results). The atomic write pattern and Zod validation must be implemented completely — partially implemented write tools that lack atomicity or validation are worse than no write tools because they can corrupt data silently.

**Delivers:** `keloia_add_task`, `keloia_move_task`, `keloia_update_progress` — Claude Code can update board and progress state as work proceeds during conversations.

**Uses:** Atomic write via tmp+rename (same-directory temp file, `filePath + '.tmp.' + process.pid`), Zod validation before any filesystem operation, live column validation from index.json at call time (not hardcoded), human-readable error messages naming valid column options

**Implements:** Full read-write data layer; enables Claude Code to participate in project management without manual file editing

**Avoids:** Non-atomic `writeFileSync` calls (Pitfall 2), EXDEV cross-filesystem rename (Pitfall 3), Zod `.transform()` in input schemas (Pitfall 7)

**Checklist before moving on:**
- Manually interrupt a write (Ctrl+C mid-operation); verify JSON file remains valid and parseable
- Confirm temp files are created in same directory as target (log path to stderr; confirm not `/tmp`)
- `keloia_add_task` with invalid column returns `isError: true` naming valid column options
- No `.transform()` in any tool input schema (audit all `registerTool()` calls)
- Site re-fetches correctly after each write tool creates or mutates a file

### Phase Ordering Rationale

- Foundation must precede all tools: the TypeScript module system, path resolution, Zod version pinning, and Claude Code registration are correctness prerequisites, not optional polish. Debugging tool failures that are actually foundation issues wastes significant time.
- Reads before writes: reads are safe to test with live data; writes are not. Proving the integration layer works read-only before enabling mutations prevents data corruption during development.
- Write tools are a single phase: atomic write, Zod validation, and column/ID validation are interdependent. Shipping any write tool without all three components would introduce data corruption risk.
- Enhancements (filters, `percentComplete`, schema version assertion) are explicitly deferred to v1.x post-validation — they add no correctness value at launch.

### Research Flags

All phases have standard, well-documented patterns. No phase in this milestone requires a `/gsd:research-phase` before planning. The reasons:

- **Phase 1 (Foundation):** Official MCP quickstart covers this exactly. STACK.md has complete `package.json` and `tsconfig.json`. The patterns are established.
- **Phase 2 (Read Tools):** File read patterns are standard Node.js. Tool registration is documented in ARCHITECTURE.md with working code examples.
- **Phase 3 (Write Tools):** Atomic write pattern is fully documented. Zod validation pattern is fully documented with examples. No novel territory.

One area to keep an eye on during Phase 3 planning: if the task ID generation strategy needs revisiting (sequential `task-NNN` vs UUID), that is a 5-minute decision, not a research task. Sequential is recommended — it produces human-readable file names and is sufficient for single-user use.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry, official SDK repo, and Zod docs as of 2026-02-22. marked.js v17.0.3 released days before research. MCP SDK v1.27.0 is current stable. TypeScript 5.9.3 stable. |
| Features | HIGH | Tool list derived from MCP spec (2025-06-18), official Anthropic filesystem reference server, and official tutorial. Tool descriptions grounded in empirical study of 856 tools. All 7 tools verified against existing data layer schemas from live repo files. |
| Architecture | HIGH | Patterns verified against official SDK docs and live repo data files (`data/kanban/index.json`, `data/kanban/task-001.json`, `data/progress/index.json`, `data/progress/milestone-01.json`, `data/docs/index.json`). Path resolution, split-file read, and atomic write all confirmed working patterns. |
| Pitfalls | HIGH | 11 of 13 pitfalls verified against official SDK GitHub issues, official Claude Code docs, or confirmed CVEs. Two (tool description quality, sub-agent collision) confirmed via community sources and official bug reports. Recovery strategies documented for all pitfalls. |

**Overall confidence:** HIGH

### Gaps to Address

- **Tool name prefix confirmation:** Research recommends `keloia_` prefix. Before implementing, confirm no other MCP servers registered in the developer's Claude Code environment use the same prefix or the same tool names without prefix.
- **`.mcp.json` scope decision:** Research flags a genuine trade-off between project scope (version-controlled, repo-relative path, approval prompt on startup) and local scope (no prompt, machine-specific, not in repo). For a single-developer tool, local scope (`--scope local`) has less friction. Decide before the foundation phase.
- **`dist/` gitignore strategy:** Whether to commit `mcp-server/dist/` or gitignore and build locally. Committing `dist/` ensures Claude Code always has a runnable binary without a manual build step. The trade-off is compiled JS in version history. For a single-developer internal tool, committing `dist/` is pragmatic.
- **MCP SDK v2 timeline:** SDK GitHub releases note "v2 anticipated Q1 2026" but it has not shipped as of the research date (2026-02-22). Do not upgrade mid-project without reviewing breaking changes. v1.27.0 is stable and should be used.

## Sources

### Primary (HIGH confidence)
- [GitHub: modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) — SDK API, Node.js >=20 requirement, v1.x stable status
- [GitHub: typescript-sdk/docs/server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — `McpServer`, `registerTool()`, `StdioServerTransport`, Zod input schema
- [MCP Specification 2025-06-18: Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — tool data types, error handling, two-tier error model
- [Anthropic Reference Filesystem MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) — canonical tool naming, description, and parameter patterns
- [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) — `.mcp.json` project scope, stdio registration, `--scope project` flag, absolute path requirement
- [MCP TypeScript SDK Issue #906](https://github.com/modelcontextprotocol/typescript-sdk/issues/906) — Zod v4 `keyValidator.parse is not a function` breakage confirmed
- [MCP TypeScript SDK Issue #702](https://github.com/modelcontextprotocol/typescript-sdk/issues/702) — Zod `.transform()` silently stripped in JSON Schema conversion confirmed
- [Claude Code Issue #10668](https://github.com/anthropics/claude-code/issues/10668) — sub-agent tool duplication bug; namespaced tool names fix confirmed
- [Node.js ESM docs](https://nodejs.org/api/esm.html) — `import.meta.url` + `fileURLToPath` pattern
- [npmjs.com: @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.27.0 as latest stable, 26,000+ downstream users
- [zod.dev/v4/versioning](https://zod.dev/v4/versioning) — dual subpath versioning, v4 stable since July 2025
- Live repo data files — schemas read directly from `data/kanban/index.json`, `data/kanban/task-001.json`, `data/progress/index.json`, `data/progress/milestone-01.json`, `data/docs/index.json`

### Secondary (MEDIUM confidence)
- [Writing Effective MCP Tools — official tutorial](https://modelcontextprotocol.info/docs/tutorials/writing-effective-tools/) — naming, description structure, parameter design
- [arxiv: MCP Tool Description Quality Study](https://arxiv.org/html/2602.14878v1) — empirical study of 856 tools; tool description quality affects agent accuracy
- [Peter Steinberger: MCP Best Practices](https://steipete.me/posts/2025/mcp-best-practices) — stdout logging, source vs compiled code
- [Visor: Lessons Learned Developing an MCP Server](https://www.visor.us/blog/lessons-learned-developing-visors-mcp-server/) — tool proliferation, session restart, Zod friction
- [write-file-atomic (npm)](https://www.npmjs.com/package/write-file-atomic) — atomic write pattern reference
- [Node.js Issue #19077](https://github.com/nodejs/node/issues/19077) — EXDEV cross-device rename confirmed; temp file must be in same directory as target
- [Claude Code Issue #5963](https://github.com/anthropics/claude-code/issues/5963) — project vs local scope `.mcp.json` behavior
- [MCP Server Naming Conventions](https://zazencodes.com/blog/mcp-server-naming-conventions) — snake_case convention, verb-noun pattern, LLM tokenization rationale

---
*Research completed: 2026-02-22*
*Ready for roadmap: yes*
