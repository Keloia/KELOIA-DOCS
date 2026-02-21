# Pitfalls Research

**Domain:** Static docs site (vanilla JS + GitHub Pages) + MCP server (stdio, TypeScript, filesystem)
**Researched:** 2026-02-22
**Confidence:** HIGH — primary pitfalls verified against official Claude Code docs, MCP SDK GitHub issues, and multiple practitioner post-mortems

---

## Critical Pitfalls

### Pitfall 1: stdout Pollution Kills the MCP stdio Transport

**What goes wrong:**
Any `console.log()` call in the MCP server process writes to stdout. Under stdio transport, stdout is the JSON-RPC communication channel between Claude Code and the server. A single stray log line corrupts the message framing and breaks all tool calls — silently or with cryptic parse errors.

**Why it happens:**
Developers default to `console.log()` for debugging. During development the server may work fine when run standalone, but fails the moment Claude Code launches it as a subprocess and reads stdout for protocol messages.

**How to avoid:**
- Replace every `console.log()` with `console.error()` — stderr is safe; Claude Code does not read it
- Add a lint rule or grep check: `grep -r "console\.log" mcp-server/src/` should return zero results
- Never use a logging library that defaults to stdout without explicit configuration

**Warning signs:**
- `JSON.parse` errors in Claude Code after connecting the server
- Tools appear in `/mcp` list but return garbage or timeout on first call
- Server works when you run it manually but fails when added to Claude Code

**Phase to address:** MCP server foundation phase (before any tools are implemented)

---

### Pitfall 2: Non-Atomic JSON Writes Corrupt Per-Entity Files

**What goes wrong:**
The `add_task`, `move_task`, and `update_progress` tools read a JSON file, mutate the object in memory, and write it back. If the process crashes, is killed, or if Claude Code invokes two tools concurrently, the write can be interrupted mid-file. The result is a truncated or invalid JSON file that makes every subsequent tool call fail with a parse error — and the kanban data or progress state is silently lost.

**Why it happens:**
`fs.writeFileSync(path, JSON.stringify(data))` is the obvious one-liner. It is not atomic. On any OS, a crash between the file being truncated and the write completing leaves a corrupt file.

**How to avoid:**
Use the write-to-temp-then-rename pattern — atomic on POSIX filesystems when both the temp file and target are on the same filesystem:

```typescript
import { writeFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';

function atomicWriteJSON(filePath: string, data: unknown): void {
  // CRITICAL: tmp file must be in the SAME directory as the target
  // Writing to /tmp and renaming across filesystems causes EXDEV error
  const tmp = filePath + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, filePath);
}
```

The `npm` package `write-file-atomic` provides this pattern with cross-platform support if you prefer not to inline it.

**Warning signs:**
- `SyntaxError: Unexpected end of JSON input` on `get_kanban` or `get_progress` calls
- The JSON file on disk is 0 bytes or cut off mid-structure
- Data loss reported after Claude Code ran multiple write tools back-to-back

**Phase to address:** MCP server write tools phase — implement before `add_task`/`move_task`/`update_progress` are considered done

---

### Pitfall 3: Atomic Write Fails with EXDEV When Temp File Is on a Different Filesystem

**What goes wrong:**
The atomic write pattern (write temp, then rename) only works when the temp file is on the same filesystem as the target. If you create the temp file in `/tmp` (a different partition on some systems), `fs.renameSync()` throws `EXDEV: cross-device link not permitted` because `rename(2)` cannot move files across filesystem boundaries.

**Why it happens:**
Developers copy the atomic write pattern from examples that use `/tmp` for temp files. On macOS and most Linux systems, `/tmp` is a separate tmpfs. The pattern silently works in some environments and fails in others.

**How to avoid:**
Always create the temp file in the same directory as the target file:

```typescript
// WRONG — may be a different filesystem
const tmp = path.join('/tmp', 'task-001.tmp');

// CORRECT — same directory, guaranteed same filesystem
const tmp = filePath + '.tmp.' + process.pid;
writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
renameSync(tmp, filePath);
```

**Warning signs:**
- `EXDEV: cross-device link not permitted` error in MCP tool output
- Atomic write works locally but fails in CI or Docker

**Phase to address:** MCP server write tools phase — verify temp file placement from the start

---

### Pitfall 4: MCP Server Path Resolution Breaks When Claude Code's CWD Differs

