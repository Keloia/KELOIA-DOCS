# Keloia Docs + MCP Server Guide

**A single repo that serves docs to humans (GitHub Pages) and AI tools (MCP).**

---

## 1. What We're Building

```
keloia-docs/
│
├── docs/                    # Markdown content (single source of truth)
│   ├── architecture.md
│   ├── value-proposition.md
│   ├── api-reference.md
│   └── ...
│
├── kanban/                  # Task tracking as data
│   └── board.json           # One file, simple structure
│
├── progress/                # Progress snapshots
│   └── tracker.json
│
├── site/                    # GitHub Pages static site
│   ├── index.html           # SPA shell — renders docs, kanban, progress
│   ├── style.css
│   └── app.js
│
├── mcp-server/              # MCP server — exposes everything to AI tools
│   ├── src/
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
│
└── README.md
```

**Core principle:** Markdown + JSON files are the source of truth. The site renders them for humans. The MCP server serves them to AI tools. No duplication.

---

## 2. Data Formats

### 2a. Kanban Board (`kanban/board.json`)

```json
{
  "columns": ["backlog", "todo", "in_progress", "review", "done"],
  "tasks": [
    {
      "id": "KELOIA-001",
      "title": "WhatsApp webhook handler",
      "column": "in_progress",
      "priority": "high",
      "assignee": "reza",
      "labels": ["wa-bff", "mvp"],
      "description": "Implement Meta webhook verification + message parsing",
      "created": "2026-02-15",
      "updated": "2026-02-20"
    },
    {
      "id": "KELOIA-002",
      "title": "D1 schema migration",
      "column": "done",
      "priority": "high",
      "assignee": "reza",
      "labels": ["core-domain", "mvp"],
      "description": "Create initial D1 tables for three pillars",
      "created": "2026-02-10",
      "updated": "2026-02-18",
      "completed": "2026-02-18"
    }
  ]
}
```

### 2b. Progress Tracker (`progress/tracker.json`)

```json
{
  "milestones": [
    {
      "id": "mvp",
      "title": "MVP — Single Tenant PO Bus",
      "target_date": "2026-04-30",
      "modules": [
        {
          "name": "WhatsApp BFF",
          "progress": 30,
          "tasks_total": 8,
          "tasks_done": 2,
          "notes": "Webhook handler done, AI intent extraction in progress"
        },
        {
          "name": "Core Domain",
          "progress": 20,
          "tasks_total": 12,
          "tasks_done": 2,
          "notes": "D1 schema done, booking service started"
        },
        {
          "name": "Dashboard BFF",
          "progress": 0,
          "tasks_total": 6,
          "tasks_done": 0
        },
        {
          "name": "Dashboard UI",
          "progress": 0,
          "tasks_total": 5,
          "tasks_done": 0
        },
        {
          "name": "AI Processor",
          "progress": 10,
          "tasks_total": 4,
          "tasks_done": 0,
          "notes": "Prompt design in progress"
        }
      ]
    }
  ],
  "last_updated": "2026-02-21"
}
```

---

## 3. GitHub Pages Site

A single-page app that fetches markdown and JSON at runtime. No build step.

### 3a. `site/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keloia — Project Hub</title>
  <link rel="stylesheet" href="style.css">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
  <nav id="sidebar">
    <h1>🚌 Keloia</h1>
    <ul>
      <li><a href="#" data-view="kanban" class="active">Kanban</a></li>
      <li><a href="#" data-view="progress">Progress</a></li>
    </ul>
    <h2>Docs</h2>
    <ul id="doc-list"></ul>
  </nav>

  <main id="content">
    <!-- Dynamically rendered -->
  </main>

  <script src="app.js"></script>
