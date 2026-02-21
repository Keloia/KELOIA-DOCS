# Stack Research

**Domain:** Static docs site + local MCP server (dual-audience: humans via browser, AI tools via stdio)
**Researched:** 2026-02-22 (updated for MCP server milestone)
**Confidence:** HIGH (all versions verified against npm registry and official documentation)

## Recommended Stack

### Site Layer — Zero Build Step

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Vanilla HTML/CSS/JS | — | Site shell | Zero build step is a hard constraint; no framework satisfies it without a bundler. A single `index.html` + `style.css` + `app.js` pushed to `main` is deployed instantly. |
| marked.js | 17.0.3 (CDN) | Markdown-to-HTML rendering in the browser | Lightest CommonMark-compliant renderer that ships a UMD build loadable via `<script>` tag with no npm install. ~7KB gzipped. Used by 10,000+ packages. Actively maintained (v17.0.3 released 2026-02-17). |
| GitHub Pages | — | Static hosting | Serves the raw repo as static files with zero config. No build step. Push to `main` = deployed. No Netlify/Cloudflare account needed. Unlimited bandwidth for public repos. |

**CDN URLs for marked.js:**
```html
<!-- UMD (recommended for vanilla JS with global `marked` object) -->
<script src="https://cdn.jsdelivr.net/npm/marked@17.0.3/lib/marked.umd.js"></script>

<!-- ESM alternative -->
<script type="module">
  import { marked } from 'https://cdn.jsdelivr.net/npm/marked@17.0.3/lib/marked.esm.js';
</script>
```

### MCP Server Layer

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 20.x LTS (minimum) | Runtime | SDK requires Node >=20 (verified from SDK package.json). Node 24 LTS is the current Active LTS; either works. |
| TypeScript | 5.9.3 (stable) | Type-safe server authoring | v5.9.3 is latest stable. v6.0 beta exists but is pre-release; skip it. TypeScript compiles away at build time — zero runtime cost. |
| @modelcontextprotocol/sdk | 1.27.0 | MCP protocol implementation | Official Anthropic TypeScript SDK. Provides `McpServer` class, `StdioServerTransport`, tool/resource/prompt registration, and all JSON-RPC plumbing. v1.x is the current stable production branch; v2 is pre-alpha. 26,000+ downstream projects use v1.x. |
| zod | 3.25.x or 4.x | Input schema validation for tools | Required peer dependency of the MCP SDK. SDK supports Zod v3.25+ via subpath imports and uses Zod v4 internally. Use `^3.25.0` for maximum compatibility with the v1.x SDK, or `^4.0.0` if you want the current stable version. Basic `z.object()`, `z.string()`, `z.number()` API is identical in both. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsx | Run TypeScript directly during development | `npx tsx src/index.ts` — no compile step in dev. Replaces ts-node for Node 20+. Use as `dev` script only; ship compiled JS. |
| tsc | Compile TypeScript to JavaScript for production | Output to `dist/`. Required because Claude Code launches the server via `node dist/index.js`. |
| @types/node | Node.js type definitions | Required for `fs`, `path`, `process` types in TypeScript. |

## Installation

```bash
# MCP server dependencies (from mcp-server/ directory)
npm install @modelcontextprotocol/sdk zod

# Dev dependencies
npm install -D typescript @types/node tsx
```

**package.json configuration:**
```json
{
  "name": "keloia-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.9.3"
  }
}
```

