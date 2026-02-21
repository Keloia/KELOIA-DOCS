# Phase 4: Read Tools - Research

**Researched:** 2026-02-22
**Domain:** MCP tool registration (v1.x SDK), file system reads, JSON denormalization, AI tool-selection through descriptions
**Confidence:** HIGH

## Summary

Phase 4 implements four read tools in the already-registered MCP server: `keloia_list_docs`, `keloia_read_doc`, `keloia_get_kanban`, and `keloia_get_progress`. The server skeleton from Phase 3 is wired and connected; this phase fills in `src/tools/read.ts` and registers the tools in `src/server.ts`. No new dependencies are required — the MCP SDK, Zod, and Node.js built-in `fs` cover everything.

The SDK installed in the project is `@modelcontextprotocol/sdk@1.26.0`, which uses the v1.x API. The preferred registration method going forward is `server.registerTool()` (the older `server.tool()` overloads are marked `@deprecated`). In v1.x, `registerTool` accepts a raw Zod shape object (not wrapped in `z.object()`) for `inputSchema`, which differs from the v2 pre-alpha pattern. Code examples below reflect the v1.26.0 installed API.

INTG-02 ("descriptive action-first tool descriptions") is the highest-leverage requirement in this phase. Success criterion 1–4 all test whether Claude picks the right tool without a prompt hint — this depends entirely on description quality. The pattern is: lead with the action verb and unique data domain, not the mechanism ("Returns all kanban columns with task objects denormalized" beats "Gets kanban data").

**Primary recommendation:** Implement all four tools in `src/tools/read.ts` as exported functions that accept a `McpServer` instance, call `server.registerTool()` for each tool, and read data with synchronous `fs.readFileSync` (reads are always fresh off disk per REQUIREMENTS.md out-of-scope list). Register them from `src/server.ts` by calling the export. Return `isError: true` with a human-readable message for all error cases.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| READ-01 | `keloia_list_docs` returns available documentation filenames from `data/docs/index.json` | Architecture Pattern: `registerTool` with no inputSchema; read `index.json`, return docs array as JSON text |
| READ-02 | `keloia_read_doc` reads a markdown file by slug with `max_tokens` and `offset` optional params for large doc pagination | Architecture Pattern: optional Zod params, `readFileSync`, substring pagination; error on missing slug |
| READ-03 | `keloia_get_kanban` returns denormalized board (columns + all task objects) from split-file JSON | Architecture Pattern: read `index.json`, read each `task-NNN.json`, assemble denormalized response |
| READ-04 | `keloia_get_progress` returns all milestones with status, task counts, and notes from split-file JSON | Architecture Pattern: read `index.json`, read each `milestone-NN.json`, assemble response |
| READ-05 | All read tools return `isError: true` with clear message for invalid inputs (bad slug, missing file) | Code Example: `{ isError: true, content: [{ type: "text", text: "..." }] }` return shape |
| INTG-01 | All tool names prefixed with `keloia_` to avoid Claude Code built-in collisions | Standard: prefix enforced in all `registerTool` calls |
| INTG-02 | Descriptive action-first tool descriptions for accurate AI tool selection | Architecture Pattern: description writing rules, verified by success criteria 1–4 |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `1.26.0` (installed) | `McpServer.registerTool()`, `CallToolResult` type | Already installed; v1.x stable API |
| `zod` | `^3.25.0` (installed) | Tool input schema validation | Already installed; required by SDK |
| `node:fs` | Node built-in | `readFileSync`, `existsSync` | Synchronous reads match "always fresh off disk" requirement; no caching |
| `node:path` | Node built-in | `join()` for path construction | Already used in `paths.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:url` | Node built-in | (already handled in `paths.ts`) | Not needed in read.ts directly — import path constants from `paths.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `readFileSync` (sync) | `fs.promises.readFile` (async) | Async would require `async` tool handlers — fine technically, but sync is simpler and latency is identical for local file reads at this scale |
| Raw shape `inputSchema` (v1.x style) | `z.object({...})` wrapped schema (v2 style) | v1.x SDK accepts both but raw shape is the documented v1.x pattern; `z.object()` wrapping is required for v2 only |
| Inline tool registration | Exported `registerReadTools(server)` function | Inline in `server.ts` would conflate concerns; exported function keeps `server.ts` as a thin orchestrator |

**Installation:** No new packages required — all dependencies already present from Phase 3.

## Architecture Patterns

### Recommended Project Structure

```
mcp-server/src/
├── index.ts          # unchanged from Phase 3
├── server.ts         # add: import registerReadTools, call it
├── transport.ts      # unchanged from Phase 3
├── paths.ts          # unchanged from Phase 3
└── tools/
    ├── read.ts       # implement all four tools here (READ-01 through READ-05)
    └── write.ts      # still placeholder for Phase 5