</body>
</html>
```

### 3b. `site/style.css`

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --border: #2a2d3a;
  --text: #e1e4ed;
  --text-muted: #8b8fa3;
  --accent: #6c8cff;
  --green: #34d399;
  --yellow: #fbbf24;
  --red: #f87171;
  --sidebar-w: 240px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  display: flex;
  min-height: 100vh;
}

/* Sidebar */
#sidebar {
  width: var(--sidebar-w);
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 1.5rem 1rem;
  position: fixed;
  height: 100vh;
  overflow-y: auto;
}

#sidebar h1 { font-size: 1.25rem; margin-bottom: 1.5rem; }
#sidebar h2 { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); margin: 1.5rem 0 0.5rem; letter-spacing: 0.05em; }
#sidebar ul { list-style: none; }
#sidebar a {
  display: block;
  padding: 0.4rem 0.75rem;
  color: var(--text-muted);
  text-decoration: none;
  border-radius: 6px;
  font-size: 0.9rem;
}
#sidebar a:hover, #sidebar a.active { color: var(--text); background: var(--border); }

/* Main content */
main {
  margin-left: var(--sidebar-w);
  padding: 2rem 3rem;
  flex: 1;
  max-width: 1100px;
}

/* Markdown rendering */
.doc-content h1 { font-size: 1.8rem; margin: 2rem 0 1rem; }
.doc-content h2 { font-size: 1.4rem; margin: 1.5rem 0 0.75rem; color: var(--accent); }
.doc-content h3 { font-size: 1.1rem; margin: 1.25rem 0 0.5rem; }
.doc-content p { line-height: 1.7; margin-bottom: 1rem; color: var(--text-muted); }
.doc-content code { background: var(--surface); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
.doc-content pre { background: var(--surface); padding: 1rem; border-radius: 8px; overflow-x: auto; margin-bottom: 1rem; }
.doc-content pre code { background: none; padding: 0; }
.doc-content table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
.doc-content th, .doc-content td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; }
.doc-content th { background: var(--surface); font-weight: 600; }

/* Kanban board */
.kanban { display: flex; gap: 1rem; overflow-x: auto; padding-bottom: 1rem; }
.kanban-col { min-width: 240px; flex: 1; background: var(--surface); border-radius: 8px; padding: 1rem; }
.kanban-col h3 { font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.75rem; letter-spacing: 0.05em; }
.kanban-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
}
.kanban-card .title { font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem; }
.kanban-card .meta { font-size: 0.75rem; color: var(--text-muted); }
.kanban-card .labels { display: flex; gap: 0.25rem; margin-top: 0.5rem; flex-wrap: wrap; }
.label { font-size: 0.65rem; padding: 0.15em 0.5em; border-radius: 999px; background: var(--border); color: var(--text-muted); }
.priority-high { border-left: 3px solid var(--red); }
.priority-medium { border-left: 3px solid var(--yellow); }
.priority-low { border-left: 3px solid var(--green); }

/* Progress */
.milestone { margin-bottom: 2rem; }
.milestone h2 { margin-bottom: 1rem; }
.module-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem; }
.module-name { width: 160px; font-size: 0.9rem; flex-shrink: 0; }
.progress-bar { flex: 1; height: 24px; background: var(--surface); border-radius: 12px; overflow: hidden; position: relative; }
.progress-fill { height: 100%; border-radius: 12px; transition: width 0.3s; }
.progress-text { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 0.75rem; color: var(--text); }
.module-tasks { font-size: 0.8rem; color: var(--text-muted); width: 80px; text-align: right; flex-shrink: 0; }
```

### 3c. `site/app.js`

