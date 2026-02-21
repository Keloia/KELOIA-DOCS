# Feature Research

**Domain:** MCP server exposing filesystem-backed project data (docs, kanban, progress)
**Researched:** 2026-02-22
**Confidence:** HIGH — MCP spec and tool design patterns verified against official protocol spec (2025-06-18) and Anthropic's reference filesystem server

---

## Context: What "User" Means Here

The primary consumer of this MCP server is Claude Code, not a human. "User expects" means "Claude Code (or any LLM) expects this behavior for reliable, accurate tool use." The secondary consumer is Reza registering tools in `.mcp.json` and reading tool output in conversations.

**Already built (not in scope):** Static site (HTML/CSS/JS SPA), GitHub Pages deploy, kanban board and progress tracker views, split-file JSON data layer (`data/docs/`, `data/kanban/`, `data/progress/`).

**In scope:** MCP server features only — what tools to build, what behaviors they must have, what naming and description patterns make LLM tool selection accurate.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features Claude Code (and any MCP-capable LLM) assumes exist in any well-formed MCP server. Missing these = tool calls fail, select the wrong tool, or produce corrupt data.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `list_docs` tool | LLM cannot know what docs exist without a catalog; must discover before reading | LOW | Reads `data/docs/index.json` (schemaVersion 1, `docs[]` array of `{slug, title}`). Returns slug + title pairs. Dependency: existing index.json. |
| `read_doc` tool | Core read operation; LLM uses list to discover slug, then reads content | LOW | Reads `data/docs/{slug}.md`. Returns raw markdown as text content. Errors clearly on unknown slug with `isError: true`. Dependency: existing markdown files. |
| `get_kanban` tool | LLM needs full board state to reason about tasks, columns, and what to do next | MEDIUM | Reads `data/kanban/index.json` + all per-task files. Returns denormalized result: `{ columns: string[], tasks: Task[] }`. One call, complete board. Dependency: existing split-file kanban data. |
| `get_progress` tool | LLM needs milestone state to understand project phase and what's complete | MEDIUM | Reads `data/progress/index.json` + all per-milestone files. Returns milestone list with status, task counts, notes. Dependency: existing split-file progress data. |
| `add_task` tool | Write capability; LLM must create tasks as work is identified during conversations | MEDIUM | Writes new per-task file to `data/kanban/`, updates `index.json` tasks array. Zod validates: id, title, column, description, assignee. Atomic: entity file first, then index. |
| `move_task` tool | Moving tasks between columns is the fundamental kanban workflow action | LOW | Updates `column` field in existing task file. Validates target column exists in `index.json` columns array before writing. |
| `update_progress` tool | Progress data that can't be updated goes stale and becomes untrustworthy | MEDIUM | Updates fields in per-milestone file. Zod validates status enum (backlog/in-progress/done) and numeric task counts. |
| Zod input validation on all write tools | LLM tool calls must fail fast with clear messages when schema is wrong — prevents corrupt data that breaks site rendering | MEDIUM | Every write tool validates full input with Zod before touching filesystem. Returns `isError: true` with field-level detail on validation failure. |
| Atomic writes on write tools | Partial writes corrupt the split-file data layer — site renders broken state | MEDIUM | Write entity file first, update index second. On index failure, log but do not revert entity file — orphaned entity file is safe; orphaned index entry is broken. |
| `isError: true` on tool failures | MCP spec defines two error tiers; returning errors as success confuses LLM and breaks retry logic | LOW | All tool handlers wrap execution in try/catch. Filesystem errors, invalid slugs, validation failures all return `isError: true` with descriptive text content. Protocol errors (unknown tool, malformed request) handled by SDK automatically. |
| snake_case tool names | LLM tokenization (GPT-4o, Claude) performs best with snake_case; inconsistent casing signals poor quality; convention in all MCP reference servers | LOW | All 7 tools: `list_docs`, `read_doc`, `get_kanban`, `get_progress`, `add_task`, `move_task`, `update_progress`. |
| Verb-first tool names | MCP convention; name communicates the action not the subject | LOW | Names follow `verb_noun`: `list_docs`, `read_doc`, `get_kanban`, `add_task`, `move_task`, `update_progress`, `get_progress`. |
| Precise parameter descriptions in inputSchema | LLM reads parameter `description` fields to form correct call arguments — vague descriptions cause wrong values | LOW | Every parameter has a description: type, format, valid values, and constraints. Example: `column` on `add_task` — "Must match one of the column names in the kanban index (e.g., 'Backlog', 'In Progress', 'Done')." |
| Action-first tool descriptions | Tool `description` field is how LLM decides which tool to call; vague or noun-first descriptions cause misselection | LOW | Each description leads with an imperative verb and states what the tool returns. Example: "List all documentation files available in the project. Returns slug and title for each doc. Call this before read_doc to discover valid slugs." |
| stdio transport | Claude Code uses stdio MCP registration; HTTP transport is out of scope for v1.1 | LOW | Server speaks stdio via `@modelcontextprotocol/sdk`. Launched via `node dist/index.js`. `.mcp.json` in repo root handles registration. |
| `.mcp.json` project-scope config | Claude Code discovers MCP servers via project-scoped `.mcp.json` — without this file the server is never loaded | LOW | File at repo root: `{ "mcpServers": { "keloia": { "type": "stdio", "command": "node", "args": ["mcp-server/dist/index.js"] } } }`. |

