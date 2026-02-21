# Phase 3: MCP Foundation - Research

**Researched:** 2026-02-22
**Domain:** TypeScript MCP server skeleton — stdio transport, ESM module system, path resolution, Claude Code registration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Source organization:** Modular from the start — `src/tools/`, `src/utils/`, `src/types/` directories created in Phase 3 even if mostly empty. Tools grouped by domain in phases 4-5. Transport wiring is a separate module so swapping stdio for HTTP later means changing one import, not refactoring `index.ts`.
- **Dev workflow:** `tsx` for dev (instant TypeScript execution, no build step), `tsc` for production builds. Watch mode included: `npm run dev:watch`. Scripts: `npm run dev` (tsx), `npm run build` (tsc), `npm run dev:watch` (tsx --watch).

### Claude's Discretion

- Constants location: whether `REPO_ROOT`, `DOCS_DIR`, etc. live in a dedicated `paths.ts` or a broader `config.ts` — Claude picks what fits
- Entry point style: thin `index.ts` vs all-in-one — Claude picks based on server complexity
- `.mcp.json` target: built output (`node dist/index.js`) vs tsx source — Claude picks based on reliability tradeoffs
- Package scope: separate `mcp-server/package.json` vs shared root — Claude picks what keeps things clean
- Env var overrides for paths: whether to allow `KELOIA_REPO_ROOT` override or stick with pure `import.meta.url` resolution
- Path validation timing: startup validation vs per-tool validation
- `.mcp.json` command format: relative path vs npx/npm script

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | MCP server skeleton in `mcp-server/` with `@modelcontextprotocol/sdk`, `zod@^3.25.0`, TypeScript, `Node16` module resolution | Standard stack section covers exact package versions, tsconfig settings, and project structure |
| MCP-02 | Stdio transport via `StdioServerTransport` — zero `console.log()`, only `console.error()` | Architecture Patterns: stdio transport wiring pattern; Pitfall: stdout pollution kills the transport |
| MCP-03 | All file paths resolved from `import.meta.url`, never `process.cwd()` | Code Examples: `import.meta.url` path resolution pattern with `fileURLToPath` |
| MCP-04 | `.mcp.json` at repo root for Claude Code project-scope registration | Architecture Patterns: `.mcp.json` format and scope; Claude Code docs confirm exact format |
| MCP-05 | Code structured so transport layer is swappable for future HTTP/SSE | Architecture Patterns: transport abstraction; locked decision about separate transport module |
</phase_requirements>

## Summary

Phase 3 creates a TypeScript MCP server skeleton that registers with Claude Code via stdio transport. The implementation is disciplined infrastructure work: no tool logic, just proving that the toolchain (tsc + tsx), module system (ESM with Node16), path resolution (`import.meta.url`), and logging discipline (`console.error()` only) are all correct before tool code is written.

The SDK situation is critical to understand: REQUIREMENTS.md specifies `@modelcontextprotocol/sdk` with `zod@^3.25.0`, which targets the **v1.x line** of the SDK (latest: v1.27.0, published ~Feb 2025). Context7 documentation reflects a v2 pre-alpha rewrite (split into `@modelcontextprotocol/server`, requires `zod/v4`) that is NOT yet stable for production. The planner must use the v1.x SDK and Zod 3.x — do not use v2 patterns (`registerTool`, `@modelcontextprotocol/server`, `zod/v4`).

The most important constraint for this phase is stdout discipline: the stdio transport uses stdout as the JSON-RPC communication channel. Any `console.log()` call corrupts the protocol. This is the most common first-time mistake and produces mysterious "server not connecting" failures with no error message.

