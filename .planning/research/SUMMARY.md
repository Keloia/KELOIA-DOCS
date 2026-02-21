# Project Research Summary

**Project:** Keloia Docs + MCP Server
**Domain:** Dual-surface internal tool — static documentation site (human-readable) + local MCP server (AI-readable via Claude Code)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Executive Summary

Keloia Docs is a dual-surface project with a hard zero-build-step constraint. The right approach is to serve the same filesystem as both the human-facing static site (via GitHub Pages) and the AI-facing MCP server (via stdio). There is no sync problem, no duplication, and no cache-invalidation complexity because both consumers read the same files — markdown in `docs/`, JSON in `kanban/` and `progress/`. The recommended stack is vanilla HTML/CSS/JS + marked.js from CDN for the site, and TypeScript + `@modelcontextprotocol/sdk@1.27.0` + Zod v4 for the MCP server. No build step touches the site; a single `tsc` compile step produces the MCP server binary.

The key architectural insight is that the site and MCP server share a filesystem but never talk to each other. The site reads via GitHub Pages HTTP; the MCP server reads and writes via Node.js `fs`. This means the site is always read-only, all mutations go through validated MCP tools, and git history acts as a backup layer. The build order dictated by research is: data schema design first, then static site, then MCP server, then GitHub Actions + Claude Code wiring. Site and MCP server can be built in parallel once data schemas are locked, but serial is safer for a solo developer.

The dominant risks are all implementation-level, not architectural: stdout pollution corrupting the stdio JSON-RPC channel, non-atomic JSON writes that corrupt data files on interrupted writes, and relative path breakage when GitHub Pages serves from a subdirectory. All three are preventable with well-established patterns (console.error-only logging, atomic rename writes, relative fetch paths + base tag). The feature scope is tightly bounded — 7 MCP tools covering read/write of docs, kanban, and progress — and the entire server fits in a single TypeScript file under 200 lines.

## Key Findings

### Recommended Stack

The site layer requires zero build tooling: a single `index.html` shell, `app.js` using `fetch()` and `marked.js` from CDN for runtime markdown rendering, plain `style.css`, and GitHub Pages as the host. marked.js v17.0.3 is the right choice — 7KB gzipped, UMD-loadable via script tag, actively maintained (released 2026-02-17). DOMPurify must accompany marked.js to prevent XSS from embedded HTML in markdown.

The MCP server layer is TypeScript compiled to `dist/` and run by Claude Code via `node dist/index.js`. The official SDK handles all JSON-RPC plumbing. Zod v4 provides input validation for all write tools. During development, `tsx` enables running TypeScript directly without a compile step, but production must use compiled output.

**Core technologies:**
- Vanilla HTML/CSS/JS: Site shell — zero build step, push to main = deployed
- marked.js v17.0.3 (CDN): Browser-side markdown rendering — no npm install, UMD global
- DOMPurify (CDN): XSS sanitization — required alongside marked.js before any markdown rendering ships
- GitHub Pages: Static hosting — serves repo root as static files, zero config
- Node.js 24.x LTS: MCP server runtime — Active LTS through April 2028
- TypeScript 5.9.3: Type-safe server authoring — compiles away, zero runtime cost
- @modelcontextprotocol/sdk 1.27.0: MCP protocol — official Anthropic SDK, only game in town
- Zod v4 (4.3.6): Input validation on all write tools — required peer of the SDK, use v4 for new projects
- tsx: Dev-time TypeScript runner — replaces ts-node for Node 20+, dev script only

**What to avoid:** React/Astro/Vite/Docusaurus (build step), Tailwind (PostCSS build), ts-node (broken with ESM in Node 20+), console.log in MCP server (corrupts stdio), TypeScript 6.0 beta (pre-release), dotenv (v17+ prints to stdout), SSE transport (deprecated in Claude Code).

### Expected Features

The MVP is tightly scoped: 7 MCP tools and 3 site views. Everything is P1 — there are no optional items at launch. The differentiator is integration: no existing tool combines docs reading, kanban write operations, and a human-readable static site in one repo with files as the only storage layer.

