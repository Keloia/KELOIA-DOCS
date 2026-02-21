# Architecture Research

**Domain:** Docs site + MCP server (shared filesystem, single repo)
**Researched:** 2026-02-21
**Confidence:** HIGH (official MCP docs verified, patterns confirmed from official TypeScript SDK)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Single Repo (keloia-docs)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────┐   ┌──────────────────────────────┐    │
│  │   Static Site (SPA)  │   │    MCP Server (stdio)        │    │
│  │   site/index.html    │   │    mcp-server/src/index.ts   │    │
│  │   site/app.js        │   │                              │    │
│  │   site/style.css     │   │  McpServer + StdioTransport  │    │
│  │                      │   │  Tools: read, write, query   │    │
│  │  fetch() at runtime  │   │  Resources: docs listing     │    │
│  └──────────┬───────────┘   └──────────────┬───────────────┘    │
│             │                               │                    │
│             │ reads files via              │ reads/writes       │
│             │ HTTP (GH Pages)              │ filesystem (local) │
│             ↓                               ↓                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Shared Data Layer (filesystem)           │   │
│  │                                                           │   │
│  │  docs/           kanban/           progress/             │   │
│  │  *.md files      board.json        tracker.json          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│                     GitHub (hosting + storage)                    │
│   GitHub Pages (serves site/ + data files as static HTTP)       │
│   GitHub Actions (deploys on push to main)                       │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `docs/*.md` | Authoritative content — documentation text, diagrams | Plain markdown files, hand-edited |
| `kanban/board.json` | Authoritative task state — columns, tasks, labels | JSON file, written by MCP tools or hand-edited |
| `progress/tracker.json` | Authoritative milestone state — milestones, progress | JSON file, written by MCP tools or hand-edited |
| `site/index.html` | SPA shell — nav, layout, container elements | Single HTML file, no build step |
| `site/app.js` | Runtime renderer — fetches data, renders markdown, manages routing | Vanilla JS, uses marked.js from CDN |
| `site/style.css` | Visual styling — sidebar, kanban board, progress bars | Plain CSS, no preprocessor |
| `mcp-server/src/index.ts` | MCP server entry point — registers tools, connects transport | TypeScript, compiled to `build/index.js` |
| `mcp-server/src/tools/` | Tool handlers — one file per domain (docs, kanban, progress) | TypeScript functions, Zod schemas |

## Recommended Project Structure

```
keloia-docs/
├── docs/                    # Markdown content (primary source of truth)
│   ├── architecture.md      # Drop existing docs here
│   ├── value-proposition.md
│   └── *.md
├── kanban/                  # Kanban state (JSON source of truth)
│   └── board.json           # { columns: [...], tasks: [...] }
├── progress/                # Milestone state (JSON source of truth)
│   └── tracker.json         # { milestones: [...] }
├── site/                    # Static SPA (no build step)
│   ├── index.html           # Shell: nav structure, link to CDN scripts
│   ├── app.js               # Router, fetch, marked.js rendering
│   └── style.css            # Styles
├── mcp-server/              # MCP server (TypeScript, compiled)
│   ├── src/
│   │   └── index.ts         # ~150 lines: McpServer + all 7 tools
│   ├── build/               # Compiled output (gitignored or committed)
│   │   └── index.js
│   ├── package.json
│   └── tsconfig.json
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions: push to main → deploy Pages
└── .planning/               # Project planning (not served)
    └── ...
```

### Structure Rationale

- **`docs/`, `kanban/`, `progress/`:** Kept at repo root so GitHub Pages serves them under the same origin as `site/`, enabling plain `fetch('../docs/foo.md')` with no CORS issues.
- **`site/`:** Isolated from data directories. GitHub Pages root is the repo root, so `site/` is accessible at `/site/`. Alternatively, configure Pages to serve from repo root and use relative paths.
- **`mcp-server/src/index.ts`:** Single-file server matches the project's "no abstraction layers" constraint. 7 tools, each under 20 lines, all in one file is the right call at this scale.
- **`build/`:** Compiled JS needed to run via `node build/index.js`. Either commit it (simpler for local Claude Code use) or generate on first run.

## Architectural Patterns

### Pattern 1: Shared Filesystem as Single Source of Truth

**What:** Both the site and MCP server read the same files — markdown in `docs/`, JSON in `kanban/` and `progress/`. No sync, no duplication, no cache invalidation problem.

**When to use:** Any time two consumers (human UI + AI tooling) need access to the same data and you want edits to be immediately visible to both.

**Trade-offs:** Pro — zero latency between edit and visibility. Con — no schema enforcement on disk (JSON can be malformed). Mitigation: Zod validation in MCP tools before writes.

**Example:**
```typescript
// MCP tool reads the same file the site fetches
import { readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "../../");

function readBoard() {
  const raw = readFileSync(join(REPO_ROOT, "kanban/board.json"), "utf-8");
  return JSON.parse(raw);
}
```

### Pattern 2: Single-File MCP Server with Inline Tools

**What:** All 7 tools defined in `mcp-server/src/index.ts`. No separate tool files, no abstraction layers. Register tools directly on `McpServer` using `server.tool()` with Zod schemas.

