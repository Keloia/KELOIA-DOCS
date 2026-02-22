# Keloia Docs — Tech Stack Decisions

**Why every choice is deliberately boring**
February 2026

---

## 1. Guiding Principle

The docs + MCP repo is the **opposite** of the main Keloia app. The app optimizes for type safety and scalability. This repo optimizes for **zero friction** — no build step, no framework, no bundler. If a markdown file or JSON file changes, the site reflects it on the next page load. Period.

```
┌──────────────────────────────────────────────────────────┐
│  DOCS SITE                                               │
│    Runtime:     GitHub Pages (static hosting)             │
│    Framework:   None — vanilla HTML/CSS/JS                │
│    Markdown:    marked.js (CDN, no install)               │
│    Build step:  None                                      │
│                                                          │
│  MCP SERVER                                              │
│    Runtime:     Node.js (local, via Claude Code)          │
│    SDK:         @modelcontextprotocol/sdk                 │
│    Validation:  Zod                                       │
│    Transport:   stdio                                     │
│    Build step:  tsc (TypeScript → JS, that's it)          │
│                                                          │
│  DATA LAYER                                              │
│    Docs:        Markdown files in /docs                   │
│    Tasks:       JSON file in /kanban/board.json           │
│    Progress:    JSON file in /progress/tracker.json       │
│    Database:    The filesystem. That's the database.      │
└──────────────────────────────────────────────────────────┘
```

**Total dependencies:** 3 (MCP SDK, Zod, TypeScript). That's it.

---

## 2. Site Stack — Why No Framework

### The temptation

React, Astro, Docusaurus, VitePress, MkDocs — there's a docs framework for every taste. All of them add a build step, a `node_modules/`, and a deploy pipeline. For a project hub that 1-2 people look at, that's overhead with zero return.

### What we use instead

| Concern | Solution | Why not the "real" tool |
|---|---|---|
| **HTML** | Single `index.html` shell | No SSR, no templating engine, no hydration |
| **CSS** | Single `style.css`, CSS custom properties | No Tailwind (adds build step), no CSS-in-JS |
| **JS** | Single `app.js`, vanilla DOM manipulation | No React (500KB+ for a read-only dashboard) |
| **Markdown** | `marked.js` via CDN `<script>` tag | No remark/rehype pipeline, no MDX, no plugins |
| **Routing** | `data-view` attributes + `switch` statement | No react-router, no file-based routing |
| **State** | `fetch()` on navigation, render into `innerHTML` | No Redux, no signals, no stores |
| **Build** | None | No Vite, no Webpack, no esbuild |
| **Hosting** | GitHub Pages (static files from repo) | No Cloudflare Pages, no Vercel, no Netlify |

### The result

```bash
# "Deploy" = push to main. That's it.
git add . && git commit -m "update docs" && git push
```

No CI pipeline needed for the site itself. GitHub Pages serves the files directly from the repo. The `app.js` fetches `/docs/*.md` and `/kanban/board.json` at runtime and renders them client-side.

### One external dependency: marked.js

Loaded from CDN — no `npm install`, no `node_modules/` in the site directory:

```html
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
```

Why marked over alternatives: ~7KB gzipped, zero config, CommonMark-compliant, the most widely used markdown parser for browsers. Loaded from jsDelivr (Cloudflare-backed CDN), so it's fast everywhere.

---

## 3. MCP Server Stack

### 3a. Dependencies (3 total)

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

That's the entire dependency tree. Three packages in production, two in dev.

### 3b. Why these choices

**`@modelcontextprotocol/sdk`** — The official MCP SDK from Anthropic. Provides `McpServer`, `StdioServerTransport`, and the tool/resource registration API. No alternative exists that's worth considering — this IS the standard.

**`zod`** — Tool parameter validation. The MCP SDK uses Zod schemas natively for tool input definitions. Not optional — it's a peer requirement.

**`typescript` + `tsc`** — The MCP server is the one piece that gets compiled. But the build is just `tsc` — no bundler, no esbuild, no rollup. TypeScript to JavaScript, preserving the module structure. That's it.

### 3c. Why NOT these things

| Rejected | Why |
|---|---|
| **esbuild / tsup / rollup** | `tsc` is enough. The MCP server runs locally on the developer's machine, not in a browser or edge runtime. Bundle size is irrelevant. |
| **Express / Hono / Fastify** | The MCP server communicates over stdio, not HTTP. There are no routes, no middleware, no request/response cycles. A web framework has nothing to do here. |
| **Prisma / Drizzle / any ORM** | The "database" is JSON files on the filesystem. `readFileSync` and `writeFileSync` are the ORM. |
| **dotenv** | One env var (`KELOIA_DOCS_ROOT`), set in the MCP client config. No `.env` file needed. |
| **nodemon / tsx** | `tsc --watch` recompiles on save. Claude Code restarts the MCP server connection automatically. No dev server needed. |
| **Jest / Vitest** | 7 tools, each under 20 lines. If a tool breaks, you'll know immediately when Claude Code calls it. Test by using it. YAGNI. |
| **Monorepo tools** | This is a single-purpose repo. No pnpm workspaces, no Turborepo. One `package.json` in `mcp-server/`, that's the whole project. |