```js
const BASE = location.hostname === 'localhost' ? '..' : '..';

const DOCS = [
  { slug: 'architecture', title: 'System Architecture' },
  { slug: 'value-proposition', title: 'Value Proposition Canvas' },
];

// --- Init ---
function init() {
  renderDocList();
  bindNav();
  showView('kanban');
}

function renderDocList() {
  const list = document.getElementById('doc-list');
  list.innerHTML = DOCS.map(
    (d) => `<li><a href="#" data-view="doc" data-slug="${d.slug}">${d.title}</a></li>`
  ).join('');
}

function bindNav() {
  document.getElementById('sidebar').addEventListener('click', (e) => {
    const link = e.target.closest('a[data-view]');
    if (!link) return;
    e.preventDefault();
    document.querySelectorAll('#sidebar a').forEach((a) => a.classList.remove('active'));
    link.classList.add('active');
    showView(link.dataset.view, link.dataset.slug);
  });
}

async function showView(view, slug) {
  const main = document.getElementById('content');
  main.innerHTML = '<p style="color:var(--text-muted)">Loading…</p>';

  switch (view) {
    case 'kanban': return renderKanban(main);
    case 'progress': return renderProgress(main);
    case 'doc': return renderDoc(main, slug);
  }
}

// --- Kanban ---
async function renderKanban(el) {
  const data = await fetchJSON(`${BASE}/kanban/board.json`);
  const byColumn = Object.groupBy
    ? Object.groupBy(data.tasks, (t) => t.column)
    : data.tasks.reduce((acc, t) => { (acc[t.column] ??= []).push(t); return acc; }, {});

  el.innerHTML = `
    <h1>Kanban Board</h1>
    <div class="kanban">
      ${data.columns.map((col) => `
        <div class="kanban-col">
          <h3>${col.replace('_', ' ')} (${(byColumn[col] || []).length})</h3>
          ${(byColumn[col] || []).map(taskCard).join('')}
        </div>
      `).join('')}
    </div>
  `;
}

function taskCard(t) {
  return `
    <div class="kanban-card priority-${t.priority || 'low'}">
      <div class="meta">${t.id}</div>
      <div class="title">${t.title}</div>
      ${t.assignee ? `<div class="meta">→ ${t.assignee}</div>` : ''}
      <div class="labels">${(t.labels || []).map((l) => `<span class="label">${l}</span>`).join('')}</div>
    </div>
  `;
}

// --- Progress ---
async function renderProgress(el) {
  const data = await fetchJSON(`${BASE}/progress/tracker.json`);

  el.innerHTML = data.milestones.map((m) => `
    <div class="milestone">
      <h1>${m.title}</h1>
      <p style="color:var(--text-muted);margin-bottom:1.5rem">Target: ${m.target_date}</p>
      ${m.modules.map(moduleRow).join('')}
    </div>
  `).join('') + `<p style="color:var(--text-muted);font-size:0.8rem">Last updated: ${data.last_updated}</p>`;
}

function moduleRow(mod) {
  const color = mod.progress >= 80 ? 'var(--green)' : mod.progress >= 40 ? 'var(--yellow)' : 'var(--accent)';
  return `
    <div class="module-row">
      <div class="module-name">${mod.name}</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${mod.progress}%;background:${color}"></div>
        <span class="progress-text">${mod.progress}%</span>
      </div>
      <div class="module-tasks">${mod.tasks_done}/${mod.tasks_total}</div>
    </div>
    ${mod.notes ? `<div style="margin:-0.25rem 0 0.75rem calc(160px + 1rem);font-size:0.8rem;color:var(--text-muted)">${mod.notes}</div>` : ''}
  `;
}

// --- Docs ---
async function renderDoc(el, slug) {
  const res = await fetch(`${BASE}/docs/${slug}.md`);
  const md = await res.text();
  el.innerHTML = `<div class="doc-content">${marked.parse(md)}</div>`;
}

// --- Utils ---
async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

init();
```

### 3d. GitHub Pages Config

In your repo settings, set GitHub Pages source to the repo root (not `/docs`). Then add a redirect `index.html` at root:

```html
<!-- Root index.html — redirects to site/ -->
<!DOCTYPE html>
<meta http-equiv="refresh" content="0;url=site/">
```

Or configure Pages to deploy from `site/` folder using a GitHub Actions workflow:

```yaml
# .github/workflows/pages.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'   # whole repo — site/ reads from ../docs/ and ../kanban/
      - id: deployment
        uses: actions/deploy-pages@v4
```

---

## 4. MCP Server

The MCP server lets Claude Code (or any MCP client) read docs, query the kanban board, and check progress — all through structured tool calls.

### 4a. Setup

```bash
cd mcp-server
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node
```

### 4b. `mcp-server/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### 4c. `mcp-server/package.json` (key fields)

```json
{
  "name": "keloia-docs-mcp",
  "version": "1.0.0",
  "type": "module",
  "bin": { "keloia-docs-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  }
}
```

### 4d. `mcp-server/src/index.ts`