**Must have (table stakes):**
- `list_docs` + `read_doc` MCP tools — without these, Claude Code cannot access project docs
- `get_kanban` with column/label/assignee filters — read before write; filter as optional params on one tool
- `add_task` + `move_task` MCP tools — write capability is the core AI value proposition
- `get_progress` + `update_progress` MCP tools — milestone tracking is an explicit requirement
- Zod validation on all write tools — corrupted JSON breaks both surfaces; not optional
- Static site: markdown rendering from `docs/` with sidebar nav — human-readable surface
- Static site: kanban board view from `board.json` — visual columns with cards, not raw JSON
- Static site: progress tracker view from `tracker.json` — progress bars, not raw numbers
- GitHub Actions deployment workflow — push-to-deploy is the zero-friction contract
- Proper MCP error responses (`isError: true`) — spec-compliant error signaling

**Should have (add after launch validation):**
- `docs://` MCP resource template — when a second MCP client needs resource access
- Structured `outputSchema` on read tools — when Claude Code shows schema confusion
- Human-readable card styling with labels/assignees/status colors — when plain titles feel insufficient

**Defer to v2+:**
- Full-text search — add only when doc count exceeds 20
- Milestone history / trend display — when retrospective data is needed
- Remote MCP HTTP transport — only when team usage or remote access is required
- Polling-based site refresh — if manual reload becomes friction in daily use

**Anti-features to reject explicitly:** GitHub Issues sync (external API dependency, breaks offline model), authentication on site (contradicts zero-build), CSS frameworks (Tailwind = build step), SQLite (requires runtime process), remote MCP transport in v1 (auth + infrastructure overhead), testing framework (7 tools under 20 lines each — test by using).

### Architecture Approach

The architecture is single-repo, shared filesystem, two independent consumers. Data files (`docs/*.md`, `kanban/board.json`, `progress/tracker.json`) sit at repo root. The site lives in `site/` and reads files via `fetch()` over the same GitHub Pages origin. The MCP server lives in `mcp-server/` and reads/writes files via Node.js `fs`. They share data only through the filesystem — no runtime coupling, no HTTP calls between them, no shared cache.

**Major components:**
1. `docs/`, `kanban/board.json`, `progress/tracker.json` — authoritative data layer; everything else derives from these
2. `site/index.html` + `site/app.js` + `site/style.css` — zero-build SPA; hash-based routing, runtime fetch, marked.js rendering
3. `mcp-server/src/index.ts` — single-file TypeScript MCP server; all 7 tools inline; compiled to `mcp-server/dist/index.js`
4. `.github/workflows/deploy.yml` — GitHub Actions; push to main triggers Pages deployment
5. `.mcp.json` at repo root — project-scoped Claude Code MCP config; points to `node mcp-server/dist/index.js` with absolute path

**Critical path resolution pattern** (must use in MCP server from day one):
```typescript
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = resolve(PROJECT_ROOT, 'docs');
const KANBAN_FILE = resolve(PROJECT_ROOT, 'kanban', 'board.json');
```

**Atomic write pattern** (must use for all JSON writes):
```typescript
function atomicWriteJSON(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, filePath);
}
```

### Critical Pitfalls

1. **stdout pollution kills stdio transport** — Any `console.log()` in the MCP server corrupts the JSON-RPC channel. Use `console.error()` exclusively. Enforce with a grep check in the build. This is the most common MCP server failure mode and causes silent connection loss.

2. **Non-atomic JSON writes corrupt data files** — `fs.writeFileSync()` is not atomic. A crash during a write produces a truncated JSON file that breaks all subsequent tool calls. Use write-to-temp-then-rename from day one on all three write tools (`add_task`, `move_task`, `update_progress`).

3. **MCP server path resolution breaks on CWD mismatch** — Claude Code launches the MCP server from an arbitrary working directory. `process.cwd()` is unreliable. All file paths must be derived from `__dirname` / `import.meta.url`. Hardcoded absolute paths break on any other machine.

4. **Relative path breakage on GitHub Pages subdirectory** — Project repos are served from `username.github.io/repo-name/`, not `/`. Absolute `fetch('/kanban/board.json')` calls return 404 on deployed site. Use relative paths throughout and set `<base href="/keloia-docs/">` in `index.html`. Test on the deployed URL before building out the site.

5. **Poor tool descriptions cause Claude to misuse tools** — Empirical research across 856 MCP tools shows description quality directly predicts agent accuracy. Treat descriptions as a primary deliverable: lead with what the tool does for the user, describe when to call it, list accepted parameter values explicitly. Test each tool by asking Claude to use it without a prompt hint.