### 3d. Architecture: One file, seven tools

The entire MCP server is a single `index.ts` (~150 lines). No service layer, no repository pattern, no dependency injection. Here's why:

```
index.ts
  ├── 4 helper functions (readJSON, writeJSON, listDocs, readDoc)
  ├── 1 resource (docs-list)
  └── 7 tools:
       ├── read_doc        (read)
       ├── list_docs       (read)
       ├── get_kanban      (read + filter)
       ├── add_task        (write)
       ├── move_task       (write)
       ├── get_progress    (read)
       └── update_progress (write)
```

No abstraction layers. Every tool is a function that reads or writes a file. If the file structure changes, you change the tool. There's nothing to "refactor" because there's nothing to decompose.

---

## 4. Data Format Decisions

### Why JSON for kanban/progress (not YAML, not SQLite, not markdown)

| Format | Pros | Why not |
|---|---|---|
| **JSON** ✅ | Native to JS (`JSON.parse`), no parser library, GitHub renders it, MCP tools read/write trivially | — |
| YAML | More human-readable | Needs a parser (`js-yaml`), one more dependency for zero benefit since humans use the site, not the raw files |
| SQLite | Queryable, relational | Overkill for <100 tasks. Adds a binary file to git. GitHub can't render it. MCP server needs an ORM. |
| Markdown | Git-friendly diffs | Unstructured — parsing task status from markdown is fragile and error-prone |
| GitHub Issues | Built-in kanban | Can't be read by MCP server without GitHub API auth. Adds external dependency. |

### Why Markdown for docs (not Notion, not Google Docs, not a CMS)

Markdown lives in the repo → MCP server reads it with `readFileSync` → the site renders it with `marked.js` → changes are tracked in git history. One format, three consumers, zero API calls.

---

## 5. Hosting Decision: GitHub Pages

| Concern | GitHub Pages | Cloudflare Pages | Vercel |
|---|---|---|---|
| **Cost** | Free | Free | Free |
| **Build step** | None needed (serves static files) | Optional | Required |
| **Deploy** | Push to main | Push to main | Push to main |
| **Custom domain** | Yes | Yes | Yes |
| **Fits our use** | Serves raw files from repo ✅ | Would need a build config | Would need a framework |

The site fetches `../docs/architecture.md` and `../kanban/board.json` as relative paths. GitHub Pages serves the entire repo as static files. No build config, no `wrangler.toml`, no `vercel.json`. The repo IS the deployment artifact.

---

## 6. How This Relates to the Main Keloia Stack

```
keloia/              ← Main app (Hono, Drizzle, D1, Workers, React)
  └── Complex, typed, scalable

keloia-docs/         ← This repo (vanilla JS, JSON files, marked.js)
  └── Simple, disposable, zero-maintenance
```

The main Keloia app has ~10 core libraries, a monorepo with 6 packages, and type safety from DB to UI. The docs repo has 3 dependencies and a single-file MCP server. These are different tools for different jobs.

The docs repo's job is to be **instantly editable, instantly readable, and instantly queryable by AI**. The moment it needs a build step to update a doc, it has failed at its job.

---

## 7. When to Reconsider (and What to Upgrade To)

| Signal | Current limit | Upgrade path |
|---|---|---|
| **>20 docs, need search** | Linear scan in `list_docs` | Add `search_docs` MCP tool with keyword matching across files. Still no framework — just `grep`-like logic in JS. |
| **>200 kanban tasks** | Single JSON file gets unwieldy | Split into `kanban/board-{status}.json` per column, or move to SQLite + `better-sqlite3` (still local, still no server). |
| **Multiple contributors editing kanban** | Last-write-wins on JSON | Add GitHub API integration so the MCP server creates commits (preserves git history, enables PRs for task changes). |
| **Site needs interactivity** | Vanilla JS limits | Consider upgrading `site/` to a Vite + Preact app (~3KB). Still static output, but with components. Do NOT reach for React — it's a docs site. |
| **Need auth on the site** | GitHub Pages is public | Move site to Cloudflare Pages with Access. Or just keep the repo private — GitHub Pages respects repo visibility. |

Until you hit one of these signals, resist the urge to add complexity. The current stack does its job with zero maintenance burden.
