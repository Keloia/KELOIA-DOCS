# Architecture Research

**Domain:** MCP server integration with existing filesystem data layer
**Researched:** 2026-02-22
**Confidence:** HIGH (official MCP TypeScript SDK docs verified, data layer schemas confirmed from live files)

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                     Single Repo (keloia-docs)                      │
├───────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────┐   ┌──────────────────────────────────┐   │
│  │   Static Site (SPA)  │   │     MCP Server (stdio)           │   │
│  │   index.html         │   │     mcp-server/src/index.ts      │   │
│  │   app.js             │   │                                  │   │
│  │   style.css          │   │   McpServer + StdioTransport     │   │
│  │                      │   │   Tools: read + write            │   │
│  │   fetch() at runtime │   │   Zod validation on writes       │   │
│  └──────────┬───────────┘   └──────────────┬─────────────────-─┘   │
│             │                               │                       │
│             │ reads via                     │ reads/writes          │
│             │ HTTP (GH Pages)               │ Node.js fs module     │
│             ↓                               ↓                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  Shared Data Layer (data/)                   │   │
│  │                                                              │   │
│  │  data/docs/          data/kanban/        data/progress/      │   │
│  │  index.json          index.json          index.json          │   │
│  │  *.md files          task-NNN.json       milestone-NN.json   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
├───────────────────────────────────────────────────────────────────┤
│                    GitHub (hosting + storage)                       │
│   GitHub Pages (serves repo root as static HTTP)                   │
│   GitHub Actions (deploys on push to main, no build step)         │
└───────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `data/docs/index.json` | Registry of all docs (slug + title pairs) | `{ schemaVersion: 1, docs: [{slug, title}] }` |
| `data/docs/*.md` | Authoritative doc content | Plain markdown, hand-edited or MCP-written |
| `data/kanban/index.json` | Registry of columns + task IDs | `{ schemaVersion: 1, columns: [...], tasks: ["task-001", ...] }` |
| `data/kanban/task-NNN.json` | Individual task entity | `{ id, title, column, description, assignee }` |
| `data/progress/index.json` | Registry of milestone IDs | `{ schemaVersion: 1, milestones: ["milestone-01", ...] }` |
| `data/progress/milestone-NN.json` | Individual milestone entity | `{ id, phase, title, status, tasksTotal, tasksCompleted, notes }` |
| `index.html` / `app.js` / `style.css` | Static SPA shell, runtime renderer | Vanilla HTML/CSS/JS, hash routing, marked.js from CDN |
| `mcp-server/src/index.ts` | MCP server entry — server init, transport, all tool registrations | TypeScript + MCP SDK, compiled to `mcp-server/dist/` |

## Recommended Project Structure

```
keloia-docs/                       # Repo root = GitHub Pages root
├── index.html                     # SPA shell (existing)
├── app.js                         # SPA router + renderers (existing)
├── style.css                      # Styles (existing)
├── data/                          # Single source of truth (existing)
│   ├── docs/
│   │   ├── index.json             # { schemaVersion, docs: [{slug, title}] }
│   │   └── *.md                   # Doc content files
│   ├── kanban/
│   │   ├── index.json             # { schemaVersion, columns, tasks: [ids] }
│   │   └── task-NNN.json          # Per-task entity files
│   └── progress/
│       ├── index.json             # { schemaVersion, milestones: [ids] }
│       └── milestone-NN.json      # Per-milestone entity files
├── mcp-server/                    # NEW: MCP server (isolated, TypeScript)
│   ├── src/
│   │   └── index.ts               # Server init + all tool registrations (~200 lines)
│   ├── dist/                      # Compiled output (gitignored or committed)
│   │   └── index.js               # Entry point Claude Code spawns
│   ├── package.json               # { "type": "module", scripts.build: "tsc" }
│   └── tsconfig.json              # target: ES2022, module: Node16, outDir: dist
├── .mcp.json                      # NEW: Claude Code project-scope MCP config
├── .github/
│   └── workflows/
│       └── deploy.yml             # GitHub Actions (existing, no change needed)
└── .planning/                     # GSD planning files (existing)
    └── ...
```

