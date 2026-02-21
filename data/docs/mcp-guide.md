# MCP Setup Guide

## What is Keloia MCP?

The Keloia MCP server exposes your project docs, kanban board, and milestones to AI tools via the Model Context Protocol. When a markdown or JSON file changes in your repo, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync required.

## Prerequisites

- Node.js 18 or higher
- The Keloia repository cloned locally

## Setup

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "keloia": {
      "command": "node",
      "args": ["/absolute/path/to/your-repo/mcp-server/dist/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/your-repo` with the absolute path to your local Keloia repository.

### Claude Code

Add to your Claude Code MCP configuration (e.g. `~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "keloia": {
      "command": "node",
      "args": ["/absolute/path/to/your-repo/mcp-server/dist/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/your-repo` with the absolute path to your local Keloia repository.

### Windsurf

Add to your Windsurf MCP settings:

```json
{
  "mcpServers": {
    "keloia": {
      "command": "node",
      "args": ["/absolute/path/to/your-repo/mcp-server/dist/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/your-repo` with the absolute path to your local Keloia repository.

## Available Tools

| Tool | Type | Description |
|------|------|-------------|
| `keloia_list_docs` | Read | List all documents registered in the docs index |
| `keloia_read_doc` | Read | Read a document by slug, returns full markdown content |
| `keloia_get_kanban` | Read | Get the full kanban board with all tasks and columns |
| `keloia_get_progress` | Read | Read milestone progress data |
| `keloia_add_task` | Write | Add a new task to the kanban board |
| `keloia_move_task` | Write | Move a task to a different column |
| `keloia_update_progress` | Write | Update milestone progress (tasks completed / total) |