**What goes wrong:**
The MCP server uses `fs.readFileSync('../data/...')` or relative paths built from `process.cwd()`. When Claude Code launches the server, the working directory may not be the repo root — it depends on how `claude mcp add` was configured. Relative paths that work in `npx ts-node` testing fail in production with `ENOENT: no such file or directory`.

**Why it happens:**
`process.cwd()` reflects wherever Claude Code was launched from, not where the server script lives. `__dirname` in compiled JavaScript (`dist/`) points to the `dist/` directory, one level deeper than the source, making `../data` navigate to a different location than expected.

**How to avoid:**
Resolve all file paths from the project root using a root constant anchored to the compiled file location:

```typescript
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// For ESM (import.meta.url — use when package.json has "type": "module")
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// For CommonJS (compiled output with "module": "CommonJS" in tsconfig)
// __dirname is available natively

// Both cases: resolve data directory relative to compiled file, not CWD
const PROJECT_ROOT = resolve(__dirname, '..'); // dist/../ = repo root
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const KANBAN_DIR = resolve(DATA_DIR, 'kanban');
const PROGRESS_DIR = resolve(DATA_DIR, 'progress');
```

**Warning signs:**
- `ENOENT` errors on tool calls that read files
- Tools work when you `ts-node` the server directly but fail via Claude Code
- Log `process.cwd()` to stderr — if it shows an unexpected directory, paths will break

**Phase to address:** MCP server foundation phase — establish path constants before implementing any file-reading tools

---

### Pitfall 5: ESM vs CommonJS Module Mismatch Breaks Compilation and Runtime

**What goes wrong:**
The MCP TypeScript SDK package.json has `"type": "module"` in some versions, requiring consumers to match. If your `tsconfig.json` uses `"module": "CommonJS"` but the SDK expects ESM, you get `ERR_REQUIRE_ESM` at runtime. Conversely, if you use `"module": "NodeNext"` but forget to add `.js` extensions to all local imports, TypeScript compilation fails with `TS2307: Cannot find module` even though the files exist.

**Why it happens:**
TypeScript's ESM support requires explicit `.js` extensions on relative imports (even for `.ts` source files) when using `NodeNext` module resolution — because Node.js native ESM requires extensions at runtime. Developers import `'./tools/read'` instead of `'./tools/read.js'` and get confusing errors.

**How to avoid:**

Step 1 — choose your module system. The MCP SDK v1.x supports both via conditional exports. CommonJS is simpler; NodeNext/ESM is more correct but requires more setup.

For CommonJS (recommended for simplicity in a single-developer server):
```json
{
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "target": "ES2020",
    "outDir": "dist",
    "strict": true
  }
}
```

For ESM (if you need `import.meta.url` or top-level await):
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2020",
    "outDir": "dist",
    "strict": true
  }
}
```

If using NodeNext, all local relative imports in `.ts` files must end in `.js`:
```typescript
// WRONG — fails with NodeNext
import { atomicWrite } from './utils/fs';

// CORRECT — required for NodeNext ESM
import { atomicWrite } from './utils/fs.js';
```

**Warning signs:**
- `ERR_REQUIRE_ESM: require() of ES Module not supported` at runtime
- `TS2307: Cannot find module './utils/foo'` despite the file existing
- Server compiles but crashes immediately on startup

**Phase to address:** MCP server foundation phase — set tsconfig and import style before writing any code

---

### Pitfall 6: Zod v4 Installed Alongside MCP SDK That Requires Zod v3

**What goes wrong:**
The MCP TypeScript SDK pins Zod v3 as a peer dependency internally. If you install `zod@4.x` in your project, the SDK's internal schema code fails with `keyValidator.parse is not a function` or `w._parse is not a function` because Zod v4 moved internal APIs (e.g., `_def` moved to `_zod.def`). Tools fail to register or schema validation throws at startup.

**Why it happens:**
Zod v4 was released in 2025 with breaking internal API changes. The MCP SDK v1.x through v1.17.5 depended on Zod v3 internals. Developers `npm install zod` and get v4 by default. The SDK started adding v4 support in v1.23.0-beta but compatibility is still evolving.

**How to avoid:**
Pin Zod explicitly in `package.json`:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x.x",
    "zod": "^3.25.0"
  }
}
```

Check the SDK's installed version requirements before upgrading:
```bash
npm ls zod
```