### Differentiators (Competitive Advantage)

Features that make this MCP server more useful than a generic filesystem server for this project.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Denormalized kanban response | Generic filesystem tools return raw JSON; this tool assembles the full board state (columns + all task objects) in one call — LLM never needs to read index then loop over task files manually | MEDIUM | `get_kanban` reads index then reads all N task files. Returns `{ columns: string[], tasks: Task[] }`. Dependency: split-file kanban data (already built). |
| Column filter on `get_kanban` | LLM can request "show me only In Progress tasks" without loading the full board — reduces tokens on large boards | LOW | Optional `column` param filters tasks array before return. Validate against known columns from index; return error if column unknown. |
| Assignee filter on `get_kanban` | LLM can scope to tasks for one person in multi-assignee projects | LOW | Optional `assignee` param. Simple string equality match on task's assignee field. Null-safe: tasks with null assignee never match. |
| Computed `percentComplete` on `get_progress` | Returns `percentComplete` derived from `tasksCompleted / tasksTotal` — LLM gets ready-to-use number instead of computing it from raw fields | LOW | `Math.round((tasksCompleted / tasksTotal) * 100)`. Guard against division by zero (return 0 when total is 0). |
| Domain-specific tool names over generic filesystem names | `read_doc` is unambiguous to LLM; `read_file` with a path parameter requires LLM to know the correct path, which is fragile | LOW | Opinionated naming for this domain. Generic filesystem server is wrong tool here — path knowledge should not live in LLM prompts. |
| Human-readable validation error messages on write failures | When `add_task` fails because column doesn't exist, error message names the valid columns — LLM can self-correct without user intervention | LOW | Error text template: "Column '{value}' not found. Valid columns are: Backlog, In Progress, Done." Generate from actual index data, not hardcoded list. |
| Schema version assertion on reads | If data files change schema, tool fails informatively rather than returning malformed data silently | LOW | Read `schemaVersion` from index files. If not `1`, return `isError: true` with message: "Unsupported schemaVersion: {n}. Expected 1." |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Generic `read_file` / `write_file` passthrough | Seems flexible; one tool covers everything | LLM constructs arbitrary paths, bypasses validation, corrupts data layer, reads unintended files (credentials, config) | Domain-specific tools with paths baked in. `read_doc` knows to look in `data/docs/`. Path is not an LLM concern. |
| `delete_task` tool | Logical complement to `add_task`; seems necessary for task lifecycle | Deletes are hard to recover in a no-undo filesystem system; LLM hallucinations could silently destroy data | `move_task` to Done column is the workflow signal for completed work. Delete is an admin operation the human does in an editor. |
| `create_doc` / `update_doc` write tools | Symmetric with read tools; LLM could maintain docs autonomously | Markdown files are the human developer's artifact; LLM writing markdown risks overwriting intentional prose and structure | Human edits docs directly. MCP server is read-only for docs (human-owned content), read-write only for structured kanban/progress data (machine-managed). |
| `search_docs` / full-text search | Useful for large doc sets | Adds complexity for a 2-doc corpus; out of scope per PROJECT.md ("add when >20 docs justify it") | `list_docs` + `read_doc` covers the current corpus. LLM can read all docs in two calls. |
| Batch write tools (e.g., `bulk_add_tasks`) | Seems efficient for creating multiple tasks | Atomicity complexity multiplies; partial batch failure is hard to report clearly; retry logic becomes complex | Single `add_task` per call. LLM calls it multiple times. Simple, predictable, easy to retry. |
| Caching / in-memory state | Faster reads on repeated calls | Reads are always fresh off disk — no caching means no staleness problem; single-user local server has no concurrent access issue | Read files on every tool call. For this scale (< 100 tasks, 5 milestones), file I/O is negligible. |
| Real-time file watching / push notifications | Interesting capability; keeps LLM in sync with human edits | Requires persistent server state; stdio transport is request-response only; `listChanged` notification not needed for single-user local setup | Fresh reads on every call. |
| Authentication / access control on tools | Correct for multi-user or remote scenarios | Local stdio server for one developer; auth adds configuration complexity with zero security benefit | Project repo visibility controls access at the source. |

