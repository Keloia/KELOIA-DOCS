# Phase 5: Write Tools + Integration - Research

**Researched:** 2026-02-22
**Domain:** MCP write tools (v1.26.0 SDK), atomic file writes (Node.js fs), Zod validation, README documentation
**Confidence:** HIGH

## Summary

Phase 5 completes the MCP server by adding three write tools (`keloia_add_task`, `keloia_move_task`, `keloia_update_progress`) to the already-working server from Phase 4. The implementation follows the identical `registerTool` pattern established in Phase 4 — same file structure, same error return shape, same `type: "text" as const` cast — with two new concerns: atomic writes and Zod input validation.

**Atomic writes** (WRITE-04) use a same-directory temp file + `renameSync` pattern. Write the full JSON to `{target}.tmp` in the same directory, then call `renameSync(tmp, target)`. On POSIX systems (macOS/Linux), `rename` is a single syscall — it is atomic. The target is only replaced if the write completes successfully. This satisfies success criterion 2: "interrupting the write mid-operation leaves valid, parseable JSON." This pattern is verified working on macOS (Darwin 25.2.0).

**Zod input validation** leverages the same raw shape `inputSchema` in `registerTool`. The SDK runs Zod parse before the handler is ever called — invalid inputs never enter the handler. For invalid enum values (e.g., bad column name), the tool must explicitly validate and return `isError: true` with the list of valid options because Zod's `.enum()` error surfaces automatically, but the error message format must be controlled to name valid columns (success criterion 4).

**INTG-03** (README) is independent of the tool code — it requires a `README.md` at the repo root (or `mcp-server/README.md`) covering clone, install, build, and register steps with `/mcp` verification. No existing README was found in the repo.

**Primary recommendation:** Implement all three write tools in `src/tools/write.ts` using the existing `registerWriteTools(server)` export pattern. Use atomic writes via `writeFileSync` + `renameSync`. Use Zod enum for column validation so the SDK surfaces column errors automatically. Wire `registerWriteTools` in `server.ts` after `registerReadTools`. Write a `README.md` covering the complete setup flow.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WRITE-01 | `keloia_add_task` creates a new kanban task with Zod-validated input and atomic write | Architecture Pattern: generate next task ID from index, write `task-NNN.json` atomically, update `index.json` atomically; Zod schema for `title`, `description`, `column`, `assignee` |
| WRITE-02 | `keloia_move_task` moves a task between columns with column validation and atomic write | Architecture Pattern: read task file, validate new column against `index.json` columns array, write updated task atomically; return isError for unknown task ID or invalid column |
| WRITE-03 | `keloia_update_progress` updates milestone fields with Zod-validated input and atomic write | Architecture Pattern: validate milestone ID against index, merge updates, write milestone file atomically |
| WRITE-04 | All write tools use atomic writes (same-directory temp file + `renameSync`) | Code Example: `writeFileSync(tmp, json); renameSync(tmp, target)` — POSIX rename is atomic |
| INTG-03 | README with setup instructions (clone, `npm install`, build, register) | Architecture Pattern: README at repo root, four sections: Prerequisites, Install, Build, Register + Verify |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `1.26.0` (installed) | `McpServer.registerTool()`, `CallToolResult` type | Already installed; v1.x stable, same API as Phase 4 |
| `zod` | `^3.25.0` (installed) | Tool input schema validation, enum validation for columns | Already installed; SDK integrates natively |
| `node:fs` | Node built-in | `writeFileSync`, `renameSync`, `readFileSync` | `renameSync` is the atomic write primitive |
| `node:path` | Node built-in | `join()` for target and temp file paths | Same as Phase 4 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` or counter | Node built-in or derived | ID generation for new tasks | Use counter derived from existing index tasks, not crypto — simpler and deterministic |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Counter-based task IDs (`task-005`) | UUID (`crypto.randomUUID()`) | UUIDs are globally unique but break the human-readable `task-NNN` naming already established in data files; counter matches existing scheme |
| `writeFileSync` + `renameSync` (atomic) | `writeFileSync` direct | Direct write truncates before write completes — power-cut or crash leaves empty file; renameSync is atomic on POSIX |
| Zod enum for columns | String + manual validation | Zod enum provides correct error messages automatically; manual validation duplicates logic |
| Merged Zod partial for `keloia_update_progress` | Full required schema | Milestone updates should allow partial fields — use `z.string().optional()` per field |

**Installation:** No new packages required — all dependencies present from Phase 3.

## Architecture Patterns

### Recommended Project Structure

```
mcp-server/src/
├── index.ts          # unchanged
├── server.ts         # add: import registerWriteTools, call it
├── transport.ts      # unchanged
├── paths.ts          # unchanged
└── tools/
    ├── read.ts       # complete from Phase 4 — DO NOT MODIFY
    └── write.ts      # implement all three tools here (Phase 5)
