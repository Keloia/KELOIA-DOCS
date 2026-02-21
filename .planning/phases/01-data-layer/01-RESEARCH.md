# Phase 1: Data Layer - Research

**Researched:** 2026-02-22
**Domain:** Filesystem schema design — directory structure, JSON schemas, seed content
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Repo file structure:** All data lives under a top-level `data/` directory: `data/docs/`, `data/kanban/`, `data/progress/`
- **Documentation files:** Flat inside `data/docs/` — no subdirectories by topic
- **Storage approach:** Kanban and progress data use split-file approach (one JSON file per entity) rather than monolithic files
- **Kanban board design:**
  - Three columns: Backlog, In Progress, Done
  - No priority field — column position and ordering imply priority
  - Task fields: id, title, column, description, assignee
  - Lean schema — no labels, no dates, no tags
- **Progress tracker design:**
  - Milestones map directly to roadmap phases (Phase 1 = milestone 1, etc.)
  - Progress is task-count driven — calculated from completed/total tasks in kanban, not manually set
  - No manual percentage override

### Claude's Discretion

- Kanban file split strategy (file-per-task with columns index, file-per-column, or other)
- Progress file split strategy (file-per-milestone vs single file)
- Whether milestones have sub-modules or single aggregate progress
- Seed task content for initial kanban data
- Schema design details (field types, ID format, validation rules)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DATA-01 | Seed `docs/` directory with existing markdown files (architecture, value proposition) | Covered by directory structure section — create `data/docs/` with at least one real `.md` file |
| DATA-02 | Create `kanban/board.json` with schema: columns array, tasks with id/title/column/priority/assignee/labels/description/dates | Partially locked by CONTEXT.md (no priority, no labels, no dates — lean schema applies). Schema design section covers what fields to implement |
| DATA-03 | Create `progress/tracker.json` with schema: milestones with modules, progress percentages, task counts, notes | Schema design section covers split-file approach and how milestones map to phases |
| DATA-04 | Add `schemaVersion: 1` field to both JSON files for future migration safety | `schemaVersion` placement in split-file structure is a key design decision covered below |
</phase_requirements>

---

## Summary

Phase 1 is a schema design and content seeding phase with no external library dependencies. The deliverable is a repo directory structure (`data/docs/`, `data/kanban/`, `data/progress/`) containing valid JSON files and at least one markdown doc. The only "code" is JSON and markdown — no npm, no build step, no TypeScript.