### Structure Rationale

- **`data/` at repo root:** Existing constraint — GitHub Pages serves the repo root, so `data/` is reachable at `data/docs/index.json` by both the SPA's `fetch()` and the MCP server's `fs` module without any path gymnastics. Do not move this.
- **`mcp-server/` as isolated subdirectory:** Keeps TypeScript toolchain (`node_modules/`, `tsconfig.json`, `package.json`) completely separate from the site. The site has zero dependencies; the server's `npm install` does not affect the site.
- **`mcp-server/src/index.ts` as single file:** 7-8 tools, each under 25 lines. A single file is readable in one pass. Split into `src/tools/` only if the file exceeds ~300 lines.
- **`mcp-server/dist/` as output (not `build/`):** The milestone context specifies `dist/` as the compiled output directory. Use this consistently in `tsconfig.json`, `package.json` scripts, and `.mcp.json`.
- **`.mcp.json` at repo root:** Claude Code looks for `.mcp.json` in the project root for project-scoped MCP registration. This is the correct location.

## Architectural Patterns

### Pattern 1: Path Resolution via import.meta.url

**What:** In an ESM TypeScript server (`"type": "module"` in package.json), `__dirname` does not exist. Use `import.meta.url` to derive the filesystem path of the compiled entry point, then navigate to the repo root.

**When to use:** Every time the server needs to construct an absolute path to a data file. This is the only correct approach for ESM modules.

**Trade-offs:** Two extra lines at the top of the file. No downside for this project. The alternative (`process.cwd()`) depends on which directory the process was spawned from, which is fragile.

**Example:**
```typescript
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// mcp-server/dist/index.js → navigate up two levels to repo root
const REPO_ROOT = join(__dirname, "..", "..");

// Derived data paths — derive once, use everywhere
const DOCS_DIR      = join(REPO_ROOT, "data", "docs");
const KANBAN_DIR    = join(REPO_ROOT, "data", "kanban");
const PROGRESS_DIR  = join(REPO_ROOT, "data", "progress");
```

Note: Node.js 20.11+ supports `import.meta.dirname` directly, eliminating the fileURLToPath step. Using the fileURLToPath approach works on all Node versions and is safer as a default.

### Pattern 2: Split-File Read Pattern (index + entity files)

**What:** The existing data layer uses a split-file pattern. Reading a domain requires two steps: (1) read the index to get the list of entity IDs, (2) read each entity file. The MCP server mirrors this exactly — never reconstruct a flat list by scanning the directory.

**When to use:** All kanban and progress read operations. The index is the authoritative registry; scanning the directory for `task-*.json` files bypasses schema versioning and ordering.

**Trade-offs:** Two filesystem reads per domain fetch instead of one. At 4-20 files, this is imperceptible. The split-file pattern was chosen for the data layer for good reasons (atomic updates, no unbounded growth); the MCP server should honor the same contract.

**Example (reading all kanban tasks):**
```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

function getAllTasks(): Task[] {
  const index = JSON.parse(
    readFileSync(join(KANBAN_DIR, "index.json"), "utf-8")
  ) as KanbanIndex;

  return index.tasks.map(id =>
    JSON.parse(readFileSync(join(KANBAN_DIR, `${id}.json`), "utf-8")) as Task
  );
}
```

### Pattern 3: Atomic Write via Temp File + Rename

**What:** For write tools (`add_task`, `move_task`, `update_progress`), never write directly to the target JSON file. Write to a `.tmp` file first, then use `fs.renameSync()` to atomically replace the original. If the write fails mid-way, the original file is untouched.

**When to use:** Every write to `data/`. On a local filesystem, `renameSync` is atomic. On NTFS/ext4/APFS, a partial write followed by crash leaves the `.tmp` file, not a corrupt JSON file.