If you need to use Zod v4 alongside, import v3 from its compat path:
```typescript
import { z } from 'zod/v3';
```

**Warning signs:**
- `keyValidator.parse is not a function` at server startup
- `w._parse is not a function` when tools register
- `Type instantiation is excessively deep and possibly infinite` TypeScript error

**Phase to address:** MCP server foundation phase — pin Zod version in `package.json` before installing any dependencies

---

### Pitfall 7: Zod `.transform()` Is Stripped During JSON Schema Conversion

**What goes wrong:**
When you define a Zod schema with `.transform()` and pass it to a tool's input schema, the MCP SDK converts the Zod schema to JSON Schema using `zod-to-json-schema`. JSON Schema has no concept of transformation functions, so `.transform()` is silently stripped. A schema like `z.union([z.array(z.string()), z.string()]).transform(parseArray)` becomes `{ type: "array" }` only — the string variant disappears. When a client sends a string, Zod validation fails with "Expected array, received string" even though your schema was supposed to accept both.

**Why it happens:**
`zod-to-json-schema` explicitly documents that transforms cannot be preserved. The MCP SDK uses this library internally for the `inputSchema` JSON Schema that gets sent to Claude. The Zod schema with transforms is kept separately for runtime validation, but the two get out of sync.

**How to avoid:**
- Keep tool input schemas free of `.transform()` — put transformation logic inside the tool handler after parsing
- Revalidate with the transform-bearing schema inside the handler if needed:

```typescript
server.tool('add_task', {
  // Schema without transform — what MCP exposes to Claude
  title: z.string(),
  column: z.enum(['Backlog', 'In Progress', 'Done']),
}, async (args) => {
  // Handler receives already-parsed args matching the schema above
  // Apply any normalization here instead of via .transform()
  const column = args.column.trim();
  // ...
});
```

**Warning signs:**
- Tool accepts multiple input types in your Zod schema but Claude always passes one specific type
- Validation fails for inputs that your schema supposedly accepts
- The `inputSchema` in `tools/list` response shows fewer types than your Zod schema defines

**Phase to address:** MCP server read tools phase and write tools phase — design tool schemas without transforms from the start

---

### Pitfall 8: Tool Descriptions That Confuse Claude

**What goes wrong:**
Poor tool descriptions cause Claude to call the wrong tool, pass wrong argument types, or fail to call tools at all when they would be appropriate. This is not a runtime error — the server is technically correct but Claude cannot use it effectively. This is the primary reason MCP integrations feel "broken" despite working code.

**Why it happens:**
Developers write tool descriptions for human readers ("Gets the kanban board data") rather than for an AI consumer. AI agents need context about *when* to use a tool, *what* each parameter means in plain terms, and *what the output represents*.

**How to avoid:**
Based on empirical research across 856 MCP tools (arxiv.org/html/2602.14878v1):
- Lead the description with the most important information — agents may not read the full text
- Avoid raw technical identifiers in parameter names; use descriptive names (`column_name` not `col_id`)
- Describe what the tool *does for the user*, not what it *does internally*
- For filtering parameters, list the accepted values explicitly in the description

Example of weak vs. strong description:
```
// Weak
description: "Gets kanban tasks"

// Strong
description: "Returns all tasks from the kanban board. Use when you need to see project status, find tasks in a specific column (todo/in-progress/done), or check task assignments. Returns task list with titles, status, labels, and assignees."
```

**Warning signs:**
- Claude calls `list_docs` when the user asks about task status
- Claude asks for clarification on parameters that should be obvious
- Claude ignores tools that would clearly answer the user's question

**Phase to address:** MCP server tool implementation phase — treat descriptions as a primary deliverable, not an afterthought

---

### Pitfall 9: Tool Name Collision Breaks Claude Code Sub-Agents

**What goes wrong:**
Claude Code v2.x had a regression (introduced in v2.0.30, resolved later) where MCP tool names registered from a server collide with Claude Code's internal tool names or with each other across multiple registrations. The error `tools: Tool names must be unique` (HTTP 400) fires when Claude Code spawns a sub-agent (Task tool, Explore, Plan, etc.) — making all sub-agent functionality non-functional while any MCP server is active.

**Why it happens:**
When a sub-agent is spawned, it inherits the parent session's tool list. A bug in the inheritance logic caused tools to be registered twice. Tool names like `read_file` or `list_files` also conflict with Claude Code's own built-in tools.

