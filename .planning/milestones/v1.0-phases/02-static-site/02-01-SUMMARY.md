---
phase: 02-static-site
plan: 01
subsystem: frontend-spa
tags: [vanilla-js, spa, hash-routing, markdown, dompurify, github-actions, github-pages]
dependency_graph:
  requires: [01-01]
  provides: [SPA shell, hash router, doc rendering pipeline, docs registry, GitHub Actions deploy]
  affects: [02-02, 03-01]
tech_stack:
  added:
    - marked.js (CDN UMD) — markdown to HTML conversion
    - DOMPurify (CDN) — XSS sanitization
    - GitHub Actions pages deploy workflow
  patterns:
    - Hash-based routing via hashchange event
    - marked.parse + DOMPurify.sanitize pipeline
    - Relative fetch paths for GitHub Pages subdirectory compatibility
    - Split-file doc registry (data/docs/index.json)
key_files:
  created:
    - index.html — SPA shell with CDN scripts, sidebar, main content area
    - style.css — dark theme with CSS custom properties, responsive layout
    - app.js — hash router, doc rendering, active nav highlighting, placeholder views
    - data/docs/index.json — doc registry with schemaVersion 1
    - .github/workflows/deploy.yml — no-build GitHub Pages deploy on push to main
  modified: []
decisions:
  - "Hash routing over History API — mandatory for GitHub Pages project sites; prevents 404 on page refresh"
  - "DOMPurify.sanitize wraps all marked.parse output — no direct innerHTML assignment of raw markdown HTML"
  - "data/docs/index.json as doc registry — serves both sidebar population and future MCP list_docs tool"
  - "Relative fetch paths enforced — no leading slash on any URL to ensure GitHub Pages subdirectory compat"
  - "CDN scripts have no async/defer — app.js depends on marked and DOMPurify globals being synchronously available"
metrics:
  duration: "2 min"
  completed: "2026-02-22"
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 0
requirements-completed: [SITE-01, SITE-02, SITE-05, SITE-06, SITE-07, SITE-08]
---

# Phase 2 Plan 1: Static Site Shell Summary

**One-liner:** Vanilla JS SPA with hash routing, marked.js + DOMPurify doc rendering, dark theme, and GitHub Actions no-build Pages deploy.

## What Was Built

The foundational site layer — everything renders inside a single `index.html` SPA shell. A hash router dispatches to views without any server involvement. Markdown docs are fetched, parsed with `marked.parse()`, and sanitized with `DOMPurify.sanitize()` before being assigned to `innerHTML`. The sidebar doc list is populated dynamically from `data/docs/index.json`. Active navigation highlighting fires on every `hashchange` event. The GitHub Actions workflow deploys the repo root to GitHub Pages on push to `main` with no build step.

## Tasks Completed

| # | Name | Commit | Key Files |
|---|------|--------|-----------|
| 1 | SPA shell, dark theme CSS, docs registry | c7eb94f | index.html, style.css, data/docs/index.json |
| 2 | Hash router, doc rendering, active nav | d7f0c96 | app.js |
| 3 | GitHub Actions deploy workflow | ddba780 | .github/workflows/deploy.yml |

## Key Implementation Details

### Hash Router (app.js)

```javascript
async function router() {
  const hash = window.location.hash || '#/docs';
  const parts = hash.slice(1).split('/');
  const view = parts[1] || 'docs';
  const param = parts[2] || null;
  // dispatches to renderDoc, renderKanban, renderProgress
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', async () => {
  await populateDocList();
  await router();
});
```

### Render Pipeline

```javascript
const rawHtml = marked.parse(markdown);
const safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
mainEl.innerHTML = safeHtml;
```

### Script Load Order (index.html)

CDN scripts have no `async`/`defer` to ensure globals are available synchronously before `app.js` runs with `defer`:
```html
<script src="https://cdn.jsdelivr.net/npm/marked/lib/marked.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
<script src="app.js" defer></script>
```

## Decisions Made

1. **Hash routing mandatory** — GitHub Pages project sites serve from `/keloia-docs/` subdirectory; History API `pushState` routes 404 on refresh. Hash routing is fully client-side.

2. **DOMPurify always wraps marked output** — `marked.parse()` output contains raw HTML (markdown allows embedded HTML). Direct `innerHTML` assignment without sanitization is an XSS vulnerability.

3. **data/docs/index.json as registry** — GitHub Pages has no directory listing API. A registry file serves both the sidebar and future MCP `list_docs` tool, avoiding hardcoded arrays in `app.js`.

4. **Relative paths everywhere** — `fetch('data/docs/index.json')` not `fetch('/data/docs/index.json')`. Leading slash resolves to GitHub Pages root (`github.io/`) not the project root (`github.io/keloia-docs/`).

5. **Placeholder views for kanban/progress** — renderKanban() and renderProgress() return simple text placeholders. Full implementation is Plan 02 (kanban) scope.

## Deviations from Plan

None — plan executed exactly as written.

## Post-Deploy Note

After pushing this workflow, the repository's Pages source must be set to "GitHub Actions" in Settings > Pages > Source. This is a one-time manual step (cannot be done via API/CLI without admin scope).

## Self-Check: PASSED

All 5 created files found on disk. All 3 task commits verified in git log.
