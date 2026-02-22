# Phase 7: MCP Search + Doc CRUD Tools - Research

**Researched:** 2026-02-22
**Domain:** Node.js filesystem operations, MCP tool registration (TypeScript SDK), line-by-line regex/keyword search, atomic write patterns
**Confidence:** HIGH

---

## Summary

Phase 7 adds five MCP tools: `keloia_search_docs` (keyword or regex search across doc files with optional slug filter) and the CRUD trio `keloia_add_doc`, `keloia_edit_doc`, `keloia_delete_doc`. All five tools are pure filesystem operations — no external API, no auth, no new dependencies. This is the simplest write-surface phase in the roadmap.

The existing codebase already has working patterns for everything needed. `write.ts` demonstrates atomic write using `writeFileSync` + `renameSync`, index read-before-write discipline, slug validation against the index, and the `isError` response shape. `read.ts` demonstrates path-traversal protection via slug allowlist and the `readFileSync` pattern. The new tools follow identical patterns, just applied to `data/docs/` instead of `data/kanban/` or `data/progress/`.

The search tool is a line-by-line scan: read each doc file, split on `\n`, test each line against the keyword or compiled regex, extract a 150-character snippet centered on the match, and return `{ slug, title, lineNumber, snippet }` per match. This is sufficient for a corpus of fewer than 20 docs. No search library is needed or appropriate — this is a filesystem scan, not an in-memory index.

**Primary recommendation:** Create `mcp-server/src/tools/docs.ts` for all five new tools, register it in `server.ts`, and follow the existing `atomicWriteJson`/`atomicWriteText` pattern precisely. No new dependencies.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-05 | MCP tool `keloia_search_docs` searches doc content by keyword or regex | Line-by-line scan of `.md` files in `DOCS_DIR`; keyword uses `indexOf`, regex uses `new RegExp(pattern, 'gi')`; returns slug, title, snippet, lineNumber per match |
| SRCH-06 | MCP tool `keloia_search_docs` supports filtering by doc slug | Optional `slug` input param; when provided, filter `index.docs` to that single entry before scanning; return `isError` if slug not found in index |
| CRUD-06 | MCP tool `keloia_add_doc` creates a new markdown file in data/docs/ and updates the doc index — fails if slug already exists | Check index for slug, return `isError` if present; write `.md` file first (`atomicWriteText`), then update `index.json` (`atomicWriteJson`) |
| CRUD-07 | MCP tool `keloia_edit_doc` overwrites an existing doc file — fails if slug does not exist | Check index for slug, return `isError` if absent; `atomicWriteText` on `${slug}.md` |
| CRUD-08 | MCP tool `keloia_delete_doc` removes the doc file and removes the slug from the index — index is updated before file deletion | Update `index.json` first (remove slug), THEN call `unlinkSync` on the file |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` | Built-in (Node 24) | `readFileSync`, `writeFileSync`, `renameSync`, `unlinkSync` | Already used in `write.ts`; all required ops are synchronous and appropriate for MCP stdio handler |
| `node:path` | Built-in | `join()` for path construction | Already used throughout; prevents manual string concatenation errors |
| `zod` | ^3.25.0 (installed) | Input schema validation for MCP tool params | Already in `package.json`; all existing tools use it |
| `@modelcontextprotocol/sdk` | 1.26.0 (installed) | `McpServer` + `registerTool` | Already installed; version 1.26.0 supports both raw Zod shape (`{ slug: z.string() }`) and `z.object()` for `inputSchema` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | — | — | No additional dependencies needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Line-by-line `indexOf`/`RegExp` scan | MiniSearch (used in browser) | MiniSearch requires building an in-memory index; overkill for <20 docs MCP scan; line-by-line gives exact lineNumber which MiniSearch cannot |
| `unlinkSync` | `rm` from `node:fs` | Both work; `unlinkSync` is the traditional POSIX equivalent and matches the existing codebase style |
| Raw Zod shape `{ key: z.string() }` | `z.object({ key: z.string() })` | Both accepted by SDK 1.26.0; raw shape is what all existing tools use — match existing style |

**Installation:**
```bash
# No new packages needed — all dependencies already installed
```

---

## Architecture Patterns

### Recommended Project Structure

```
mcp-server/src/
├── tools/
│   ├── read.ts        # Existing: keloia_list_docs, keloia_read_doc, etc.
│   ├── write.ts       # Existing: keloia_add_task, keloia_move_task, etc.
│   └── docs.ts        # NEW: keloia_search_docs, keloia_add_doc, keloia_edit_doc, keloia_delete_doc
├── server.ts          # Update: import + call registerDocTools(server)
├── paths.ts           # No change needed — DOCS_DIR already exported
└── ...
```

### Pattern 1: Atomic Write Text File (new helper)

**What:** The existing `atomicWriteJson` helper in `write.ts` writes JSON atomically. A parallel `atomicWriteText` function is needed for markdown content.
**When to use:** `keloia_add_doc` and `keloia_edit_doc`.

```typescript
// Source: derived from existing atomicWriteJson in write.ts
import { writeFileSync, renameSync } from "node:fs";