**How to avoid:**
- Use domain-specific, project-namespaced tool names: `keloia_list_docs`, `keloia_get_kanban`, `keloia_add_task` — not generic names that could collide with built-ins or other MCP servers
- Keep the total tool count low (under 10) to minimize collision surface
- Pin Claude Code to a known-working version if sub-agent failures appear after an update

**Warning signs:**
- `API Error 400: tools: Tool names must be unique` when using `/task`, `/explore`, or Plan features
- Sub-agents fail immediately on launch when MCP server is active
- Disabling the MCP server via `/mcp` resolves the sub-agent error

**Phase to address:** MCP server foundation phase — choose non-colliding tool names in the initial tool list design

---

### Pitfall 10: Split-File JSON Pattern Requires N+1 File Reads Per Tool Call

**What goes wrong:**
The kanban schema uses `data/kanban/index.json` (which lists task IDs) plus individual `data/kanban/task-NNN.json` files. A naive `get_kanban` implementation reads `index.json`, loops over the task IDs, and calls `readFileSync` per task. For N tasks, this is N+1 reads — one for the index plus one per task. At small scale (4 tasks) this is imperceptible, but the tool response time grows linearly with task count.

More critically, the tool must aggregate data from multiple files before returning a single response to Claude. If any individual task file is missing or corrupt, the whole tool call fails mid-loop.

**Why it happens:**
The split-file pattern was chosen for atomic per-task writes and to match the site's existing data layout. The read side is less obvious — reading an index then iterating reads is the straightforward implementation but has both performance and error-handling implications.

**How to avoid:**
- Read all task files in a single synchronous loop with individual try/catch per file — surface missing files as partial results rather than full failure
- Cache the full board in memory for the session lifetime if read frequency justifies it (not needed at <20 tasks)
- For the MVP: use `fs.readdirSync` to get all `task-*.json` files directly, bypassing the index for reads (the index is primarily for write coordination):

```typescript
function getAllTasks(kanbanDir: string): Task[] {
  const files = fs.readdirSync(kanbanDir)
    .filter(f => f.startsWith('task-') && f.endsWith('.json'));

  return files.flatMap(f => {
    try {
      return [JSON.parse(fs.readFileSync(path.join(kanbanDir, f), 'utf8'))];
    } catch {
      console.error(`Skipping corrupt file: ${f}`);
      return [];
    }
  });
}
```

**Warning signs:**
- `get_kanban` fails with `ENOENT` if a task file listed in the index has been manually deleted
- Tool response time scales visibly with task count
- A single corrupt task file causes the entire board to be unreadable

**Phase to address:** MCP server read tools phase — design the read strategy before implementing `get_kanban` and `get_progress`

---

### Pitfall 11: MCP Server Requires Full Claude Code Restart to Pick Up Changes

**What goes wrong:**
Claude Code launches the MCP server as a subprocess when the session starts. Edits to the server source code — even after recompiling — are not picked up until Claude Code is fully restarted (not just the session). Developers recompile, see no change, assume their code is wrong, and waste time debugging working code.

**Why it happens:**
The server process is spawned once at startup and kept alive for the session. There is no hot-reload mechanism in stdio transport. This is documented behavior but commonly overlooked.

**How to avoid:**
- Add a `compile-and-restart` workflow note to the project's contributing guide
- During development, prefer running the server manually with `npx ts-node mcp-server/src/index.ts` and a test harness rather than relying on Claude Code restart cycles
- Use the MCP Inspector (`npx @modelcontextprotocol/inspector`) to test tools without needing Claude Code at all

**Warning signs:**
- Code changes appear to have no effect after recompile
- The server still exhibits behavior from an older version of the code
- `dist/` directory exists but was not rebuilt after the last source change

**Phase to address:** MCP server foundation phase — document the restart requirement before any iterative tool development begins

---

### Pitfall 12: `.mcp.json` Project Scope Prompts Approval on Every Claude Code Session

**What goes wrong:**
Checking `.mcp.json` into the repo (project scope) means every Claude Code session opens with a security approval prompt before the MCP server is activated. For a single-developer project, this is friction with no security benefit — the developer wrote the server themselves.

More importantly: project-scope `.mcp.json` is version-controlled and would expose server command paths to anyone who clones the repo. If the server path is machine-specific (`/Users/reza/Github/...`), it breaks for any other machine.

