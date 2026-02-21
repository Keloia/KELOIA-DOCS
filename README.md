# Keloia Docs

A single repository that serves project documentation to humans via GitHub Pages and to AI tools via an MCP server. Both surfaces read and write the same JSON files on disk — no sync, no duplication, no deploy step. When a markdown or JSON file changes, both the site and Claude see the update immediately.

## Prerequisites

- Node.js 18+ (for the MCP server)
- Claude Code (for MCP integration)

## Quick Start (MCP Server)

```bash
git clone https://github.com/your-org/keloia-docs.git
cd keloia-docs/mcp-server
npm install
npm run build
```

Open Claude Code in the repo root directory.

`.mcp.json` is already committed — Claude Code auto-registers the server on open. Run `/mcp` in Claude Code to verify `keloia` shows as "connected".

## Available Tools

| Tool | Type | Description |
|------|------|-------------|
| keloia_list_docs | read | Lists available documentation files |
| keloia_read_doc | read | Reads a markdown doc by slug with optional pagination |
| keloia_get_kanban | read | Returns the full kanban board with denormalized tasks |
| keloia_get_progress | read | Returns all milestone progress data |
| keloia_add_task | write | Creates a new kanban task with generated ID |
| keloia_move_task | write | Moves a task to a different column |
| keloia_update_progress | write | Updates milestone fields (status, task counts, notes) |

## Static Site

The `site/` directory is deployed via GitHub Actions to GitHub Pages. Push to `main` triggers the deploy workflow. No build step — the site reads JSON data directly.

## Data Structure

- `data/docs/` — Markdown documentation files
- `data/kanban/` — Kanban board (`index.json` + `task-NNN.json` files)
- `data/progress/` — Milestone progress (`index.json` + `milestone-NN.json` files)

## Development

```bash
cd mcp-server
npm run dev
```

`npm run dev` runs the server via tsx (for development only). After code changes, run `npm run build` to update `dist/` — Claude Code runs the built output, not source. Always rebuild before testing changes in Claude Code.