```

README location: `README.md` at repo root (covers both site and MCP server setup).

### Pattern 1: Tool Registration (same as Phase 4)

**What:** Export a `registerWriteTools(server: McpServer)` function, call `server.registerTool()` for each tool.
**When to use:** Same pattern as `registerReadTools` — keeps `server.ts` as a thin orchestrator.

```typescript
// Source: read.ts Phase 4 pattern, confirmed working
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { KANBAN_DIR, PROGRESS_DIR } from "../paths.js";

export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    "keloia_add_task",
    {
      description: "Creates a new task on the keloia kanban board...",
      inputSchema: { /* Zod raw shape */ },
    },
    async (args) => {
      // handler
    }
  );
}
```

### Pattern 2: Atomic Write (WRITE-04)

**What:** Write to a temp file in the same directory, then atomically rename to the final path.
**When to use:** Every write operation — task file writes, index file writes. Satisfies success criterion 2.

```typescript
// Source: Node.js fs docs + verified working on macOS (Darwin 25.2.0)
// POSIX rename() is a single syscall — atomic replacement of the target
import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

function atomicWriteJson(targetPath: string, data: unknown): void {
  const tmp = `${targetPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, targetPath);
}
```

The `.tmp` file must be in the SAME directory as the target. `renameSync` across filesystems (different devices) is NOT atomic — but since all files are in `data/kanban/` or `data/progress/`, this is not a concern here.

### Pattern 3: ID Generation for `keloia_add_task`

**What:** Derive the next task ID from the existing task list in `index.json`.
**When to use:** `keloia_add_task` to generate a new task file name.

```typescript
// Source: derived from actual data schema (index.json "tasks" array)
// tasks: ["task-001", "task-002", "task-003", "task-004"]
function nextTaskId(existingIds: string[]): string {
  if (existingIds.length === 0) return "task-001";
  const nums = existingIds.map((id) => parseInt(id.replace("task-", ""), 10));
  const next = Math.max(...nums) + 1;
  return "task-" + String(next).padStart(3, "0");
}
// Verified: ["task-001", ..., "task-004"] → "task-005"
```

### Pattern 4: Zod Input Schema for `keloia_add_task`

**What:** Validate required `title`, optional `description`/`assignee`, and validated `column`.
**When to use:** `keloia_add_task` input validation.

Column values are defined in `data/kanban/index.json`: `["Backlog", "In Progress", "Done"]`. Hard-code the enum in the Zod schema so the SDK reports the valid values in its error.

```typescript
// Source: data/kanban/index.json columns array (confirmed)
const VALID_COLUMNS = ["Backlog", "In Progress", "Done"] as const;

inputSchema: {
  title: z.string().min(1).describe("Task title (required, non-empty)"),
  column: z.enum(VALID_COLUMNS).default("Backlog").describe(
    "Column to place the task in. Valid values: Backlog, In Progress, Done"
  ),
  description: z.string().optional().describe("Task description"),
  assignee: z.string().optional().describe("Assignee name"),
},
```

Note: `z.enum()` with the column union covers WRITE-02's column validation too. For `keloia_move_task`, use the same `VALID_COLUMNS` constant.

### Pattern 5: Two-File Atomic Update for `keloia_add_task`

**What:** Adding a task requires two atomic writes: (1) the new task file, (2) updated index.
**When to use:** `keloia_add_task`. Both must succeed — partial update would leave index out of sync.

```typescript
// Order: write task file FIRST, then update index
// If step 1 fails, index is unchanged (no orphan reference)
// If step 2 fails, the task file exists but is not indexed (benign — not visible to reads)
// This ordering is safer than index-first

async (args) => {
  const index = JSON.parse(readFileSync(join(KANBAN_DIR, "index.json"), "utf-8")) as {
    schemaVersion: number;
    columns: string[];
    tasks: string[];
  };
  const newId = nextTaskId(index.tasks);
  const taskData = {
    id: newId,
    title: args.title,
    column: args.column ?? "Backlog",
    description: args.description ?? null,
    assignee: args.assignee ?? null,
  };
  // Step 1: Write task file atomically
  const taskPath = join(KANBAN_DIR, `${newId}.json`);
  atomicWriteJson(taskPath, taskData);
  // Step 2: Update index atomically
  const updatedIndex = { ...index, tasks: [...index.tasks, newId] };
  atomicWriteJson(join(KANBAN_DIR, "index.json"), updatedIndex);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(taskData, null, 2) }],
  };
}
```

### Pattern 6: `keloia_move_task` Implementation

**What:** Read the task file, validate the new column, update `column` field, write atomically.
**When to use:** WRITE-02.

```typescript
inputSchema: {
  id: z.string().describe("Task ID (e.g. 'task-001')"),
  column: z.enum(VALID_COLUMNS).describe(
    "Target column. Valid values: Backlog, In Progress, Done"
  ),
},

async ({ id, column }) => {
  // Validate task exists
  const index = JSON.parse(readFileSync(join(KANBAN_DIR, "index.json"), "utf-8")) as {
    tasks: string[];
    columns: string[];
  };
  if (!index.tasks.includes(id)) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Task not found: "${id}". Known tasks: ${index.tasks.join(", ")}` }],
    };
  }
  const taskPath = join(KANBAN_DIR, `${id}.json`);
  const task = JSON.parse(readFileSync(taskPath, "utf-8"));
  const updated = { ...task, column };
  atomicWriteJson(taskPath, updated);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }],
  };
}
```

### Pattern 7: `keloia_update_progress` Implementation

**What:** Validate milestone ID against index, merge only the provided fields, write atomically.
**When to use:** WRITE-03.

Milestone fields from actual data: `id`, `phase`, `title`, `status`, `tasksTotal`, `tasksCompleted`, `notes`.
Only `status`, `tasksTotal`, `tasksCompleted`, and `notes` are reasonable to update via tool.

```typescript
const VALID_STATUSES = ["pending", "in-progress", "done"] as const;

