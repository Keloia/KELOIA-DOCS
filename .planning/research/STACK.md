# Stack Research

**Domain:** Static docs site + local MCP server (dual-audience: humans via browser, AI tools via stdio)
**Researched:** 2026-02-21
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
| Node.js | 24.x LTS (24.13.1) | Runtime | Active LTS as of February 2026, supported through April 2028. Node 22 is Maintenance LTS (still valid). Node 24 gets security patches actively; use it for new projects. |
| TypeScript | 5.9.3 (stable) | Type-safe server authoring | v5.9.3 is latest stable. v6.0 beta exists but is pre-release; skip it. TypeScript compiles away at build time — zero runtime cost. |
| @modelcontextprotocol/sdk | 1.27.0 | MCP protocol implementation | Official Anthropic TypeScript SDK. Provides `McpServer` class, `StdioServerTransport`, tool/resource/prompt registration, and all JSON-RPC plumbing. Only game in town for TypeScript MCP servers. |
| zod | 4.x (4.3.6) | Input schema validation for tools | Required peer dependency of the MCP SDK. SDK uses Zod v4 internally; supports Zod v3.25+ via subpath imports for backwards compatibility. Use v4 for new projects — it's stable and the SDK's native version. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsx | Run TypeScript directly during development | `npx tsx src/index.ts` — no compile step in dev. Replaces ts-node for Node 20+. Use as `dev` script only; ship compiled JS. |
| tsc | Compile TypeScript to JavaScript for production | Output to `dist/` or `build/`. Required because Claude Code launches the server via `node dist/index.js`. |
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
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js"
  }
}
```

**tsconfig.json (Node 24, ES modules):**
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

**Note:** The official MCP quickstart uses `module: "Node16"` / `moduleResolution: "Node16"`. These are equivalent to `NodeNext` for the current Node LTS. Either works; `Node16` is what the official docs show.

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

const server = new McpServer({ name: "keloia-docs", version: "1.0.0" });

// Register a tool with Zod schema validation
server.registerTool(
  "read_doc",
  {
    description: "Read a documentation file by path",
    inputSchema: {
      path: z.string().describe("Relative path within docs/ directory"),
    },
  },
  async ({ path }) => {
    // implementation
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

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| marked.js | micromark, remark | Building a Node.js pipeline, not browser rendering. Both require a build step or bundler for browser use. |
| marked.js | Showdown.js | Showdown is less actively maintained and larger. Choose if you need very old browser support (IE11). |
| marked.js | markdown-it | Heavier (plugins ecosystem), also CDN-available. Choose if you need advanced extensions (footnotes, math). Both are valid; marked.js is simpler for this use case. |
| GitHub Pages | Cloudflare Pages, Netlify | Pages supports build steps and serverless functions. Overkill here; zero-build GitHub Pages is simpler and free. |
| Vanilla JS | Lit, Alpine.js | Alpine or Lit are reasonable if you need component reactivity at scale. For a 1-2 user internal tool, vanilla JS is less code. |
| @modelcontextprotocol/sdk | FastMCP (community wrapper) | FastMCP adds ergonomics but is a community package with less guarantee of keeping up with protocol changes. Use the official SDK. |
| Zod v4 | Zod v3 | Zod v3 still works with the MCP SDK (v3.25+). Use v4 for new projects — it's stable, faster, and the SDK's native version. |
| tsc | esbuild, tsup | Bundlers add complexity unnecessary for a single-file server. `tsc` is sufficient. |
| Node 24 LTS | Node 22 LTS | Node 22 is Maintenance LTS (still receives security patches through April 2027). Acceptable choice if you already have it installed. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| React / Astro / VitePress / Docusaurus | All require a build step. Zero-build is a hard project constraint. | Vanilla HTML/CSS/JS + marked.js from CDN |
| Tailwind CSS | Requires PostCSS build step. | Handwritten CSS — the site has ~3 views and 1 user. |
| ts-node | Broken with ESM modules in Node 20+. tsx is the drop-in replacement. | tsx |
| console.log() in MCP server | Writes to stdout, corrupts the JSON-RPC transport stream. Claude Code loses connection silently. | console.error() for all server-side logging |
| TypeScript 6.0 beta | Pre-release (beta as of Feb 2026). Breaking changes possible. TypeScript 7 (Go rewrite) is next major. | TypeScript 5.9.3 (latest stable) |
| Hash-based SPA routing (#/page) | GitHub Pages serves the whole repo; relative `fetch()` paths work without any routing hack. No need for hash routing complexity. | Direct `fetch()` calls with relative paths |
| dotenv in MCP server | dotenv v17+ prints to stdout on load, which corrupts stdio transport. | Pass env vars via the `env` field in `.mcp.json` configuration instead |
| SSE transport | Deprecated in Claude Code. MCP docs recommend HTTP for remote, stdio for local. SSE is legacy. | stdio for local Claude Code integration |

## Stack Patterns by Variant

**If adding HTTP/SSE transport later (Phase 2+):**
- Add `express` or `Hono` to the MCP server
- The `McpServer` class is transport-agnostic; swap `StdioServerTransport` for `StreamableHTTPServerTransport`
- Keep the tool registrations identical — transport is just the connection layer

**If the site needs search (>20 docs):**
- Add Pagefind (zero-build static search, runs as a post-build CLI)
- This would require a GitHub Actions build step — acceptable when search becomes needed

**If Claude Code team adds file write tools:**
- `add_task` and `move_task` write to `kanban/board.json` via `fs.promises.writeFile`
- Atomicity: write to a temp file, then `fs.promises.rename` (atomic on same filesystem)

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| @modelcontextprotocol/sdk@1.27.0 | zod@>=3.25, zod@4.x | SDK uses Zod v4 internally via subpath imports. Both v3 (3.25+) and v4 work. Use v4 for new projects. |
| @modelcontextprotocol/sdk@1.27.0 | Node.js 16+ | Official docs say Node 16+. Use Node 24 LTS for new projects. |
| marked@17.0.3 | All modern browsers | UMD build works with `<script>` tag. No IE11 support. |
| TypeScript@5.9.3 | Node.js 14.17+ | No conflicts with Node 24. |

## Sources

- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.27.0, confirmed February 2026
- [MCP TypeScript SDK GitHub releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) — v1.27.0 latest, v2 anticipated Q1 2026 but not yet released
- [modelcontextprotocol.io/docs/develop/build-server](https://modelcontextprotocol.io/docs/develop/build-server) — Official TypeScript MCP server tutorial; tsconfig, package.json, McpServer API, StdioServerTransport, Claude Desktop config format (HIGH confidence — official docs)
- [modelcontextprotocol.io/docs/develop/build-server (server.md)](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — McpServer.registerTool() API with Zod inputSchema (HIGH confidence — official SDK docs)
- [marked npm / jsDelivr](https://www.jsdelivr.com/package/npm/marked) — v17.0.3, CDN URLs confirmed (HIGH confidence)
- [Zod v4 stable announcement](https://zod.dev/) — v4 confirmed stable; v4.3.6 latest (HIGH confidence — official docs)
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — .mcp.json format, `claude mcp add` CLI, scope options, project-scoped `.mcp.json` at project root (HIGH confidence — official Anthropic docs)
- [Node.js releases](https://nodejs.org/en/about/previous-releases) — Node 24.13.1 is Active LTS as of February 2026 (HIGH confidence — official Node.js site)
- [TypeScript npm](https://www.npmjs.com/package/typescript) — v5.9.3 latest stable; v6.0 beta available but pre-release (MEDIUM confidence — WebSearch confirmed)

---
*Stack research for: Keloia Docs + MCP Server*
*Researched: 2026-02-21*