The critical design decision the user delegated (Claude's Discretion) is how to structure the split-file kanban and progress data. The user chose split-file over monolithic, but left the specific strategy open. This research recommends a specific split strategy for each domain that balances simplicity with the MCP server's future read/write needs.

A structural tension exists between the user's `data/` prefix decision and the success criteria in ROADMAP.md which reference `kanban/board.json` and `progress/tracker.json` without the `data/` prefix. The planner must resolve this by using the CONTEXT.md decision (which is more recent and explicit) as authoritative, and noting that downstream consumers (site fetch paths and MCP server file paths) must reference `data/kanban/`, `data/progress/`, `data/docs/` accordingly.

**Primary recommendation:** Use a `data/` root with an index file per domain (`data/kanban/index.json`, `data/progress/index.json`) that aggregates the split entity files. `schemaVersion: 1` lives in the index file. This keeps a stable "anchor" file that downstream consumers can read for metadata while individual entity files remain independently editable.

---

## Standard Stack

### Core

| Technology | Version | Purpose | Why Standard |
|------------|---------|---------|--------------|
| JSON | n/a | Kanban and progress data format | Native to JS, GitHub renders it, no parser needed |
| Markdown | CommonMark | Documentation content | Readable in GitHub UI, renderable by marked.js |
| Filesystem directories | n/a | Physical schema | The filesystem IS the database for this project |

### Supporting

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `jq` (optional) | any | Manual JSON validation during development | Useful for verifying schema before committing |
| GitHub UI | n/a | Visual verification of markdown rendering | Success criterion 1 requires viewable-in-GitHub-UI docs |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Split-file JSON | Single monolithic `board.json` | Monolithic is simpler to read but creates merge conflicts and large diffs when individual tasks change |
| file-per-task kanban split | file-per-column split | File-per-column groups tasks by their current column but requires moving files when tasks move columns — awkward for atomic updates |
| Index + entity files | Flat directory scan | Index file is faster to read and holds `schemaVersion`; directory scan requires reading every file to build a full view |

**Installation:** None. Phase 1 has zero npm dependencies.

---

## Architecture Patterns

### Recommended Project Structure

```
keloia-docs/
└── data/
    ├── docs/
    │   ├── architecture.md          # Seed: existing architecture doc
    │   └── value-proposition.md     # Seed: existing value proposition doc
    ├── kanban/
    │   ├── index.json               # Schema anchor: columns def, schemaVersion, task registry
    │   ├── task-001.json            # Individual task file
    │   └── task-002.json            # Individual task file
    └── progress/
        ├── index.json               # Schema anchor: milestone registry, schemaVersion
        └── milestone-01.json        # Individual milestone file (maps to Phase 1)
```

### Pattern 1: Index File as Schema Anchor

**What:** Each domain (`kanban/`, `progress/`) has an `index.json` that holds the `schemaVersion`, domain-level metadata, and a list of all entity file IDs. Individual entity files (tasks, milestones) live as separate JSON files.

**When to use:** When entities are independently editable, when you want a stable file for downstream consumers to read first, and when you need `schemaVersion` to live in exactly one place per domain.

**Why not file-per-column:** File-per-column requires renaming/moving files when a task changes columns, which is not atomic and creates filesystem-level state transitions that MCP write tools have to manage carefully. File-per-task is simpler: move task = update `column` field in `task-XXX.json`, no file rename needed.

**Example kanban index:**

```json
{
  "schemaVersion": 1,
  "columns": ["Backlog", "In Progress", "Done"],
  "tasks": ["task-001", "task-002"]
}
```

**Example task file (`data/kanban/task-001.json`):**

```json
{
  "id": "task-001",
  "title": "Seed docs directory with markdown files",
  "column": "Done",
  "description": "Create data/docs/ and add architecture.md and value-proposition.md",
  "assignee": null
}
```

**Example progress index:**

```json
{
  "schemaVersion": 1,
  "milestones": ["milestone-01", "milestone-02", "milestone-03", "milestone-04", "milestone-05"]
}
```

**Example milestone file (`data/progress/milestone-01.json`):**

```json
{
  "id": "milestone-01",
  "phase": 1,
  "title": "Data Layer",
  "status": "in-progress",
  "tasksTotal": 4,
  "tasksCompleted": 0,
  "notes": "Establishing shared filesystem data contracts"
}
```

### Pattern 2: Task ID Format

**What:** Use zero-padded sequential integer IDs (`task-001`, `task-002`) rather than UUIDs or slugs.

**Why:** Predictable, sortable, human-readable, and the MCP server can scan `data/kanban/` for `task-*.json` files to discover all tasks without maintaining a separate registry. The index file still exists for schema anchoring, but isn't strictly required for discovery.

**ID format rules:**
- Kanban tasks: `task-NNN` (three digits, zero-padded, increment from `task-001`)
- Milestones: `milestone-NN` (two digits, maps to phase number, e.g., `milestone-01` = Phase 1)

### Pattern 3: Progress as Task-Count Derived (Not Stored)

**What:** `tasksCompleted` and `tasksTotal` are stored in the milestone file, but percentage is NOT stored — it is calculated at read time by the consumer (site or MCP tool).

**Why:** The user locked this: "Progress is task-count driven — calculated from completed/total tasks in kanban, not manually set." Storing a computed percentage creates a sync problem: when tasks move in kanban, percentage in tracker must also update. Removing the percentage field eliminates that invariant.

**Calculation:**
```
progress_pct = (tasksCompleted / tasksTotal) * 100
```

Consumers (site view, MCP `get_progress` tool) compute this at display time.

### Pattern 4: Column Field as Enum String

**What:** The `column` field in each task file is a string constrained to the three valid column names: `"Backlog"`, `"In Progress"`, `"Done"`.

**Why:** Storing column as a string in the task file means the task is self-describing. Column order and display are defined in `kanban/index.json > columns` array. The `move_task` MCP tool will validate the column string against the columns array before writing.

### Anti-Patterns to Avoid

- **Storing `progress_pct` in milestone file:** Creates sync problem between kanban and progress files — every task state change must update two files. Store counts, compute percentages.
- **Using UUID for task IDs:** UUIDs are opaque and unsortable. For a <100 task board, sequential IDs are better for human editability.
- **Nesting tasks inside the index file:** Defeats the purpose of split files and makes individual task updates touch the index file every time.
- **Putting `schemaVersion` only at the entity level:** If a consumer scans all task files, it reads `schemaVersion` N times. One `schemaVersion` in the index is authoritative.
- **Using subdirectories inside `data/docs/`:** Locked decision — flat structure only. Subdirectories would require the site's sidebar nav and MCP `list_docs` tool to handle recursive scanning.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON schema validation | Custom validator | Zod (in MCP server, Phase 3+) | This is a Phase 1 concern only at design time; the JSON files are hand-seeded. Validation at write time is a Phase 5 concern. |
| ID generation | UUID library | Sequential `task-NNN` increment | Overkill; sequential is readable, sortable, and sufficient for <100 tasks |
| File discovery | Recursive walker | `fs.readdir` + filter for `task-*.json` | The directory IS the index; no separate registry needed for discovery |

**Key insight:** Phase 1 has no code to write. It is pure schema design and file creation. Do not over-engineer — the files should be hand-editable by a human who has never read the schema docs.

---

## Common Pitfalls

### Pitfall 1: `data/` Prefix Conflicts with Success Criteria

**What goes wrong:** ROADMAP.md success criteria reference `kanban/board.json` and `progress/tracker.json` without the `data/` prefix. CONTEXT.md (more recent, explicit user decision) places everything under `data/`. These are in conflict.

**Why it happens:** Requirements were written before the `data/` prefix decision was made in the discussion phase.

**How to avoid:** Use CONTEXT.md as authoritative. The user explicitly decided `data/docs/`, `data/kanban/`, `data/progress/`. The success criteria checking for "kanban/board.json" should be interpreted as checking for the kanban data file — which in this project is `data/kanban/index.json`. Update success criteria interpretation accordingly.

**Downstream impact:** All future phases must use `data/` prefix in fetch paths (site) and fs paths (MCP server). Document this prominently.

### Pitfall 2: `schemaVersion` Ambiguity in Split-File Structure

**What goes wrong:** DATA-04 requires `schemaVersion: 1` in both JSON files. With split files, "both JSON files" is ambiguous — which file? Every task file? Only the index?

**How to avoid:** Place `schemaVersion: 1` in the index file only (`data/kanban/index.json` and `data/progress/index.json`). This is the domain's schema anchor. Entity files (task, milestone) do not carry `schemaVersion` — they inherit from the index.

**Success criteria resolution:** Criteria 4 ("Both JSON files contain `schemaVersion: 1`") refers to the two domain index files, not every entity file.

### Pitfall 3: Seeding Incorrect Markdown for GitHub UI Rendering

**What goes wrong:** Success criterion 1 requires a markdown file "viewable in the GitHub UI." GitHub renders markdown if the file has a `.md` extension and is valid CommonMark. Non-standard extensions, YAML front matter with invalid syntax, or binary content embedded in markdown can cause GitHub to fall back to raw text display.

**How to avoid:** Use standard `.md` extension, valid CommonMark, and avoid Jekyll-style `{% liquid %}` template syntax (GitHub Pages Jekyll processing can mangle markdown unless disabled). Since this project is not using Jekyll, add an empty `.nojekyll` file at the repo root to prevent GitHub Pages from processing markdown as Jekyll templates.

### Pitfall 4: Missing `.nojekyll` File

**What goes wrong:** GitHub Pages runs Jekyll by default, which processes markdown and Liquid templates. This can cause `_` prefixed directories or files to be hidden, and can mangle markdown content with embedded double-brace expressions.

**How to avoid:** Create an empty `.nojekyll` file at the repo root. This signals GitHub Pages to skip Jekyll processing and serve files as static content.

### Pitfall 5: Inconsistent Null Handling in Task Fields

**What goes wrong:** Optional fields like `assignee` can be `null`, `""` (empty string), or omitted entirely. Inconsistency causes MCP server read tools and site rendering to require extra null-coalescing logic.

**How to avoid:** Standardize: optional fields that have no value use `null` (not omitted, not empty string). Document this in a comment or README so hand-editing stays consistent.

---

## Code Examples

### Kanban Index Schema (`data/kanban/index.json`)

```json
{
  "schemaVersion": 1,
  "columns": ["Backlog", "In Progress", "Done"],
  "tasks": ["task-001", "task-002", "task-003"]
}
```

### Task File Schema (`data/kanban/task-001.json`)

```json
{
  "id": "task-001",
  "title": "Example task title",
  "column": "Backlog",
  "description": "Optional longer description of what this task entails",
  "assignee": null
}
```

### Progress Index Schema (`data/progress/index.json`)

```json
{
  "schemaVersion": 1,
  "milestones": ["milestone-01", "milestone-02", "milestone-03", "milestone-04", "milestone-05"]
}
```

### Milestone File Schema (`data/progress/milestone-01.json`)

```json
{
  "id": "milestone-01",
  "phase": 1,
  "title": "Data Layer",
  "status": "in-progress",
  "tasksTotal": 4,
  "tasksCompleted": 0,
  "notes": "Establishing shared filesystem data contracts and seed content"
}
```

### Milestone Status Enum Values

Valid values for `status` field:
- `"pending"` — not yet started
- `"in-progress"` — actively being worked
- `"complete"` — all tasks done

### Seed Markdown File (`data/docs/architecture.md`)

```markdown
# Keloia Architecture

[Content of existing architecture doc goes here]
```

### Seed Task Content for Initial Kanban Board

The first tasks seeded should represent the current Phase 1 work items, mapped from DATA-01 through DATA-04 requirements. Three tasks in Backlog, seeded as part of Phase 1 execution itself.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single monolithic `board.json` | Split-file per entity | User decision 2026-02-22 | Finer-grained diffs, no merge conflicts on individual task edits |
| `progress_pct` stored in tracker | Task-count driven, calculated at read time | User decision 2026-02-22 | Eliminates sync problem between kanban and progress |

**Not applicable:** This is a greenfield schema design. No migration from an old approach needed.

---

## Open Questions

1. **Conflict between `data/` prefix and success criteria references**
   - What we know: CONTEXT.md says `data/` prefix; ROADMAP.md success criteria say `kanban/board.json` without prefix
   - What's unclear: Whether success criteria should be updated to match, or whether the user intended `data/` to not apply to the root-level JSON anchors
   - Recommendation: Treat CONTEXT.md as authoritative (it's the more recent, explicit decision). Use `data/kanban/index.json` as the kanban schema anchor. Update or reinterpret success criteria accordingly. Raise with user before final plan commit if ambiguity is blocking.

2. **Milestone `tasksTotal` source of truth**
   - What we know: Progress is "calculated from completed/total tasks in kanban" per CONTEXT.md
   - What's unclear: Should `tasksTotal` in the milestone file be hand-set and match the kanban task count, or should it be omitted and always computed at read time?
   - Recommendation: Store `tasksTotal` and `tasksCompleted` explicitly in the milestone file. This avoids requiring the `get_progress` tool to also read all kanban tasks for every progress query. Update counts manually (or via MCP write tool in Phase 5). This is a pragmatic tradeoff between consistency and query simplicity.

3. **Whether to create all 5 milestone files upfront or only milestone-01**
   - What we know: There are 5 phases/milestones. Only Phase 1 is being worked now.
   - What's unclear: Is it better to seed all milestones now (complete schema) or only what exists?
   - Recommendation: Create all 5 milestone files now with `status: "pending"` and `tasksCompleted: 0`. This makes the progress view meaningful from day one and avoids a future schema change when Phase 2 begins.

---

## Sources

### Primary (HIGH confidence)

- `/Users/enjat/Github/keloia/keloia-docs/.planning/phases/01-data-layer/01-CONTEXT.md` — User decisions locked for this phase
- `/Users/enjat/Github/keloia/keloia-docs/.planning/REQUIREMENTS.md` — DATA-01 through DATA-04 definitions
- `/Users/enjat/Github/keloia/keloia-docs/.planning/ROADMAP.md` — Success criteria for Phase 1
- `/Users/enjat/Github/keloia/keloia-docs/.planning/research/ARCHITECTURE.md` — Project architecture research (2026-02-21), recommended directory structure
- `/Users/enjat/Github/keloia/keloia-docs/.planning/research/STACK.md` — Stack research confirming no deps needed for data layer

### Secondary (MEDIUM confidence)

- Project-level research files (`SUMMARY.md`, `PITFALLS.md`, `FEATURES.md`) — confirmed no external tools needed for Phase 1

### Tertiary (LOW confidence)

None used.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Phase 1 has no external dependencies; all design is schema-level
- Architecture: HIGH — File split strategy is internally consistent and derived from locked user decisions
- Pitfalls: HIGH — `data/` prefix tension is a concrete, observable inconsistency in the project docs; `.nojekyll` pitfall is verified GitHub Pages behavior

**Research date:** 2026-02-22
**Valid until:** This research is stable until the project's file structure decisions change (not time-bound)