**Primary recommendation:** Create `mcp-server/` as a standalone package with its own `package.json`. Use `@modelcontextprotocol/sdk@^1.7.0` (latest stable v1.x), `zod@^3.25.0`, `Node16` module resolution with `.js` extensions on all relative imports, and `import.meta.url`-based path resolution. Target built output (`node dist/index.js`) in `.mcp.json` — tsx source works in dev but built output is more reliable for Claude Code's process spawning.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.7.0` (latest v1.x: 1.27.0) | MCP protocol, `McpServer`, `StdioServerTransport` | Official SDK; requirements specify this package not v2 split |
| `zod` | `^3.25.0` | Schema validation (required by SDK) | Requirements specify Zod 3.x; v2 SDK would need Zod 4 |
| `typescript` | `^5.7.0` | Type checking and compilation | Industry standard; tsx uses it for types |
| `tsx` | `^4.19.0` | Dev execution without build step | Requirement locked. Powered by esbuild, ESM-native, fast |
| `node` | `>=20.11.0` | Runtime | ESM-native; `import.meta.dirname` available; MCP SDK requires Node 20+ |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/node` | `^22.0.0` | Node.js type definitions | Required for `process`, `path`, `url` types |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@modelcontextprotocol/sdk` v1.x | v2 pre-alpha (`@modelcontextprotocol/server`) | v2 not stable, requires Zod 4, different import paths — contradicts requirements |
| `tsx` for dev | `ts-node` | `ts-node` is broken with ESM in Node 20+; explicitly excluded in REQUIREMENTS.md Out of Scope |
| `node dist/index.js` in `.mcp.json` | `tsx src/index.ts` | tsx source works in dev but `node dist/index.js` is more reliable for Claude Code's process spawning; built output is the safer default |
| separate `mcp-server/package.json` | Root-level `package.json` | Separate package keeps `type: "module"` isolated, prevents interference with existing static site files |

**Installation:**
```bash
# Inside mcp-server/
npm install @modelcontextprotocol/sdk zod
npm install --save-dev typescript tsx @types/node
```

## Architecture Patterns

### Recommended Project Structure

```
mcp-server/
├── package.json          # type: "module", scripts: dev/build/dev:watch
├── tsconfig.json         # target: ES2022, module: Node16, outDir: dist
├── dist/                 # compiled output (gitignored or committed)
│   └── index.js
└── src/
    ├── index.ts          # thin entry point: imports server + transport, calls connect
    ├── server.ts         # McpServer construction, tool/resource registration (none yet)
    ├── transport.ts      # StdioServerTransport wiring (the swappable layer)
    ├── paths.ts          # REPO_ROOT, DOCS_DIR, KANBAN_DIR, PROGRESS_DIR constants
    ├── tools/            # empty placeholder directories for phases 4-5
    │   ├── read.ts       # placeholder (phases 4-5)
    │   └── write.ts      # placeholder (phases 4-5)
    ├── utils/            # placeholder for shared utilities
    └── types/            # placeholder for shared TypeScript types
```

The `transport.ts` split is the MCP-05 requirement: swapping stdio for HTTP/SSE later means editing one file, not refactoring `index.ts`.

### Pattern 1: Minimal Stdio Server (v1.x SDK)

**What:** Zero-tools server that connects to Claude Code and shows "connected" status.
**When to use:** Phase 3 foundation — prove the toolchain before adding tools.

```typescript
// src/server.ts
// Source: @modelcontextprotocol/sdk v1.x official docs
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "keloia",
    version: "1.0.0",
  });
  // Tools registered here in phases 4-5
  return server;
}
```

```typescript
// src/transport.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

```typescript
// src/index.ts
import { createServer } from "./server.js";
import { connectStdio } from "./transport.js";
import { REPO_ROOT, DOCS_DIR, KANBAN_DIR, PROGRESS_DIR } from "./paths.js";

// Log paths to stderr at startup (MCP-03 verification)
console.error("[keloia-mcp] REPO_ROOT:", REPO_ROOT);
console.error("[keloia-mcp] DOCS_DIR:", DOCS_DIR);
console.error("[keloia-mcp] KANBAN_DIR:", KANBAN_DIR);
console.error("[keloia-mcp] PROGRESS_DIR:", PROGRESS_DIR);

const server = createServer();
await connectStdio(server);
```

### Pattern 2: Path Resolution from `import.meta.url` (MCP-03)

**What:** Derive absolute paths from the module's own location rather than `process.cwd()`.
**Why:** `process.cwd()` is wherever Claude Code was launched from, not where the server lives. Claude Code can launch the MCP server from any directory.

```typescript
// src/paths.ts
// Source: Node.js ESM docs + MCP-03 requirement
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Resolve __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
// dist/paths.js -> dist/ -> mcp-server/ -> repo root
const MCP_SERVER_DIR = join(__filename, "..", "..");
const REPO_ROOT = join(MCP_SERVER_DIR, "..");