function atomicWriteText(targetPath: string, text: string): void {
  const tmp = `${targetPath}.tmp`;
  writeFileSync(tmp, text, "utf-8");
  renameSync(tmp, targetPath);
}
```

### Pattern 2: Slug Validation (security — path traversal prevention)

**What:** Before constructing any file path from user input, validate the slug against a strict allowlist regex AND against the known slugs in `index.json`. Never pass raw user input to `join(DOCS_DIR, ...)` without validation.
**When to use:** All five tools.

```typescript
// Source: derived from existing slug validation in read.ts (index allowlist check)
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

// For add_doc: validate format first, then check NOT in index
if (!SLUG_RE.test(slug)) {
  return { isError: true, content: [{ type: "text" as const, text: `Invalid slug "${slug}". Use lowercase letters, numbers, and hyphens only.` }] };
}
if (index.docs.some((d) => d.slug === slug)) {
  return { isError: true, content: [{ type: "text" as const, text: `Slug "${slug}" already exists. Use keloia_edit_doc to update it.` }] };
}

// For edit_doc / delete_doc / search slug filter: check IS in index
if (!index.docs.some((d) => d.slug === slug)) {
  return { isError: true, content: [{ type: "text" as const, text: `No doc with slug "${slug}". Use keloia_list_docs to see available slugs.` }] };
}
```

### Pattern 3: Line-by-Line Search (keyword and regex)

**What:** Load each doc's markdown content, split on `\n`, test each line, extract a snippet centered on the match. Return one result entry per matching line (up to a safety cap).
**When to use:** `keloia_search_docs`.

```typescript
// Source: verified against Node.js docs + prototype testing 2026-02-22
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Build the pattern — keyword becomes a literal string search; regex is compiled
let compiled: RegExp | null = null;
if (useRegex) {
  try {
    compiled = new RegExp(pattern, "gi");
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Invalid regex: ${String(err)}` }],
    };
  }
}

const results: Array<{ slug: string; title: string; lineNumber: number; snippet: string }> = [];
const SNIPPET_WINDOW = 150;
const MAX_RESULTS = 50; // safety cap

for (const doc of docsToSearch) {
  const content = readFileSync(join(DOCS_DIR, `${doc.slug}.md`), "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let matchPos = -1;

    if (compiled) {
      compiled.lastIndex = 0; // reset global regex before each exec
      const m = compiled.exec(line);
      if (m) matchPos = m.index;
    } else {
      matchPos = line.toLowerCase().indexOf(pattern.toLowerCase());
    }

    if (matchPos !== -1) {
      const start = Math.max(0, matchPos - 40);
      const end = Math.min(line.length, start + SNIPPET_WINDOW);
      const snippet = line.slice(start, end).trim();
      results.push({ slug: doc.slug, title: doc.title, lineNumber: i + 1, snippet });
      if (results.length >= MAX_RESULTS) break;
    }
  }
  if (results.length >= MAX_RESULTS) break;
}
```

**Critical:** Reset `lastIndex` before each `exec()` call on a global regex — failing to do this causes the regex to skip matches across lines.

### Pattern 4: Delete Order (index before file)

**What:** Per success criterion #5, update `index.json` first, then call `unlinkSync`. This ensures that if the file deletion fails, the index is already consistent (the doc is gone from listings). A zombie `.md` file is far less harmful than a dangling index reference.
**When to use:** `keloia_delete_doc` exclusively.

```typescript
// Source: success criterion #5 + derived from existing atomicWriteJson pattern
// Step 1: Update index (remove slug)
const updatedDocs = index.docs.filter((d) => d.slug !== slug);
atomicWriteJson(join(DOCS_DIR, "index.json"), { ...index, docs: updatedDocs });

// Step 2: Delete file
unlinkSync(join(DOCS_DIR, `${slug}.md`));
```

### Pattern 5: Tool Registration in server.ts

**What:** Import `registerDocTools` from `docs.ts` and call it alongside the existing registrations.
**When to use:** After creating `docs.ts`.

```typescript
// server.ts — update
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerDocTools } from "./tools/docs.js";   // NEW

export function createServer(): McpServer {
  const server = new McpServer({ name: "keloia", version: "1.0.0" });
  registerReadTools(server);
  registerWriteTools(server);
  registerDocTools(server);   // NEW
  return server;
}
```

### Anti-Patterns to Avoid

- **Constructing a file path from user-supplied `slug` without validation first:** `join(DOCS_DIR, `${slug}.md`)` with `slug = '../etc/passwd'` would escape the docs directory. Always validate slug format AND check index allowlist before any `join()`.
- **Not resetting `lastIndex` on global regex:** A `RegExp` with the `g` flag maintains `lastIndex` between `exec()` calls. Call `compiled.lastIndex = 0` before each line test, or use `test()` carefully (it also mutates `lastIndex`). Using `exec()` with explicit reset is the safest approach.
- **Deleting the file before updating the index:** If `unlinkSync` succeeds but the index update fails, the index references a file that no longer exists. Always update index first.
- **Writing the file before updating the index in `add_doc`:** If the file is written but the index update fails, the file exists but nothing references it — a zombie. This is less harmful than a dangling reference, and matches the `keloia_add_task` pattern (`atomicWriteJson(taskFile)` then `atomicWriteJson(index)`). Keep this order for add_doc.
- **Allowing empty content on `add_doc`/`edit_doc`:** Zero-byte markdown files cause confusing behavior. Validate `content.length > 0` or trim and reject blank.
- **Using `writeFileSync` directly without `.tmp` + `renameSync`:** The atomic pattern (write to `.tmp`, then rename) prevents corrupt partial-writes if the process is interrupted mid-write.
- **Accepting `is_regex: true` without try/catch:** An invalid regex (e.g. `[unclosed`) throws a `SyntaxError` from `new RegExp()`. Always wrap in try/catch and return `isError`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic file write | Custom fsync-based writer | `writeFileSync(tmp) + renameSync(tmp, target)` | `rename()` is atomic at the OS level on POSIX; already proven in write.ts |
| Path traversal protection | Custom path sanitizer | Slug allowlist regex + index membership check | The combination of `SLUG_RE` and index lookup is sufficient and already in use for reads |
| Full-text ranking / TF-IDF | Custom scoring | Not needed | For <20 docs, first-match line-by-line scan returns actionable results without ranking overhead |

**Key insight:** Everything needed is already in the codebase. The new tools are compositional — reuse `atomicWriteJson`, `DOCS_DIR`, and the slug-allowlist pattern. Write no novel infrastructure.

---

## Common Pitfalls

### Pitfall 1: Global Regex `lastIndex` Drift Across Lines

**What goes wrong:** `compiled.exec(line)` on a `g`-flagged regex updates `compiled.lastIndex`. On the next line, `exec()` starts from `lastIndex` instead of position 0, skipping the start of the line and missing matches.

**Why it happens:** JavaScript global regexes maintain state between calls. This is expected behavior — it becomes a bug only when iterating across independent strings (lines).

**How to avoid:** Call `compiled.lastIndex = 0` before every `exec()` call inside the line loop. Alternatively, create a new `RegExp` from the source per-file (cheaper than per-line).

**Warning signs:** Search for a term that appears at the start of multiple lines — only some lines match when tested manually, but the tool returns fewer results than expected.

### Pitfall 2: Slug Filter Returns Zero Docs but No Error

**What goes wrong:** `keloia_search_docs` is called with `slug: "nonexistent"`. The tool filters `index.docs` to an empty array, then iterates zero docs, then returns an empty `results` array with `isError: false`. The caller sees success with no results — ambiguous.

**Why it happens:** Empty filter result looks like "no matches" rather than "bad input".

**How to avoid:** After applying the slug filter, if the filtered array is empty AND a slug filter was requested, return `isError: true` with a clear message: `No doc with slug "${slug}". Use keloia_list_docs to see valid slugs.`

### Pitfall 3: `add_doc` Slug Collision with Non-Index Files

**What goes wrong:** `mcp-guide.md` exists in `data/docs/` but is NOT in `index.json` (per Phase 6 decision). A caller tries `keloia_add_doc` with `slug: "mcp-guide"`. The index check passes (slug not in index), so the tool overwrites the existing `mcp-guide.md` file.

**Why it happens:** The slug uniqueness check only consults `index.json`, not the filesystem. `mcp-guide` is a filesystem orphan relative to the index.

**How to avoid:** In `keloia_add_doc`, after the index check passes, also check `existsSync(join(DOCS_DIR, `${slug}.md`))`. If the file exists despite not being in the index, return `isError: true`: `File "${slug}.md" already exists on disk (possibly an unindexed doc). Choose a different slug or investigate manually.`

**Warning signs:** `mcp-guide.md` gets silently overwritten when adding a doc with slug `mcp-guide`.

### Pitfall 4: Missing Build Step After TypeScript Changes

**What goes wrong:** Developer adds `docs.ts`, runs `node dist/index.js`, gets "Cannot find module" because the TypeScript was never compiled.

**Why it happens:** The MCP server runs from `dist/` (compiled JS). TypeScript changes require `npm run build` in `mcp-server/`.

**How to avoid:** Document in task verification steps: "Run `npm run build` in `mcp-server/` before testing." For development, use `npm run dev` (tsx) which runs TypeScript directly.

**Warning signs:** Module not found errors at runtime even though the `.ts` file exists.

### Pitfall 5: `title` Param Missing from `edit_doc` Description

**What goes wrong:** `keloia_edit_doc` only accepts `content`. But what if the caller also wants to update the title stored in `index.json`? Tool returns success but title is unchanged.

**Why it happens:** CRUD-07 says "overwrites an existing doc file" — it says nothing about updating the title. The title lives in `index.json`, not in the `.md` file.

**How to avoid:** Accept an optional `title` param on `keloia_edit_doc`. If provided, update the `index.json` entry for that slug. If not provided, leave the title unchanged. This is a small addition that prevents a frustrating gap.

---

## Code Examples

Verified patterns from project codebase and Node.js built-ins:

### Full `keloia_search_docs` Tool Registration

```typescript
// Source: derived from existing read.ts pattern + Node.js docs
server.registerTool(
  "keloia_search_docs",
  {
    description:
      "Searches keloia documentation files by keyword or regex pattern. Returns matching lines with slug, title, line number, and a text snippet. Use the optional slug parameter to narrow results to a single doc.",
    inputSchema: {
      pattern: z.string().min(1).describe("Keyword or regex pattern to search for"),
      slug: z.string().optional().describe("Optional doc slug to limit search to one document"),
      is_regex: z.boolean().optional().default(false).describe("If true, treat pattern as a regex (default: false — keyword search)"),
    },
  },
  async ({ pattern, slug, is_regex }) => {
    try {
      const index = JSON.parse(readFileSync(join(DOCS_DIR, "index.json"), "utf-8")) as {
        docs: Array<{ slug: string; title: string }>;
      };

      let docsToSearch = index.docs;

      if (slug !== undefined) {
        docsToSearch = docsToSearch.filter((d) => d.slug === slug);
        if (docsToSearch.length === 0) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `No doc with slug "${slug}". Use keloia_list_docs to see valid slugs.` }],
          };
        }
      }

      let compiled: RegExp | null = null;
      if (is_regex) {
        try {
          compiled = new RegExp(pattern, "gi");
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Invalid regex: ${String(err)}` }],
          };
        }
      }

      const results: Array<{ slug: string; title: string; lineNumber: number; snippet: string }> = [];
      const SNIPPET_WINDOW = 150;
      const MAX_RESULTS = 50;

      for (const doc of docsToSearch) {
        const content = readFileSync(join(DOCS_DIR, `${doc.slug}.md`), "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let matchPos = -1;

          if (compiled) {
            compiled.lastIndex = 0;
            const m = compiled.exec(line);
            if (m) matchPos = m.index;
          } else {
            matchPos = line.toLowerCase().indexOf(pattern.toLowerCase());
          }

          if (matchPos !== -1) {
            const start = Math.max(0, matchPos - 40);
            const end = Math.min(line.length, start + SNIPPET_WINDOW);
            results.push({ slug: doc.slug, title: doc.title, lineNumber: i + 1, snippet: line.slice(start, end).trim() });
            if (results.length >= MAX_RESULTS) break;
          }
        }
        if (results.length >= MAX_RESULTS) break;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Search failed: ${String(err)}` }],
      };
    }
  }
);
```

### Full `keloia_add_doc` Tool Registration

```typescript
// Source: derived from keloia_add_task in write.ts + existsSync check
server.registerTool(
  "keloia_add_doc",
  {
    description:
      "Creates a new markdown documentation file in data/docs/ and registers it in the doc index. Fails if the slug already exists. Do NOT use this to update an existing doc — use keloia_edit_doc instead.",
    inputSchema: {
      slug: z.string().min(1).describe("URL-safe slug (lowercase letters, numbers, hyphens only, e.g. 'my-doc')"),
      title: z.string().min(1).describe("Human-readable document title"),
      content: z.string().min(1).describe("Full markdown content of the document"),
    },
  },
  async ({ slug, title, content }) => {
    try {
      const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
      if (!SLUG_RE.test(slug)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Invalid slug "${slug}". Use lowercase letters, numbers, and hyphens only.` }],
        };
      }

      const indexPath = join(DOCS_DIR, "index.json");
      const index = JSON.parse(readFileSync(indexPath, "utf-8")) as {
        schemaVersion: number;
        docs: Array<{ slug: string; title: string }>;
      };

      if (index.docs.some((d) => d.slug === slug)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Slug "${slug}" already exists. Use keloia_edit_doc to update it.` }],
        };
      }

      const filePath = join(DOCS_DIR, `${slug}.md`);
      if (existsSync(filePath)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `File "${slug}.md" already exists on disk but is not in the index. Choose a different slug or investigate manually.` }],
        };
      }

      // Write file first, then update index
      atomicWriteText(filePath, content);
      atomicWriteJson(indexPath, { ...index, docs: [...index.docs, { slug, title }] });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ slug, title }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Failed to add doc: ${String(err)}` }],
      };
    }
  }
);
```

### `keloia_delete_doc` — Index Before File

```typescript
// Source: success criterion #5 + derived from write.ts atomicWriteJson pattern
server.registerTool(
  "keloia_delete_doc",
  {
    description:
      "Removes an existing keloia documentation file and deregisters it from the doc index. Fails if the slug does not exist. This operation is irreversible.",
    inputSchema: {
      slug: z.string().min(1).describe("Slug of the doc to delete"),
    },
  },
  async ({ slug }) => {
    try {
      const indexPath = join(DOCS_DIR, "index.json");
      const index = JSON.parse(readFileSync(indexPath, "utf-8")) as {
        schemaVersion: number;
        docs: Array<{ slug: string; title: string }>;
      };

      if (!index.docs.some((d) => d.slug === slug)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `No doc with slug "${slug}". Use keloia_list_docs to see valid slugs.` }],
        };
      }

      // Update index FIRST (success criterion: index updated before file deletion)
      const updatedDocs = index.docs.filter((d) => d.slug !== slug);
      atomicWriteJson(indexPath, { ...index, docs: updatedDocs });

      // Then delete the file
      unlinkSync(join(DOCS_DIR, `${slug}.md`));

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ deleted: slug }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Failed to delete doc: ${String(err)}` }],
      };
    }
  }
);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.tool()` (deprecated) | `server.registerTool()` | MCP SDK v1.x → v2 migration | SDK 1.26.0 supports both but marks `tool()` as deprecated — new tools should use `registerTool()` |
| `writeFileSync` directly | `writeFileSync(tmp) + renameSync` | Already adopted in write.ts | Atomic on POSIX; prevents partial-write corruption |