---

## Feature Dependencies

```
list_docs
    └── reads ──> data/docs/index.json  [ALREADY BUILT: schemaVersion 1, docs[] array]

read_doc
    └── reads ──> data/docs/{slug}.md  [ALREADY BUILT]
    └── slug discovery via ──> list_docs  (call list_docs first; read_doc itself doesn't need list_docs at call time)

get_kanban
    └── reads ──> data/kanban/index.json  [ALREADY BUILT: columns[], tasks[] array of IDs]
    └── reads ──> data/kanban/task-{id}.json x N  [ALREADY BUILT: id, title, column, description, assignee]

add_task
    └── writes ──> data/kanban/task-{id}.json  (new file)
    └── updates ──> data/kanban/index.json  tasks[] array
    └── validates column against ──> index.json columns[]  (read at call time, not startup)
    └── requires ──> atomic write pattern  (entity file first, then index)

move_task
    └── reads + updates ──> data/kanban/task-{id}.json
    └── reads ──> data/kanban/index.json  (to validate target column)
    └── task must exist ──> created by add_task or pre-existing seed data

get_progress
    └── reads ──> data/progress/index.json  [ALREADY BUILT: milestones[] array of IDs]
    └── reads ──> data/progress/milestone-{id}.json x N  [ALREADY BUILT: id, phase, title, status, tasksTotal, tasksCompleted, notes]

update_progress
    └── reads + updates ──> data/progress/milestone-{id}.json
    └── milestone must exist ──> pre-existing in data layer

Zod validation ──enhances──> add_task, move_task, update_progress  (all write tools)

.mcp.json ──enables──> ALL tools  (server discovery by Claude Code)
```

### Dependency Notes