**Why it happens:**
The distinction between project scope (`.mcp.json` in repo) and local scope (`~/.claude.json` or `.claude/settings.local.json`) is not obvious from the `claude mcp add` command.

**How to avoid:**
For a single-developer local-use server: register with `--scope local` so the config stays in `~/.claude.json`. Only use project scope (`.mcp.json`) if you want team members to share the server config with machine-agnostic paths (e.g., `node ./mcp-server/dist/index.js` using a relative path from the repo root).

If using project scope `.mcp.json`, use a repo-relative invocation:
```json
{
  "mcpServers": {
    "keloia": {
      "command": "node",
      "args": ["./mcp-server/dist/index.js"]
    }
  }
}
```

**Warning signs:**
- Every Claude Code startup shows a "Trust this MCP server?" prompt
- `.mcp.json` contains absolute paths to your home directory
- Other developers clone the repo and the MCP server path doesn't exist on their machine

**Phase to address:** MCP server integration phase (Claude Code registration) — decide scope before running `claude mcp add`

---

### Pitfall 13: marked.js Renders Raw HTML in Markdown, Enabling XSS

**What goes wrong:**
marked.js renders HTML embedded in markdown files as-is by default. If any markdown file ever contains `<script>` tags or `javascript:` href values (from a copy-paste, a bad edit, or a future contributor), the site will execute that script in the user's browser. For a personal internal tool this is low risk, but the behavior will surprise you if markdown ever comes from an untrusted source.

**Why it happens:**
The `sanitize` option in older marked.js versions was opt-in and has since been removed entirely — marked now defers sanitization to downstream libraries. The default pipeline is `markdown → HTML` with no XSS filtering.

A confirmed 2025 CVE (CVE-2025-24981) existed in a markdown parsing library's URL handling — the class of vulnerability is real.

**How to avoid:**
Pipe marked.js output through DOMPurify before inserting into the DOM:
```javascript
// In app.js — load DOMPurify from CDN alongside marked.js
const dirty = marked.parse(markdownContent);
const clean = DOMPurify.sanitize(dirty);
contentDiv.innerHTML = clean;
```
DOMPurify is available from CDN with no build step: `https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js`

**Warning signs:**
- `<script>alert('xss')</script>` in a markdown file executes in the browser
- Links in rendered markdown navigate to `javascript:void(0)` equivalent payloads

**Phase to address:** Site foundation phase — add DOMPurify when wiring up marked.js, before any markdown rendering is considered "done"

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `console.log()` for MCP debug output | Fast debugging | Corrupts stdio channel; breaks all tool calls | Never — use `console.error()` always |
| `fs.writeFileSync()` without atomic rename | Simple code | Data corruption on crash during write | Never for write tools — always use atomic write |
| Temp file in `/tmp` for atomic write | Obvious pattern | EXDEV error if /tmp is a different filesystem | Never — always use same-directory temp file |
| `process.cwd()` for data file paths | Simple to write | Breaks when CWD differs from repo root | Never — use `__dirname` or `import.meta.url` |
| Omit `.js` extension on local imports with NodeNext | Shorter imports | `TS2307: Cannot find module` compilation errors | Never with NodeNext — required by ESM spec |
| Install `zod@latest` without checking SDK compatibility | Latest features | `keyValidator.parse is not a function` at startup | Never — pin `zod@^3.25` until SDK officially supports v4 |
| Zod `.transform()` on tool input schemas | Cleaner schema code | Transforms silently stripped; validation accepts wrong inputs | Never on tool input schemas — use handler-side normalization |
| Generic tool names (`read_file`, `list_tasks`) | Obvious naming | Collides with Claude Code builtins; breaks sub-agents | Never — prefix with project namespace |
| Large flat tool list (10+ tools) | All tools available | Consumes context window; degrades Claude's decisions | Keep under 10 tools; split into sub-tools if needed |
| Absolute paths (`/kanban/board.json`) in site fetch | Obvious intent | Breaks on GitHub Pages project-repo subdirectory | Never — use relative paths |
| No `schemaVersion` field in JSON data files | Simpler JSON | Schema migrations become guesswork later | Already added at v1.0; keep it |

---

## Integration Gotchas