**When to use:** Fewer than ~10 tools with handlers under 30 lines each. This project qualifies.

**Trade-offs:** Pro — trivial to understand entire server in one read. Con — file grows if tools expand. Split into `tools/` subdirectory if file exceeds ~300 lines.

**Example:**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "fs";

const server = new McpServer({ name: "keloia-docs", version: "1.0.0" });

server.tool(
  "list_docs",
  {},  // no input params needed
  async () => {
    const files = readdirSync(DOCS_DIR).filter(f => f.endsWith(".md"));
    return { content: [{ type: "text", text: files.join("\n") }] };
  }
);

// ... more tools

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Pattern 3: Runtime-Fetching SPA (No Build Step)

**What:** `index.html` loads `app.js` as a module. `app.js` uses `fetch()` to load markdown or JSON at runtime, parses markdown with `marked.js` from CDN, and injects rendered HTML into the DOM. URL hash (`#`) drives routing — no server-side routing needed.

**When to use:** Docs/dashboard sites where content is read-mostly, users are few, and zero-friction deployment outweighs SSR/SEO needs.

**Trade-offs:** Pro — push to main = live, no npm, no bundler, no pipeline. Con — no SEO (single HTML shell), first paint requires two round trips (HTML + data file). Acceptable for a 1-2 user internal tool.

**Example:**
```javascript
// app.js — hash-based router
window.addEventListener("hashchange", render);
window.addEventListener("load", render);

async function render() {
  const hash = location.hash.slice(1) || "docs/architecture";
  if (hash.startsWith("docs/")) {
    const res = await fetch(`../${hash}.md`);
    const md = await res.text();
    document.getElementById("content").innerHTML = marked.parse(md);
  } else if (hash === "kanban") {
    const res = await fetch("../kanban/board.json");
    const board = await res.json();
    renderKanban(board);
  }
}
```

## Data Flow

### Human Reading Docs

```
Browser loads site/index.html (GitHub Pages)
    ↓
app.js runs, reads URL hash
    ↓
fetch("../docs/architecture.md")  [same GitHub Pages origin]
    ↓
marked.parse(rawMarkdown)
    ↓
innerHTML = rendered HTML
```

### Claude Code Reading Docs

```
Claude Code spawns: node mcp-server/build/index.js
    ↓
StdioServerTransport: JSON-RPC over stdin/stdout
    ↓
Claude calls: tools/call { name: "read_doc", arguments: { path: "architecture" } }
    ↓
MCP tool: readFileSync("docs/architecture.md")
    ↓
Returns: { content: [{ type: "text", text: "..." }] }
    ↓
Claude receives markdown content in context window
```

### Claude Code Writing Kanban Task

```
Claude calls: tools/call { name: "add_task", arguments: { title: "...", column: "todo" } }
    ↓
MCP tool: reads kanban/board.json
    ↓
Zod validates input, appends task object
    ↓
writeFileSync("kanban/board.json", JSON.stringify(board, null, 2))
    ↓
Returns: { content: [{ type: "text", text: "Task added: ..." }] }
    ↓
Next time site fetches kanban/board.json → sees new task
```

### Key Data Flow Properties

1. **Write path is MCP-only.** The site is read-only. Writes go through MCP tools that validate with Zod before touching disk.
2. **Read path is parallel.** Site and MCP server both read files independently. No shared process, no shared cache.
3. **No network calls between site and MCP server.** They share a filesystem, not a network. The site never talks to the MCP server.
4. **Consistency is eventual (seconds, not milliseconds).** A task added via MCP becomes visible in the site on the next `fetch()` call — which happens on page load or navigation. No polling needed for this use case.

## Component Boundaries

| Boundary | Communication Method | Notes |
|----------|---------------------|-------|
| Site ↔ Data files | HTTP GET (GitHub Pages serving static files) | Read-only from site's perspective |
| MCP server ↔ Data files | Node.js `fs` module (local filesystem) | Read and write |
| Claude Code ↔ MCP server | JSON-RPC 2.0 over stdio | MCP protocol, spawned as child process |
| GitHub Actions ↔ GitHub Pages | Git push triggers deploy | Automatic on push to main |
| Human editor ↔ Data files | Direct file edit in repo | Markdown/JSON editable in any editor or GitHub UI |

**What does NOT communicate with what:**
- The site has no knowledge of the MCP server. They share data only through the filesystem.
- The MCP server has no HTTP endpoint. It only accepts stdio connections.
- GitHub Pages serves everything statically — no server-side logic.

## Build Order Implications

Dependencies flow in this order — build lower layers before upper layers:

```
1. Data schema design (docs/, kanban/board.json, progress/tracker.json)
       ↓
2. Static site (site/) — depends on knowing data file paths/format
       ↓
3. MCP server tools (mcp-server/) — depends on same data file paths/format
       ↓
4. GitHub Actions workflow — depends on site working correctly
       ↓
5. Claude Code integration (.claude/ config) — depends on MCP server compiling
```

**Recommended build order for roadmap phases:**

