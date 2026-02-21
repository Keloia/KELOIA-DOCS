# Pitfalls Research

**Domain:** Static docs site (vanilla JS + GitHub Pages) + MCP server (stdio, TypeScript, filesystem)
**Researched:** 2026-02-21
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

### Pitfall 2: Non-Atomic JSON Writes Corrupt board.json and tracker.json

**What goes wrong:**
The `add_task`, `move_task`, and `update_progress` tools read the JSON file, mutate the object in memory, and write it back. If the process crashes, is killed, or if Claude Code invokes two tools concurrently, the write can be interrupted mid-file. The result is a truncated or invalid JSON file that makes every subsequent tool call fail with a parse error — and the kanban board or progress tracker is silently lost.

**Why it happens:**
`fs.writeFileSync(path, JSON.stringify(data))` is the obvious one-liner. It is not atomic. On any OS, a crash between the file being truncated and the write completing leaves a corrupt file.

**How to avoid:**
Use the write-to-temp-then-rename pattern — atomic on POSIX filesystems:

```typescript
import { writeFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';

function atomicWriteJSON(filePath: string, data: unknown): void {
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

### Pitfall 3: GitHub Pages Serves Stale Files After Push

**What goes wrong:**
GitHub Pages has a propagation delay of 30–120 seconds after a push to main. During that window, the site still serves the old file content. More critically, the browser may have cached the old JSON or markdown file aggressively (GitHub Pages sets `Cache-Control: max-age=600` for most files). A developer edits `board.json`, reloads the site, and sees the old board for up to 10 minutes — making it appear the write failed when it actually succeeded.

**Why it happens:**
GitHub Pages CDN caches are not busted on push. Browsers honor the cache headers. Developers who are used to build-pipeline sites with content-hash filenames (which bypass caching entirely) do not expect this behavior from a "no build step" site.

**How to avoid:**
- Use a cache-busting query param when fetching data files in `app.js`:
  ```javascript
  fetch(`../kanban/board.json?v=${Date.now()}`)
  ```
- Document in the repo README that propagation delay is 30–120 seconds
- For development, serve locally with `npx serve .` which does not cache aggressively

**Warning signs:**
- Site shows old data immediately after a push
- Clearing the browser cache resolves the "stale data" problem
- Hard refresh (Ctrl+Shift+R) shows updated data but normal reload does not

**Phase to address:** Site foundation phase — add cache-buster to all `fetch()` calls from the start

---

### Pitfall 4: Relative Path Breakage When GitHub Pages Serves from a Subdirectory

**What goes wrong:**
GitHub Pages for a user/org repo (`username.github.io`) serves from the root `/`. But for a project repo (`username.github.io/keloia-docs`), the site is served from a subpath. If `app.js` hardcodes paths like `fetch('/kanban/board.json')` instead of `fetch('../kanban/board.json')` or a base-relative path, fetches return 404 on the deployed site but work perfectly on localhost.

**Why it happens:**
Developers test locally with `open index.html` or a simple local server at `/`, where absolute paths resolve correctly. The subpath deployment on GitHub Pages changes the origin, breaking absolute paths.

**How to avoid:**
- Use only relative paths in all `fetch()` calls: `fetch('../kanban/board.json')`
- Set the correct base URL in `index.html`: `<base href="/keloia-docs/">` if deploying to a project repo
- Test locally by serving from a subdirectory: `npx serve -l 3000 .` then navigate to `http://localhost:3000/site/`

**Warning signs:**
- All `fetch()` calls return 404 on the deployed site but work locally
- Browser DevTools Network tab shows requests going to `username.github.io/kanban/...` instead of `username.github.io/keloia-docs/kanban/...`

**Phase to address:** Site foundation phase — confirm deployment URL and set `<base>` tag before writing any `fetch()` calls

---

### Pitfall 5: MCP Server Requires Restart to Pick Up Config Changes

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

### Pitfall 6: Tool Descriptions That Confuse Claude

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

### Pitfall 7: marked.js Renders Raw HTML in Markdown, Enabling XSS

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

### Pitfall 8: MCP Server Path Resolution Breaks When Claude Code's CWD Differs

**What goes wrong:**
The MCP server uses `fs.readFileSync('../docs/...')` or relative paths built from `__dirname`. When Claude Code launches the server, the working directory may not be the repo root — it depends on how `claude mcp add` was configured. Relative paths that work in `npx ts-node` testing fail in production with `ENOENT: no such file or directory`.

**Why it happens:**
`process.cwd()` reflects wherever Claude Code was launched from, not where the server script lives. `__dirname` in compiled JavaScript (`dist/`) points to the `dist/` directory, one level deeper than the source, making `../docs` navigate to a different location than expected.

**How to avoid:**
Resolve all file paths from the project root using a manifest or explicit root constant:
```typescript
import { resolve } from 'path';

// Derive project root relative to this compiled file's location
const PROJECT_ROOT = resolve(__dirname, '..'); // dist/../ = repo root
const DOCS_DIR = resolve(PROJECT_ROOT, 'docs');
const KANBAN_FILE = resolve(PROJECT_ROOT, 'kanban', 'board.json');
const PROGRESS_FILE = resolve(PROJECT_ROOT, 'progress', 'tracker.json');
```

