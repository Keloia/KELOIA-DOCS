# Requirements: Keloia Docs + MCP Server

**Defined:** 2026-02-22
**Core Value:** When a markdown or JSON file changes, both humans (via the site) and AI tools (via MCP) see the update immediately — no build pipeline, no deploy step, no sync.

## v1.1 Requirements

Requirements for MCP server milestone. Each maps to roadmap phases.

### MCP Foundation

- [x] **MCP-01**: MCP server skeleton in `mcp-server/` with `@modelcontextprotocol/sdk`, `zod@^3.25.0`, TypeScript, `Node16` module resolution
- [x] **MCP-02**: Stdio transport via `StdioServerTransport` — zero `console.log()`, only `console.error()`
- [x] **MCP-03**: All file paths resolved from `import.meta.url`, never `process.cwd()`
- [x] **MCP-04**: `.mcp.json` at repo root for Claude Code project-scope registration
- [x] **MCP-05**: Code structured so transport layer is swappable for future HTTP/SSE

### Read Tools

- [ ] **READ-01**: `keloia_list_docs` returns available documentation filenames from `data/docs/index.json`
- [ ] **READ-02**: `keloia_read_doc` reads a markdown file by slug with `max_tokens` and `offset` optional params for large doc pagination
- [ ] **READ-03**: `keloia_get_kanban` returns denormalized board (columns + all task objects) from split-file JSON
- [ ] **READ-04**: `keloia_get_progress` returns all milestones with status, task counts, and notes from split-file JSON
- [ ] **READ-05**: All read tools return `isError: true` with clear message for invalid inputs (bad slug, missing file)

### Write Tools

- [ ] **WRITE-01**: `keloia_add_task` creates a new kanban task with Zod-validated input and atomic write
- [ ] **WRITE-02**: `keloia_move_task` moves a task between columns with column validation and atomic write
- [ ] **WRITE-03**: `keloia_update_progress` updates milestone fields with Zod-validated input and atomic write
- [ ] **WRITE-04**: All write tools use atomic writes (same-directory temp file + `renameSync`)

### Integration

- [ ] **INTG-01**: All tool names prefixed with `keloia_` to avoid Claude Code built-in collisions
- [ ] **INTG-02**: Descriptive action-first tool descriptions for accurate AI tool selection
- [ ] **INTG-03**: README with setup instructions (clone, `npm install`, build, register)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Read Enhancements

- **READ-06**: Column and assignee filters on `keloia_get_kanban`
- **READ-07**: Computed `percentComplete` field on `keloia_get_progress` response
- **READ-08**: Schema version assertion on reads (validate `schemaVersion` before returning data)

### MCP Enhancements

- **MCP-06**: `docs://` resource template for alternative MCP access pattern
- **MCP-07**: Structured `outputSchema` on read tools for response validation
- **MCP-08**: `keloia_search_docs` tool with keyword matching across all files
- **MCP-09**: HTTP/SSE remote transport option alongside stdio

### Site Enhancements

- **SITE-09**: Full-text search across docs (lunr.js or similar)
- **SITE-10**: Milestone progress history / trend display
- **SITE-11**: Enhanced card styling with label colors and assignee avatars

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Generic `read_file`/`write_file` passthrough | LLM constructs arbitrary paths, bypasses validation |
| `delete_task` tool | Hard to recover on filesystem with no undo; move to Done instead |
| `create_doc`/`update_doc` write tools | Docs are human-owned markdown content; MCP reads only |
| Caching/in-memory state | Reads are always fresh off disk; no staleness problem |
| Batch write tools | Atomicity complexity multiplies with partial batch failure |
| `ts-node` | Broken with ESM in Node 20+; use `tsx` for dev |
| SSE transport | Deprecated in Claude Code; stdio is the correct transport |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MCP-01 | Phase 3 | Complete |
| MCP-02 | Phase 3 | Complete |
| MCP-03 | Phase 3 | Complete |
| MCP-04 | Phase 3 | Complete |
| MCP-05 | Phase 3 | Complete |
| READ-01 | Phase 4 | Pending |
| READ-02 | Phase 4 | Pending |
| READ-03 | Phase 4 | Pending |
| READ-04 | Phase 4 | Pending |
| READ-05 | Phase 4 | Pending |
| INTG-01 | Phase 4 | Pending |
| INTG-02 | Phase 4 | Pending |
| WRITE-01 | Phase 5 | Pending |
| WRITE-02 | Phase 5 | Pending |
| WRITE-03 | Phase 5 | Pending |
| WRITE-04 | Phase 5 | Pending |
| INTG-03 | Phase 5 | Pending |

**Coverage:**
- v1.1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after v1.1 roadmap creation*