**Trade-offs:** One extra file operation per write. No meaningful downside. The alternative (`writeFileSync` directly) leaves a window where the file is half-written if the process is killed.

**Example (adding a task):**
```typescript
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function addTask(input: { title: string; column: string; description?: string; assignee?: string }) {
  // 1. Read index
  const indexPath = join(KANBAN_DIR, "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf-8")) as KanbanIndex;

  // 2. Generate new task ID (next sequential number)
  const nextNum = String(index.tasks.length + 1).padStart(3, "0");
  const taskId = `task-${nextNum}`;

  // 3. Build task object
  const task: Task = {
    id: taskId,
    title: input.title,
    column: input.column,
    description: input.description ?? null,
    assignee: input.assignee ?? null,
  };

  // 4. Write task file atomically
  const taskPath = join(KANBAN_DIR, `${taskId}.json`);
  const taskTmp  = taskPath + ".tmp";
  writeFileSync(taskTmp, JSON.stringify(task, null, 2), "utf-8");
  renameSync(taskTmp, taskPath);

  // 5. Update index atomically
  index.tasks.push(taskId);
  const indexTmp = indexPath + ".tmp";
  writeFileSync(indexTmp, JSON.stringify(index, null, 2), "utf-8");
  renameSync(indexTmp, indexPath);

  return task;
}
```

### Pattern 4: Zod Validation Before Write

**What:** All write tool inputs are validated with a Zod schema before any filesystem operation. `server.registerTool()` (or `server.tool()`) accepts a Zod input schema — use it. Reject invalid inputs with a descriptive error message returned as MCP content, not a thrown exception.

**When to use:** Every write tool. Reading does not require Zod (schemas are for user/AI input validation, not file content validation).

**Trade-offs:** 5-10 extra lines per tool for schema definition. Worth it — prevents corrupt JSON from being written to disk and provides Claude with clear error messages when arguments are wrong.

**Example:**
```typescript
import { z } from "zod";

const AddTaskInput = z.object({
  title:       z.string().min(1).max(200),
  column:      z.enum(["Backlog", "In Progress", "Done"]),
  description: z.string().max(1000).optional(),
  assignee:    z.string().max(100).optional(),
});

server.tool(
  "add_task",
  "Create a new kanban task in the specified column.",
  AddTaskInput.shape,          // MCP SDK accepts zod shape
  async (input) => {
    const parsed = AddTaskInput.safeParse(input);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
        isError: true,
      };
    }
    const task = addTask(parsed.data);
    return {
      content: [{ type: "text", text: `Task created: ${task.id} — ${task.title}` }],
    };
  }
);
```

## Data Flow

### Read Flow: list_docs

```
Claude calls: list_docs {}
    ↓
readFileSync(DOCS_DIR/index.json)
    ↓
Parse JSON → extract docs array [{slug, title}, ...]
    ↓
Return: content[{ type: "text", text: "architecture — Architecture\nvalue-proposition — Value Proposition" }]
```

### Read Flow: read_doc

```
Claude calls: read_doc { slug: "architecture" }
    ↓
Validate: slug must match /^[a-z0-9-]+$/ (no path traversal)
    ↓
readFileSync(DOCS_DIR/{slug}.md)
    ↓
Return: content[{ type: "text", text: "# Architecture\n..." }]
```

### Read Flow: get_kanban

```
Claude calls: get_kanban { column?: "In Progress" }
    ↓
readFileSync(KANBAN_DIR/index.json) → get columns + task IDs
    ↓
For each task ID: readFileSync(KANBAN_DIR/{id}.json)
    ↓
Apply column filter if provided
    ↓
Return: content[{ type: "text", text: JSON.stringify(tasks, null, 2) }]
```

### Write Flow: add_task

