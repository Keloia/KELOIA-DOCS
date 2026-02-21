# Feature Research

**Domain:** Project documentation hub (static site) + MCP server (AI tool integration)
**Researched:** 2026-02-21
**Confidence:** HIGH (MCP features verified against official spec at modelcontextprotocol.io/docs; site features MEDIUM from WebSearch + domain knowledge)

---

## Feature Landscape

This project is a dual-surface product: one surface serves humans (static site), one serves AI (MCP server). Features are categorized for each surface, then for the integrated system.

---

### Table Stakes (Users Expect These)

#### Site Surface

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Markdown rendering from `docs/` | Docs site without rendered markdown is not a docs site | LOW | marked.js from CDN handles this; already in PROJECT.md |
| Sidebar navigation with doc list | Users need to discover and switch docs; a flat wall of content is unusable | LOW | Built from file listing or a manifest JSON; fetch-based at runtime |
| Active link highlighting in sidebar | Users need to know where they are in the nav | LOW | Simple class toggle on current route |
| Kanban board view from `board.json` | The board is the task tracker; showing raw JSON is a non-product | MEDIUM | Column layout with card rendering; column names from JSON schema |
| Progress tracker view from `tracker.json` | Progress bars expected for milestone tracking; JSON dump is not usable | LOW-MEDIUM | Simple percentage bars per milestone; no charting library needed |
| GitHub Pages deployment via Actions | Users of GitHub Pages repos expect push-to-deploy; manual deploys feel broken | LOW | Standard Actions workflow; already specified in PROJECT.md |
| Responsive layout | Site will be viewed in browser and possibly on mobile | LOW | Single CSS file, flexbox/grid |
| Fast initial load (no framework overhead) | No build step means no bundle optimization; must compensate with simplicity | LOW | Constraint already met by vanilla HTML/CSS/JS + CDN assets |

#### MCP Server Surface

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `list_docs` tool | Claude Code needs to discover what documentation exists before it can read any | LOW | Reads `docs/` directory, returns filenames + titles |
| `read_doc` tool | Reading a single file is the atomic unit of all doc access | LOW | Reads markdown file by name, returns content as text |
| `get_kanban` tool | Board state is useless without a way to read it | LOW | Reads `board.json`, supports filter params |
| `add_task` tool | Read-only board makes AI assistants passive; write access is the value | LOW-MEDIUM | Append card to column in `board.json` with validation |
| `move_task` tool | Moving tasks across columns is the core kanban workflow | LOW-MEDIUM | Update column field on card in `board.json` |
| `get_progress` tool | Milestone state must be readable to be useful | LOW | Reads `tracker.json`, returns milestone summary |
| `update_progress` tool | Progress that can't be updated goes stale and becomes untrustworthy | LOW-MEDIUM | Updates percentage/status on a milestone in `tracker.json` |
| JSON Schema input validation via Zod | Without validation, invalid writes corrupt data files | LOW | Zod already in dependency list; wrap all write tools |
| Descriptive tool names and descriptions | Claude Code uses tool descriptions to decide which tool to call; vague names cause misuse | LOW | No implementation cost — quality of strings only |
| Stdio transport | Claude Code's local integration model is stdio; HTTP transport cannot be configured without a running server | LOW | Already decided in PROJECT.md; standard SDK setup |
| Proper error responses (`isError: true`) | MCP spec defines error signaling; returning errors as success confuses LLM | LOW | Follow MCP spec: `{ isError: true, content: [{ type: "text", text: "..." }] }` |