```

No new files needed. `types/` and `utils/` remain empty placeholders unless a shared type or utility emerges during implementation.

### Pattern 1: Tool Registration with `registerTool` (v1.26.0)

**What:** Register a tool with a description, optional input schema, and handler callback.
**When to use:** All four tools in Phase 4. `server.tool()` overloads still work but are deprecated.

```typescript
// Source: mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts
// v1.26.0 registerTool signature (confirmed from installed types):
//   registerTool(name, config, cb)
//   config: { title?, description?, inputSchema?, outputSchema?, annotations?, _meta? }
//   inputSchema: raw ZodRawShape (NOT z.object() wrapped — that's v2)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    "keloia_list_docs",
    {
      description: "Lists all available documentation files in the keloia docs library. Returns filenames and slugs that can be passed to keloia_read_doc.",
    },
    async () => {
      // handler body
      return { content: [{ type: "text", text: "..." }] };
    }
  );
}
```

### Pattern 2: Tool with Optional Input Schema

**What:** Tool accepting optional parameters uses a Zod raw shape with `.optional()` fields.
**When to use:** `keloia_read_doc` (slug required, max_tokens and offset optional).

```typescript
server.registerTool(
  "keloia_read_doc",
  {
    description: "Reads the full markdown content of a documentation file by its slug. Use keloia_list_docs first to discover valid slugs. Supports pagination via max_tokens and offset for large documents.",
    inputSchema: {
      slug: z.string().describe("The document slug, e.g. 'architecture' or 'value-proposition'"),
      max_tokens: z.number().optional().describe("Maximum characters to return (for large doc pagination)"),
      offset: z.number().optional().describe("Character offset to start from (for large doc pagination)"),
    },
  },
  async ({ slug, max_tokens, offset }) => {
    // handler body
  }
);
```

### Pattern 3: Error Return (READ-05)

**What:** Return `isError: true` with a human-readable text content item.
**When to use:** Invalid slug, missing file, JSON parse failure.

```typescript
// Source: confirmed in types.d.ts — CallToolResult has optional isError: boolean
// and content: array of content items

return {
  isError: true,
  content: [{ type: "text", text: `Document not found: no doc with slug "${slug}" exists` }],
};
```

Do NOT throw an exception for user-facing errors (bad slug, missing file). Throwing causes the MCP protocol to return a JSON-RPC error, which is harder for Claude to interpret than a tool result with `isError: true`. Throw only for unexpected internal errors.

### Pattern 4: Denormalized Kanban Assembly (READ-03)

**What:** Read the index, then read each referenced task file, return a combined object.
**When to use:** `keloia_get_kanban`.

Data structure from actual files:
- `data/kanban/index.json`: `{ schemaVersion: 1, columns: ["Backlog", "In Progress", "Done"], tasks: ["task-001", "task-002", ...] }`
- `data/kanban/task-NNN.json`: `{ id, title, column, description, assignee }`

```typescript
server.registerTool(
  "keloia_get_kanban",
  {
    description: "Returns the complete keloia kanban board with all columns and their tasks. Tasks are denormalized — each task object is embedded in the response rather than referenced by ID. Use this to view all work items and their current status.",
  },
  async () => {
    const indexPath = join(KANBAN_DIR, "index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf-8")) as {
      schemaVersion: number;
      columns: string[];
      tasks: string[];
    };

    const allTasks = index.tasks.map((taskId) => {
      const taskPath = join(KANBAN_DIR, `${taskId}.json`);
      return JSON.parse(readFileSync(taskPath, "utf-8"));
    });

    // Group tasks by column for denormalized output
    const board = index.columns.map((col) => ({
      column: col,
      tasks: allTasks.filter((t) => t.column === col),
    }));

    return {
      content: [{ type: "text", text: JSON.stringify({ columns: board }, null, 2) }],
    };
  }
);
```

### Pattern 5: Progress Assembly (READ-04)

**What:** Read milestone index, then read each milestone file.
**When to use:** `keloia_get_progress`.

Data structure from actual files:
- `data/progress/index.json`: `{ schemaVersion: 1, milestones: ["milestone-01", "milestone-02", ...] }`
- `data/progress/milestone-NN.json`: `{ id, phase, title, status, tasksTotal, tasksCompleted, notes }`

```typescript
server.registerTool(
  "keloia_get_progress",
  {
    description: "Returns milestone progress for all keloia project phases. Each milestone includes status (done/in-progress/pending), task counts, and descriptive notes. Use this to check overall project status and what is complete.",
  },
  async () => {
    const indexPath = join(PROGRESS_DIR, "index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf-8")) as {
      schemaVersion: number;
      milestones: string[];
    };

    const milestones = index.milestones.map((milestoneId) => {
      const milestonePath = join(PROGRESS_DIR, `${milestoneId}.json`);
      return JSON.parse(readFileSync(milestonePath, "utf-8"));
    });

    return {
      content: [{ type: "text", text: JSON.stringify({ milestones }, null, 2) }],
    };
  }
);
```

### Pattern 6: Wiring `registerReadTools` in `server.ts`

**What:** Import and call the exported registration function from `server.ts`.
**When to use:** After implementing `read.ts`.

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./tools/read.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "keloia",
    version: "1.0.0",
  });
  registerReadTools(server);
  return server;
}
```