1. **Data layer first** — Define and create the JSON schemas for `board.json` and `tracker.json`. Establish the `docs/` directory structure. Everything downstream depends on these formats being stable.
2. **Static site second** — Build the SPA against real data files. Verify GitHub Pages serving works before adding MCP complexity.
3. **MCP server third** — Build tools against the same files the site reads. By this point, schemas are validated and files exist.
4. **Wiring and integration fourth** — GitHub Actions deploy + Claude Code config + end-to-end testing of both consumers reading the same data.

The site and MCP server can be built in parallel once data schemas are locked, but serial is safer for a solo developer.

## Anti-Patterns

### Anti-Pattern 1: Syncing Data Between Site and Server

**What people do:** Build an MCP server that serves an HTTP API, and have the site call that API instead of reading files directly.

**Why it's wrong:** Adds a runtime dependency (MCP server must be running for site to work), destroys the "push to main = live" property, and requires hosting beyond GitHub Pages.

**Do this instead:** Both consumers read the same files. Site reads via GitHub Pages HTTP. MCP server reads via Node.js fs. No runtime coupling.

### Anti-Pattern 2: Console.log in stdio MCP Server

**What people do:** Use `console.log()` for debugging in a stdio-transport MCP server.

**Why it's wrong:** `console.log()` writes to stdout. The MCP protocol uses stdout to transmit JSON-RPC messages. Any non-JSON bytes in stdout corrupt the protocol stream and break the connection silently.

**Do this instead:** Use `console.error()` exclusively for all logging. It writes to stderr, which Claude Code and other hosts display separately without interfering with the protocol.

### Anti-Pattern 3: Absolute Paths Hardcoded in MCP Server

**What people do:** Hardcode `/Users/enjat/Github/keloia/keloia-docs/docs/` as the docs path.

**Why it's wrong:** Server breaks immediately when run from any other machine or directory.

**Do this instead:** Derive repo root from `__dirname` (or `import.meta.url` in ESM):
```typescript
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../");  // mcp-server/build/ → repo root
```

### Anti-Pattern 4: Framework Creep in the Site

**What people do:** Start with vanilla JS, then add marked.js, then a CSS framework "just for the sidebar", then decide to switch to Astro for better DX.

**Why it's wrong:** Any build step breaks the zero-friction deploy. The constraint is the value.

**Do this instead:** Treat the no-build-step constraint as a hard wall. If complexity grows beyond what vanilla JS handles well, re-evaluate the constraint explicitly rather than eroding it incrementally.

## Scaling Considerations

This is a 1-2 user internal tool. Scaling is not a concern. These notes exist only for completeness.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-2 users (current) | No changes. Filesystem is the database. This is the intended operating point. |
| 5-10 users, concurrent edits | Add file locking in MCP write tools. Consider a lock file or optimistic concurrency check before writing JSON. |
| Multi-machine teams | Move to a remote MCP transport (Streamable HTTP) so team members connect to a shared server instead of each running their own. Server already designed for this upgrade. |
| >100 docs | Add a generated index file (`docs/index.json`) listing all docs with titles and summaries, built by a simple script. Site and MCP `list_docs` reads index instead of `fs.readdir`. |

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| GitHub Pages | Static file serving — GitHub serves `site/` and data files directly from repo | Zero config once Pages is enabled for the repo |
| GitHub Actions | Push trigger — workflow runs `npm run build` in `mcp-server/` and optionally commits compiled JS | MCP server needs compilation; site does not |
| Claude Code | stdio spawn — Claude reads `~/.claude/mcp.json` or `.claude/mcp.json` to know how to start the server | Config points to `node mcp-server/build/index.js` with repo root as cwd |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `site/app.js` ↔ `docs/*.md` | `fetch("../docs/name.md")` relative URL | Path assumes site is served from `site/` subdir |
| `site/app.js` ↔ `kanban/board.json` | `fetch("../kanban/board.json")` relative URL | Same origin as site on GitHub Pages |
| `mcp-server` ↔ `docs/` | `fs.readFileSync(join(REPO_ROOT, "docs", name + ".md"))` | Absolute path derived from `__dirname` |
| `mcp-server` ↔ `kanban/board.json` | `fs.readFileSync` / `fs.writeFileSync` | Write tools validate with Zod before writing |
| `mcp-server` ↔ `progress/tracker.json` | Same pattern as kanban | Same pattern as kanban |

## Sources

- [MCP Architecture Overview — modelcontextprotocol.io](https://modelcontextprotocol.io/docs/learn/architecture) — HIGH confidence. Official spec documentation.
- [Build an MCP Server — modelcontextprotocol.io](https://modelcontextprotocol.io/docs/develop/build-server) — HIGH confidence. Official TypeScript example, stdio transport pattern.
- [MCP TypeScript SDK — github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) — HIGH confidence. Official SDK.
- [Single TypeScript file MCP server — aihero.dev](https://www.aihero.dev/mcp-server-from-a-single-typescript-file) — MEDIUM confidence. Verified pattern matches official docs.
- [MCP Filesystem Server reference — github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) — HIGH confidence. Official reference implementation showing shared filesystem patterns.

---
*Architecture research for: Keloia Docs + MCP Server*
*Researched: 2026-02-21*