---

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Single-source-of-truth files (no sync) | Most doc+AI setups duplicate data: one format for humans, another for AI. This project eliminates that friction entirely | LOW | Already the architectural choice; the differentiator is the constraint, not a feature to build |
| Filtered `get_kanban` (by column, label, assignee) | Claude Code can ask "show me all in-progress tasks assigned to me" without reading the whole board | LOW-MEDIUM | Add `column`, `label`, `assignee` query params to the tool; filter in memory |
| `docs://` resource alongside tools | Exposing docs as MCP Resources (not just tools) lets Claude Code use them via both resource-read and tool-call patterns — more compatible with diverse MCP clients | LOW | One-time addition: expose `docs://{filename}` resource templates per spec |
| Zero-config MCP registration | One-liner `claude mcp add` command in README; most projects require manual JSON editing | LOW | Quality of documentation and a single CLI command |
| Structured output schema on read tools | Adding `outputSchema` to `read_doc` and `get_kanban` lets Claude Code validate responses and reason about shape — newer MCP spec feature (2025-06-18) | LOW | JSON Schema declarations in tool definition; no runtime cost |
| Human-readable kanban cards in site | Rendering cards with labels, assignees, status colors makes the board useful without a dedicated app like Linear or Jira | MEDIUM | CSS-only card components; color-coding columns |
| Milestone progress with history display | Showing trend (was 20% last week, now 60%) adds temporal context most simple trackers skip | HIGH | Requires appending history to `tracker.json`; deferred unless requested |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full-text search across docs | Users want to find content without browsing | Requires either a build-time index (breaks zero-build constraint) or a client-side WASM search engine (adds ~200KB+ dependency); at <20 docs, search is overkill | Browser Ctrl+F on current doc; add only when doc count justifies it (stated in PROJECT.md) |
| GitHub Issues sync | Tasks already exist in Issues; why duplicate? | Adds external API dependency (rate limits, auth tokens, network failures); Issues are write-heavy (comments, events) and poorly structured for kanban; breaks offline-first model | Use the local `board.json` as the authoritative task store; link to Issues by URL in card descriptions if needed |
| Authentication on the site | Protect private project data | Repo visibility is the access control layer; adding auth to a static site requires either a backend or a third-party service, both of which contradict zero-build constraints | Set repo to private if confidentiality needed |
| CSS framework (Tailwind, Bootstrap) | Faster styling | Tailwind requires a build step; Bootstrap adds 30KB+ and imposes visual opinions on a single-user tool | Hand-write a single `style.css`; 200 lines of vanilla CSS is more maintainable than a framework dependency for a 3-page SPA |
| React/Vue/Svelte component library | Component reuse, state management | Any modern JS framework adds a build step (even Svelte compiles); defeats the zero-build constraint entirely | Vanilla DOM manipulation and HTML templates with `<template>` elements |
| SQLite/D1 for task storage | Type-safe queries, relational data | Requires a runtime database process or edge worker; JSON files serve the same needs for <100 tasks with zero infrastructure | JSON files in `kanban/` and `progress/`; revisit at scale |
| Remote MCP transport (HTTP/SSE) in v1 | Access from remote clients or team members | Adds auth complexity (OAuth 2.1 required per 2025 spec), infrastructure (a server to run), and TLS management; none of this is needed for single-user local use | Stdio first; design server code so transport is a one-line swap (already a stated requirement) |
| WebSocket live updates on site | Real-time board sync when files change | Requires a persistent server process; GitHub Pages serves static files only; no SSE or WebSocket support | Manual reload; or for local dev only, a simple `fetch` poll every N seconds triggered by user action |
| Testing framework (Jest/Vitest) | Catch regressions | 7 tools under 20 lines each; the cost of test infrastructure exceeds the value at this scale and user count | Test by using: run Claude Code sessions against the server and validate outputs manually |

---

## Feature Dependencies

```
[Site: Sidebar Navigation]
    └──requires──> [Site: Doc file listing / manifest]
                       └──requires──> [Data: docs/ directory with markdown files]

[Site: Kanban Board View]
    └──requires──> [Data: kanban/board.json with valid schema]

[Site: Progress Tracker View]
    └──requires──> [Data: progress/tracker.json with valid schema]

[MCP: read_doc]
    └──requires──> [MCP: list_docs] (discover names before reading)

[MCP: move_task]
    └──requires──> [MCP: get_kanban] (read board state to validate move)
    └──requires──> [MCP: add_task] (tasks must exist before moving)

[MCP: update_progress]
    └──requires──> [MCP: get_progress] (read before write)

[MCP: Filtered get_kanban]
    └──enhances──> [MCP: get_kanban] (filter is a param, not a separate tool)

[MCP: docs:// Resource]
    └──enhances──> [MCP: list_docs + read_doc] (parallel access pattern for MCP clients)

[Site: Human-readable cards]
    └──requires──> [Data: kanban/board.json] with consistent schema (labels, assignees)
    └──conflicts──> [Anti-feature: GitHub Issues sync] (two task sources create sync burden)

[MCP: Structured outputSchema]
    └──enhances──> [MCP: read_doc, get_kanban, get_progress] (validation layer on top)
```

### Dependency Notes

- **`read_doc` requires `list_docs`:** Claude Code must call `list_docs` to know document names before calling `read_doc`. Both tools are table stakes and must ship together.
- **`move_task` requires valid board state:** The move operation must verify the task ID exists and the target column exists before writing. This means `get_kanban` must be implemented first.
- **`docs://` resource enhances tools:** Resources and tools serve the same underlying data but through different MCP access patterns. Resources are optional but low-cost to add alongside tools.
- **Filtered `get_kanban` enhances base tool:** Filtering is implemented as optional parameters on the existing tool, not a separate tool. One tool handles both cases.

---

## MVP Definition

### Launch With (v1)

Minimum viable product — what Claude Code and the human user need to work with this repo.