**Warning signs:**
- `ENOENT` errors on tool calls that read files
- Tools work when you `ts-node` the server directly but fail via Claude Code
- `console.error(process.cwd())` (to stderr) shows an unexpected directory

**Phase to address:** MCP server foundation phase — establish path constants before implementing any file-reading tools

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `console.log()` for MCP debug output | Fast debugging | Corrupts stdio channel; breaks all tool calls | Never — use `console.error()` always |
| `fs.writeFileSync()` without atomic rename | Simple code | Data corruption on crash during write | Never for write tools — always use atomic write |
| Absolute paths (`/kanban/board.json`) in fetch | Obvious intent | Breaks on GitHub Pages project-repo subdirectory | Never — use relative paths |
| Hardcoded file paths in MCP server | Simple to write | Breaks when CWD changes; breaks on other machines | Never — derive from `__dirname` |
| Skip DOMPurify, trust your own markdown | One fewer CDN dep | XSS if any markdown ever contains HTML | Acceptable only if the repo is truly private and no external markdown is ever rendered |
| Large flat tool list (10+ tools) | All tools available | Consumes context window; degrades Claude's decisions | Keep under 10 tools; split into sub-tools if needed |
| No `schemaVersion` field in JSON data files | Simpler JSON | Schema migrations become guesswork later | Acceptable at this scale; add version if schema evolves |

---

## Integration Gotchas

Common mistakes when connecting components.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code + MCP stdio server | Writing to stdout for any reason | Reserve stdout for JSON-RPC; use stderr for all other output |
| Claude Code + MCP server config | Running `claude mcp add` then expecting immediate effect | Fully exit and restart Claude Code after any config change |
| GitHub Pages + vanilla JS fetch | Using `fetch('/kanban/board.json')` (absolute path) | Use `fetch('../kanban/board.json')` (relative) or configure `<base>` tag |
| marked.js + innerHTML | `element.innerHTML = marked.parse(content)` | `element.innerHTML = DOMPurify.sanitize(marked.parse(content))` |
| MCP server + TypeScript build | Running `ts-node src/index.ts` vs compiled `node dist/index.js` | Claude Code must run compiled JS; development can use ts-node but test compiled output before registering with Claude Code |
| Concurrent MCP write tools | `writeFileSync` followed by `writeFileSync` on same file | Serialize writes or use atomic rename pattern; the MCP SDK is single-threaded per connection but tools can queue up |
| GitHub Pages cache | Expect instant update after push | Add `?v=Date.now()` to all data fetches; document 30–120s propagation delay |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all markdown docs on page init | Fine at 5 docs; slow at 50 | Lazy-load: fetch only the doc the user navigates to | ~20+ docs or docs >50KB each |
| Returning full board.json on every `get_kanban` call | Fine at 20 tasks; wastes tokens at 200 | Honor the column/label/assignee filter params in the tool; never return all tasks when a filter is specified | ~100+ tasks (token limit for MCP output is 25K by default) |
| Inline all JSON in `app.js` rather than fetching at runtime | Simpler JS | Site must be redeployed to update data; defeats the "no build step" goal | Immediately — breaks the core value proposition |
| Single `index.html` with all views rendered simultaneously | Simple DOM | DOM bloat; markdown rendering blocks initial paint | ~10+ views loaded at once |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| `marked.parse()` piped directly to `innerHTML` without DOMPurify | XSS if markdown contains HTML tags or JS URLs | Always run output through `DOMPurify.sanitize()` before DOM insertion |
| MCP server write tools with no path validation | Path traversal: `add_task` called with crafted content could overwrite files outside `kanban/` | Validate that all resolved file paths start with `PROJECT_ROOT`; reject anything that escapes |
| Committing `.mcp.json` with `--scope project` without review | Shares MCP server config with collaborators who may run untrusted commands | Use `--scope local` (stored in `~/.claude.json`) for this single-developer repo |
| MCP tool that reads arbitrary file paths from tool input | AI-controlled path traversal could read sensitive files | Whitelist exactly which paths each tool is allowed to read; never pass user-provided paths directly to `fs.readFileSync` |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Kanban board renders as raw JSON on the site | Useless for human reading | Render board.json as visual columns with cards; this is the primary human-facing view |
| No loading state during fetch | Page appears blank or broken while markdown loads | Show a spinner or skeleton; `fetch()` is async and GitHub Pages can be slow on first load |
| Broken markdown links (relative paths that work locally but not on Pages) | Docs link to `../other-doc.md` which renders as a broken page | In the SPA, intercept link clicks and fetch the target doc via the app's routing rather than navigating to the raw file |
| No sidebar active state | User cannot tell which doc is currently open | Highlight the active item in the sidebar nav on load and on navigation |
| Progress tracker shown as raw numbers | Hard to read at a glance | Render progress bars using CSS width percentages; do not show raw `current/total` only |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **MCP server connected**: Verify with `/mcp` in Claude Code that the server status is "connected", not just that the config was added — a misconfigured path shows the server as added but it fails at runtime
- [ ] **Write tools work atomically**: Manually interrupt (Ctrl+C) a write in progress and verify the JSON file is still valid — not just that the tool returns success under normal conditions
- [ ] **Site works on deployed URL**: Test on `https://username.github.io/keloia-docs/` not just `localhost` — relative path bugs and `<base>` tag issues only appear on the deployed subdirectory URL
- [ ] **marked.js output is sanitized**: Put `<script>alert(1)</script>` in a test markdown file and verify no alert fires when the site renders it
- [ ] **All file reads use `__dirname`-relative paths**: Run the MCP server from a different working directory (`cd /tmp && node /path/to/dist/index.js`) and verify tools still work
- [ ] **stdout is clean**: After connecting the MCP server in Claude Code, run any tool and inspect whether any non-JSON text appears in the Claude Code output — any text means stdout is polluted
- [ ] **GitHub Actions deploys the right directory**: Confirm the Pages workflow deploys the repo root (not `site/` subdirectory) since raw markdown and JSON files need to be publicly accessible alongside `site/index.html`

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| stdout pollution corrupting stdio | LOW | Remove all `console.log` calls, recompile, restart Claude Code |
| Corrupted board.json from non-atomic write | MEDIUM | Restore from last git commit (`git checkout HEAD -- kanban/board.json`); the git history is the backup |
| All fetch paths broken on deployed site | LOW | Add `<base href="/repo-name/">` to `index.html`, update relative paths, push to main |
| MCP server ENOENT file not found | LOW | Replace relative paths with `__dirname`-anchored `resolve()` calls, recompile |
| XSS via unescaped markdown | LOW (personal tool) | Add DOMPurify, re-test; severity is low for a private single-user tool |
| Stale data displayed to user | LOW | Add `?v=${Date.now()}` to fetch calls; clear browser cache as immediate mitigation |
| Claude ignores tools due to poor descriptions | MEDIUM | Rewrite all tool descriptions using the "what/when/parameters" pattern; restart Claude Code to reload tool list |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| stdout pollution (Pitfall 1) | MCP server foundation | grep confirms zero `console.log` in src/; tool call succeeds in Claude Code |
| Non-atomic JSON writes (Pitfall 2) | MCP write tools implementation | Interrupt a write; verify JSON remains valid |
| GitHub Pages stale cache (Pitfall 3) | Site foundation | `?v=Date.now()` present on all data fetches from first commit |
| Relative path breakage (Pitfall 4) | Site foundation | Test deployed URL before any other site work |
| MCP restart required for changes (Pitfall 5) | MCP server foundation | Document in contributing guide; use MCP Inspector for dev iteration |
| Poor tool descriptions (Pitfall 6) | MCP tool implementation | Ask Claude to use each tool without a prompt hint; verify correct invocation |
| marked.js XSS (Pitfall 7) | Site foundation | DOMPurify wired up before any markdown rendering ships |
| Path resolution in compiled output (Pitfall 8) | MCP server foundation | All paths derived from `resolve(__dirname, '..')` from day one |

