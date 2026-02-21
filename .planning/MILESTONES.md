# Milestones

## v1.0 Data Layer + Static Site (Shipped: 2026-02-22)

**Phases completed:** 2 phases, 3 plans, 9 tasks
**Timeline:** 1 day (2026-02-21 → 2026-02-22)
**Files:** 39 files changed, +5,090 lines
**LOC (site):** 846 lines (HTML/CSS/JS/YAML)
**Git range:** cef32e4..2999541

**Delivered:** Filesystem data layer with split-file JSON schemas and a vanilla JS SPA that renders docs, kanban board, and progress tracker — deployed via GitHub Pages with zero build step.

**Key accomplishments:**
- Filesystem data layer with split-file JSON schemas for kanban and progress tracking
- Seed documentation (architecture, value proposition) for dual-surface access
- Vanilla JS SPA with hash routing, dark theme, and marked.js + DOMPurify doc rendering
- Kanban board with 3 color-coded columns fetching from split-file JSON
- Progress tracker with computed progress bars from milestone data
- GitHub Actions no-build deploy to GitHub Pages

**Key decisions:**
- Split-file pattern (index.json + one file per entity) over monolithic JSON
- Hash routing over History API (mandatory for GitHub Pages subdirectory)
- DOMPurify wraps all marked.parse output (XSS protection)
- Relative fetch paths everywhere (no leading slash for Pages compat)
- Column-based color-coding interprets priority requirement (task schema has no priority field)

**Tech debt accepted:**
- GitHub Pages source must be manually set to "GitHub Actions" in repo Settings
- 8 browser-level visual verification items not yet human-tested

**Archive:** `.planning/milestones/v1.0-ROADMAP.md`, `.planning/milestones/v1.0-REQUIREMENTS.md`

---

