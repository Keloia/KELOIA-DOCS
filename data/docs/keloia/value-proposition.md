# Value Proposition

## The Core Problem

Solo developers using AI tools like Claude Code face a specific friction: keeping project state visible to both themselves and the AI. Documentation lives in one place, task state lives in another, and the AI has to ask about both. When anything changes, you update it in one surface and hope the other stays in sync.

Keloia eliminates that friction.

## The Core Value

**When a file changes, both humans and AI see the update immediately.**

There is no build pipeline between a file edit and what the GitHub Pages site displays. There is no sync step between the filesystem and what the MCP server exposes. Edit a JSON file, commit it, and the next `fetch()` call (from the browser) or tool call (from the AI) returns the updated data.

This is not an optimization — it is the design constraint the entire architecture is built around.

## No Pipeline, No Drift

Traditional project management setups involve:
- A database that needs to be kept in sync with documentation
- A build step that transforms source into the deployed artifact
- Export/import flows to share data between tools

Keloia has none of these. The `data/` directory is the single source of truth. The GitHub Pages site reads from it. The MCP server reads from it. There is nothing to sync because there is only one store.

## Single Source of Truth

Every piece of project state — documentation, kanban tasks, milestone progress — lives in `data/` as plain files. Markdown for prose, JSON for structured data. Both formats render natively in the GitHub UI without any tooling.

This means:
- You can edit files directly in the GitHub web editor and both surfaces update on the next page load
- You can clone the repo, edit locally, and push — same result
- AI tools can read and write the same files you do, with no translation layer

## Target Audience

Keloia is built for solo developers who:
- Use Claude Code as their primary AI assistant
- Want AI tools to have real-time access to project state without manual context-sharing
- Prefer plain files over databases for project data
- Are comfortable with Git as a history and collaboration layer

If you find yourself pasting task lists or milestone status into an AI conversation at the start of every session, Keloia replaces that workflow with structured tool access. The AI queries the current state directly.