```
Claude calls: add_task { title: "...", column: "Backlog", description: "..." }
    ↓
Zod validates input
    ↓
Read KANBAN_DIR/index.json → compute next task ID
    ↓
Write task-NNN.json to .tmp, rename to task-NNN.json (atomic)
    ↓
Append task ID to index.tasks, write index.json to .tmp, rename (atomic)
    ↓
Return: content[{ type: "text", text: "Task created: task-005 — ..." }]
    ↓
Next site fetch sees task-005.json via index.tasks registry
```

### Write Flow: move_task

```
Claude calls: move_task { taskId: "task-003", column: "Done" }
    ↓
Zod validates: taskId matches task-NNN pattern, column is valid
    ↓
Read KANBAN_DIR/{taskId}.json
    ↓
Mutate: task.column = newColumn
    ↓
Write updated task to .tmp, rename (atomic)
    ↓
Return: content[{ type: "text", text: "task-003 moved to Done" }]
```

### Key Data Flow Properties

1. **Read isolation.** Site reads via HTTP (GitHub Pages). MCP server reads via `fs`. No shared process, no cache coherency issue, no locking needed for reads.
2. **Write path is MCP-only.** The site is read-only. All mutations go through Zod-validated MCP tools.
3. **Split-file atomicity.** Entity files (task-NNN.json, milestone-NN.json) are written atomically per entity. The index is updated last. A crash between entity write and index update leaves an orphaned file — harmless (not in registry = not visible). Recovery: re-run the write operation.
4. **No network coupling between site and MCP server.** They communicate exclusively through shared filesystem files.
5. **Eventual consistency is sufficient.** A task written via MCP is visible to the site on the next `fetch()` — which happens on navigation or page load. Zero polling needed.

## Integration Points

### New Files Created by This Milestone

| File | Purpose |
|------|---------|
| `mcp-server/package.json` | npm manifest: `"type": "module"`, build script, deps |
| `mcp-server/tsconfig.json` | TypeScript config: ES2022, Node16, outDir: dist |
| `mcp-server/src/index.ts` | Server entry: server init + all tool registrations |
| `mcp-server/dist/index.js` | Compiled output (gitignored or committed) |
| `.mcp.json` | Claude Code project-scope registration |

### Modified Files

| File | Change |
|------|--------|
| None | The site (`index.html`, `app.js`, `style.css`) is not modified. The data layer (`data/`) is not modified. The MCP server is entirely additive. |

### Data Layer Integration Points

| Data Location | MCP Tool(s) | Operation | Notes |
|---------------|-------------|-----------|-------|
| `data/docs/index.json` | `list_docs` | Read | Returns slug+title pairs |
| `data/docs/{slug}.md` | `read_doc` | Read | Validate slug before path construction |
| `data/kanban/index.json` | `get_kanban`, `add_task` | Read + Write | `add_task` appends to tasks array |
| `data/kanban/task-NNN.json` | `get_kanban`, `add_task`, `move_task` | Read + Write | `move_task` overwrites column field |
| `data/progress/index.json` | `get_progress` | Read | Registry of milestone IDs |
| `data/progress/milestone-NN.json` | `get_progress`, `update_progress` | Read + Write | `update_progress` mutates tasksCompleted/status |

### .mcp.json Configuration

```json
{
  "mcpServers": {
    "keloia-docs": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "cwd": "/absolute/path/to/keloia-docs"
    }
  }
}
```

The `cwd` ensures `REPO_ROOT` derivation via `import.meta.url` anchors correctly to the repo root regardless of where Claude Code was launched from. Claude Code substitutes the project root automatically for `.mcp.json` in the repo root.