```typescript
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";

// --- Config ---
// Resolve project root relative to where the server runs from
const PROJECT_ROOT = resolve(process.env.KELOIA_DOCS_ROOT || process.cwd());
const DOCS_DIR = join(PROJECT_ROOT, "docs");
const KANBAN_PATH = join(PROJECT_ROOT, "kanban", "board.json");
const PROGRESS_PATH = join(PROJECT_ROOT, "progress", "tracker.json");

// --- Helpers ---
function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJSON(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function listDocs(): string[] {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(".md", ""));
}

function readDoc(slug: string): string {
  const filePath = join(DOCS_DIR, `${slug}.md`);
  if (!existsSync(filePath)) throw new Error(`Doc not found: ${slug}`);
  return readFileSync(filePath, "utf-8");
}

// --- Kanban types ---
interface Task {
  id: string;
  title: string;
  column: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  description?: string;
  created: string;
  updated: string;
  completed?: string;
}

interface Board {
  columns: string[];
  tasks: Task[];
}

// --- MCP Server ---
const server = new McpServer({
  name: "keloia-docs",
  version: "1.0.0",
});

// ========== RESOURCES ==========
// Expose docs as readable resources
server.resource(
  "docs-list",
  "docs://index",
  async () => ({
    contents: [{
      uri: "docs://index",
      mimeType: "text/plain",
      text: `Available docs:\n${listDocs().map((d) => `- ${d}`).join("\n")}`,
    }],
  })
);

// ========== TOOLS ==========

// --- Read a doc ---
server.tool(
  "read_doc",
  "Read a project documentation file by slug",
  { slug: z.string().describe("Doc filename without .md extension. Use list_docs to see available.") },
  async ({ slug }) => ({
    content: [{ type: "text", text: readDoc(slug) }],
  })
);

// --- List docs ---
server.tool(
  "list_docs",
  "List all available documentation files",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(listDocs(), null, 2) }],
  })
);

// --- Get kanban board ---
server.tool(
  "get_kanban",
  "Get the full kanban board or filter by column/label/assignee",
  {
    column: z.string().optional().describe("Filter by column: backlog, todo, in_progress, review, done"),
    label: z.string().optional().describe("Filter by label"),
    assignee: z.string().optional().describe("Filter by assignee"),
  },
  async ({ column, label, assignee }) => {
    const board = readJSON<Board>(KANBAN_PATH);
    let tasks = board.tasks;

    if (column) tasks = tasks.filter((t) => t.column === column);
    if (label) tasks = tasks.filter((t) => t.labels?.includes(label));
    if (assignee) tasks = tasks.filter((t) => t.assignee === assignee);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ columns: board.columns, tasks, total: tasks.length }, null, 2),
      }],
    };
  }
);

// --- Add kanban task ---
server.tool(
  "add_task",
  "Add a new task to the kanban board",
  {
    id: z.string().describe("Task ID like KELOIA-003"),
    title: z.string(),
    column: z.string().default("backlog"),
    priority: z.enum(["high", "medium", "low"]).default("medium"),
    assignee: z.string().optional(),
    labels: z.array(z.string()).default([]),
    description: z.string().optional(),
  },
  async ({ id, title, column, priority, assignee, labels, description }) => {
    const board = readJSON<Board>(KANBAN_PATH);

    if (board.tasks.some((t) => t.id === id)) {
      return { content: [{ type: "text", text: `Task ${id} already exists.` }] };
    }

    const now = new Date().toISOString().split("T")[0];
    const task: Task = { id, title, column, priority, assignee, labels, description, created: now, updated: now };
    board.tasks.push(task);
    writeJSON(KANBAN_PATH, board);

    return { content: [{ type: "text", text: `Added: ${id} — ${title} → ${column}` }] };
  }
);

// --- Move kanban task ---
server.tool(
  "move_task",
  "Move a task to a different kanban column",
  {
    id: z.string().describe("Task ID"),
    column: z.string().describe("Target column"),
  },
  async ({ id, column }) => {
    const board = readJSON<Board>(KANBAN_PATH);
    const task = board.tasks.find((t) => t.id === id);
    if (!task) return { content: [{ type: "text", text: `Task ${id} not found.` }] };

    const from = task.column;
    task.column = column;
    task.updated = new Date().toISOString().split("T")[0];
    if (column === "done") task.completed = task.updated;
    writeJSON(KANBAN_PATH, board);

    return { content: [{ type: "text", text: `Moved ${id}: ${from} → ${column}` }] };
  }
);

// --- Get progress ---
server.tool(
  "get_progress",
  "Get project progress tracker — milestones and module completion",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(readJSON(PROGRESS_PATH), null, 2) }],
  })
);

// --- Update module progress ---
server.tool(
  "update_progress",
  "Update progress for a specific module within a milestone",
  {
    milestone_id: z.string().describe("Milestone ID, e.g. 'mvp'"),
    module_name: z.string().describe("Module name, e.g. 'WhatsApp BFF'"),
    progress: z.number().min(0).max(100).optional(),
    tasks_done: z.number().optional(),
    notes: z.string().optional(),
  },
  async ({ milestone_id, module_name, progress, tasks_done, notes }) => {
    const data = readJSON<any>(PROGRESS_PATH);
    const milestone = data.milestones.find((m: any) => m.id === milestone_id);
    if (!milestone) return { content: [{ type: "text", text: `Milestone ${milestone_id} not found.` }] };

    const mod = milestone.modules.find((m: any) => m.name === module_name);
    if (!mod) return { content: [{ type: "text", text: `Module ${module_name} not found.` }] };

    if (progress !== undefined) mod.progress = progress;
    if (tasks_done !== undefined) mod.tasks_done = tasks_done;
    if (notes !== undefined) mod.notes = notes;
    data.last_updated = new Date().toISOString().split("T")[0];

    writeJSON(PROGRESS_PATH, data);
    return { content: [{ type: "text", text: `Updated ${module_name}: ${mod.progress}% (${mod.tasks_done}/${mod.tasks_total})` }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Keloia Docs MCP server running on stdio");
}

main().catch(console.error);
```