### Pattern 7: INTG-02 — Description Writing Rules

Claude Code selects tools based on the tool's `description` field in the MCP tool manifest. Success criteria 1–4 test that Claude invokes the correct tool WITHOUT a prompt hint naming the tool. Description quality is the sole signal.

**Rules:**
1. Lead with an action verb that matches natural language ("Lists", "Reads", "Returns")
2. Name the specific data domain in the first sentence ("kanban board", "documentation files", "milestone progress")
3. Distinguish each tool from the others — no two tools should be interchangeable from description alone
4. Include user-facing intent ("Use this to view all work items and their current status")
5. Mention related tools when chaining is expected (`keloia_list_docs` should mention it provides slugs for `keloia_read_doc`)

**Description review — each tool:**

| Tool | First-sentence target |
|------|-----------------------|
| `keloia_list_docs` | "Lists all available documentation files in the keloia docs library." |
| `keloia_read_doc` | "Reads the full markdown content of a documentation file by its slug." |
| `keloia_get_kanban` | "Returns the complete keloia kanban board with all columns and their tasks." |
| `keloia_get_progress` | "Returns milestone progress for all keloia project phases." |

### Anti-Patterns to Avoid

- **Throwing errors for user-facing problems:** Throw only for unexpected internal errors. For bad slugs or missing files, return `{ isError: true, content: [...] }`. Throwing causes a JSON-RPC error response instead of a tool result, which may not surface as a readable message.
- **Path construction from user input without validation:** Never do `join(DOCS_DIR, slug + ".md")` without verifying the slug is in the known list first. A slug of `../../etc/passwd` would traverse outside the docs directory.
- **`console.log()` in tool handlers:** Still fatal in Phase 4 — corrupts stdout JSON-RPC stream. All diagnostic output goes to `console.error()`.
- **Caching reads in module-level variables:** REQUIREMENTS.md explicitly excludes caching. Reads must be fresh off disk every call.
- **`process.cwd()` for path construction:** Already established as fatal in Phase 3. Use imported constants from `paths.ts`.
- **Ambiguous tool descriptions:** Generic descriptions like "Gets data" or "Reads files" will cause Claude to pick the wrong tool or ask which one to use. Every description must make the tool's unique purpose unambiguous.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool input validation | Manual type checks on args | Zod schema in `inputSchema` | SDK runs Zod parse before calling handler; invalid inputs never reach the handler |
| JSON-RPC error response shape | Custom error object | `{ isError: true, content: [...] }` return | MCP protocol defines this shape; SDK serializes it correctly |
| Path traversal protection | Custom regex/whitelist check | Validate slug against `index.json` docs list | Index is the authoritative list; checking slug exists in it is simpler and more correct than path pattern matching |
| Markdown file discovery | `fs.readdirSync` + filter | Read `data/docs/index.json` | Index already exists and is the single source of truth; filesystem scan is out of sync with the index |
| Async file reading with retry | Custom retry logic | `readFileSync` (synchronous) | Local filesystem reads don't fail transiently; retry adds complexity with no benefit |