6. **marked.js XSS via unescaped HTML** — marked.js renders embedded HTML as-is by default. Pipe all output through DOMPurify before `innerHTML` assignment. Wire this up at the same time as marked.js — do not ship markdown rendering without it.

7. **GitHub Pages stale cache** — Pages sets `Cache-Control: max-age=600`. Add `?v=${Date.now()}` to all data `fetch()` calls from the start. Document the 30–120 second propagation delay.

## Implications for Roadmap

Based on research, the architecture dictates a clear build-order dependency chain. The suggested phase structure follows the dependency flow: data layer → site → MCP server → integration wiring.

### Phase 1: Data Layer and Repo Foundation

**Rationale:** Everything downstream — site rendering, MCP tools, GitHub Actions — depends on knowing the exact file paths and JSON schemas. Changing schemas after the site and server are built causes rework in both. Lock schemas first.

**Delivers:** Defined and populated data structures: `docs/` directory with initial markdown files, `kanban/board.json` with column/task schema, `progress/tracker.json` with milestone schema. Repo structure established. GitHub Pages enabled on the repo.

**Addresses:** FEATURES.md data dependencies (all MCP read/write tools assume stable schemas); ARCHITECTURE.md "build data layer first" recommendation.

**Avoids:** Schema rework cascading into site and server; starting site development against undefined data shapes.

**Research flag:** Standard patterns — JSON schema design for a simple kanban board and milestone tracker is well-understood. No additional research needed.

### Phase 2: Static Site Foundation

**Rationale:** Build the human-facing surface against real data files before adding MCP complexity. Verify GitHub Pages serving, relative path behavior, and cache-busting work on the actual deployed URL before writing any MCP code.

**Delivers:** `site/index.html` + `site/app.js` + `site/style.css`. Sidebar with doc list and active link highlighting. Markdown rendering with marked.js + DOMPurify. Kanban board view with visual columns and cards. Progress tracker view with CSS progress bars. Hash-based routing. GitHub Actions deploy workflow. Verified working at the deployed `github.io/keloia-docs/` URL.

**Addresses:** FEATURES.md site table stakes (markdown rendering, sidebar, kanban view, progress view, GitHub Actions deploy); PITFALLS.md Pitfalls 3 (cache-busting on all fetches), 4 (relative paths + base tag), 7 (DOMPurify alongside marked.js).

**Avoids:** Building MCP tools before validating that the shared data files are served correctly by Pages; shipping the site without DOMPurify; absolute path fetch calls.

**Research flag:** Standard patterns — vanilla JS SPA with marked.js, GitHub Actions Pages deploy. Well-documented. No additional research needed.

### Phase 3: MCP Server Foundation

**Rationale:** Establish the server skeleton with correct path resolution, stdio transport, and logging discipline before implementing any tools. Getting these foundational elements wrong causes every tool to fail in non-obvious ways.

**Delivers:** `mcp-server/src/index.ts` with `McpServer` + `StdioServerTransport`. `PROJECT_ROOT` constant derived from `import.meta.url`. Logging using `console.error()` only (zero `console.log` calls). TypeScript + tsconfig + package.json configured. `npm run build` produces `dist/index.js`. `.mcp.json` at repo root pointing to compiled output. MCP server connected and verified in Claude Code (`/mcp` shows "connected"). MCP Inspector used for development iteration.

**Addresses:** PITFALLS.md Pitfalls 1 (stdout pollution prevention), 5 (restart workflow documented), 8 (path resolution from `__dirname`); STACK.md TypeScript configuration and Claude Code integration patterns.

**Avoids:** Implementing tools before the foundation is solid; debugging tool failures that are actually caused by path or logging issues.

**Research flag:** Standard patterns — official MCP SDK TypeScript server tutorial is authoritative. No additional research needed.

### Phase 4: MCP Tools — Read Surface

**Rationale:** Implement read tools before write tools. Read tools are lower risk (no data mutation), validate that path resolution and server communication work end-to-end, and are required by write tools (e.g., `get_kanban` state must be validated before `move_task` can write).