**Deprecated/outdated:**
- `server.tool()`: Marked `@deprecated` in SDK 1.26.0 — use `server.registerTool()`. All existing project tools already use `registerTool`.

---

## Open Questions

1. **Should `keloia_search_docs` also search `mcp-guide.md`?**
   - What we know: `mcp-guide.md` exists on disk but is not in `index.json` (per Phase 6 decision). The search tool iterates `index.docs`, so `mcp-guide` is excluded by default.
   - What's unclear: Whether it's useful for Claude Code to search the guide via MCP (it can read it directly via `keloia_read_doc` only if the slug is known, but since it's not in the index, `keloia_read_doc` would also reject it due to allowlist check).
   - Recommendation: Keep `keloia_search_docs` index-scoped only. The guide is a meta page, not a project doc. If the user wants to add it to search scope, it should be added to `index.json` as a proper doc. This is consistent with how `keloia_read_doc` works.

2. **Should `keloia_edit_doc` accept an optional `title` parameter?**
   - What we know: The title lives in `index.json` as `{ slug, title }`. The content lives in `${slug}.md`. There is no way to update the title via any existing tool.
   - What's unclear: Whether it belongs in Phase 7 or Phase 10 (site CRUD).
   - Recommendation: Include optional `title` in `keloia_edit_doc` now. It is a two-line addition (read the index, update the matching entry). Leaving it out creates a gap where Claude Code can update content but not titles — likely to cause confusion immediately.

3. **Result limit for `keloia_search_docs`**
   - What we know: With <20 docs and line-by-line scanning, a pathological pattern like `.` could match every line of every doc (hundreds of results).
   - What's unclear: What the right cap is.
   - Recommendation: Cap at 50 results total with a note in the response if truncated. This is generous for any real query and safe against noise patterns.

---

## Sources

### Primary (HIGH confidence)

- Existing project code: `/mcp-server/src/tools/write.ts` — `atomicWriteJson`, `nextTaskId`, `keloia_add_task` pattern (index-first discipline, error shapes)
- Existing project code: `/mcp-server/src/tools/read.ts` — `keloia_read_doc` slug allowlist pattern (path-traversal protection)
- Existing project code: `/mcp-server/src/paths.ts` — `DOCS_DIR` already exported
- Node.js v24.11.1 docs: `fs.writeFileSync`, `fs.renameSync`, `fs.unlinkSync`, `fs.existsSync` — all synchronous, all available
- `/modelcontextprotocol/typescript-sdk` (Context7) — `registerTool` API confirmed; raw Zod shape accepted in SDK 1.26.0
- Live prototype testing 2026-02-22: full search flow (keyword, regex, slug filter, empty results), all CRUD operations (add, duplicate detection, edit, delete, orphan file detection) tested against actual `data/docs/` files

### Secondary (MEDIUM confidence)

- Context7 MCP SDK migration docs — confirms `registerTool` is the correct API; `tool()` deprecated
- `data/docs/index.json` schema — `{ schemaVersion: 1, docs: [{ slug, title }] }` structure confirmed by reading live file

### Tertiary (LOW confidence)

- None required — all claims verified by codebase inspection and live prototype execution

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already installed and version-confirmed; no new packages
- Architecture: HIGH — all patterns derived from existing working code in the same file tree; search prototype executed successfully against real data
- Pitfalls: HIGH — `lastIndex` reset issue verified by documentation; orphan file collision is an observable edge case from Phase 6 decision; delete ordering is stated in success criteria

**Research date:** 2026-02-22
**Valid until:** 2026-03-24 (MCP SDK APIs stable; Node.js fs APIs stable; 30-day window)