**Key insight:** The data layer (split-file JSON with index files) was designed in Phase 1 specifically so reads are straightforward. The index files are the authoritative lists — always start from them, never scan directories.

## Common Pitfalls

### Pitfall 1: Path Traversal via User-Supplied Slug

**What goes wrong:** `keloia_read_doc` constructs a file path from the `slug` parameter and reads it. A slug like `../../.mcp.json` reads outside the docs directory.
**Why it happens:** Developer trusts that "slug" input will be a simple filename. It won't be, by adversarial test.
**How to avoid:** Validate slug against the known slugs in `data/docs/index.json` before constructing any file path. If slug is not in the list, return `isError: true`. Do not construct the path at all for unknown slugs.
**Warning signs:** Success criterion 5 — "invalid slug returns `isError: true`" — also functions as the path traversal test.

### Pitfall 2: Tool Description Too Generic for Claude to Distinguish

**What goes wrong:** Claude asks "which tool should I use?" or invokes the wrong tool. Success criteria 1–4 fail.
**Why it happens:** Descriptions like "Gets kanban data" or "Returns JSON" don't tell Claude WHICH data or WHY it's distinct from other tools.
**How to avoid:** Each description must contain the unique data domain in the first sentence. Test by reading descriptions in isolation and asking: "if I only read this description, would I know exactly when to use this tool vs. the others?"
**Warning signs:** Success criteria 1–4 fail in verification — Claude picks the wrong tool or needs a hint.

### Pitfall 3: Forgetting to Rebuild Before Testing in Claude Code

**What goes wrong:** Tool changes don't show up in Claude Code. Claude still sees the old tool list (or no tools).
**Why it happens:** `.mcp.json` runs `node mcp-server/dist/index.js` — the built output. Changes to `src/` require `npm run build` to take effect.
**How to avoid:** Always rebuild before testing via Claude Code. Development iteration with `npm run dev` (tsx) is useful for local testing but Claude Code will not pick up tsx-run changes.
**Warning signs:** Tool not appearing in `/mcp` list after adding it, or tool behavior unchanged after code edit.

### Pitfall 4: JSON.parse Failure on Malformed Data Files

**What goes wrong:** Tool throws an unexpected error when a data file has invalid JSON. The error becomes a JSON-RPC protocol error rather than a clean `isError: true` response.
**Why it happens:** `JSON.parse()` throws on invalid JSON. If not caught, it propagates out of the tool handler.
**How to avoid:** Wrap file reads and JSON.parse in try/catch. Return `isError: true` for parse failures. This is also good for missing files (`readFileSync` throws `ENOENT`).
**Warning signs:** Tool invocation returns a protocol-level error rather than a tool result with content.

### Pitfall 5: `registerTool` Called After `server.connect()`

**What goes wrong:** Tools registered after the server is connected may not be visible to the client without reconnection.
**Why it happens:** The tool list is negotiated at connect time (or via `tools/list` on demand). Late registration may miss this window.
**How to avoid:** All `registerTool` calls happen in `createServer()` before `connectStdio(server)` is called. The existing `server.ts` / `index.ts` structure already enforces this.
**Warning signs:** Tool not appearing in Claude Code's tool list even after rebuild.

### Pitfall 6: Pagination Math Off-by-One

**What goes wrong:** `keloia_read_doc` with `offset` and `max_tokens` returns wrong slice of content.
**Why it happens:** String `substring(offset, offset + max_tokens)` vs `slice(offset, offset + max_tokens)` — both work identically for positive indices, but developers sometimes confuse the end-index vs length parameter.
**How to avoid:** Use `content.slice(offset ?? 0, (offset ?? 0) + max_tokens)` — `slice` with start and end, not length. Test with known content.
**Warning signs:** Returned content overlaps, is empty when it shouldn't be, or misses the last characters.

## Code Examples

Verified patterns from official sources and installed SDK types:

### Complete `read.ts` Tool Implementations

```typescript
// src/tools/read.ts
// Source: SDK types from mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DOCS_DIR, KANBAN_DIR, PROGRESS_DIR } from "../paths.js";

export function registerReadTools(server: McpServer): void {

  // READ-01: keloia_list_docs
  server.registerTool(
    "keloia_list_docs",
    {
      description:
        "Lists all available documentation files in the keloia docs library. Returns an array of slugs and titles. Use slugs with keloia_read_doc to fetch document content.",
    },
    async () => {
      try {
        const index = JSON.parse(readFileSync(join(DOCS_DIR, "index.json"), "utf-8"));
        return { content: [{ type: "text", text: JSON.stringify(index.docs, null, 2) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to read docs index: ${String(err)}` }],
        };
      }
    }
  );

  // READ-02: keloia_read_doc
  server.registerTool(
    "keloia_read_doc",
    {
      description:
        "Reads the full markdown content of a keloia documentation file by its slug. Use keloia_list_docs first to discover valid slugs. Supports optional pagination via max_tokens (character limit) and offset (character start position) for large documents.",
      inputSchema: {
        slug: z.string().describe("Document slug (e.g. 'architecture', 'value-proposition')"),
        max_tokens: z.number().optional().describe("Maximum characters to return"),
        offset: z.number().optional().describe("Character offset to start from"),
      },
    },
    async ({ slug, max_tokens, offset }) => {
      try {
        // Validate slug against known list (path traversal protection, READ-05)
        const index = JSON.parse(readFileSync(join(DOCS_DIR, "index.json"), "utf-8"));
        const known = index.docs.map((d: { slug: string }) => d.slug);
        if (!known.includes(slug)) {
          return {
            isError: true,
            content: [{ type: "text", text: `Document not found: no doc with slug "${slug}". Available: ${known.join(", ")}` }],
          };
        }
        const filePath = join(DOCS_DIR, `${slug}.md`);
        let content = readFileSync(filePath, "utf-8");
        if (offset !== undefined || max_tokens !== undefined) {
          const start = offset ?? 0;
          content = max_tokens !== undefined
            ? content.slice(start, start + max_tokens)
            : content.slice(start);
        }
        return { content: [{ type: "text", text: content }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to read doc "${slug}": ${String(err)}` }],
        };
      }
    }
  );

  // READ-03: keloia_get_kanban
  server.registerTool(
    "keloia_get_kanban",
    {
      description:
        "Returns the complete keloia kanban board with all columns and their tasks fully denormalized. Each column object contains an array of task objects (id, title, column, description, assignee). Use this to view all work items and their current status.",
    },
    async () => {
      try {
        const index = JSON.parse(readFileSync(join(KANBAN_DIR, "index.json"), "utf-8"));
        const allTasks = index.tasks.map((taskId: string) =>
          JSON.parse(readFileSync(join(KANBAN_DIR, `${taskId}.json`), "utf-8"))
        );
        const board = (index.columns as string[]).map((col) => ({
          column: col,
          tasks: allTasks.filter((t: { column: string }) => t.column === col),
        }));
        return { content: [{ type: "text", text: JSON.stringify({ columns: board }, null, 2) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to read kanban board: ${String(err)}` }],
        };
      }
    }
  );

  // READ-04: keloia_get_progress
  server.registerTool(
    "keloia_get_progress",
    {
      description:
        "Returns milestone progress for all keloia project phases. Each milestone includes its status (done/in-progress/pending), total and completed task counts, and descriptive notes. Use this to check which phases are complete and what is in progress.",
    },
    async () => {
      try {
        const index = JSON.parse(readFileSync(join(PROGRESS_DIR, "index.json"), "utf-8"));
        const milestones = index.milestones.map((id: string) =>
          JSON.parse(readFileSync(join(PROGRESS_DIR, `${id}.json`), "utf-8"))
        );
        return { content: [{ type: "text", text: JSON.stringify({ milestones }, null, 2) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to read progress data: ${String(err)}` }],
        };
      }
    }
  );
}
```

### Updated `server.ts` After Phase 4

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./tools/read.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "keloia",
    version: "1.0.0",
  });
  registerReadTools(server);
  return server;
}
```

### `isError: true` Return Shape (READ-05)

```typescript
// Source: types.d.ts in installed SDK — CallToolResult has optional isError: boolean
// Both content and isError are returned; content carries the human-readable message

return {
  isError: true,
  content: [{ type: "text" as const, text: "Clear error message here" }],
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.tool()` overloads | `server.registerTool()` | SDK v1.x ongoing | `tool()` marked `@deprecated` in v1.26.0 types; use `registerTool` |
| v2 `z.object({})` wrapping for inputSchema | v1.x raw shape `{ field: z.string() }` | v2 not yet released | v1.26.0 accepts raw shape; `z.object()` wrapping only required for v2 |
| Generic tool names (e.g. `read_file`) | Domain-prefixed names (`keloia_read_doc`) | Best practice enforced by INTG-01 | Avoids collision with Claude Code built-ins |
| Caching file reads | Always-fresh `readFileSync` | Project requirement | REQUIREMENTS.md explicitly excludes caching; reads are cheap at this scale |

**Deprecated/outdated:**
- `server.tool()` overloads: deprecated in v1.26.0, use `server.registerTool()` instead
- Wrapping inputSchema in `z.object()`: only required for v2 pre-alpha SDK, not v1.26.0

## Open Questions

1. **Whether `type: "text" as const` is required in content items**
   - What we know: TypeScript narrows `"text"` to `string` without `as const` in some contexts, which fails the `type: "text"` literal type check
   - What's unclear: Whether the tool handler return type inference is strict enough to require the cast in all cases
   - Recommendation: Use `as const` on `type: "text"` or explicitly type the content array to avoid runtime TypeScript errors during build

2. **Whether to pretty-print JSON with `null, 2` or compact**
   - What we know: `JSON.stringify(data, null, 2)` is more readable for Claude; compact is smaller
   - What's unclear: Whether Claude processes structured text better pretty-printed or compact
   - Recommendation: Use `null, 2` pretty-print — Claude's tool result parsing handles both, and readability aids debugging

3. **TypeScript type annotations for parsed JSON in handlers**
   - What we know: `JSON.parse()` returns `any` — downstream field accesses may silently be wrong
   - What's unclear: How strict to be (inline type assertions vs. Zod parse of the file content)
   - Recommendation: Use inline type assertions (`as { slug: string }[]`) for the index files — they're internal data with known schemas. Full Zod parsing of file content is overkill for Phase 4.

## Sources

### Primary (HIGH confidence)

- Installed SDK types at `/Users/enjat/Github/keloia/keloia-docs/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` — `registerTool` signature, `CallToolResult` type, `isError` field, deprecation notices on `tool()` overloads
- Installed SDK types at `...sdk/dist/esm/types.d.ts` — `CallToolResult` schema including `isError: ZodOptional<ZodBoolean>` and `content` array shape
- Phase 3 RESEARCH.md and actual built source files — confirmed project patterns (paths.ts, server.ts, transport.ts structure, import paths, Node16 moduleResolution)
- Data files read directly: `data/docs/index.json`, `data/kanban/index.json`, `data/kanban/task-001.json`, `data/progress/index.json`, `data/progress/milestone-01.json` — confirmed actual schema shapes
- `/modelcontextprotocol/typescript-sdk/__branch__v1.x` (Context7) — `registerTool` registration patterns, tool handler return shape

### Secondary (MEDIUM confidence)

- Context7 v1.x branch docs — `registerTool` with raw shape inputSchema (consistent with installed types)
- REQUIREMENTS.md "Out of Scope" section — confirmed caching exclusion, ts-node exclusion

### Tertiary (LOW confidence)

- None — all claims verified from installed SDK types or project source files

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — confirmed from installed `package.json` and `package-lock.json` (SDK 1.26.0, Zod 3.x)
- Architecture: HIGH — `registerTool` signature read directly from installed `.d.ts` types; data schemas read from actual data files
- Pitfalls: HIGH — path traversal risk is a well-known pattern; other pitfalls follow directly from Phase 3 established constraints (stdout, path resolution, rebuild cycle)
- Description quality (INTG-02): MEDIUM — description writing rules are derived from MCP best practices; actual Claude tool-selection behavior can only be verified by running success criteria

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (30 days — SDK v1.x is stable; check for new SDK releases before implementing)