Common mistakes when connecting components.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code + MCP stdio server | Writing to stdout for any reason | Reserve stdout for JSON-RPC; use stderr for all other output |
| Claude Code + MCP server config | Running `claude mcp add` then expecting immediate effect | Fully exit and restart Claude Code after any config change |
| MCP SDK + Zod | `npm install zod` gets v4 which breaks MCP SDK v1.x | Pin `"zod": "^3.25.0"` in package.json explicitly |
| Zod + tool input schemas | Using `.transform()` in tool input schema | Remove transforms from schemas; apply normalization in handlers |
| MCP server + TypeScript | Running `ts-node src/index.ts` vs compiled `node dist/index.js` | Claude Code must run compiled JS; use ts-node only during dev; test compiled output before registering |
| ESM + NodeNext + TypeScript | `import { fn } from './module'` without `.js` extension | Must use `import { fn } from './module.js'` — Node ESM requires extensions |
| Atomic writes + cross-filesystem | Writing temp file to `/tmp` then renaming to project directory | Write temp file to same directory as target: `filePath + '.tmp.' + process.pid` |
| Split-file JSON + read tools | Read index, then loop readFileSync per entity (N+1 reads) | Read all entity files in one pass with per-file error handling |
| Claude Code + sub-agents + MCP | Generic tool names collide with Claude Code builtins | Prefix all tool names with project namespace (e.g., `keloia_`) |
| GitHub Pages + vanilla JS fetch | Using `fetch('/kanban/board.json')` (absolute path) | Use `fetch('../data/kanban/index.json')` (relative) |
| marked.js + innerHTML | `element.innerHTML = marked.parse(content)` | `element.innerHTML = DOMPurify.sanitize(marked.parse(content))` |
| GitHub Pages cache | Expect instant update after push | Add `?v=Date.now()` to all data fetches; document 30–120s propagation delay |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 file reads in `get_kanban` | Slow tool response; failure if one file missing | Read all `task-*.json` files in one readdirSync pass | ~50+ tasks or if any file is missing |
| Returning full board on every `get_kanban` call | Wastes tokens at 200+ tasks | Honor column/label/assignee filter params; never return all tasks when filter is specified | ~100+ tasks (MCP output token limit ~25K by default) |
| Loading all markdown docs on page init | Fine at 5 docs; slow at 50 | Lazy-load: fetch only the doc the user navigates to | ~20+ docs or docs >50KB each |
| Single `index.html` with all views rendered simultaneously | Simple DOM | DOM bloat; markdown rendering blocks initial paint | ~10+ views loaded at once |
| Inline all JSON in `app.js` rather than fetching at runtime | Simpler JS | Site must be redeployed to update data; defeats the "no build step" goal | Immediately — breaks the core value proposition |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| `marked.parse()` piped directly to `innerHTML` without DOMPurify | XSS if markdown contains HTML tags or JS URLs | Always run output through `DOMPurify.sanitize()` before DOM insertion |
| MCP server write tools with no path validation | Path traversal: crafted input could overwrite files outside `data/` | Validate that all resolved file paths start with `PROJECT_ROOT`; reject anything that escapes |
| MCP tool that reads arbitrary file paths from tool input | AI-controlled path traversal could read sensitive files | Whitelist exactly which paths each tool is allowed to read; never pass user-provided paths directly to `fs.readFileSync` |
| Committing `.mcp.json` with absolute paths | Exposes machine-specific paths; breaks on other machines | Use repo-relative paths in `.mcp.json`, or use `--scope local` to keep config out of the repo |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Kanban board renders as raw JSON on the site | Useless for human reading | Render `index.json` + task files as visual columns with cards |
| No loading state during fetch | Page appears blank or broken while markdown loads | Show a spinner or skeleton; `fetch()` is async and GitHub Pages can be slow on first load |
| Broken markdown links (relative paths that work locally but not on Pages) | Docs link to `../other-doc.md` which renders as a broken page | In the SPA, intercept link clicks and fetch the target doc via the app's routing |
| No sidebar active state | User cannot tell which doc is currently open | Highlight the active item in the sidebar nav on load and on navigation |
| Progress tracker shown as raw numbers | Hard to read at a glance | Render progress bars using CSS width percentages; do not show raw `current/total` only |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **MCP server connected**: Verify with `/mcp` in Claude Code that the server status is "connected", not just that the config was added — a misconfigured path shows the server as added but it fails at runtime
- [ ] **stdout is clean**: After connecting the MCP server in Claude Code, run any tool and inspect whether any non-JSON text appears — any text means stdout is polluted; `grep -r "console\.log" mcp-server/src/` must return zero results
- [ ] **Write tools work atomically**: Manually interrupt (Ctrl+C) a write in progress and verify the JSON file is still valid — not just that the tool returns success under normal conditions
- [ ] **Temp file in same directory**: Verify that `filePath + '.tmp.' + process.pid` creates the temp file in the same directory as the target, not in `/tmp` (run `strace` or add a log to stderr confirming path)
- [ ] **Zod version pinned**: Run `npm ls zod` and confirm only `3.x` appears — no `4.x` version in the tree
- [ ] **No Zod `.transform()` in input schemas**: Audit all `server.tool()` calls; input schemas must define types only, not transforms
- [ ] **Tool names are namespaced**: All tool names start with `keloia_` or similar prefix; none clash with common names like `read_file`, `list_files`, `get_status`
- [ ] **All file reads use `__dirname`-relative paths**: Run the MCP server from a different working directory (`cd /tmp && node /path/to/dist/index.js`) and verify tools still work
- [ ] **Compiled output tested**: Run `node dist/index.js` (not `ts-node src/index.ts`) and verify the server starts — some errors only appear in compiled output
- [ ] **ESM imports have `.js` extensions**: If using NodeNext module resolution, every relative import in `.ts` files ends in `.js`
- [ ] **Split-file reads are fault-tolerant**: Delete one task file and verify `get_kanban` returns the rest rather than throwing an error
- [ ] **Site works on deployed URL**: Test on `https://username.github.io/keloia-docs/` not just `localhost` — relative path bugs and `<base>` tag issues only appear on the deployed subdirectory URL
- [ ] **marked.js output is sanitized**: Put `<script>alert(1)</script>` in a test markdown file and verify no alert fires when the site renders it
- [ ] **GitHub Actions deploys the right directory**: Confirm the Pages workflow deploys the repo root so raw markdown and JSON files are publicly accessible alongside `index.html`

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| stdout pollution corrupting stdio | LOW | Remove all `console.log` calls, recompile, restart Claude Code |
| Corrupted JSON file from non-atomic write | MEDIUM | Restore from last git commit (`git checkout HEAD -- data/kanban/task-NNN.json`); git history is the backup |
| EXDEV error from cross-filesystem atomic write | LOW | Move temp file creation to same directory as target; recompile |
| MCP server ENOENT file not found | LOW | Replace `process.cwd()` with `resolve(__dirname, '..')`-anchored paths, recompile |
| Zod v4/v3 incompatibility | LOW | `npm install zod@^3.25.0`, delete `node_modules`, reinstall |
| Zod transforms causing schema mismatch | MEDIUM | Audit all tool input schemas, remove `.transform()`, move normalization into handlers |
| Tool name collision breaking sub-agents | LOW | Rename all tools with `keloia_` prefix; update `.mcp.json` or local config; restart Claude Code |
| All fetch paths broken on deployed site | LOW | Add `<base href="/repo-name/">` to `index.html`, update relative paths, push |
| XSS via unescaped markdown | LOW (personal tool) | Add DOMPurify, re-test |
| Stale data displayed to user | LOW | Add `?v=${Date.now()}` to fetch calls; clear browser cache as immediate mitigation |
| Claude ignores tools due to poor descriptions | MEDIUM | Rewrite all tool descriptions using the "what/when/parameters" pattern; restart Claude Code to reload tool list |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| stdout pollution (Pitfall 1) | MCP server foundation | `grep -r console.log src/` returns zero results; tool call succeeds in Claude Code |
| Non-atomic JSON writes (Pitfall 2) | MCP write tools phase | Interrupt a write; verify JSON remains valid |
| EXDEV cross-filesystem temp file (Pitfall 3) | MCP write tools phase | Log temp file path to stderr; confirm it is in same dir as target |
| Path resolution / CWD mismatch (Pitfall 4) | MCP server foundation | Run server from `/tmp`; verify all file operations succeed |
| ESM vs CommonJS mismatch (Pitfall 5) | MCP server foundation | Set tsconfig before writing any code; confirm `node dist/index.js` starts |
| Zod v4/v3 incompatibility (Pitfall 6) | MCP server foundation | Pin Zod in package.json; `npm ls zod` shows 3.x only |
| Zod transform stripping (Pitfall 7) | MCP read/write tools phases | Audit all tool schemas; no `.transform()` on input schemas |
| Poor tool descriptions (Pitfall 8) | MCP tool implementation | Ask Claude to use each tool without a prompt hint; verify correct invocation |
| Tool name collision (Pitfall 9) | MCP server foundation | Use `keloia_` prefix on all tools; test sub-agent launch |
| N+1 split-file reads (Pitfall 10) | MCP read tools phase | Delete one task file; verify get_kanban returns partial results not an error |
| MCP restart required (Pitfall 11) | MCP server foundation | Document in contributing guide; use MCP Inspector for dev iteration |
| .mcp.json project vs local scope (Pitfall 12) | MCP integration phase | Confirm no absolute paths in .mcp.json; no approval prompt on startup |
| marked.js XSS (Pitfall 13) | Site foundation (v1.0 — already addressed) | DOMPurify wired up; alert test passes |