**Delivers:** `list_docs` tool (reads `docs/` directory, returns filenames + titles). `read_doc` tool (reads single markdown file by name). `get_kanban` tool with column/label/assignee filter params. `get_progress` tool. All tools with descriptive names and descriptions written to the "what/when/parameters" standard. All tools returning spec-compliant `{ content: [{ type: "text", text: "..." }] }` responses.

**Addresses:** FEATURES.md P1 read tools; PITFALLS.md Pitfall 6 (tool description quality); FEATURES.md "descriptive tool names and descriptions" table stake.

**Avoids:** Implementing write tools before read tools are validated; vague tool descriptions that cause Claude misuse.

**Research flag:** Standard patterns — all tools follow the same read/return pattern from official SDK docs. No additional research needed.

### Phase 5: MCP Tools — Write Surface

**Rationale:** Write tools depend on read tools being stable and data schemas being locked. Atomic write pattern must be implemented from the start — not retrofitted. This phase completes the MCP surface and enables AI-assisted task management.

**Delivers:** `add_task` tool (appends card to column with Zod validation). `move_task` tool (updates column on existing task with Zod validation). `update_progress` tool (updates milestone percentage/status with Zod validation). Atomic write pattern (`atomicWriteJSON`) used by all three tools. Proper `isError: true` error responses for validation failures, missing tasks, invalid columns.

**Addresses:** FEATURES.md P1 write tools and Zod validation requirement; PITFALLS.md Pitfall 2 (non-atomic writes); ARCHITECTURE.md "write path is MCP-only" and atomic write pattern.

**Avoids:** Non-atomic `writeFileSync` calls; write tools without Zod validation; write tools that corrupt JSON on invalid input.

**Research flag:** Standard patterns — atomic write pattern and Zod validation are well-documented. Security consideration: validate that all resolved file paths start with `PROJECT_ROOT` to prevent path traversal via crafted tool inputs. This is a one-time check, not a research task.

### Phase Ordering Rationale

- Data layer first because schemas are a shared contract between both consumers; changing them after either consumer is built causes rework in both.
- Site before MCP server because the site validates that GitHub Pages serving, relative paths, and the deployed URL work correctly — failures here are easier to debug without MCP complexity added.
- MCP server foundation before tools because foundational issues (stdout, paths, tsconfig) cause every tool to fail in non-obvious ways; the foundation phase isolates these concerns.
- Read tools before write tools because read tools validate the end-to-end communication path at lower risk, and write tools depend on read tool state validation.
- This ordering matches ARCHITECTURE.md's explicit build-order recommendation and is supported by PITFALLS.md's phase-to-pitfall mapping.

### Research Flags

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1** (Data Layer): JSON schema design for kanban + milestones is well-understood; schemas are simple and documented in ARCHITECTURE.md.
- **Phase 2** (Static Site): Vanilla JS SPA + marked.js + GitHub Actions Pages deploy is fully documented in official GitHub docs and MDN.
- **Phase 3** (MCP Foundation): Official MCP TypeScript tutorial covers this exactly; high-confidence official source.
- **Phase 4** (Read Tools): All read tools follow the same pattern from official SDK docs.
- **Phase 5** (Write Tools): Zod validation + atomic write pattern are standard; security path validation is a one-time check with known implementation.

No phases in this project require deeper research before implementation. All technology choices are verified against official documentation at HIGH confidence.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry and official docs as of 2026-02-21. marked.js v17.0.3 released days before research. MCP SDK v1.27.0 is current stable. TypeScript 5.9.3 stable. Node 24 Active LTS confirmed. |
| Features | HIGH (MCP) / MEDIUM (site) | MCP features verified against official spec at modelcontextprotocol.io. Site features from domain knowledge and web search — well-established patterns, lower risk of gaps. |
| Architecture | HIGH | Official MCP architecture docs + official TypeScript SDK reference implementation (filesystem server). Patterns directly applicable to this project. |
| Pitfalls | HIGH | Primary pitfalls verified against official Claude Code docs, MCP SDK GitHub issues, confirmed CVEs, and practitioner post-mortems. Empirical study (856 tools) backs tool description guidance. |

**Overall confidence:** HIGH

### Gaps to Address