- **`add_task` reads index at call time to validate column:** Not at server startup. Column list is live from the file, so future schema changes are picked up automatically.
- **Atomic write order is critical:** Entity file before index. An orphaned entity file (file exists, not in index) is harmless — `get_kanban` only fetches indexed task IDs. An orphaned index entry (in index, no file) causes every subsequent `get_kanban` call to error on that task's file read.
- **`move_task` and `update_progress` have soft dependencies on seed data:** Seed tasks and milestones already exist in the data layer. These tools don't need `add_task` to run first in practice.
- **`.mcp.json` is a prerequisite for all tools:** Without it, Claude Code never starts the server. It is the entry point for every feature.
- **All read tools read fresh from disk:** No initialization step, no in-memory state. Server startup is just SDK initialization and tool registration.

---

## MVP Definition

### Launch With (v1.1 — Current Milestone)

Minimum to make the MCP server useful for daily Claude Code usage on this project.

- [ ] `list_docs` — Without it, LLM must guess doc slugs or ask user; defeats the purpose of MCP
- [ ] `read_doc` — Core reason to have MCP access to docs at all
- [ ] `get_kanban` — LLM needs full board state to participate in task planning
- [ ] `get_progress` — LLM needs milestone state to understand project phase
- [ ] `add_task` with Zod validation — Write capability; LLM can capture new work items during conversations
- [ ] `move_task` with column validation — Write capability; LLM can update board state as work completes
- [ ] `update_progress` with Zod validation — Write capability; LLM can update milestone tracking
- [ ] Atomic write pattern on all write tools — Data integrity is non-negotiable; the site renders this data
- [ ] `isError: true` error handling — All tool failures reported correctly per MCP spec
- [ ] `.mcp.json` project-scope registration — Server must be discoverable by Claude Code

### Add After Validation (v1.x)

Add when daily usage reveals the gap.

- [ ] Column filter on `get_kanban` — Add when board exceeds ~10 tasks and full board response feels excessive
- [ ] Assignee filter on `get_kanban` — Add when project has more than one assignee
- [ ] Computed `percentComplete` on `get_progress` — Add when LLM is observed computing this manually
- [ ] Schema version assertion on reads — Add when a schema migration actually creates the risk

### Future Consideration (v2+)

Defer until a clear need emerges from actual usage.

- [ ] HTTP/SSE transport — Add when remote Claude access is needed; PROJECT.md explicitly defers this
- [ ] `search_docs` — Add when doc count exceeds 20 (PROJECT.md threshold)
- [ ] Output schemas (`outputSchema`) on read tools — Optional MCP 2025-06-18 feature; useful for typed clients but not needed for stdio Claude Code usage
- [ ] `docs://` MCP resource template — Parallel access pattern for non-tool MCP clients; add when a second client type is needed

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `list_docs` | HIGH | LOW | P1 |
| `read_doc` | HIGH | LOW | P1 |
| `get_kanban` (full denormalized board) | HIGH | LOW | P1 |
| `get_progress` (full milestones) | HIGH | LOW | P1 |
| `add_task` with Zod validation | HIGH | MEDIUM | P1 |
| `move_task` with column validation | HIGH | LOW | P1 |
| `update_progress` with Zod validation | HIGH | MEDIUM | P1 |
| Atomic write pattern | HIGH | MEDIUM | P1 |
| `.mcp.json` config | HIGH | LOW | P1 |
| `isError: true` error handling | HIGH | LOW | P1 |
| Action-first tool descriptions | HIGH | LOW | P1 — quality of strings only, zero implementation cost |
| Precise parameter descriptions | HIGH | LOW | P1 — quality of strings only |
| Column filter on `get_kanban` | MEDIUM | LOW | P2 |
| Human-readable validation error messages | MEDIUM | LOW | P2 |
| Computed `percentComplete` | LOW | LOW | P2 |
| Schema version assertion | LOW | LOW | P2 |
| Assignee filter on `get_kanban` | LOW | LOW | P3 |
| HTTP/SSE transport | LOW | HIGH | P3 |
| `search_docs` | LOW | MEDIUM | P3 |
| `outputSchema` on read tools | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for v1.1 launch
- P2: Should have, add in v1.x when gap appears
- P3: Nice to have, v2+ consideration