- [ ] `list_docs` and `read_doc` MCP tools — without these, Claude Code cannot access project docs
- [ ] `get_kanban` with column/label/assignee filters — board read access is required before write access
- [ ] `add_task` and `move_task` MCP tools — write capability is the core value proposition for AI-assisted task management
- [ ] `get_progress` and `update_progress` MCP tools — milestone tracking is an explicit requirement
- [ ] Zod input validation on all write tools — corrupted JSON breaks both site and MCP; this is not optional
- [ ] Static site rendering markdown from `docs/` with sidebar — the human-readable surface of the same data
- [ ] Static site kanban board view from `board.json` — board must be human-readable, not raw JSON
- [ ] Static site progress tracker view from `tracker.json` — progress must be human-readable
- [ ] GitHub Actions deployment workflow — push-to-deploy is the zero-friction contract

### Add After Validation (v1.x)

Features to add once core is working and in daily use.

- [ ] `docs://` MCP resource template — add when a second MCP client (not Claude Code) needs resource access
- [ ] Structured `outputSchema` on read tools — add when Claude Code shows evidence of schema confusion
- [ ] Human-readable card styling with labels/assignees/colors — add when raw card titles feel insufficient

### Future Consideration (v2+)

Features to defer until product-market fit with this setup is established.

- [ ] Full-text search — add when doc count exceeds 20
- [ ] Milestone history / trend display — add when retrospective data is wanted
- [ ] Remote MCP HTTP/SSE transport — add when remote access or team usage is needed
- [ ] Polling-based site refresh — add if manual reload becomes friction in daily workflow

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `list_docs` + `read_doc` | HIGH | LOW | P1 |
| `get_kanban` (with filters) | HIGH | LOW | P1 |
| `add_task` + `move_task` | HIGH | LOW-MEDIUM | P1 |
| `get_progress` + `update_progress` | HIGH | LOW | P1 |
| Zod validation on write tools | HIGH (data safety) | LOW | P1 |
| Site: markdown rendering + sidebar | HIGH | LOW | P1 |
| Site: kanban board view | HIGH | MEDIUM | P1 |
| Site: progress tracker view | HIGH | LOW | P1 |
| GitHub Actions deploy workflow | HIGH | LOW | P1 |
| Proper MCP error responses | MEDIUM | LOW | P1 |
| Descriptive tool names/descriptions | MEDIUM | LOW | P1 |
| Filtered `get_kanban` params | MEDIUM | LOW | P2 |
| `docs://` resource template | LOW (at launch) | LOW | P2 |
| Structured `outputSchema` on tools | LOW (at launch) | LOW | P2 |
| Card label/assignee styling on site | MEDIUM | LOW | P2 |
| Full-text search | LOW (< 20 docs) | HIGH | P3 |
| Milestone history/trend | LOW | HIGH | P3 |
| Remote MCP transport | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

The closest analogues are: standalone MCP doc servers (e.g., Google's Developer Knowledge API MCP), Kanban MCP servers (eyalzh/kanban-mcp), and static docs sites (Docusaurus, VitePress, GitHub Pages + Jekyll).

| Feature | eyalzh/kanban-mcp | Google Dev Knowledge MCP | Our Approach |
|---------|-------------------|--------------------------|--------------|
| Task read/write | Yes (SQLite-backed) | No (read-only docs) | Yes (JSON-backed, no DB process) |
| Doc reading | No | Yes (Google docs) | Yes (local markdown files) |
| Static site | No | No | Yes (human-readable surface) |
| Zero-build constraint | N/A | N/A | Yes (hard constraint) |
| Local files as source of truth | No (SQLite) | No (remote API) | Yes (markdown + JSON on disk) |
| Filters on board queries | Yes (WIP limits) | N/A | Yes (column, label, assignee) |
| Single-user focus | No (multi-agent) | No (public API) | Yes (Reza + Claude Code) |

**Key differentiation:** No existing tool combines docs reading, kanban write operations, and a human-readable static site in one repo with files as the only storage layer. The value is the integration, not any individual feature.

---

## Sources

- [MCP Tools specification (Protocol Revision 2025-06-18)](https://modelcontextprotocol.io/docs/concepts/tools) — HIGH confidence; official spec
- [MCP Resources specification (Protocol Revision 2025-06-18)](https://modelcontextprotocol.io/docs/concepts/resources) — HIGH confidence; official spec
- [eyalzh/kanban-mcp — kanban MCP reference implementation](https://github.com/eyalzh/kanban-mcp) — MEDIUM confidence; open source reference
- [Claude Code MCP integration docs](https://code.claude.com/docs/en/mcp) — HIGH confidence; official docs
- [MCP Best Practices guide](https://modelcontextprotocol.info/docs/best-practices/) — MEDIUM confidence; community docs
- [GitHub Pages documentation](https://docs.github.com/articles/creating-project-pages-manually) — HIGH confidence; official docs

---
*Feature research for: docs site + MCP server (Keloia Docs project)*
*Researched: 2026-02-21*
