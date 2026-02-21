# Pitfalls Research

**Domain:** Static docs site (vanilla JS + GitHub Pages) + MCP server (stdio, TypeScript, filesystem)
**Researched:** 2026-02-22
**Confidence:** HIGH — primary pitfalls verified against official Claude Code docs, MCP SDK GitHub issues, and multiple practitioner post-mortems

---

## v1.0 / v1.1 Pitfalls (Foundation)

> Pitfalls from the initial build. Preserved for reference. All prevention already baked into the shipped codebase.

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

## v2.0 Pitfalls (Search + Auth + CRUD)

> New pitfalls specific to the v2.0 feature set: GitHub OAuth on a static site, GitHub API file CRUD, client-side full-text search, vanilla JS drag-and-drop, and MCP tool additions. All are HIGH confidence unless noted.

---

### Pitfall 14: GitHub OAuth Token Exchange Requires a Backend — There Is No Workaround on Pure Static Sites

**What goes wrong:**
The GitHub OAuth web flow token endpoint (`POST https://github.com/login/oauth/access_token`) does not support CORS. A browser fetch to this endpoint fails with a CORS pre-flight error. Additionally, exchanging the authorization code for a token requires the `client_secret`, which must never appear in client-side JavaScript. The result: a pure static GitHub Pages site cannot complete the OAuth flow without a backend — at all.

**Why it happens:**
GitHub's official documentation states: "CORS pre-flight requests (OPTIONS) are not supported at this time." This has been true since 2018 and remains true as of 2026. GitHub added PKCE support for GitHub Apps in July 2025 but the token endpoint CORS restriction still applies to OAuth Apps. Developers assume that because GitHub Pages is fully static, there must be a client-side-only approach — there is not for the standard flow.

**How to avoid:**
Accept that a minimal backend is required for the token exchange step. The backend need not be a full server — a serverless function is sufficient. Options:

1. **Cloudflare Worker** (recommended for this project): A small Worker proxies the code→token exchange, holds the `client_secret` in a Worker secret, and returns the token to the client. Simon Willison's pattern is the canonical reference: `https://til.simonwillison.net/cloudflare/workers-github-oauth`

2. **GitHub Actions + PAT fallback**: Since this is a single-developer project with a known GitHub account, a fine-grained Personal Access Token (PAT) scoped to the specific repo is a simpler alternative to full OAuth. The user stores the PAT in the browser (with understood XSS risk), and the site uses it directly for API calls. No backend required.

3. **Gatekeeper pattern**: A minimal Node.js server (`github.com/prose/gatekeeper`) that holds the secret and proxies the token exchange. Requires a deployment target (Heroku, Railway, etc.).

For Keloia specifically: PAT-based auth is the pragmatic choice. Full OAuth for a single-developer private tool adds infrastructure complexity with no proportional security benefit.

**Warning signs:**
- `Access to XMLHttpRequest blocked by CORS policy` when calling `github.com/login/oauth/access_token` from JavaScript
- The token exchange succeeds during server-side testing but fails in the browser
- Attempting to include `client_secret` in client-side JavaScript (immediate security failure)

**Phase to address:** GitHub Auth phase — decide PAT vs full OAuth before writing any auth code. If OAuth: provision backend first, before implementing any site auth UI.

---

### Pitfall 15: GitHub OAuth Redirect URI Cannot Include Hash Fragment

**What goes wrong:**
GitHub's OAuth callback redirects to the registered callback URL. Hash fragments (`#`) are not sent to the server in HTTP redirects — they are client-side only. If the SPA uses hash routing (`#/callback`), GitHub cannot redirect to `https://example.github.io/repo/#/callback` because the hash part is stripped in the redirect. The user lands on the root page with no route active, and the authorization code in the query string gets processed by the wrong handler (or not at all).

**Why it happens:**
The existing SPA uses `#`-based routing (hash router) — a deliberate choice to avoid GitHub Pages' 404 problem with pushState. But OAuth callback URIs must be query-string based, not hash-fragment based. These two requirements conflict.

**How to avoid:**
Register the OAuth callback URL as the root page without a hash fragment: `https://username.github.io/keloia-docs/`. When GitHub redirects back with `?code=...&state=...`, the page loads and `app.js` reads `window.location.search` (not `window.location.hash`) to detect and handle the callback before normal routing takes over:

```javascript
// In app.js — check for OAuth callback FIRST, before routing
const params = new URLSearchParams(window.location.search);
if (params.has('code') && params.has('state')) {
  handleOAuthCallback(params.get('code'), params.get('state'));
  // Clean URL after handling
  window.history.replaceState({}, '', window.location.pathname);
} else {
  // Normal SPA routing
  router();
}
```

**Warning signs:**
- GitHub redirects to `https://example.github.io/repo/` but the SPA shows blank or the wrong view
- `code` parameter is present in `window.location.search` but the auth flow does not detect it
- Hash routing activates before the callback handler runs

**Phase to address:** GitHub Auth phase — design the callback detection mechanism before registering the OAuth app.

---

### Pitfall 16: GitHub API Update Requires Current File SHA or Returns 409 Conflict

**What goes wrong:**
The GitHub Contents API `PUT /repos/{owner}/{repo}/contents/{path}` endpoint requires the current file's blob SHA when updating an existing file. If the SHA is missing (creating logic applied to an existing file) or stale (the file changed since you last fetched it), the API returns `409 Conflict` with a message like "is at [actual SHA] but expected [your SHA]". Operations appear to succeed in development but fail intermittently in production when the file changes between fetch and update.