---

## MCP Tool Design Reference

Findings from the official MCP spec and reference implementations that directly apply to this project's tool implementations.

### Naming convention (HIGH confidence — official spec + reference servers)
Use `verb_noun` snake_case. The official Anthropic filesystem server uses: `read_file`, `write_file`, `list_directory`, `move_file`, `create_directory`. This project follows the same pattern: `list_docs`, `read_doc`, `get_kanban`, `add_task`, `move_task`, `update_progress`, `get_progress`.

### Tool description pattern (HIGH confidence — official tutorial + SEP-1382)
1-2 sentences. Lead with imperative verb. State what the tool returns. Include when to use it (especially in relation to other tools). Example:

```
"List all documentation files available in the project. Returns slug and title for each doc.
 Call this before read_doc to discover valid slugs."
```

AI agents may not read the full description if it is long — put the most critical information first.

### Parameter description pattern (HIGH confidence — official tutorial)
State the type, format, valid values, and constraints. For closed-set values, enumerate examples. Example for the `column` parameter on `add_task`:

```
"The column to place the task in. Must match an existing column name in the kanban
 index (e.g., 'Backlog', 'In Progress', 'Done')."
```

### Error handling pattern (HIGH confidence — official MCP spec 2025-06-18)
Two tiers:
1. **Protocol errors** (JSON-RPC level): Unknown tool names, malformed requests. Handled automatically by the MCP SDK. Do not manually produce these.
2. **Execution errors** (`isError: true` in tool result): Business logic failures — unknown slug, invalid column, validation failure, file not found. These are the errors tool implementations produce.

```typescript
return {
  content: [{ type: "text", text: "Column 'Sprint' not found. Valid columns are: Backlog, In Progress, Done." }],
  isError: true
};
```

### Atomic write pattern for split-file data (HIGH confidence — derived from data layer design)
```
1. Validate input with Zod — fail early, no filesystem changes yet
2. Derive output path from validated input
3. Write entity file (data/kanban/task-{id}.json or data/progress/milestone-{id}.json)
4. Read current index.json
5. Update the index array in memory
6. Write updated index.json
7. Return success content
```

On step 6 failure: entity file exists without index entry. This is the safe failure mode — `get_kanban` only fetches tasks listed in the index. The inverse (index updated, no entity file) causes every subsequent board read to error.

### Tool response content type (HIGH confidence — official MCP spec 2025-06-18)
Return structured data as a JSON string in a `text` content block for backwards compatibility. Optionally also populate `structuredContent` for typed clients. For this project's v1.1, text content is sufficient.

```typescript
return {
  content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
};
```

---

## Sources

- [MCP Specification 2025-06-18: Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — official protocol; tool data types, error handling, two-tier error model (HIGH confidence)
- [Anthropic Reference Filesystem MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) — canonical tool naming, description, and parameter patterns (HIGH confidence)
- [Writing Effective MCP Tools — official tutorial](https://modelcontextprotocol.info/docs/tutorials/writing-effective-tools/) — naming, description structure, parameter design, error message patterns (HIGH confidence)
- [SEP-1382: Documentation Best Practices for MCP Tools](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1382) — separation of tool description (selection) from parameter description (invocation) (MEDIUM confidence — community proposal, not ratified spec)
- [MCP Server Naming Conventions](https://zazencodes.com/blog/mcp-server-naming-conventions) — snake_case convention, verb-noun pattern, LLM tokenization rationale (MEDIUM confidence — community source, consistent with official patterns)
- [MCP Tool Descriptions Best Practices — Merge Dev](https://www.merge.dev/blog/mcp-tool-description) — 1-2 sentence descriptions, action-first pattern (MEDIUM confidence — practitioner source)

---
*Feature research for: MCP server exposing filesystem-backed project data (Keloia Docs v1.1)*
*Researched: 2026-02-22*