**tsconfig.json (Node 20+, ES modules):**
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
  "exclude": ["node_modules"]
}
```

**Note:** The official MCP quickstart uses `module: "Node16"` / `moduleResolution: "Node16"`. These are equivalent to `NodeNext` for the current Node LTS. Use `Node16` — it's what the official docs show and it resolves the SDK's `.js` extension imports correctly.

## Claude Code Integration

**`.mcp.json` at project root (project-scoped, checked into version control):**
```json
{
  "mcpServers": {
    "keloia-docs": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute-path-to-repo>/mcp-server/dist/index.js"]
    }
  }
}
```

**Add via CLI (recommended — writes `.mcp.json` automatically):**
```bash
claude mcp add --scope project keloia-docs -- node /absolute/path/to/mcp-server/dist/index.js
```

**Key constraint:** Path in `args` must be absolute. Claude Code launches the server as a child process from an arbitrary working directory.

## Core MCP Server Pattern

The canonical TypeScript MCP server structure from official docs:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "keloia-docs", version: "1.0.0" },
  { capabilities: { logging: {} } }   // enable ctx.mcpReq.log() in handlers
);

// Tool registration: inputSchema is a Zod object schema
server.registerTool(
  "read_doc",
  {
    title: "Read Document",
    description: "Read a documentation file by filename",
    inputSchema: z.object({
      filename: z.string().describe("Filename from data/docs/index.json")
    })
  },
  async ({ filename }) => {
    // implementation reads from data/docs/<filename>
    return { content: [{ type: "text", text: content }] };
  }
);

// Stdio transport: Claude Code spawns this process and communicates over stdin/stdout
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Keloia MCP server running on stdio"); // stderr is safe; stdout is reserved for JSON-RPC
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

**Critical rule:** Never use `console.log()` in a stdio MCP server. It writes to stdout, which corrupts the JSON-RPC stream. Use `console.error()` exclusively for all debug output.

**inputSchema API note:** `registerTool()` accepts either a plain Zod object `z.object({...})` or a plain object of Zod fields `{ key: z.string() }`. Both work. Using `z.object()` directly is cleaner and enables top-level schema reuse.

## Integration with Existing Data Layer

The MCP server reads the same files the static site renders. No duplication.

| Data | File Pattern | MCP Access | Notes |
|------|-------------|------------|-------|
| Docs index | `data/docs/index.json` | `list_docs` — read index, return filenames | `{ "files": ["architecture.md", "value-proposition.md"] }` |
| Doc content | `data/docs/<name>.md` | `read_doc` — read file, return markdown | Plain markdown string in text content block |
| Kanban index | `data/kanban/index.json` | `get_kanban` — read index, load task files | `{ schemaVersion, columns, tasks: ["task-001", ...] }` |
| Task files | `data/kanban/task-<id>.json` | `add_task`, `move_task` — write with Zod validation | `{ id, title, column, description, assignee }` |
| Progress index | `data/progress/index.json` | `get_progress` — read index, load milestone files | `{ schemaVersion, milestones: ["milestone-01", ...] }` |
| Milestone files | `data/progress/milestone-<id>.json` | `update_progress` — write with Zod validation | `{ id, phase, title, status, tasksTotal, tasksCompleted, notes }` |

**Path resolution:** The MCP server must resolve `data/` paths relative to the repo root, not the `mcp-server/` directory. Use `path.resolve()` anchored to a known absolute path (e.g. derived from `import.meta.url`). See PITFALLS.md for the specific pattern.

**Zod schemas mirror existing JSON shapes:**

```typescript
// Task schema (mirrors data/kanban/task-001.json)
const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  column: z.string(),
  description: z.string(),
  assignee: z.string().nullable()
});

// Milestone schema (mirrors data/progress/milestone-01.json)
const MilestoneSchema = z.object({
  id: z.string(),
  phase: z.number(),
  title: z.string(),
  status: z.enum(["done", "active", "planned"]),
  tasksTotal: z.number(),
  tasksCompleted: z.number(),
  notes: z.string()
});
```

**Atomic write pattern (no extra dependency — Node built-ins only):**

```typescript
import { writeFileSync, renameSync } from "fs";