export const DOCS_DIR = join(REPO_ROOT, "data", "docs");
export const KANBAN_DIR = join(REPO_ROOT, "data", "kanban");
export const PROGRESS_DIR = join(REPO_ROOT, "data", "progress");
export { REPO_ROOT };
```

**Note on `import.meta.dirname`:** Node.js 20.11.0+ exposes `import.meta.dirname` directly (no need for `fileURLToPath`). Since Node 20.11.0+ is likely in use, either approach works. `fileURLToPath` is more portable and avoids the version dependency.

**Note on path depth:** The depth of the `join(..., "..", "..")` depends on the final dist structure. If `dist/` is flat (no subdirs), then `paths.js` lives at `dist/paths.js`, one level up is `dist/`, two levels up is `mcp-server/`, three levels up is repo root. Plan for this carefully.

### Pattern 3: `.mcp.json` Project Registration (MCP-04)

**What:** Claude Code project-scope MCP registration file at repo root.
**When to use:** Always committed to source control for project-scoped access.

```json
// .mcp.json (at repo root)
// Source: Claude Code official docs — project scope format
{
  "mcpServers": {
    "keloia": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

**Alternative (tsx source directly):**
```json
{
  "mcpServers": {
    "keloia": {
      "command": "npx",
      "args": ["tsx", "mcp-server/src/index.ts"],
      "env": {}
    }
  }
}
```

**Recommendation (Claude's Discretion):** Use `node dist/index.js`. Claude Code spawns the process from the project root, so paths in `args` are relative to the project root. Using built output avoids tsx being absent from PATH in some shell environments. However, tsx approach means no build step for Claude Code's use — tradeoff is environment reliability vs convenience.

### Pattern 4: tsconfig.json for Node16 ESM

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Critical:** With `moduleResolution: "Node16"`, all relative imports in TypeScript source MUST use `.js` extension:
```typescript
// CORRECT — Node16 requires explicit .js extension on relative imports
import { createServer } from "./server.js";

// WRONG — will fail at runtime
import { createServer } from "./server";
```

The `.js` extension refers to the compiled output file, not the TypeScript source. This is counter-intuitive but correct for Node16 ESM.

### Pattern 5: package.json for Standalone mcp-server Package

```json
{
  "name": "keloia-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx src/index.ts",
    "dev:watch": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.7.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  }
}
```

**`"type": "module"`** is required. Without it, Node.js treats `.js` files as CommonJS, which breaks the ESM-only SDK.

### Anti-Patterns to Avoid

- **`console.log()` anywhere in `src/`:** Fatal. Corrupts the JSON-RPC stdout stream. Claude Code will see the server as broken/crashed. Only `console.error()` for any logging.
- **`process.cwd()` for paths:** Returns wherever Claude Code was launched (often `~` or the project root), not where the server files live. Always use `import.meta.url`.
- **`ts-node` instead of `tsx`:** Explicitly out of scope in REQUIREMENTS.md. Broken with ESM in Node 20+.
- **Missing `.js` on relative imports:** Node16 moduleResolution requires explicit extensions. TypeScript will compile fine but Node.js will fail at runtime with "Cannot find module".
- **Relative path in `.mcp.json` `command` field:** The `command` must be an absolute path or a system executable (`node`, `npx`). Relative paths in `command` fail — relative paths in `args` resolve from process cwd (project root).
- **`"type": "commonjs"` or no `type` field:** ESM-only SDK will fail with `require()` syntax errors.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC 2.0 over stdio | Custom message framing, newline buffering, error codes | `StdioServerTransport` from SDK | Framing, buffering, and error protocol are subtle — SDK handles all of it |
| MCP protocol handshake | Custom `initialize` handler, capability negotiation | `McpServer.connect()` | Protocol handshake includes capability negotiation, version checking |
| Tool schema → JSON Schema conversion | Manual Zod-to-JSON-Schema | SDK does this automatically for registered tools | Edge cases in Zod-to-JSON-Schema conversion are numerous |
| Graceful shutdown on SIGINT/SIGTERM | Custom signal handlers | SDK handles via transport lifecycle | Transport close sequence is protocol-aware |

**Key insight:** The SDK's value in Phase 3 is everything except tool business logic. Don't replicate any part of the protocol layer.

## Common Pitfalls

### Pitfall 1: Stdout Pollution (The Silent Killer)

**What goes wrong:** Server shows as "connected" briefly, then disconnects. Or never connects. No obvious error message.
**Why it happens:** Developer adds `console.log("Server starting...")` for debugging. This writes text to stdout. Claude Code's MCP client expects only valid JSON-RPC messages on stdout. The stray text corrupts the framing.
**How to avoid:** Never use `console.log()`. Use `console.error()` for ALL diagnostic output. Enforce this with a grep check in the success criteria: `grep -r "console.log" mcp-server/src/` must return zero results.
**Warning signs:** Server connects momentarily in `/mcp` then shows disconnected. Server status toggles. `console.error()` output visible but server not functional.

### Pitfall 2: Relative Import Extensions with Node16

**What goes wrong:** TypeScript compiles without errors but `node dist/index.js` fails with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module`.
**Why it happens:** With `moduleResolution: "Node16"`, relative imports must include the `.js` extension in TypeScript source. Without it, Node.js cannot resolve the module at runtime even though TypeScript found it at compile time.
**How to avoid:** Every local import uses `.js` extension: `import { x } from "./module.js"`. Set up a lint rule or add a verification step.
**Warning signs:** `npm run build` succeeds but `node dist/index.js` immediately crashes with module resolution error.

### Pitfall 3: Path Resolution Goes Wrong When CWD Changes

**What goes wrong:** Server works when run from `mcp-server/` directory but shows wrong paths when Claude Code spawns it from project root.
**Why it happens:** Developer used `process.cwd()` or `path.resolve("../data")`. These resolve relative to the current working directory, which is wherever Claude Code launched from.
**How to avoid:** All paths derived exclusively from `import.meta.url`. The success criteria requires logging `REPO_ROOT`, `DOCS_DIR`, `KANBAN_DIR`, `PROGRESS_DIR` to stderr at startup — verify these are absolute and correct.
**Warning signs:** Paths in stderr log contain relative segments or wrong prefixes.

### Pitfall 4: Depth Math Error in Path Derivation

**What goes wrong:** `REPO_ROOT` resolves to `mcp-server/` instead of the actual repo root.
**Why it happens:** Off-by-one in the `join(..., "..", "..")` chain. The depth depends on the dist output structure. If `src/paths.ts` compiles to `dist/paths.js` (flat dist, no subdirectories), then: `dist/paths.js` → `..` = `dist/` → `..` = `mcp-server/` → `..` = repo root. That's three `..` from the file, but `import.meta.url` points to the file itself, so `dirname` first, then two `..`.
**How to avoid:** Log paths at startup and verify. Build once, run `node dist/index.js` manually, check stderr output.
**Warning signs:** Success criterion 5 fails: paths are off by one directory level.

### Pitfall 5: `.mcp.json` Command Format

**What goes wrong:** Claude Code fails to spawn the server. Error like `spawn ENOENT`.
**Why it happens:** The `command` field uses a relative path (e.g., `"./mcp-server/dist/index.js"`) instead of an executable (`"node"`). The `command` field is the executable, and `args` contains arguments.
**How to avoid:** Use `"command": "node"` and `"args": ["mcp-server/dist/index.js"]`. The args path is relative to the project root (Claude Code's working directory when spawning).
**Warning signs:** Server never appears in `/mcp` list at all, or appears with "failed to start" status.

### Pitfall 6: SDK v1 vs v2 Import Confusion

**What goes wrong:** TypeScript errors or missing exports when mixing v1 and v2 patterns.
**Why it happens:** Context7 docs and some web tutorials show v2 patterns (`@modelcontextprotocol/server`, `registerTool`, `zod/v4`). The actual npm package `@modelcontextprotocol/sdk` at v1.x uses different import paths and API.
**How to avoid:** Use ONLY v1.x patterns. v1.x import paths:
- `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`
- `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"`
- `import { Server } from "@modelcontextprotocol/sdk/server/index.js"` (low-level)
**Warning signs:** `Module not found: @modelcontextprotocol/server` or type errors involving `registerTool`.

## Code Examples

Verified patterns from official sources:

### Minimal v1.x McpServer + Stdio (Complete)

```typescript
// Source: @modelcontextprotocol/sdk docs/server.md (v1.x branch)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "keloia",
  version: "1.0.0",
});

// No tools registered yet — zero-tool server is valid for Phase 3

const transport = new StdioServerTransport();
await server.connect(transport);
// Server now running, listening on stdin, responding on stdout
// All diagnostic output MUST go to stderr
```

### `import.meta.url` Path Resolution (Complete)

```typescript
// Source: Node.js ESM docs (nodejs.org/api/esm.html)
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// When compiled: dist/paths.js
// __dirname = /abs/path/to/keloia-docs/mcp-server/dist
const REPO_ROOT = join(__dirname, "..", "..");
//                              ^         ^
//                              mcp-server  keloia-docs (repo root)

export const DOCS_DIR = join(REPO_ROOT, "data", "docs");
export const KANBAN_DIR = join(REPO_ROOT, "data", "kanban");
export const PROGRESS_DIR = join(REPO_ROOT, "data", "progress");
export { REPO_ROOT };
```

### `.mcp.json` Project-Scope Registration

```json
// Source: Claude Code docs (code.claude.com/docs/en/mcp) — project scope format
// File: .mcp.json at repo root
{
  "mcpServers": {
    "keloia": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

Adding via CLI (generates the same file):
```bash
# Run from repo root
claude mcp add --scope project keloia -- node mcp-server/dist/index.js
```

### tsx Watch Mode Scripts

```json
// Source: tsx.is documentation
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "dev:watch": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

Note: `tsx watch` (space-separated, not `tsx --watch`) is the correct syntax for tsx's built-in watch mode.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ts-node` for TypeScript dev execution | `tsx` (esbuild-powered) | 2023+ | `ts-node` broken with Node 20+ ESM; `tsx` is the drop-in replacement |
| `StdioServerTransport` with SSE as alternative | stdio only (SSE deprecated in Claude Code) | 2025 | REQUIREMENTS.md Out of Scope explicitly lists SSE as deprecated; stdio is correct |
| `require()` / CommonJS MCP server | ESM-only (`"type": "module"`) | SDK v1.x (2024+) | SDK ships ESM-only; CJS requires workarounds |
| `@modelcontextprotocol/sdk` monolithic v1.x | v2 split packages (`@modelcontextprotocol/server`, etc.) | v2 in development, not released | v2 not stable; v1.x is production standard as of Feb 2026 |

**Deprecated/outdated:**
- `ts-node`: Do not use. Explicitly excluded in project REQUIREMENTS.md Out of Scope section.
- SSE transport: Deprecated in Claude Code. REQUIREMENTS.md explicitly excludes it.
- `console.log()`: Fatal in MCP server context. Always use `console.error()`.
- Relative paths from `process.cwd()`: Never use for MCP server file resolution.

## Discretion Recommendations

These are the "Claude's Discretion" items from CONTEXT.md, researched and recommended:

### Constants location: `paths.ts` dedicated file (recommended)

A dedicated `paths.ts` is cleaner than a `config.ts` for Phase 3. The constants are pure path derivations with no configuration values yet. If runtime configuration (env overrides) is added later, it can either stay in `paths.ts` or be extracted to `config.ts` — but that's a Phase 4+ concern. Verdict: **use `paths.ts`**.

### Entry point style: thin `index.ts` (recommended)

With the locked modular structure (`server.ts`, `transport.ts`), `index.ts` should be 10-15 lines: import the startup path logging, import `createServer`, import `connectStdio`, call them. Zero business logic in `index.ts`. Verdict: **thin entry point**.

### `.mcp.json` target: built output `node dist/index.js` (recommended)

`tsx src/index.ts` works in dev, but Claude Code spawns the process in its own environment. If `tsx` is installed as a devDependency (not globally), Claude Code may not find it unless `npx tsx` is used. `node dist/index.js` only requires `node` in PATH, which is always present. The tradeoff: developer must run `npm run build` before testing Claude Code registration, but that's an acceptable one-time step. Verdict: **`node dist/index.js` in `.mcp.json`**.

### Package scope: separate `mcp-server/package.json` (recommended)

The repo root has no `package.json` currently (it's a static site: `app.js`, `index.html`, `style.css`, `data/`). Creating a root `package.json` would be unnecessary pollution. A standalone `mcp-server/` package is clean, explicit, and correctly scoped. Verdict: **separate `mcp-server/package.json`**.

### Env var overrides: skip for Phase 3 (recommended)

`import.meta.url` resolution is deterministic and correct. Adding `KELOIA_REPO_ROOT` override adds complexity with no benefit in Phase 3 (single-developer, single-machine). Phases 4-5 can add it if needed. Verdict: **pure `import.meta.url` resolution, no env override**.

### Path validation timing: startup (recommended)

Log paths to stderr at startup (already required by success criterion 5). Add an existence check (`fs.existsSync`) for `DOCS_DIR`, `KANBAN_DIR`, and `PROGRESS_DIR` at startup with a warning to stderr if they don't exist. This surfaces misconfiguration immediately rather than at first tool call. Verdict: **startup logging + existence check, warnings only (don't exit)**.

### `.mcp.json` command format: relative args, system `node` command (recommended)

`"command": "node"` with `"args": ["mcp-server/dist/index.js"]`. The args path is relative to the project root, which is correct since Claude Code spawns from there. No need for npx. Verdict: **as shown in code examples above**.

## Open Questions

1. **Whether to gitignore `dist/` or commit it**
   - What we know: STATE.md notes "Decide whether to commit `mcp-server/dist/` or gitignore and build locally (committing is pragmatic for single-developer use)"
   - What's unclear: Not a Phase 3 research question — it's a user preference
   - Recommendation: Gitignore `dist/` (standard practice) and document that `npm run build` must be run before Claude Code can connect. Committing dist is pragmatic but violates convention; the build is fast enough that the tradeoff isn't worth it.

2. **Exact `import.meta.url` → repo root path depth**
   - What we know: `dist/index.js` will be at `mcp-server/dist/index.js` relative to repo root
   - What's unclear: Whether there are subdirectories under `dist/`
   - Recommendation: Flat dist (TypeScript does not mirror directory structure unless `rootDir` has subdirs). With `rootDir: src` and a flat `src/`, `dist/` will be flat. Path depth: file → `..` → `dist/` → `..` → `mcp-server/` → `..` → repo root. So `dirname(__filename)` + `../..` = repo root.

## Sources

### Primary (HIGH confidence)

- `/modelcontextprotocol/typescript-sdk` (Context7) — server setup, transport patterns, v1/v2 API differences
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — `.mcp.json` format, project scope, stdio server registration, command format
- [Node.js ESM docs](https://nodejs.org/api/esm.html) — `import.meta.url`, `fileURLToPath` path resolution
- [tsx.is](https://tsx.is/) — watch mode syntax, ESM support, dev workflow

### Secondary (MEDIUM confidence)

- [MCP SDK GitHub releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) — confirmed v1.27.0 as latest stable (Feb 2025), v2 not released
- [MCP Node.js client tutorial](https://modelcontextprotocol.info/docs/tutorials/building-a-client-node/) — confirmed tsconfig settings: `target: ES2022`, `module: Node16`, `moduleResolution: Node16`
- [GitHub Issue #258 — moduleResolution](https://github.com/modelcontextprotocol/typescript-sdk/issues/258) — confirmed SDK migrated to `bundler` in v2 pre-alpha, but v1.x uses `Node16` (requires `.js` extensions)

### Tertiary (LOW confidence)

- WebSearch results re: v2 release timing — "stable v2 release anticipated in Q1 2026" (single unverified claim; treat as noise; v1.x is the production recommendation)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry + GitHub releases confirm v1.27.0; tsx.is docs confirm watch mode syntax; requirements specify exact versions
- Architecture: HIGH — Claude Code official docs confirm `.mcp.json` format verbatim; Node.js docs confirm `import.meta.url` patterns; SDK docs confirm minimal server pattern
- Pitfalls: HIGH — stdout pollution and Node16 extension requirements are well-documented failure modes with multiple corroborating sources

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (30 days — SDK is stable, but check for new releases before implementing)