---

## Sources

- [Claude Code MCP Documentation (official)](https://code.claude.com/docs/en/mcp) — stdout reservation, restart requirements, scope behavior (HIGH confidence)
- [MCP TypeScript SDK Issue #796 — Zod validation errors](https://github.com/modelcontextprotocol/typescript-sdk/issues/796) — schema compatibility edge cases (HIGH confidence)
- [MCP memory server race condition — Issue #2579](https://github.com/modelcontextprotocol/servers/issues/2579) — confirmed race condition from non-atomic writes (HIGH confidence)
- [Visor: Lessons Learned Developing an MCP Server](https://www.visor.us/blog/lessons-learned-developing-visors-mcp-server/) — tool proliferation, session restart, Zod friction (MEDIUM confidence)
- [Peter Steinberger: MCP Best Practices](https://steipete.me/posts/2025/mcp-best-practices) — stdout logging, source vs compiled code, bloated files (MEDIUM confidence)
- [arxiv: MCP Tool Description Quality Study](https://arxiv.org/html/2602.14878v1) — empirical study of 856 tools; tool description quality measurably affects agent accuracy (MEDIUM confidence)
- [write-file-atomic (npm)](https://www.npmjs.com/package/write-file-atomic) — atomic write pattern, npm/write-file-atomic GitHub (HIGH confidence)
- [marked.js XSS — CVE-2025-24981](https://thesecmaster.com/blog/how-to-fix-cve-2025-24981-mitigating-xss-vulnerability-in-markdown-library-for-we) — confirmed 2025 CVE in markdown URL parsing (HIGH confidence)
- [GitHub Pages SPA 404 routing discussion](https://github.com/orgs/community/discussions/64096) — confirmed no server-side routing support (HIGH confidence)
- [GitHub Pages CORS discussion](https://github.com/orgs/community/discussions/22399) — CORS wildcard for public pages, GET/HEAD only (HIGH confidence)

---
*Pitfalls research for: docs site + MCP server (Keloia project)*
*Researched: 2026-02-21*