function atomicWrite(targetPath: string, content: string): void {
  const tmpPath = `${targetPath}.tmp`;
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, targetPath);  // atomic on POSIX; safe for this use case
}
```

`fs.renameSync` is atomic on the same filesystem on POSIX systems. The `write-file-atomic` npm package is unnecessary for a local dev tool on macOS/Linux with < 100 tasks.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| marked.js | micromark, remark | Building a Node.js pipeline, not browser rendering. Both require a build step or bundler for browser use. |
| marked.js | Showdown.js | Showdown is less actively maintained and larger. Choose if you need very old browser support (IE11). |
| marked.js | markdown-it | Heavier (plugins ecosystem), also CDN-available. Choose if you need advanced extensions (footnotes, math). Both are valid; marked.js is simpler for this use case. |
| GitHub Pages | Cloudflare Pages, Netlify | Pages supports build steps and serverless functions. Overkill here; zero-build GitHub Pages is simpler and free. |
| Vanilla JS | Lit, Alpine.js | Alpine or Lit are reasonable if you need component reactivity at scale. For a 1-2 user internal tool, vanilla JS is less code. |
| @modelcontextprotocol/sdk v1.27.0 | @modelcontextprotocol/sdk v2 (pre-alpha) | Never — v2 is pre-alpha, API is changing. Switch when v2 is stable (anticipated Q1 2026, not yet released as of Feb 2026). |
| @modelcontextprotocol/sdk | FastMCP (community wrapper) | FastMCP adds ergonomics but is a community package with less guarantee of keeping up with protocol changes. Use the official SDK. |
| zod v3.25.x | zod v4.x | v4 is also safe — the basic API (`z.object`, `z.string`, `z.number`) is identical. Breaking changes in v4 are only in error customization APIs. Use v3.25 for maximum conservatism, v4 if you prefer the current version. |
| tsc | esbuild, tsup | Bundlers add complexity unnecessary for a single-file server. `tsc` is sufficient. |
| Node built-in fs + renameSync | write-file-atomic npm package | Use `write-file-atomic` only if you need Windows compatibility or file ownership control. Overkill for this local dev tool. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| React / Astro / VitePress / Docusaurus | All require a build step. Zero-build is a hard project constraint. | Vanilla HTML/CSS/JS + marked.js from CDN |
| Tailwind CSS | Requires PostCSS build step. | Handwritten CSS — the site has ~3 views and 1 user. |
| ts-node | Broken with ESM modules in Node 20+. tsx is the drop-in replacement. | tsx |
| console.log() in MCP server | Writes to stdout, corrupts the JSON-RPC transport stream. Claude Code loses connection silently. | console.error() for all server-side logging |
| TypeScript 6.0 beta | Pre-release as of Feb 2026. Breaking changes possible. | TypeScript 5.9.3 (latest stable) |
| dotenv in MCP server | dotenv v17+ may print to stdout on load, which corrupts stdio transport. | Pass env vars via the `env` field in `.mcp.json` configuration |
| SSE transport | Deprecated in Claude Code. MCP docs recommend HTTP for remote, stdio for local. SSE is legacy. | stdio for local Claude Code integration |
| `bundler` moduleResolution | For webpack/vite workflows. Doesn't resolve the SDK's `.js` extension imports correctly in Node. | `"moduleResolution": "Node16"` |
| CommonJS (`"type": "commonjs"`) | The MCP SDK is ESM-only; mixing CJS and ESM causes import errors. | `"type": "module"` in package.json |
| Relative paths in .mcp.json args | Claude Code spawns the server from an arbitrary working directory; relative paths break. | Absolute path to `dist/index.js` |

## Stack Patterns by Variant

**If adding HTTP/SSE transport later (future milestone):**
- Add `express` or `Hono` to the MCP server
- The `McpServer` class is transport-agnostic; swap `StdioServerTransport` for `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/http.js`
- No new npm packages required — HTTP transport is bundled in the SDK
- Keep tool registrations identical — transport is just the connection layer

**If the site needs search (>20 docs):**
- Add Pagefind (zero-build static search, runs as a post-build CLI)
- This would require a GitHub Actions build step — acceptable when search becomes needed

**If Zod v4 is required by SDK upgrade:**
- Change `"zod": "^3.25.0"` to `"^4.0.0"` in package.json
- `import { z } from "zod"` stays identical — no code changes needed
- Breaking changes are only in error customization APIs (`message` → `error` param)

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| @modelcontextprotocol/sdk@1.27.0 | zod@>=3.25, zod@4.x | SDK v1.25+ added Zod v4 schema support. Both v3 (3.25+) and v4 work as peer deps. |
| @modelcontextprotocol/sdk@1.27.0 | node@>=20 | Verified from SDK repository package.json. Node 20 LTS is the minimum; Node 24 is preferred. |
| marked@17.0.3 | All modern browsers | UMD build works with `<script>` tag. No IE11 support. |
| TypeScript@5.9.3 | node@>=14.17 | No conflicts with Node 20 or 24. |
| tsx@^4.7.0 | node@>=20, TypeScript@>=5 | Dev runner only; not needed in production. |

## Sources

- [GitHub: modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) — API patterns, Node.js >=20 requirement, v1.x vs v2 status (HIGH confidence — official SDK repo)
- [GitHub: typescript-sdk/docs/server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — `McpServer`, `registerTool()`, `StdioServerTransport`, `inputSchema` with Zod object, import paths (HIGH confidence — official SDK docs)
- [GitHub: typescript-sdk/releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) — v1.27.0 as latest stable, v2 pre-alpha confirmation (HIGH confidence — official release page)
- [npmjs.com: @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.26.0/1.27.0 release dates, 26,000+ downstream users (HIGH confidence)
- [zod.dev/v4/versioning](https://zod.dev/v4/versioning) — dual subpath versioning, v4 stable since July 2025, `^3.25.0 || ^4.0.0` peer dep pattern (HIGH confidence — official Zod docs)
- [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) — `.mcp.json` project scope format, stdio registration, `--scope project` flag, absolute path requirement (HIGH confidence — official Anthropic docs)
- [marked npm / jsDelivr](https://www.jsdelivr.com/package/npm/marked) — v17.0.3, CDN URLs confirmed (HIGH confidence)
- [Zod v4 stable announcement](https://zod.dev/) — v4 confirmed stable (HIGH confidence — official docs)

---
*Stack research for: Keloia Docs + MCP Server*
*Researched: 2026-02-22 (updated for MCP server milestone; site layer unchanged from v1.0)*