---

## 5. Claude Code Integration

### 5a. Register the MCP Server

Add to your Claude Code config (`~/.claude/claude_code_config.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "keloia-docs": {
      "command": "node",
      "args": ["<path-to>/keloia-docs/mcp-server/dist/index.js"],
      "env": {
        "KELOIA_DOCS_ROOT": "<path-to>/keloia-docs"
      }
    }
  }
}
```

### 5b. Build & Test

```bash
cd mcp-server
npm run build

# Test locally with MCP inspector (optional)
npx @modelcontextprotocol/inspector node dist/index.js
```

### 5c. Example Claude Code Usage

Once connected, you (or Claude Code) can:

```
> Read our architecture doc
  → calls read_doc({ slug: "architecture" })

> What tasks are in progress?
  → calls get_kanban({ column: "in_progress" })

> Move KELOIA-001 to review
  → calls move_task({ id: "KELOIA-001", column: "review" })

> Update WhatsApp BFF progress to 45%, 4 tasks done
  → calls update_progress({ milestone_id: "mvp", module_name: "WhatsApp BFF", progress: 45, tasks_done: 4 })

> Add a task for PDF export feature
  → calls add_task({ id: "KELOIA-015", title: "PDF trip confirmation export", column: "backlog", labels: ["dashboard-bff", "post-mvp"] })
```

---

## 6. Quick Start Checklist

```bash
# 1. Create repo
mkdir keloia-docs && cd keloia-docs
git init

# 2. Create directory structure
mkdir -p docs kanban progress site mcp-server/src .github/workflows

# 3. Copy your existing docs
cp Keloia_Value_Proposition_Canvas.md docs/value-proposition.md
cp keloia-architecture.md docs/architecture.md

# 4. Create initial kanban/board.json and progress/tracker.json
#    (use the templates from Section 2)

# 5. Create site files (Section 3)

# 6. Build MCP server
cd mcp-server
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node
# Copy tsconfig.json and src/index.ts from Section 4
npm run build

# 7. Push & enable GitHub Pages
git add . && git commit -m "Initial project hub"
git remote add origin git@github.com:<user>/keloia-docs.git
git push -u origin main
# → Settings > Pages > Source: GitHub Actions
```

---

## 7. Future Enhancements (YAGNI — Build When Needed)

These are ideas, not tasks. Only implement when the pain justifies it.

**Site improvements:** search across docs (lunr.js), edit-in-place for kanban cards (commits via GitHub API), dark/light toggle, mobile responsive sidebar.

**MCP server additions:** `search_docs` tool with keyword matching across all files, `get_summary` tool that returns a project overview digest, `update_doc` tool for AI to propose doc edits via PRs.

**Automation:** GitHub Action that auto-updates progress tracker when PRs merge with specific labels, webhook that syncs kanban with GitHub Issues.
