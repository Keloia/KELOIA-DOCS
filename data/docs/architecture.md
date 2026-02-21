# Keloia Architecture

## Project Purpose

Keloia is a lightweight project management hub for solo developers. It provides two surfaces from a single repository: a static GitHub Pages site for human browsing, and an MCP (Model Context Protocol) server for AI tool access. When a file changes in the repository, both surfaces reflect the update immediately — no build pipeline, no deploy step, no synchronization required.

## Dual-Surface Approach

The repository serves two audiences simultaneously:

**GitHub Pages (Human Surface)**
The `docs/` directory root (or repo root with `.nojekyll`) hosts a vanilla JavaScript site. Humans navigate to the GitHub Pages URL to view project documentation, kanban board, and milestone progress. The site reads JSON and markdown files directly via `fetch()` — no server-side rendering, no framework.

**MCP Server (AI Surface)**
An MCP server (added in Phase 3) exposes the same `data/` files as structured tools. AI assistants like Claude Code can call `read_doc`, `list_tasks`, `get_milestone` and similar tools to query project state. The AI reads the same files the human site reads, so there is no divergence.

## Data Layer Design

The filesystem acts as the database. All project data lives in the `data/` directory:

```
data/
  docs/           # Markdown documentation files (flat, no subdirectories)
  kanban/         # Kanban board data
    index.json    # Schema anchor: columns array + task registry
    task-NNN.json # One file per task
  progress/       # Milestone progress data
    index.json    # Schema anchor: milestone registry
    milestone-NN.json  # One file per milestone
```

**Split-file pattern:** Each task and each milestone lives in its own JSON file. The index file acts as a registry and schema anchor — it lists all IDs and defines the valid column values (for kanban) or structure (for progress). Adding a task means adding one file and updating the index; no file grows unbounded.

**schemaVersion field:** Both index files carry `"schemaVersion": 1`. This allows future consumers to detect and handle schema migrations without breaking changes.

**No computed fields stored:** Progress percentages are not stored. Consumers calculate `(tasksCompleted / tasksTotal) * 100` at read time. This prevents stale data from persisting in the repository.

## Technology Choices

- **Vanilla JavaScript** — No framework, no build step. Files are served as-is from GitHub Pages.
- **marked.js from CDN** — Markdown rendering in the browser using the UMD global. No npm install.
- **JSON for structured data** — Native to JavaScript, rendered by GitHub UI, no parsing library needed server-side.
- **MCP stdio transport** — The MCP server uses stdio for local Claude Code usage. This is the primary use case.
- **No database** — The filesystem is the store. Git is the history layer.

## Why No Build Step

A build step creates a gap between source and output. Any gap requires synchronization, which requires tooling, which requires maintenance. Keloia eliminates the gap by serving source files directly. The constraint is intentional: if a feature requires a build step, it is out of scope.