inputSchema: {
  id: z.string().describe("Milestone ID (e.g. 'milestone-01')"),
  status: z.enum(VALID_STATUSES).optional().describe(
    "Milestone status. Valid values: pending, in-progress, done"
  ),
  tasksTotal: z.number().int().min(0).optional().describe("Total task count"),
  tasksCompleted: z.number().int().min(0).optional().describe("Completed task count"),
  notes: z.string().nullable().optional().describe("Descriptive notes (null to clear)"),
},

async ({ id, ...updates }) => {
  const index = JSON.parse(readFileSync(join(PROGRESS_DIR, "index.json"), "utf-8")) as {
    milestones: string[];
  };
  if (!index.milestones.includes(id)) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Milestone not found: "${id}". Known: ${index.milestones.join(", ")}` }],
    };
  }
  const milestonePath = join(PROGRESS_DIR, `${id}.json`);
  const milestone = JSON.parse(readFileSync(milestonePath, "utf-8"));
  // Only merge fields that were explicitly provided (not undefined)
  const updatedMilestone = { ...milestone };
  if (updates.status !== undefined) updatedMilestone.status = updates.status;
  if (updates.tasksTotal !== undefined) updatedMilestone.tasksTotal = updates.tasksTotal;
  if (updates.tasksCompleted !== undefined) updatedMilestone.tasksCompleted = updates.tasksCompleted;
  if (updates.notes !== undefined) updatedMilestone.notes = updates.notes;
  atomicWriteJson(milestonePath, updatedMilestone);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(updatedMilestone, null, 2) }],
  };
}
```

### Pattern 8: Wiring in `server.ts`

```typescript
// src/server.ts — updated for Phase 5
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "keloia",
    version: "1.0.0",
  });
  registerReadTools(server);
  registerWriteTools(server);  // Add this line
  return server;
}
```

### Pattern 9: README Structure (INTG-03)

**What:** A `README.md` covering the complete setup flow from a fresh clone.
**When to use:** INTG-03 success criterion — "A developer following the README from a fresh clone can install, build, register, and verify."

README sections, in order:
1. **What this is** (1 paragraph) — project overview, two surfaces (site + MCP)
2. **Prerequisites** — Node.js version (18+), Claude Code installed
3. **Install** — `git clone`, `cd mcp-server`, `npm install`
4. **Build** — `npm run build` (produces `dist/index.js`)
5. **Register with Claude Code** — `.mcp.json` is already committed; Claude Code auto-registers from it. Open Claude Code in the repo root. Run `/mcp` to verify `keloia` appears as "connected".
6. **Available tools** — brief list of all 7 tools and their purpose
7. **Development** — `npm run dev` for tsx-based development (does not update Claude Code's server — requires rebuild)

### Anti-Patterns to Avoid

- **Writing to the target file directly (non-atomic):** `writeFileSync(targetPath, json)` truncates before writing — crash mid-write leaves an empty file. Always use temp + rename.
- **Temp file in a different directory from target:** If `/tmp/` is on a different filesystem from `data/kanban/`, `renameSync` will throw `EXDEV`. Keep temp file in the same directory: `targetPath + ".tmp"`.
- **Adding to index BEFORE writing the task file:** If task write fails after index update, the index references a file that doesn't exist. Write task file first; an un-indexed task file is benign.
- **`console.log()` in write handlers:** Still fatal — corrupts stdout JSON-RPC stream. All diagnostic output to `console.error()`.
- **Throwing on user-facing errors:** Same rule as read tools. Return `{ isError: true, content: [...] }` for invalid task ID, invalid column, bad milestone ID. Throw only for unexpected I/O failures (which the outer try/catch converts to isError).
- **Not returning the updated data in the success response:** The success response should include the created/updated object as JSON — allows Claude to confirm the write was correct.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Input validation | Manual type checks on handler args | Zod raw shape in `registerTool`'s `inputSchema` | SDK runs Zod parse before handler; invalid types never reach handler |
| Column enum validation | Manual `if (!['Backlog',...].includes(col))` check | `z.enum(VALID_COLUMNS)` in inputSchema | Zod enum produces a structured error naming valid values; SDK returns it automatically |
| Atomic writes | Transaction log, lock files | `writeFileSync(tmp) + renameSync(tmp, target)` | POSIX rename is a kernel primitive — guaranteed atomic on single filesystem |
| ID uniqueness | UUID, timestamp-based | Counter from existing index tasks | Matches existing `task-NNN` naming; deterministic and human-readable |
| Milestone field merging | Deep merge library | Shallow spread with explicit undefined checks | Milestone files are flat objects; spread is sufficient and obvious |

**Key insight:** The split-file JSON schema (index + individual files) was designed in Phase 1 to make both reads and writes straightforward. The index is the registry — always consult it, always update it.

## Common Pitfalls

### Pitfall 1: Temp File on Different Filesystem Than Target

**What goes wrong:** `renameSync('/tmp/task-005.json.tmp', 'data/kanban/task-005.json')` throws `EXDEV: cross-device link not permitted`.
**Why it happens:** `/tmp` and the repo root may be on different mount points; `rename(2)` cannot cross device boundaries.
**How to avoid:** Construct the temp path as `targetPath + ".tmp"` so it lives in the same directory as the target.
**Warning signs:** `EXDEV` error thrown from `renameSync`.

### Pitfall 2: Index Updated Before Task File Written

**What goes wrong:** Power cut or crash after updating `index.json` but before writing the new task file. Index now references `task-005` but the file doesn't exist. Next `keloia_get_kanban` call throws `ENOENT`.
**Why it happens:** Natural developer impulse is to "claim" the ID in the index first.
**How to avoid:** Write task file first. An un-indexed task file is invisible to read tools (they only read tasks in `index.json`). Benign.
**Warning signs:** `keloia_get_kanban` returning an error after a failed `keloia_add_task` call.

### Pitfall 3: Partial Milestone Update Overwrites Unchanged Fields

**What goes wrong:** Handler reads milestone, builds a new object with only the updated fields, writes it — losing `title`, `phase`, and other unchanged fields.
**Why it happens:** Developer constructs the write object from scratch instead of spreading the existing file.
**How to avoid:** Always start with `const updated = { ...existing }` and only apply the fields that were provided (not undefined).
**Warning signs:** Milestone `title` or `phase` disappears after `keloia_update_progress` call.

### Pitfall 4: Column Enum Hardcoded Inconsistently

**What goes wrong:** `VALID_COLUMNS` in `write.ts` diverges from actual `index.json` columns. A column added to `index.json` by direct edit is now invalid according to the tool.
**Why it happens:** Two sources of truth for columns: the index file and the Zod enum in code.
**How to avoid:** Document that `VALID_COLUMNS` is the authoritative list for MCP tools and matches `index.json`. If columns change, update both. For this project's scope (single developer, stable schema), this is acceptable. An alternative is to read columns from `index.json` at runtime — simpler Zod validation becomes manual but avoids drift.
**Warning signs:** Valid column is rejected by `keloia_move_task` or `keloia_add_task`.

### Pitfall 5: Forgetting to Rebuild After Phase 5 Implementation

**What goes wrong:** Write tools don't appear in Claude Code's `/mcp` status. Success criteria tests fail.
**Why it happens:** `.mcp.json` runs `node mcp-server/dist/index.js` — built output only.
**How to avoid:** Run `npm run build` in `mcp-server/` after all code changes. Verify with `/mcp` before running success criteria tests.
**Warning signs:** Tool count in `/mcp` unchanged (still 4 from Phase 4, not 7).

### Pitfall 6: `notes` Field Typed as `string | null` — Zod Handling

**What goes wrong:** Milestone `notes` can be `null` (see `milestone-05.json`). A Zod schema of `z.string().optional()` will reject `null` at runtime because `null !== undefined`.
**Why it happens:** TypeScript `optional` means the field may be absent; it does not mean it accepts `null`.
**How to avoid:** Use `z.string().nullable().optional()` for the `notes` field — accepts `string`, `null`, or `undefined`.
**Warning signs:** TypeScript compile error or Zod validation rejection when trying to set `notes: null`.

## Code Examples

Verified from installed SDK types, actual data files, and Node.js fs APIs:

### Complete `atomicWriteJson` Helper

```typescript
// Source: Node.js fs.renameSync docs + POSIX rename(2) atomicity guarantee
// Verified working on macOS (Darwin 25.2.0)
import { writeFileSync, renameSync } from "node:fs";

function atomicWriteJson(targetPath: string, data: unknown): void {
  const tmp = `${targetPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, targetPath);
}
```

### `keloia_add_task` — Full Tool Implementation

```typescript
const VALID_COLUMNS = ["Backlog", "In Progress", "Done"] as const;

function nextTaskId(existingIds: string[]): string {
  if (existingIds.length === 0) return "task-001";
  const nums = existingIds.map((id) => parseInt(id.replace("task-", ""), 10));
  return "task-" + String(Math.max(...nums) + 1).padStart(3, "0");
}

server.registerTool(
  "keloia_add_task",
  {
    description:
      "Creates a new task on the keloia kanban board. Writes a new task file and updates the kanban index. Returns the created task object with its generated ID. Provide a title; column defaults to Backlog.",
    inputSchema: {
      title: z.string().min(1).describe("Task title (required, non-empty)"),
      column: z.enum(VALID_COLUMNS).default("Backlog").describe(
        "Column to place the task in. Valid values: Backlog, In Progress, Done. Defaults to Backlog."
      ),
      description: z.string().optional().describe("Task description"),
      assignee: z.string().optional().describe("Assignee name"),
    },
  },
  async ({ title, column, description, assignee }) => {
    try {
      const indexPath = join(KANBAN_DIR, "index.json");
      const index = JSON.parse(readFileSync(indexPath, "utf-8")) as {
        schemaVersion: number;
        columns: string[];
        tasks: string[];
      };
      const newId = nextTaskId(index.tasks);
      const taskData = {
        id: newId,
        title,
        column: column ?? "Backlog",
        description: description ?? null,
        assignee: assignee ?? null,
      };
      // Write task file first (un-indexed task is benign if this fails)
      atomicWriteJson(join(KANBAN_DIR, `${newId}.json`), taskData);
      // Then update index
      atomicWriteJson(indexPath, { ...index, tasks: [...index.tasks, newId] });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(taskData, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Failed to add task: ${String(err)}` }],
      };
    }
  }
);
```

### `isError` Return for Invalid Input (success criterion 4)

```typescript
// When column validation fails, Zod handles it automatically via inputSchema enum
// But for task-ID-not-found errors, return explicitly:
return {
  isError: true,
  content: [{
    type: "text" as const,
    text: `Task not found: "${id}". Known tasks: ${index.tasks.join(", ")}`,
  }],
};

// For column validation (if doing runtime check instead of Zod enum):
return {
  isError: true,
  content: [{
    type: "text" as const,
    text: `Invalid column "${column}". Valid columns: ${VALID_COLUMNS.join(", ")}`,
  }],
};
```

### Updated `server.ts`

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "keloia",
    version: "1.0.0",
  });
  registerReadTools(server);
  registerWriteTools(server);
  return server;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `writeFileSync` directly to target | `writeFileSync(tmp) + renameSync(tmp, target)` | Best practice established | Direct writes leave empty target on crash; rename is POSIX atomic |
| `server.tool()` overloads | `server.registerTool()` | SDK v1.x ongoing | `tool()` marked `@deprecated`; same as Phase 4 |
| Monolithic tool file | Separate `read.ts` and `write.ts` | Phase 4 skeleton | Separation of concerns; `read.ts` is complete and stable, don't touch it |

**Deprecated/outdated:**
- `server.tool()`: deprecated in v1.26.0, use `server.registerTool()` — same decision as Phase 4
- Direct `writeFileSync` to target path without temp+rename: never safe for concurrent or interrupted writes

## Open Questions

1. **Columns enum: hardcode vs. runtime read from index.json**
   - What we know: Index has `["Backlog", "In Progress", "Done"]` — stable for this project
   - What's unclear: If columns change in the future, code and data diverge
   - Recommendation: Hardcode as `VALID_COLUMNS` constant in `write.ts` — schema is stable, hardcoding is simpler and produces cleaner Zod error messages. Document that changing columns requires updating this constant.

2. **Whether to export `VALID_COLUMNS` for testing or keep it module-private**
   - What we know: No test framework is part of the current stack
   - What's unclear: Future testing needs
   - Recommendation: Keep it unexported module-level const for Phase 5. No test framework to serve.

3. **README location: repo root vs. `mcp-server/README.md`**
   - What we know: INTG-03 says "README with setup instructions" without specifying location; no README exists yet
   - What's unclear: Whether the README should also cover the GitHub Pages site or only the MCP server
   - Recommendation: Create `README.md` at repo root. Cover both the static site (GitHub Pages) and the MCP server setup in separate sections. Repo root is the conventional location and is what GitHub displays by default.

## Sources

### Primary (HIGH confidence)

- Installed SDK types at `/Users/enjat/Github/keloia/keloia-docs/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` — `registerTool` signature confirmed (same as Phase 4)
- Actual data files read: `data/kanban/index.json` (columns, task IDs), `data/kanban/task-001.json` through `task-004.json` (task schema), `data/progress/index.json` (milestone IDs), `data/progress/milestone-01.json` and `milestone-05.json` (milestone schema including `null` notes field)
- Node.js fs API verified: `writeFileSync`, `renameSync` available; atomic rename pattern verified working on macOS (Darwin 25.2.0) via local test
- Phase 4 research and implementation — confirmed patterns, constraints, and decisions that carry forward unchanged
- `mcp-server/tsconfig.json` — `strict: true`, `module: Node16`, `target: ES2022` — confirms TypeScript constraints

### Secondary (MEDIUM confidence)

- POSIX rename(2) atomicity guarantee — well-documented OS primitive; single-filesystem constraint confirmed by errno EXDEV definition

### Tertiary (LOW confidence)

- None — all claims verified from project source files or Node.js built-in behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed; no new dependencies
- Architecture (write tools): HIGH — direct extension of Phase 4 patterns; `registerTool` API confirmed; data schemas read from actual files
- Atomic write pattern: HIGH — verified working on macOS; POSIX rename atomicity is a standard OS guarantee
- ID generation: HIGH — verified with `node -e` test against actual task IDs
- Pitfalls: HIGH — temp-file-same-directory and index-update-ordering are well-known patterns; Zod null/optional distinction is verified TypeScript behavior
- README (INTG-03): HIGH — straightforward documentation task; content is derived from project's known setup steps

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (30 days — SDK v1.x stable; atomic write pattern is not version-sensitive)