### Internal Component Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `app.js` ↔ `data/docs/index.json` | `fetch("data/docs/index.json")` relative URL | Relative from SPA at repo root |
| `app.js` ↔ `data/docs/{slug}.md` | `fetch("data/docs/{slug}.md")` | Same origin as SPA on GitHub Pages |
| `app.js` ↔ `data/kanban/index.json` | `fetch("data/kanban/index.json")` | Fan-out to individual task files |
| `app.js` ↔ `data/progress/index.json` | `fetch("data/progress/index.json")` | Fan-out to individual milestone files |
| `mcp-server` ↔ `data/docs/` | `fs.readFileSync(join(DOCS_DIR, ...))` | Absolute path derived from `import.meta.url` |
| `mcp-server` ↔ `data/kanban/` | `fs.readFileSync` / `fs.writeFileSync` + `renameSync` | Atomic writes for `add_task`, `move_task` |
| `mcp-server` ↔ `data/progress/` | Same pattern as kanban | Atomic writes for `update_progress` |
| Claude Code ↔ MCP server | JSON-RPC 2.0 over stdio | Spawned as child process, `.mcp.json` configures this |

## Build Order for Server Foundation → Read Tools → Write Tools

The MCP server has internal dependency ordering within the milestone. Build in this sequence:

```
Step 1 — Server Foundation
  mcp-server/package.json
  mcp-server/tsconfig.json
  mcp-server/src/index.ts (skeleton: McpServer init, StdioTransport, no tools yet)
  Verify: npm run build compiles, node dist/index.js starts without error

Step 2 — Path Resolution Layer (inside index.ts)
  import.meta.url → REPO_ROOT → DOCS_DIR, KANBAN_DIR, PROGRESS_DIR
  Verify: log paths to stderr at startup, confirm they resolve to actual directories

Step 3 — Read Tools (no filesystem mutations, safe to build first)
  list_docs   — reads data/docs/index.json
  read_doc    — reads data/docs/{slug}.md (add slug sanitization here)
  get_kanban  — reads kanban index + fan-out to task files
  get_progress — reads progress index + fan-out to milestone files
  Verify: each tool via MCP Inspector or direct stdio test

Step 4 — Write Tools (filesystem mutations, build after reads proven correct)
  add_task        — writes new task-NNN.json + updates index.json (atomic)
  move_task       — overwrites task-NNN.json column field (atomic)
  update_progress — overwrites milestone-NN.json fields (atomic)
  Verify: each tool creates/mutates file, site re-fetches correctly

Step 5 — Claude Code Integration
  .mcp.json at repo root
  Verify: Claude Code picks up server, all tools appear in tool list
```

**Why this order:**

- Foundation before tools: tools cannot be registered without a compiled, running server.
- Path resolution before any reads: every tool depends on `REPO_ROOT` being correct. Verify this once; don't debug path issues inside tool handlers.
- Read tools before write tools: reads are idempotent and safe to test against live data. Writes modify disk; only test once read behavior is confirmed correct.
- Write tools last: atomic write pattern (tmp + rename) must be correct before shipping. A bug in write tools corrupts data files used by both the site and MCP server.

## Anti-Patterns

### Anti-Pattern 1: console.log in stdio MCP Server

**What people do:** Use `console.log()` for debugging.

**Why it's wrong:** `console.log()` writes to stdout. The MCP protocol transmits JSON-RPC messages over stdout. Any non-JSON bytes corrupt the stream and break the connection — silently from the developer's perspective.

**Do this instead:** Use `console.error()` exclusively. It writes to stderr, which Claude Code displays in its log without interfering with the protocol. This is the official MCP documentation's primary warning.

### Anti-Pattern 2: Hardcoded Absolute Paths

**What people do:** Write `const DOCS_DIR = "/Users/enjat/Github/keloia/keloia-docs/data/docs"`.

**Why it's wrong:** Breaks immediately on any other machine, any other clone location, or any CI environment.

**Do this instead:** Derive from `import.meta.url`:
```typescript
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS_DIR  = join(REPO_ROOT, "data", "docs");
```
The `..", ".."` navigates from `mcp-server/dist/index.js` up two levels to the repo root. This is the correct depth given the `dist/` output directory.