**Why it happens:**
Creating a new file does not require SHA. Updating an existing file mandates it. Developers implement create logic first (no SHA needed), then reuse it for updates without adding the SHA fetch step. The 409 is intermittent — it only fires when another update happens between the fetch and the write.

**How to avoid:**
Always fetch the current file metadata before updating:

```javascript
// Step 1: GET current SHA
const getRes = await fetch(
  `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
  { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } }
);
const { sha } = await getRes.json();

// Step 2: PUT with current SHA
const putRes = await fetch(
  `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
  {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update ${path}`,
      content: btoa(newContent),  // base64 encoded
      sha,                         // REQUIRED for updates
    })
  }
);
```

For delete operations, SHA is also required in the request body.

**Warning signs:**
- `409 Conflict` with "SHA doesn't match" error on update or delete operations
- Create works but update returns 422 or 409
- Operations succeed the first time but fail on subsequent edits to the same file

**Phase to address:** GitHub CRUD phase — implement the GET→PUT pattern as the only update path from day one. Never implement create and update as separate code paths that diverge on SHA.

---

### Pitfall 17: `btoa()` Throws on Non-ASCII Characters — Any Markdown with Unicode Breaks

**What goes wrong:**
The GitHub Contents API requires file content to be base64-encoded. `window.btoa()` is the obvious browser-native function. However, `btoa()` only handles Latin-1 (ISO-8859-1) characters. Any markdown file containing non-ASCII characters — em dashes, curly quotes, accented characters, non-Latin scripts, or emoji — causes `btoa()` to throw `InvalidCharacterError: The string to be encoded contains characters outside of the Latin1 range`.

**Why it happens:**
`btoa()` predates Unicode and was never updated. It is still in all browsers and works silently for ASCII-only content during initial testing. The failure mode only appears when a real document with international characters or smart quotes is encountered.

**How to avoid:**
Use `TextEncoder` to convert the string to UTF-8 bytes first, then encode those bytes to base64:

```javascript
function encodeContentForGitHub(str) {
  // TextEncoder produces UTF-8 bytes; btoa can only handle Latin-1
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

function decodeContentFromGitHub(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
```

Both `TextEncoder` and `TextDecoder` are available in all modern browsers without a CDN or build step.

**Warning signs:**
- `InvalidCharacterError` or `DOMException: Failed to execute 'btoa'` in the console when saving a doc
- Create/update works for docs with only ASCII characters but fails on real-world content
- The error appears in user testing but not in developer testing (different content)

**Phase to address:** GitHub CRUD phase — use the `TextEncoder`-based encode/decode functions from the first line of code. Never use bare `btoa()` for file content.

---

### Pitfall 18: GitHub API Returns base64 Content with Newline Characters That Break `atob()`

**What goes wrong:**
The GitHub Contents API returns file content base64-encoded, but the encoding includes newline characters (`\n`) every 60 characters — following the MIME base64 standard. `window.atob()` in some browsers rejects base64 strings with whitespace, throwing `InvalidCharacterError`. In other browsers it silently strips newlines and works. The behavior is inconsistent.

**Why it happens:**
GitHub deliberately inserts newlines to match the git blob encoding format. The browser's `atob()` is specified to handle whitespace in some environments but not others. The inconsistency makes it a latent bug that manifests only in certain browsers.

**How to avoid:**
Strip newlines from the base64 string before decoding:

```javascript
function decodeGitHubContent(base64WithNewlines) {
  // GitHub inserts \n every 60 chars — strip before decoding
  const cleaned = base64WithNewlines.replace(/\n/g, '');
  // Then use TextDecoder for Unicode safety (see Pitfall 17)
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
```

**Warning signs:**
- Doc content renders correctly in Chrome but fails in Safari or Firefox
- `InvalidCharacterError` on `atob()` call that receives a string from the GitHub API
- Decoded content is truncated or garbled when displayed

**Phase to address:** GitHub CRUD phase — always strip newlines from GitHub API content responses before decoding. Test across browsers before marking the feature done.

---

### Pitfall 19: Client-Side Search Index Built from Fetched Files Blocks First Interaction

**What goes wrong:**
A client-side full-text search implementation that builds its index at page load (by fetching all markdown files and indexing them) introduces a noticeable delay before search is usable. If there are 20 docs averaging 10KB each, the site makes 20+ fetch requests on load, parses all the content, and builds the index — all before the user can type a character. On a slow connection, this takes several seconds and makes the site feel sluggish.

**Why it happens:**
The simplest implementation indexes everything upfront. It feels fine during development with a fast local cache. In production on a first load from a cold CDN, the sequential or even parallel fetches are slow enough to be perceptible.

**How to avoid:**
Build and index lazily:

1. **Build the index when search is first activated** (user clicks the search box), not at page load. Most users will navigate directly to a doc without searching.

2. **Fetch docs in parallel**, not sequentially:

```javascript
async function buildSearchIndex(docSlugs) {
  // Fetch all docs in parallel — much faster than sequential
  const results = await Promise.all(
    docSlugs.map(slug =>
      fetch(`data/docs/${slug}.md`)
        .then(r => r.text())
        .then(text => ({ slug, text }))
        .catch(() => null)
    )
  );
  return results.filter(Boolean);
}
```

3. **Show a loading state** in the search input while indexing is in progress.

4. **For this project's scale** (~5-20 docs, each <50KB): lazy-build on first search focus is sufficient. Pre-build at load time is never necessary at this scale.

**Warning signs:**
- Page feels noticeably slow on first load compared to before search was added
- Network tab shows 10+ fetch requests firing immediately on page load
- Search works but the site's time-to-interactive increased by 1+ seconds

**Phase to address:** Search phase — design the indexing trigger before writing any search code. Defer index build to first search interaction.

---

### Pitfall 20: Lunr.js Search Results Have No Snippet Highlighting Without Extra Work

**What goes wrong:**
Lunr.js (and most client-side search libraries) return matching document slugs with relevance scores — they do not return the matching text snippet or highlight where the query term appears in the document. Displaying "3 results found" with just doc titles gives users no context for why each result matched. The feature feels incomplete even though the search itself works correctly.

**Why it happens:**
Search index libraries separate indexing (they do) from snippet extraction (developers assume they do). The snippet extraction requires re-reading the original document text, finding the query term's position, and extracting surrounding context — none of which Lunr provides.

**How to avoid:**
Store the raw document text alongside the index (or re-fetch the doc on demand), then extract snippets manually:

```javascript
function extractSnippet(fullText, query, contextLength = 150) {
  const lowerText = fullText.toLowerCase();
  const lowerQuery = query.toLowerCase().split(' ')[0]; // First word
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return fullText.slice(0, contextLength) + '...';
  const start = Math.max(0, idx - 60);
  const end = Math.min(fullText.length, idx + contextLength);
  return (start > 0 ? '...' : '') + fullText.slice(start, end) + '...';
}
```

For this project (markdown docs): store `{ slug, title, text }` in the search index map during build, then use `text` for snippet extraction when displaying results.

**Warning signs:**
- Search results show only doc titles with no indication of why each result matched
- Users cannot distinguish between 5 results that all match the same query
- Feature demo looks incomplete — "it found results but doesn't show where"

**Phase to address:** Search phase — implement snippet extraction as part of the search result rendering, not as a follow-up enhancement.

---

### Pitfall 21: The `drop` Event Never Fires If `dragover` Does Not Call `preventDefault()`

**What goes wrong:**
Adding a `drop` event listener to a kanban column element does nothing — drops never register. The dragged card is released over the column, but the `drop` event does not fire, and the card snaps back to its original position. The implementation looks correct but is silently broken.

**Why it happens:**
The HTML5 Drag and Drop API has a counterintuitive design: the `drop` event only fires on elements that have explicitly signaled they are valid drop targets by calling `event.preventDefault()` in the `dragover` event handler. The default behavior of `dragover` is "not a drop target." Without canceling that default, the browser treats the element as an invalid drop zone and suppresses the `drop` event entirely.

**How to avoid:**
Every column element that should accept drops must handle `dragover` and call `preventDefault()`:

```javascript
column.addEventListener('dragover', (e) => {
  e.preventDefault(); // THIS enables the 'drop' event to fire
  e.dataTransfer.dropEffect = 'move'; // Visual feedback for user
});

column.addEventListener('drop', (e) => {
  e.preventDefault(); // Prevent browser default (e.g., open link)
  const taskId = e.dataTransfer.getData('text/plain');
  moveTaskToColumn(taskId, column.dataset.columnId);
});
```

**Warning signs:**
- `drop` event listeners are registered but never called
- Dragged cards snap back to their original position after release
- `dragover` fires (confirmed with console.error) but `drop` does not

**Phase to address:** Kanban drag-and-drop phase — add `dragover` + `preventDefault()` as the first thing implemented, before any drop logic.

---

### Pitfall 22: Drag Event Listeners on Dynamically Created Cards Break After DOM Re-render

**What goes wrong:**
Event listeners attached directly to kanban card elements (`card.addEventListener('dragstart', ...)`) stop working after the kanban board re-renders. When a task is moved and the board re-renders its HTML, the original card DOM elements are replaced with new ones. The old event listeners are attached to the now-detached (garbage-collected) elements. The new card elements have no listeners, so dragging them does nothing.

**Why it happens:**
Direct element-bound event listeners are not preserved across DOM replacements. The board re-renders (e.g., `column.innerHTML = renderCards(tasks)`) which creates new DOM nodes. Any listeners on the old nodes are lost.

**How to avoid:**
Use event delegation — attach a single `dragstart` listener to the column container (or the board root), and check `event.target` to identify which card was dragged:

```javascript
// Attach to the stable container, not the individual cards
board.addEventListener('dragstart', (e) => {
  const card = e.target.closest('[data-task-id]');
  if (!card) return;
  e.dataTransfer.setData('text/plain', card.dataset.taskId);
  e.dataTransfer.effectAllowed = 'move';
});
```

The container element persists across re-renders; the delegated listener handles any card that now exists or will exist.

**Warning signs:**
- Drag works after initial page load but stops working after the first move operation
- Cards added to the board after page load cannot be dragged
- Drag starts working again after a full page refresh

**Phase to address:** Kanban drag-and-drop phase — use delegation from the first implementation. Never attach listeners directly to dynamically created cards.

---

### Pitfall 23: HTML5 Drag and Drop Does Not Work on Mobile Browsers

**What goes wrong:**
The kanban drag-and-drop works perfectly on desktop but is completely non-functional on iOS Safari and Android Chrome. Mobile browsers use touch events (`touchstart`, `touchmove`, `touchend`) — they do not fire the HTML5 drag-and-drop events (`dragstart`, `dragover`, `drop`). Users on mobile devices cannot rearrange tasks.

**Why it happens:**
The HTML5 Drag and Drop API was designed for mouse-based input. Touch events are a separate API. Mobile browsers have never bridged this gap with a standard implementation.

**How to avoid:**
For this project (primary user is Reza on desktop), mobile touch support is acceptable to defer. However, if mobile use is expected:

1. Use the `mobile-drag-drop` polyfill: `github.com/timruffles/mobile-drag-drop` — a drop-in shim that translates touch events to the HTML5 drag API. Load from CDN with no build step.

2. Implement touch handlers separately alongside the drag API:

```javascript
// Touch fallback alongside drag API
card.addEventListener('touchstart', touchDragStart, { passive: false });
document.addEventListener('touchmove', touchDragMove, { passive: false });
document.addEventListener('touchend', touchDrop);
```

Decide the mobile strategy before implementing drag-and-drop. Retrofitting touch support after the fact requires significant refactoring.

**Warning signs:**
- Drag-and-drop features work in desktop browser testing but fail on iOS Safari
- No drag events fire when tested with browser DevTools mobile emulation
- User reports that "nothing happens" when trying to drag a card on a phone

**Phase to address:** Kanban drag-and-drop phase — explicitly mark mobile as "deferred" in the phase requirements, or implement the polyfill from day one.

---

### Pitfall 24: Adding More MCP Tools Degrades Claude's Tool Selection Accuracy

**What goes wrong:**
v2.0 adds 3+ new tools (`keloia_search_docs`, `keloia_add_doc`, `keloia_edit_doc`, `keloia_delete_doc`) to the existing 7, bringing the total to 10+. Each additional tool definition consumes tokens from the context window and increases the cognitive load on the model's tool selection. Empirical research shows measurable accuracy degradation when tool counts grow — Claude begins misfiring, calling similar tools incorrectly, or ignoring tools that would be appropriate.

**Why it happens:**
Every MCP tool definition is included verbatim in the Claude context window for every turn. At 150+ tools (across multiple MCP servers), tool metadata can consume 30-60K tokens. Even at 10-15 tools on a single server, description quality and naming clarity become critical because the model must distinguish tools that overlap in purpose (e.g., `keloia_edit_doc` vs `keloia_add_doc`).

**How to avoid:**
- Keep total tool count below 15 for this project
- Write descriptions that explicitly exclude cases where similar tools should be used instead: "Use keloia_edit_doc to modify existing docs. Use keloia_add_doc only when the file does not yet exist."
- Consolidate where possible: an `keloia_upsert_doc` that handles both create and update may be better than separate add/edit tools if they share most logic
- Do not add tools "just in case" — every tool has a context window cost paid on every turn

**Warning signs:**
- Claude calls `keloia_add_doc` on an existing file (overwriting instead of editing)
- Claude calls `keloia_edit_doc` when asked to create a new doc (which then 409s on missing SHA)
- Claude asks the user which tool to use when the intent is clear
- Tool accuracy was better with 7 tools than with 11 tools

**Phase to address:** MCP tool addition phase — audit the full tool list before adding v2.0 tools. Write descriptions that disambiguate similar tools before shipping.

---

### Pitfall 25: GitHub API Rate Limit Hits 60 req/hour If Token Is Missing or Stale

**What goes wrong:**
The GitHub REST API allows 5,000 requests/hour when authenticated. Without a valid token — or after a token expires/is revoked — the site falls to 60 requests/hour for the user's IP address. Since the existing site reads from GitHub Pages (cached static files), this has not been an issue. But v2.0 adds direct `api.github.com` calls for CRUD operations. A bug in token management (token not attached to request, token stored in a variable that gets reset on navigation, etc.) causes silent fallback to the unauthenticated limit and intermittent `403 Forbidden` or `429 Too Many Requests` errors.

**Why it happens:**
The token may be stored in a module-level variable that gets reset during SPA navigation, or attached to only some request helpers but not others. The error is intermittent — the first N requests succeed under the unauthenticated limit, then fail.

**How to avoid:**
- Store the token in `localStorage` immediately after OAuth/PAT entry, and load it from `localStorage` on page load in a single auth initialization function
- Create a single `githubFetch(path, options)` wrapper that always attaches the `Authorization` header — never call `fetch` directly for GitHub API calls
- Check `X-RateLimit-Remaining` header in responses; log a warning (to console.error) when below 100
- On 403 or 401 responses from api.github.com, clear the stored token and prompt re-auth

**Warning signs:**
- GitHub API calls work after login but stop working after navigating to a different view
- `403 Forbidden` errors appearing intermittently — not on every request
- The browser network tab shows some GitHub API calls with `Authorization` header and some without

**Phase to address:** GitHub Auth phase — implement the `githubFetch` wrapper before any CRUD operations. Single authentication surface prevents token attachment bugs.

---

### Pitfall 26: Kanban Write-Back Races Between Local State and GitHub API Response

**What goes wrong:**
When a user drags a task card to a new column, the site must: (1) update the local kanban display immediately, and (2) write the change to GitHub via the API (which takes 1-3 seconds). If the user drags another card before the first write completes, the second write fetches the SHA of the index file — but it gets the SHA before the first write committed, causing a 409 Conflict on the second write.

**Why it happens:**
The GitHub Contents API is not a database with transaction support. Concurrent writes to the same file require strict serialization. The SPA's optimistic UI pattern (update display immediately, write in background) naturally creates a race condition when multiple operations happen in quick succession.

**How to avoid:**
Serialize all GitHub write operations through a queue:

```javascript
let writeQueue = Promise.resolve();

function queueGitHubWrite(operation) {
  writeQueue = writeQueue.then(() => operation()).catch(err => {
    console.error('Write failed:', err);
    // Optionally: revert the optimistic UI update
  });
  return writeQueue;
}

// When user drops a card:
updateLocalDisplay(taskId, newColumn); // Immediate UI update
queueGitHubWrite(() => writeTaskToGitHub(taskId, newColumn)); // Serialized write
```

**Warning signs:**
- 409 Conflict errors appear after rapid successive drag operations
- The second card move appears to succeed locally but the GitHub file shows only the first change
- Rate of 409 errors correlates with how quickly the user moves multiple cards

**Phase to address:** Kanban drag-and-drop phase — implement the write queue before implementing drag-drop persistence. The race condition is guaranteed to appear in normal use.

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
| Absolute paths (`/kanban/board.json`) in site fetch | Obvious intent | Breaks on GitHub Pages project-repo subdirectory | Never — use relative paths |
| No `schemaVersion` field in JSON data files | Simpler JSON | Schema migrations become guesswork later | Already added at v1.0; keep it |
| `btoa(content)` for GitHub API encoding | Simple one-liner | Throws on any non-ASCII character; real docs always have some | Never — use TextEncoder-based encode |
| Implement create and update as separate code paths | Simpler logic | Update path misses SHA; leads to 409 Conflict | Never — always GET SHA then PUT |
| Attach drag listeners directly to card elements | Intuitive | Listeners lost after DOM re-render; drag breaks after first move | Never for dynamically rendered content — use event delegation |
| Build full search index at page load | Always-ready search | Delays time-to-interactive; unnecessary for most page visits | Never — build index lazily on first search |
| Full GitHub OAuth flow for single-developer tool | "Proper" auth | Requires backend infrastructure; high complexity for zero gain | Never — use PAT for single-developer; OAuth for multi-user |
| Store token in JS module variable | Avoids localStorage | Token lost on SPA navigation; causes intermittent 403 errors | Never — persist in localStorage, load on init |
| Call GitHub API without serializing writes | Simpler async code | Race conditions on concurrent writes; 409 Conflict | Never for write operations on the same file — use write queue |
| Large flat tool list (10+ tools) | All tools available | Consumes context window; degrades Claude's decisions | Keep under 15 tools; consolidate overlapping tools |

---

## Integration Gotchas

Common mistakes when connecting components.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code + MCP stdio server | Writing to stdout for any reason | Reserve stdout for JSON-RPC; use stderr for all other output |
| Claude Code + MCP server config | Running `claude mcp add` then expecting immediate effect | Fully exit and restart Claude Code after any config change |
| MCP SDK + Zod | `npm install zod` gets v4 which breaks MCP SDK v1.x | Pin `"zod": "^3.25.0"` in package.json explicitly |
| Zod + tool input schemas | Using `.transform()` in tool input schema | Remove transforms from schemas; apply normalization in handlers |
| MCP server + TypeScript | Running `ts-node src/index.ts` vs compiled `node dist/index.js` | Claude Code must run compiled JS; use ts-node only during dev |
| ESM + NodeNext + TypeScript | `import { fn } from './module'` without `.js` extension | Must use `import { fn } from './module.js'` — Node ESM requires extensions |
| Atomic writes + cross-filesystem | Writing temp file to `/tmp` then renaming to project directory | Write temp file to same directory as target |
| Split-file JSON + read tools | Read index, then loop readFileSync per entity (N+1 reads) | Read all entity files in one pass with per-file error handling |
| Claude Code + sub-agents + MCP | Generic tool names collide with Claude Code builtins | Prefix all tool names with project namespace (e.g., `keloia_`) |
| GitHub Pages + vanilla JS fetch | Using `fetch('/kanban/board.json')` (absolute path) | Use `fetch('../data/kanban/index.json')` (relative) |
| marked.js + innerHTML | `element.innerHTML = marked.parse(content)` | `element.innerHTML = DOMPurify.sanitize(marked.parse(content))` |
| GitHub Pages cache | Expect instant update after push | Add `?v=Date.now()` to all data fetches; document 30–120s propagation delay |
| GitHub OAuth + static site | Implement token exchange in client JS | Token exchange requires backend; use Cloudflare Worker or PAT instead |
| GitHub OAuth + hash routing | Register `#/callback` as redirect URI | Hash is stripped in HTTP redirect; use root URL, parse `?code=` from query string |
| GitHub API update + SHA | Reuse create logic (no SHA) for updates | Always GET current SHA before PUT; never update without current SHA |
| GitHub API content + `btoa()` | `btoa(markdownContent)` — throws on non-ASCII | Use TextEncoder-based encode; strip newlines from API responses before `atob()` |
| HTML5 drag-drop + `drop` event | `addEventListener('drop', ...)` without `dragover preventDefault` | Must call `e.preventDefault()` in `dragover` handler to enable the `drop` event |
| Drag listeners + dynamic DOM | Attach `dragstart` directly to card elements | Delegate from stable container; card elements are replaced on re-render |
| Drag-and-drop + mobile | Test only on desktop | HTML5 drag API does not work on mobile; decide polyfill strategy upfront |
| MCP tools + tool count | Add tools freely as features grow | Each tool costs context window tokens; keep total under 15; consolidate overlapping tools |
| GitHub API + concurrent writes | Fire multiple `PUT` requests in parallel | Serialize writes through a queue; concurrent PUTs to same file cause 409 Conflict |
| GitHub token + SPA navigation | Store token in module-level variable | Store in localStorage; load on app init; use a single `githubFetch` wrapper |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 file reads in `get_kanban` | Slow tool response; failure if one file missing | Read all `task-*.json` files in one readdirSync pass | ~50+ tasks or if any file is missing |
| Returning full board on every `get_kanban` call | Wastes tokens at 200+ tasks | Honor column/label/assignee filter params | ~100+ tasks (MCP output token limit ~25K) |
| Loading all markdown docs on page init | Fine at 5 docs; slow at 50 | Lazy-load: fetch only the doc the user navigates to | ~20+ docs or docs >50KB each |
| Building search index at page load | Slow initial load; parallel fetches compete with render | Build index lazily on first search focus | ~10+ docs or any slow connection |
| Search index includes full doc text in memory | High memory; large payload | Store only slug + title in index; fetch full text for snippets on demand | ~50+ docs or docs >100KB each |
| Inline all JSON in `app.js` rather than fetching at runtime | Simpler JS | Site must be redeployed to update data; defeats zero build step | Immediately — breaks the core value proposition |
| Multiple concurrent GitHub API writes | Fast UI response | 409 Conflict race conditions | 2+ rapid drag operations within the write roundtrip time (~2-3s) |
| Too many MCP tools (15+) | Slower Claude responses; lower tool selection accuracy | Consolidate overlapping tools; write precise descriptions | Degrades noticeably at ~15 tools; sharply at ~40 tools |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| `marked.parse()` piped directly to `innerHTML` without DOMPurify | XSS if markdown contains HTML tags or JS URLs | Always run output through `DOMPurify.sanitize()` before DOM insertion |
| MCP server write tools with no path validation | Path traversal: crafted input could overwrite files outside `data/` | Validate that all resolved file paths start with `PROJECT_ROOT`; reject anything that escapes |
| MCP tool that reads arbitrary file paths from tool input | AI-controlled path traversal could read sensitive files | Whitelist exactly which paths each tool is allowed to read |
| Committing `.mcp.json` with absolute paths | Exposes machine-specific paths; breaks on other machines | Use repo-relative paths in `.mcp.json`, or use `--scope local` |
| Including `client_secret` in client-side JavaScript | Anyone who views source can steal your OAuth app secret | Never put `client_secret` in JS; use PAT or Cloudflare Worker proxy |
| Storing OAuth token in `localStorage` | XSS can exfiltrate the token and make GitHub API calls | Acceptable for single-developer tool; add DOMPurify to reduce XSS surface |
| GitHub API token with repo-wide write access stored in browser | Compromised token can delete or overwrite all repo files | Use fine-grained PAT scoped to minimum permissions: only `contents:write` on specific repo |
| Rendering markdown from GitHub API response without sanitization | GitHub API returns stored content; could be malicious if written by a third party | Always DOMPurify all rendered markdown regardless of source |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Search results show only titles | Users cannot tell which result is relevant | Show a text snippet around the matching term (150 chars of context) |
| Search results with no highlighting | Hard to spot where the query appears | Bold the matching term in the snippet |
| No visual feedback during drag | Users unsure if drag is active | Add CSS class to dragged card (`opacity: 0.5`) and highlight column on `dragover` |
| Drop column does not highlight on `dragover` | User cannot confirm they are hovering over a valid target | Add/remove a CSS class on column during `dragover`/`dragleave` events |
| Auth state lost on page refresh | User must re-enter PAT every session | Persist token in `localStorage`; show "logged in as [username]" after auth |
| Confirmation modal for delete has no doc name | User cannot confirm they selected the right doc | Show doc title in modal: "Delete 'Architecture'? This cannot be undone." |
| Drag-and-drop with no undo | User moves card by mistake; cannot revert without manually dragging back | Show a brief toast with "Undo" option (5 second timeout) that reverts the move |
| Kanban board renders as raw JSON on the site | Useless for human reading | Render `index.json` + task files as visual columns with cards |
| No loading state during fetch | Page appears blank or broken while markdown loads | Show a spinner or skeleton; `fetch()` is async and GitHub Pages can be slow on first load |
| Progress tracker shown as raw numbers | Hard to read at a glance | Render progress bars using CSS width percentages |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

**v1.0/v1.1 (already shipped — verify regression):**

- [ ] **MCP server connected**: Verify with `/mcp` in Claude Code that the server status is "connected"
- [ ] **stdout is clean**: `grep -r "console\.log" mcp-server/src/` returns zero results; new tools must not add `console.log`
- [ ] **Write tools work atomically**: Interrupt a write; verify the JSON file is still valid
- [ ] **Temp file in same directory**: New file-writing tools must use `filePath + '.tmp.' + process.pid`
- [ ] **Zod version pinned**: `npm ls zod` shows 3.x only; adding new deps cannot pull in Zod 4
- [ ] **Tool names are namespaced**: All new tools start with `keloia_`; none clash with existing or common names
- [ ] **marked.js output is sanitized**: DOMPurify still wired; new markdown rendering paths also sanitized

**v2.0 (new — must verify before shipping each feature):**

- [ ] **GitHub token exchange uses backend or PAT**: No `client_secret` in any `.js` file; grep `client_secret` returns zero results
- [ ] **OAuth callback reads `?code=` from query string**: NOT from hash fragment; check `window.location.search` not `window.location.hash`
- [ ] **OAuth callback fires before SPA router**: Page load checks for `?code=` param first; routing does not swallow the callback
- [ ] **File content encoded with TextEncoder, not bare `btoa()`**: Test by saving a doc that contains an em dash, smart quote, or any non-ASCII character
- [ ] **API responses decoded with newline-stripping**: Pass a GitHub API content response through decode; verify no `InvalidCharacterError` in Safari
- [ ] **Update path always fetches SHA first**: Never call PUT without a preceding GET; test by updating the same file twice in succession
- [ ] **Delete path includes current SHA in body**: Verify with a DELETE call; check that the file is gone from the repo
- [ ] **Search index built lazily**: Add a performance mark; verify no `data/docs/*.md` fetches fire before the search box is first focused
- [ ] **Search results show snippets**: Results must show context around the matching term, not just the doc title
- [ ] **`dragover` calls `preventDefault()`**: Remove `preventDefault()` temporarily — confirm `drop` stops firing — then put it back
- [ ] **Drag listeners are delegated**: Move a card; check listeners still work; re-render the board; check listeners still work
- [ ] **Mobile drag tested or explicitly deferred**: Document the decision; do not ship without knowing whether mobile is expected to work
- [ ] **GitHub API write queue serializes operations**: Move two cards in rapid succession; verify both changes appear in the repo without 409 errors
- [ ] **Token persists across SPA navigation**: Log in; navigate to kanban; navigate to docs; make an API call; verify no 403 errors

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| stdout pollution corrupting stdio | LOW | Remove all `console.log` calls, recompile, restart Claude Code |
| Corrupted JSON file from non-atomic write | MEDIUM | Restore from last git commit (`git checkout HEAD -- data/kanban/task-NNN.json`) |
| EXDEV error from cross-filesystem atomic write | LOW | Move temp file creation to same directory as target; recompile |
| MCP server ENOENT file not found | LOW | Replace `process.cwd()` with `resolve(__dirname, '..')`-anchored paths, recompile |
| Zod v4/v3 incompatibility | LOW | `npm install zod@^3.25.0`, delete `node_modules`, reinstall |
| Tool name collision breaking sub-agents | LOW | Rename all tools with `keloia_` prefix; restart Claude Code |
| All fetch paths broken on deployed site | LOW | Add `<base href="/repo-name/">` to `index.html`, update relative paths, push |
| XSS via unescaped markdown | LOW (personal tool) | Add DOMPurify, re-test |
| OAuth callback swallowed by hash router | MEDIUM | Refactor page init to check `window.location.search` before routing; test on deployed URL |
| `btoa()` throws on non-ASCII content | LOW | Replace `btoa()` with TextEncoder encode; strip newlines from atob input |
| 409 Conflict on file update (missing SHA) | LOW | Add GET-before-PUT; test by updating the same file twice |
| 409 Conflict from concurrent writes | LOW | Add write queue (Promise chain); verify with rapid successive operations |
| Drop event not firing | LOW | Confirm `dragover` calls `e.preventDefault()`; check for `dragenter` handling |
| Drag listeners lost after re-render | MEDIUM | Refactor from direct attachment to event delegation on container |
| Token lost on SPA navigation | LOW | Move token to `localStorage`; add `githubFetch` wrapper |
| Claude misfiring on overlapping tools | MEDIUM | Rewrite tool descriptions to explicitly exclude cases; consolidate add/edit tools if feasible |
| Search index built at load slowing page | LOW | Move index build to search focus event; add loading state |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| stdout pollution (P1) | Already fixed (v1.1) | `grep -r console.log src/` = zero; re-check after adding v2.0 tools |
| Non-atomic JSON writes (P2) | Already fixed (v1.1) | Interrupt test; JSON remains valid |
| EXDEV cross-filesystem temp (P3) | Already fixed (v1.1) | Temp file confirmed in same dir as target |
| Path resolution / CWD (P4) | Already fixed (v1.1) | Run from `/tmp`; file operations succeed |
| ESM vs CommonJS (P5) | Already fixed (v1.1) | `node dist/index.js` starts cleanly |
| Zod v3/v4 mismatch (P6) | Already fixed (v1.1) | `npm ls zod` shows 3.x only |
| Zod transform stripping (P7) | Already fixed (v1.1) | No `.transform()` in input schemas |
| Poor tool descriptions (P8) | Ongoing — add to v2.0 tool descriptions | Ask Claude to use each new tool without prompt hint |
| Tool name collision (P9) | Already established — maintain `keloia_` prefix | New tools follow `keloia_` convention |
| N+1 file reads (P10) | Already fixed (v1.1) | Split-file reads use readdirSync |
| MCP restart required (P11) | Already documented — re-confirm with v2.0 tools | Recompile and restart; new tools appear |
| .mcp.json scope (P12) | Already fixed (v1.1) | No absolute paths in .mcp.json |
| marked.js XSS (P13) | Already fixed (v1.0) | DOMPurify wired; alert test passes |
| GitHub OAuth needs backend (P14) | GitHub Auth phase — first decision, before any UI | No `client_secret` in JS; PAT or Worker proxy confirmed |
| OAuth hash routing conflict (P15) | GitHub Auth phase — before registering OAuth app | Callback page reads `?code=` from query string |
| GitHub API SHA requirement (P16) | GitHub CRUD phase — GET before every PUT | Update same file twice; no 409 Conflict |
| `btoa()` Unicode failure (P17) | GitHub CRUD phase — from first encode call | Save doc with em dash; no InvalidCharacterError |
| GitHub base64 newlines (P18) | GitHub CRUD phase — from first decode call | Decode GitHub API response; no errors in Safari |
| Search index blocking load (P19) | Search phase — index build trigger | No doc fetches before search focus; loading state shown |
| Search missing snippets (P20) | Search phase — result rendering | Results show text context, not just titles |
| `drop` event not firing (P21) | Kanban drag-drop phase — first event wired | Remove `preventDefault()`; confirm `drop` stops |
| Drag listeners lost on re-render (P22) | Kanban drag-drop phase — delegation from day one | Move card; re-render; drag still works |
| Mobile drag not supported (P23) | Kanban drag-drop phase — explicit decision | Decision documented; polyfill added or deferred |
| Too many MCP tools (P24) | MCP tool addition phase — before adding v2.0 tools | Total tool count stays under 15; descriptions disambiguate |
| Rate limit from missing token (P25) | GitHub Auth phase — githubFetch wrapper | Navigate to kanban after login; API calls include Authorization header |
| Concurrent write race condition (P26) | Kanban drag-drop phase — write queue before persistence | Rapid double-drag; both changes committed to GitHub |

---

## Sources

**v1.0/v1.1 sources (retained):**
- [Claude Code MCP Documentation (official)](https://code.claude.com/docs/en/mcp) — stdout reservation, restart requirements, scope behavior (HIGH confidence)
- [MCP TypeScript SDK Issue #218 — ESM module resolution](https://github.com/modelcontextprotocol/typescript-sdk/issues/218) (HIGH confidence)
- [MCP TypeScript SDK Issue #702 — Zod transform stripping](https://github.com/modelcontextprotocol/typescript-sdk/issues/702) (HIGH confidence)
- [MCP TypeScript SDK Issue #906 — Zod v4 compatibility](https://github.com/modelcontextprotocol/typescript-sdk/issues/906) (HIGH confidence)
- [MCP SDK Issue #1429 — Zod v4 breaking changes](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1429) (HIGH confidence)
- [Claude Code Issue #10668 — Tool names must be unique](https://github.com/anthropics/claude-code/issues/10668) (HIGH confidence)
- [Node.js Issue #19077 — EXDEV cross-device rename](https://github.com/nodejs/node/issues/19077) (HIGH confidence)
- [arxiv: MCP Tool Description Quality Study](https://arxiv.org/html/2602.14878v1) (MEDIUM confidence)
- [marked.js XSS — CVE-2025-24981](https://thesecmaster.com/blog/how-to-fix-cve-2025-24981-mitigating-xss-vulnerability-in-markdown-library-for-we) (HIGH confidence)

**v2.0 sources:**
- [GitHub Docs — Authorizing OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) — token endpoint has no CORS; `client_secret` required server-side (HIGH confidence)
- [GitHub Community — OAuth web flow doesn't support CORS, Issue #330](https://github.com/isaacs/github/issues/330) — confirmed, long-standing issue (HIGH confidence)
- [Simon Willison — GitHub OAuth for a static site using Cloudflare Workers](https://til.simonwillison.net/cloudflare/workers-github-oauth) — canonical minimal backend pattern (HIGH confidence)
- [prose/gatekeeper](https://github.com/prose/gatekeeper) — token exchange proxy reference implementation (MEDIUM confidence)
- [GitHub Docs — REST API endpoints for repository contents](https://docs.github.com/en/rest/repos/contents) — SHA required for update/delete; 409 Conflict causes; base64 encoding requirement (HIGH confidence)
- [GitHub Community — Content is not valid Base64, Discussion #41150](https://github.com/orgs/community/discussions/41150) — confirmed base64 encoding pitfalls (HIGH confidence)
- [GitHub Community — Error 409 Conflict with Create or Update File Contents, Discussion #62198](https://github.com/orgs/community/discussions/62198) — SHA mismatch confirmed as primary 409 cause (HIGH confidence)
- [MDN — Window: btoa() method](https://developer.mozilla.org/en-US/docs/Web/API/Window/btoa) — Latin-1 only; Unicode throws InvalidCharacterError (HIGH confidence)
- [web.dev — The nuances of base64 encoding strings in JavaScript](https://web.dev/articles/base64-encoding) — TextEncoder approach for Unicode-safe encoding (HIGH confidence)
- [MDN — HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API) — dragover `preventDefault()` required for `drop` to fire (HIGH confidence)
- [MDN — HTMLElement: dragover event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dragover_event) — confirmed: canceling dragover enables drop target (HIGH confidence)
- [timruffles/mobile-drag-drop](https://github.com/timruffles/mobile-drag-drop) — touch shim for HTML5 drag API; confirmed mobile does not support native HTML5 drag (HIGH confidence)
- [GitHub Pages does not support routing for single page apps, Community Discussion #64096](https://github.com/orgs/community/discussions/64096) — hash routing required (HIGH confidence)
- [GitHub Docs — Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — 60 unauthenticated / 5000 authenticated (HIGH confidence)
- [Eclipse Source — MCP and Context Overload: Why More Tools Make Your AI Agent Worse](https://eclipsesource.com/blogs/2026/01/22/mcp-context-overload/) — tool count degrades accuracy (MEDIUM confidence)
- [The Hidden Cost of MCPs on Your Context Window](https://selfservicebi.co.uk/analytics%20edge/improve%20the%20experience/2025/11/23/the-hidden-cost-of-mcps-and-custom-instructions-on-your-context-window.html) — token overhead quantified (MEDIUM confidence)
- [Auth0 — Token Storage](https://auth0.com/docs/secure/security-guidance/data-security/token-storage) — localStorage XSS risk; acceptable tradeoff for personal tools (HIGH confidence)

---
*Pitfalls research for: docs site + MCP server (Keloia project) — v2.0 Search + Auth + CRUD*
*Researched: 2026-02-22*