- **`schemaVersion` in JSON data files:** Research notes this is acceptable to skip at this scale, but if the schema for `board.json` or `tracker.json` evolves, migrations become guesswork. Add a `schemaVersion: 1` field to both files from the start at negligible cost.
- **MCP SDK v2 timeline:** The SDK GitHub releases note "v2 anticipated Q1 2026" but it has not shipped as of the research date (2026-02-21). If v2 ships during implementation, review breaking changes before upgrading — the current v1.27.0 SDK is stable and should not be upgraded mid-project without review.
- **GitHub Pages base URL:** The exact deployed URL (`github.io/keloia-docs/` or `github.io/`) depends on repo type (project vs. user/org repo). Confirm before writing any `fetch()` paths in the site and set the `<base>` tag accordingly. This is a 5-minute verification, not a research gap.
- **`.mcp.json` scope decision:** PITFALLS.md flags that committing `.mcp.json` with `--scope project` shares the config with collaborators who may run untrusted commands. For a single-developer repo, `--scope local` (stored in `~/.claude.json`, not committed) may be preferable. Decide before the MCP foundation phase.

## Sources

### Primary (HIGH confidence)
- [modelcontextprotocol.io/docs/develop/build-server](https://modelcontextprotocol.io/docs/develop/build-server) — TypeScript MCP server tutorial, McpServer API, StdioServerTransport, tsconfig
- [modelcontextprotocol.io/docs/learn/architecture](https://modelcontextprotocol.io/docs/learn/architecture) — MCP architecture overview, transport types
- [modelcontextprotocol.io/docs/concepts/tools](https://modelcontextprotocol.io/docs/concepts/tools) — MCP Tools specification (Protocol Revision 2025-06-18)
- [modelcontextprotocol.io/docs/concepts/resources](https://modelcontextprotocol.io/docs/concepts/resources) — MCP Resources specification
- [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) — Claude Code MCP integration, `.mcp.json` format, scope options, stdout behavior
- [npmjs.com/package/@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.27.0 confirmed Feb 2026
- [jsdelivr.com/package/npm/marked](https://www.jsdelivr.com/package/npm/marked) — v17.0.3 CDN URLs confirmed
- [zod.dev](https://zod.dev/) — Zod v4 stable, v4.3.6 latest
- [nodejs.org/en/about/previous-releases](https://nodejs.org/en/about/previous-releases) — Node 24.13.1 Active LTS
- [github.com/modelcontextprotocol/servers (filesystem)](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) — Official reference implementation, shared filesystem patterns
- [npmjs.com/package/write-file-atomic](https://www.npmjs.com/package/write-file-atomic) — Atomic write pattern
- [github.com/modelcontextprotocol/typescript-sdk/issues/796](https://github.com/modelcontextprotocol/typescript-sdk/issues/796) — Zod validation edge cases
- [github.com/modelcontextprotocol/servers/issues/2579](https://github.com/modelcontextprotocol/servers/issues/2579) — Confirmed race condition from non-atomic writes

### Secondary (MEDIUM confidence)
- [arxiv.org/html/2602.14878v1](https://arxiv.org/html/2602.14878v1) — Empirical study of 856 MCP tools; tool description quality predicts agent accuracy
- [visor.us/blog/lessons-learned-developing-visors-mcp-server](https://www.visor.us/blog/lessons-learned-developing-visors-mcp-server/) — Tool proliferation, session restart, Zod friction practitioner notes
- [steipete.me/posts/2025/mcp-best-practices](https://steipete.me/posts/2025/mcp-best-practices) — stdout logging, source vs compiled code practitioner notes
- [aihero.dev/mcp-server-from-a-single-typescript-file](https://www.aihero.dev/mcp-server-from-a-single-typescript-file) — Single-file server pattern, verified against official docs
- [github.com/eyalzh/kanban-mcp](https://github.com/eyalzh/kanban-mcp) — Kanban MCP reference implementation; confirms feasibility, differs in storage (SQLite vs. JSON)
- [npmjs.com/package/typescript](https://www.npmjs.com/package/typescript) — v5.9.3 latest stable confirmed

### Tertiary (LOW confidence / needs validation during implementation)
- [thesecmaster.com/blog/how-to-fix-cve-2025-24981](https://thesecmaster.com/blog/how-to-fix-cve-2025-24981-mitigating-xss-vulnerability-in-markdown-library-for-we) — CVE-2025-24981 in markdown URL parsing; confirms DOMPurify is warranted

---
*Research completed: 2026-02-21*
*Ready for roadmap: yes*