### Anti-Pattern 3: Directory Scan Instead of Index Read

**What people do:** Use `fs.readdirSync(KANBAN_DIR).filter(f => f.match(/^task-\d+\.json$/))` to discover tasks.

**Why it's wrong:** Bypasses the `index.json` registry. The index controls ordering and is the schema anchor (`schemaVersion`). Directory order is filesystem-defined and not consistent across OSes. Tasks not in the index (e.g., orphans from a failed write) would appear incorrectly.

**Do this instead:** Always read `index.json` first, then use its task/milestone arrays to determine which files to load. Honor the same contract the site uses.

### Anti-Pattern 4: Non-Atomic Write (writeFileSync directly)

**What people do:** `writeFileSync(join(KANBAN_DIR, "index.json"), newContent)` directly.

**Why it's wrong:** If the process is killed between the file being truncated and the write completing, the JSON file is left in a corrupt state. Both the site and MCP server will fail to parse it on the next access.

**Do this instead:** Write to a `.tmp` file, then `renameSync` to the target. On POSIX filesystems (macOS, Linux), `rename` is atomic. The original file is either fully replaced or untouched.

### Anti-Pattern 5: Serving data/ from mcp-server/

**What people do:** Have the MCP server expose an HTTP endpoint and have the site call it instead of reading static files.

**Why it's wrong:** Adds a runtime dependency for the site (server must be running), breaks GitHub Pages static hosting, adds CORS complexity, destroys the zero-build-step constraint.

**Do this instead:** Both the site and MCP server read the same `data/` files independently. No runtime coupling. The site reads via HTTP from GitHub Pages. The MCP server reads via `fs` locally. They share only the filesystem.

## Scaling Considerations

This is a 1-2 user internal tool. These notes are for completeness only.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-2 users (current target) | No changes. Filesystem is the database. Single-user sequential writes. This is the intended operating mode. |
| 2-5 users, occasional concurrent writes | Add optimistic concurrency check: read index, mutate in memory, write with a check that index hasn't changed since read. Or use a lock file. |
| Multi-machine team | Switch MCP transport from stdio to Streamable HTTP. Server already designed to make this swap — the tool logic is transport-agnostic. |
| >50 tasks | Consider `add_task` auto-compacting: keep index.tasks as registry, add `lastModified` field to task files for sorting. Still no database needed. |
| >100 docs | Add title + summary to `data/docs/index.json` entries so `list_docs` can return richer results without reading every `.md` file. Schema already supports this (just add fields). |

## Sources

- [MCP TypeScript SDK — Official docs/server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — HIGH confidence. Official documentation for McpServer, StdioServerTransport, tool registration.
- [Build an MCP Server — modelcontextprotocol.io](https://modelcontextprotocol.io/docs/develop/build-server) — HIGH confidence. Official TypeScript quickstart, verified stdio transport pattern and package.json/tsconfig.json setup.
- [Node.js ESM __dirname equivalent — nodejs.org](https://nodejs.org/api/esm.html) — HIGH confidence. Official Node.js ESM documentation, import.meta.url + fileURLToPath pattern.
- [import.meta.dirname in Node 20.11+ — sonarsource.com](https://www.sonarsource.com/blog/dirname-node-js-es-modules/) — MEDIUM confidence. Confirms modern Node.js shortcut; fileURLToPath approach used for compatibility.
- [Atomic write pattern — npm/write-file-atomic](https://www.npmjs.com/package/write-file-atomic) — MEDIUM confidence. Confirms tmp + rename as the standard atomic write pattern on local filesystems.
- Live data files verified: `data/kanban/index.json`, `data/kanban/task-001.json`, `data/progress/index.json`, `data/progress/milestone-01.json`, `data/docs/index.json` — HIGH confidence. Schemas read directly from live repo.

---
*Architecture research for: MCP server integration with keloia-docs filesystem data layer*
*Researched: 2026-02-22*