---

## Sources

- [Claude Code MCP Documentation (official)](https://code.claude.com/docs/en/mcp) — stdout reservation, restart requirements, scope behavior (HIGH confidence)
- [MCP TypeScript SDK Issue #218 — ESM module resolution](https://github.com/modelcontextprotocol/typescript-sdk/issues/218) — NodeNext tsconfig requirements (HIGH confidence)
- [MCP TypeScript SDK Issue #702 — Zod transform stripping](https://github.com/modelcontextprotocol/typescript-sdk/issues/702) — confirmed; `.transform()` silently dropped in JSON Schema conversion (HIGH confidence)
- [MCP TypeScript SDK Issue #906 — Zod v4 compatibility](https://github.com/modelcontextprotocol/typescript-sdk/issues/906) — `keyValidator.parse is not a function` confirmed; pin Zod v3 (HIGH confidence)
- [MCP SDK Issue #1429 — Zod v4 breaking changes](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1429) — `_def` moved to `_zod.def`; MCP SDK v1.17.5 broken with Zod v4 (HIGH confidence)
- [Claude Code Issue #10668 — Tool names must be unique](https://github.com/anthropics/claude-code/issues/10668) — sub-agent tool duplication bug; use namespaced tool names (HIGH confidence)
- [Claude Code Issue #5963 — Project scope MCP servers](https://github.com/anthropics/claude-code/issues/5963) — project vs local scope behavior (MEDIUM confidence)
- [Node.js Issue #19077 — EXDEV cross-device rename](https://github.com/nodejs/node/issues/19077) — confirmed: `rename()` cannot cross filesystem boundaries; temp file must be in same directory (HIGH confidence)
- [write-file-atomic (npm)](https://www.npmjs.com/package/write-file-atomic) — atomic write pattern with cross-platform support (HIGH confidence)
- [MCP memory server race condition — Issue #2579](https://github.com/modelcontextprotocol/servers/issues/2579) — confirmed race condition from non-atomic writes (HIGH confidence)
- [Visor: Lessons Learned Developing an MCP Server](https://www.visor.us/blog/lessons-learned-developing-visors-mcp-server/) — tool proliferation, session restart, Zod friction (MEDIUM confidence)
- [Peter Steinberger: MCP Best Practices](https://steipete.me/posts/2025/mcp-best-practices) — stdout logging, source vs compiled code, bloated files (MEDIUM confidence)
- [Guide to Building Local MCP Servers with NodeNext & TypeScript](https://gist.github.com/jevenson76/3fcfb102eb543db64c7e1162f017f49e) — `.js` extension requirement for NodeNext; tsconfig settings (MEDIUM confidence)
- [arxiv: MCP Tool Description Quality Study](https://arxiv.org/html/2602.14878v1) — empirical study of 856 tools; tool description quality measurably affects agent accuracy (MEDIUM confidence)
- [marked.js XSS — CVE-2025-24981](https://thesecmaster.com/blog/how-to-fix-cve-2025-24981-mitigating-xss-vulnerability-in-markdown-library-for-we) — confirmed 2025 CVE in markdown URL parsing (HIGH confidence)
- [GitHub Pages SPA 404 routing discussion](https://github.com/orgs/community/discussions/64096) — confirmed no server-side routing support (HIGH confidence)

---
*Pitfalls research for: docs site + MCP server (Keloia project)*
*Researched: 2026-02-22*
