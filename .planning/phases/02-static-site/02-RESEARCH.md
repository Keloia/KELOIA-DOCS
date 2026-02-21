# Phase 2: Static Site - Research

**Researched:** 2026-02-22
**Domain:** Vanilla JS SPA, CDN-loaded markdown rendering, GitHub Pages deployment, GitHub Actions
**Confidence:** HIGH

---

## Summary

Phase 2 builds a no-build-step SPA served from GitHub Pages. The technology stack is locked by project requirements: vanilla JS, marked.js from CDN, DOMPurify for XSS protection, and GitHub Actions for deployment. There are no dependency installations or compilation steps — the deployed site is the repository itself.

The single most important architectural decision is routing strategy: **hash-based routing (`#/docs/architecture`) is mandatory** for GitHub Pages project sites. The History API cannot be used — a browser refresh on any route other than `/` sends the request to GitHub's servers which return 404. Hash routing keeps all navigation client-side with no server involvement.

Relative paths (no leading slash) are the second critical constraint. GitHub Pages serves project sites from `https://{owner}.github.io/keloia-docs/`, not from the root. Any absolute path like `/data/kanban/index.json` resolves to `https://{owner}.github.io/data/kanban/index.json` (missing the `/keloia-docs/` segment) and 404s. All `fetch()` calls, `<link>`, `<script>`, and `<img>` `src`/`href` attributes must use relative paths.

The data layer from Phase 1 uses a split-file pattern: tasks and milestones are individual JSON files with `index.json` as a registry. The site must fetch the index first, then fan out to individual entity files to build the kanban and progress views. The current task schema has no `priority` field, which conflicts with SITE-03's requirement for priority color-coding — this is an open question requiring resolution before implementation.

**Primary recommendation:** Single `index.html` with hash routing, all logic in a single `app.js` file loaded from CDN scripts, CSS in `style.css`. Keep the file count minimal. No module bundler, no package.json, no npm.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SITE-01 | SPA shell (`index.html`) with sidebar navigation listing docs, kanban, and progress views | Hash routing pattern; `hashchange` event listener; sidebar nav with `<a href="#/docs">` style links |
| SITE-02 | Markdown doc rendering via marked.js from CDN with DOMPurify XSS protection | marked.js v14+ UMD: `marked.parse()` returns HTML string; DOMPurify v3.x: `DOMPurify.sanitize()` wraps output before `innerHTML` assignment |
| SITE-03 | Kanban board view rendering columns and cards from `board.json` with priority color-coding | Split-file fetch pattern: fetch `data/kanban/index.json`, then per-task files; **OPEN QUESTION: current task schema has no `priority` field — must add before or during this phase** |
| SITE-04 | Progress tracker view rendering milestone modules with progress bars from `tracker.json` | Split-file fetch: `data/progress/index.json` then per-milestone files; `tasksCompleted/tasksTotal` ratio drives `<progress>` or CSS bar width |
| SITE-05 | Dark theme CSS with responsive layout (CSS custom properties, flexbox) | CSS custom properties on `:root`; sidebar + main in a flex container; `prefers-color-scheme` media query for system default |
| SITE-06 | Active sidebar link highlighting on navigation | On `hashchange`, match current hash to sidebar `<a>` elements; add/remove `.active` class |
| SITE-07 | All data fetches use relative paths for GitHub Pages subdirectory compatibility | No leading slash on any path; `fetch('data/kanban/index.json')` not `fetch('/data/kanban/index.json')` |
| SITE-08 | GitHub Actions workflow deploys site on push to main | Official `static.yml` starter workflow pattern; `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`; `pages: write` + `id-token: write` permissions required |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| marked.js | 17.x (latest: 17.0.3) | Markdown → HTML conversion in-browser | Project decision; fast, well-maintained, UMD global available |
| DOMPurify | 3.x (latest: 3.3.1) | XSS sanitization of marked.js HTML output | Project decision; industry standard, DOM-based, no deps |
| Vanilla JS (ES2020+) | N/A | SPA shell, routing, fetch, DOM manipulation | Project hard constraint: zero build step |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| GitHub Actions: `actions/checkout` | v4 | Check out repo in CI | Standard for all GHA workflows |
| GitHub Actions: `actions/configure-pages` | v5 | Set up Pages environment, injects base URL | Used in official static.yml starter |
| GitHub Actions: `actions/upload-pages-artifact` | v3 | Package repo root as Pages artifact | For static sites with no build step |
| GitHub Actions: `actions/deploy-pages` | v4 | Deploy artifact to Pages environment | Final deployment step |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hash routing | History API + 404.html redirect hack | History API produces cleaner URLs but requires a custom `404.html` workaround that still breaks bookmark sharing; hash routing is reliable and zero-config on static hosts |
| marked.js CDN | Showdown.js, micromark, markdown-it | Project decision is locked to marked.js |
| DOMPurify | Manual escaping | DOMPurify handles hundreds of XSS vectors; manual escaping misses DOM-based attacks |
| CSS custom properties | Hardcoded colors | Custom properties enable easy theming and runtime updates |

**Installation:** None. No `npm install`. All libraries loaded from CDN via `<script src>` tags in `index.html`.

**CDN URLs (verified):**
```html
<script src="https://cdn.jsdelivr.net/npm/marked/lib/marked.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
```

---

## Architecture Patterns

### Recommended Project Structure

```
/                           # repo root = GitHub Pages root
├── index.html              # SPA shell, all views rendered here
├── style.css               # dark theme, layout, view-specific styles
├── app.js                  # all routing and view logic
├── .nojekyll               # already exists (from Phase 1)
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions Pages workflow
└── data/                   # already exists (from Phase 1)
    ├── docs/
    │   ├── architecture.md
    │   └── value-proposition.md
    ├── kanban/
    │   ├── index.json
    │   └── task-NNN.json
    └── progress/
        ├── index.json
        └── milestone-NN.json
```

**Note:** `index.html`, `style.css`, and `app.js` go at the repo root. The GitHub Actions workflow uploads `path: '.'` (entire repo root) as the Pages artifact. `.planning/` and `.github/` directories are included in the upload but inaccessible as served files — this is fine.

### Pattern 1: Hash-Based Routing

**What:** All navigation uses URL fragments (`#/docs/architecture`, `#/kanban`, `#/progress`). The `hashchange` event fires on every navigation. A single `router()` function reads `window.location.hash` and renders the appropriate view.

**When to use:** Any static hosting where the server cannot redirect 404s to `index.html`. This includes GitHub Pages project sites.

**Example:**
```javascript
// Source: MDN Hash routing documentation + verified pattern
function router() {
  const hash = window.location.hash || '#/docs';
  const [, view, ...params] = hash.split('/');

  switch (view) {
    case 'docs':
      renderDoc(params[0]);
      break;
    case 'kanban':
      renderKanban();
      break;
    case 'progress':
      renderProgress();
      break;
    default:
      renderDoc(null); // default to first doc
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);
```

### Pattern 2: Marked + DOMPurify Pipeline

**What:** Fetch markdown as text, parse with `marked.parse()`, sanitize with `DOMPurify.sanitize()`, assign to `innerHTML`.

**When to use:** Any time markdown content from the filesystem is rendered into the DOM.

**Example:**
```javascript
// Source: Context7 /markedjs/marked + Context7 /cure53/dompurify
async function renderDoc(slug) {
  const path = slug
    ? `data/docs/${slug}.md`
    : 'data/docs/architecture.md'; // default

  const response = await fetch(path);
  if (!response.ok) {
    mainEl.innerHTML = '<p>Document not found.</p>';
    return;
  }
  const markdown = await response.text();
  const rawHtml = marked.parse(markdown);
  const safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
  mainEl.innerHTML = safeHtml;
}
```

**Critical:** Always call `DOMPurify.sanitize()` AFTER `marked.parse()`. Never assign `marked.parse()` output directly to `innerHTML`.

### Pattern 3: Split-File Fan-Out Fetch

**What:** Fetch `index.json` to get the list of entity IDs, then use `Promise.all` to fetch all individual entity files in parallel.

**When to use:** Rendering kanban board or progress tracker (both use Phase 1's split-file pattern).

**Example:**
```javascript
// Source: Phase 1 data contracts (data/kanban/index.json schema)
async function loadKanban() {
  const index = await fetch('data/kanban/index.json').then(r => r.json());
  const tasks = await Promise.all(
    index.tasks.map(id =>
      fetch(`data/kanban/${id}.json`).then(r => r.json())
    )
  );
  return { columns: index.columns, tasks };
}
```

### Pattern 4: GitHub Actions No-Build Deploy

**What:** Upload entire repository root as a Pages artifact and deploy. No build job needed.

**When to use:** Static sites with no compilation step (this project).

**Example:**
```yaml
# Source: https://github.com/actions/starter-workflows/blob/main/pages/static.yml
name: Deploy static content to Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

**GitHub repository Pages setting:** Must be set to "GitHub Actions" (not "Deploy from branch") in Settings > Pages > Source.

### Anti-Patterns to Avoid

- **Absolute paths in fetch():** `fetch('/data/kanban/index.json')` fails on project Pages sites (`/keloia-docs/` prefix missing). Always use `fetch('data/kanban/index.json')`.
- **`innerHTML = marked.parse(text)` without DOMPurify:** XSS vulnerability. Markdown can contain raw HTML including `<script>` tags.
- **History API routing:** `pushState`-based routing fails on page refresh — GitHub Pages returns 404 for any path that isn't a real file.
- **`type="module"` scripts with relative imports:** No bundler means no resolution; keep all logic in a single `app.js` or use explicit CDN imports.
- **Storing computed values:** Progress percentages must be calculated from `tasksCompleted / tasksTotal` at render time, not stored (established in Phase 1 decisions).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown → HTML | Custom regex parser | marked.js (CDN) | CommonMark compliance, handles edge cases like nested lists, code fences, HTML blocks |
| XSS sanitization | Manual element filtering | DOMPurify | DOM-based sanitizer handles 200+ XSS vectors including `javascript:` URLs, `data:` URIs, DOM clobbering; manual filtering always misses cases |
| CSS progress bars | Canvas/SVG drawing | Native `<progress>` element or CSS `width` on a div | Native `<progress>` is accessible; CSS width with custom properties is trivial and already responsive |

**Key insight:** The entire rendering pipeline is two function calls: `marked.parse()` then `DOMPurify.sanitize()`. Any custom alternative introduces XSS surface area that the project's threat model cannot accept.

---

## Common Pitfalls

### Pitfall 1: Relative Path Breaks on GitHub Pages

**What goes wrong:** `fetch('/data/kanban/index.json')` returns 404 on the deployed site but works locally.

**Why it happens:** Project Pages are served from `https://{owner}.github.io/keloia-docs/`. A leading slash makes the browser request `https://{owner}.github.io/data/kanban/index.json` (the user Pages root, not the repo root).

**How to avoid:** Use bare relative paths everywhere: `fetch('data/kanban/index.json')`. The browser resolves this relative to the current page URL, which is the repo root under the `keloia-docs/` prefix.

**Warning signs:** 404 errors in browser DevTools network tab that only appear on the deployed site, not locally.

### Pitfall 2: History API Routing Causes 404 on Refresh

**What goes wrong:** Clicking links works fine, but refreshing or bookmarking a route like `/kanban` returns GitHub's 404 page.

**Why it happens:** `pushState` changes the browser URL without making a network request. But refreshing sends a real GET request to `/kanban` which is not a file on GitHub Pages.

**How to avoid:** Use hash routing exclusively. All route changes use `window.location.hash`. No `pushState` calls.

**Warning signs:** Navigation works but page refresh shows 404.

### Pitfall 3: marked.js v9+ Breaking Changes

**What goes wrong:** Code written for marked.js v1-v8 may use deprecated APIs (`marked()` as a function, `marked.setOptions()`).

**Why it happens:** marked.js changed its API in v9+ to use `marked.use()` for configuration and `marked.parse()` as the primary entry point.

**How to avoid:** Use `marked.parse(markdown)` (confirmed correct in marked.js v17.x). The UMD global exposes `marked` as a namespace — `marked.parse()` is the correct call pattern.

**Warning signs:** `marked is not a function` error in console.

### Pitfall 4: DOMPurify Not Loaded Before Use

**What goes wrong:** Script execution order causes `DOMPurify is not defined` error when `app.js` tries to sanitize before DOMPurify CDN script has loaded.

**Why it happens:** CDN scripts load asynchronously unless explicitly ordered.

**How to avoid:** Load CDN scripts in order (marked, then DOMPurify) before `app.js` in `index.html`. Do NOT use `async` or `defer` on CDN script tags if `app.js` depends on their globals. Alternatively use `DOMContentLoaded` event listener in `app.js`.

**Warning signs:** Console error on first doc render; works after page reload (race condition).

### Pitfall 5: GitHub Pages Source Not Set to GitHub Actions

**What goes wrong:** Workflow runs successfully but site does not deploy; Pages still shows old content or a default page.

**Why it happens:** The repository Pages setting defaults to "Deploy from branch." The Actions workflow using `deploy-pages` only works when Pages source is set to "GitHub Actions."

**How to avoid:** After creating the workflow, go to repository Settings > Pages > Source and select "GitHub Actions."

**Warning signs:** GitHub Actions run completes without errors, but `pages.github.com` shows deployment not triggered.

### Pitfall 6: Priority Field Missing from Task Schema

**What goes wrong:** SITE-03 requires priority color-coding on kanban cards, but current task schema (`data/kanban/task-NNN.json`) has no `priority` field (schema has `id`, `title`, `column`, `description`, `assignee` only).

**Why it happens:** Phase 1 CONTEXT.md explicitly made kanban lean with "no priority field." REQUIREMENTS.md SITE-03 specifies priority color-coding. These conflict.

**How to avoid:** Resolve before implementation. Two options: (a) add `priority` field to the task schema and update seed files, or (b) interpret SITE-03 as column-based color-coding (Backlog = gray, In Progress = blue, Done = green). See Open Questions.

---

## Code Examples

Verified patterns from official sources:

### UMD Browser Setup (index.html head)

```html
<!-- Source: Context7 /markedjs/marked README -->
<script src="https://cdn.jsdelivr.net/npm/marked/lib/marked.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
<script src="app.js" defer></script>
```

### Complete Markdown Render

```javascript
// Source: Context7 /markedjs/marked + /cure53/dompurify
async function renderDoc(slug) {
  const res = await fetch(`data/docs/${slug}.md`);
  if (!res.ok) throw new Error(`404: ${slug}`);
  const md = await res.text();
  const html = DOMPurify.sanitize(marked.parse(md), { USE_PROFILES: { html: true } });
  document.getElementById('main').innerHTML = html;
}
```

### Hash Router

```javascript
// Source: MDN hashchange event + verified pattern
const routes = {
  docs: renderDocView,
  kanban: renderKanbanView,
  progress: renderProgressView,
};

async function router() {
  const hash = window.location.hash.slice(1) || '/docs'; // strip '#'
  const [, view, param] = hash.split('/');
  const handler = routes[view] || routes.docs;
  await handler(param);
  updateActiveNav(view);
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);
```

### Active Nav Highlight

```javascript
// Source: standard DOM pattern
function updateActiveNav(activeView) {
  document.querySelectorAll('nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.view === activeView);
  });
}
```

### CSS Dark Theme Skeleton

```css
/* Source: MDN CSS custom properties + standard pattern */
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --text-primary: #e0e0e0;
  --text-secondary: #a0a0b0;
  --accent: #4a9eff;
  --border: #2d2d4a;
  --priority-high: #ff4757;
  --priority-medium: #ffa502;
  --priority-low: #2ed573;
  --sidebar-width: 240px;
}

body {
  display: flex;
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: system-ui, sans-serif;
  margin: 0;
}

#sidebar {
  width: var(--sidebar-width);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  flex-shrink: 0;
}

#main {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
}
```

### CSS Progress Bar

```css
/* Source: standard CSS pattern - no JS library needed */
.progress-bar-track {
  background: var(--border);
  border-radius: 4px;
  height: 8px;
  width: 100%;
}

.progress-bar-fill {
  background: var(--accent);
  border-radius: 4px;
  height: 100%;
  transition: width 0.3s ease;
}
```

```javascript
// Set width from data
barFill.style.width = `${(milestone.tasksCompleted / milestone.tasksTotal) * 100}%`;
```

### Kanban Column Render

```javascript
// Source: Phase 1 data contracts
async function renderKanbanView() {
  const index = await fetch('data/kanban/index.json').then(r => r.json());
  const tasks = await Promise.all(
    index.tasks.map(id => fetch(`data/kanban/${id}.json`).then(r => r.json()))
  );

  const container = document.getElementById('main');
  container.innerHTML = index.columns.map(col => {
    const colTasks = tasks.filter(t => t.column === col);
    return `
      <div class="kanban-column">
        <h3>${col}</h3>
        ${colTasks.map(t => `
          <div class="kanban-card priority-${(t.priority || 'none').toLowerCase()}">
            <div class="card-title">${escapeHtml(t.title)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `marked(text)` function call | `marked.parse(text)` method | marked.js v9 (2022) | `marked()` still works as alias in v17 but `marked.parse()` is canonical |
| `gh-pages` npm package for deployment | `actions/deploy-pages@v4` official action | GitHub, 2022 | Official action is more secure (OIDC token), no npm package needed |
| Deploy from `gh-pages` branch | Deploy from GitHub Actions workflow | GitHub, 2022 | Workflow approach gives control over what's deployed without a separate branch |
| `DOMPurify v2.x` | `DOMPurify v3.x` | 2023 | v3 drops IE11 support; no API changes for basic usage |

**Deprecated/outdated:**

- `marked.setOptions({})` global config: replaced by `marked.use({})` in v5+. Still works in v17 but `marked.use()` is the documented approach.
- `peaceiris/actions-gh-pages`: Third-party action. Replaced by official `actions/deploy-pages`. Still works but less preferred than official.

---

## Open Questions

1. **Priority field conflict (SITE-03 vs Phase 1 schema)**
   - What we know: SITE-03 requires priority color-coding on kanban cards. Current task schema has no `priority` field (Phase 1 CONTEXT.md explicitly removed it: "No priority field — column position and ordering imply priority").
   - What's unclear: Whether SITE-03 should drive a schema addition, or whether "priority color-coding" can be satisfied by column-based color-coding (column = Backlog → gray, In Progress → blue, Done → green).
   - Recommendation: Interpret as column-based color-coding for now. This avoids a schema migration and honors the Phase 1 decision. Document the interpretation in the plan. If the user wants explicit priority fields, that's a schema change task to add before the kanban render task.

2. **GitHub Pages repository settings pre-condition**
   - What we know: The GitHub Actions `deploy-pages` workflow only works when the repository's Pages source is set to "GitHub Actions" in Settings > Pages.
   - What's unclear: Whether the repository exists on GitHub yet (no remote configured in local repo).
   - Recommendation: Make "create GitHub repo + configure Pages source" an explicit setup task in the plan. It's a blocking dependency for SITE-08.

3. **Docs list in sidebar (SITE-01)**
   - What we know: Sidebar must list docs. `data/docs/` currently has `architecture.md` and `value-proposition.md`. There is no `docs/index.json` registry.
   - What's unclear: Whether the sidebar doc list should be hardcoded, or dynamically fetched. GitHub Pages cannot list directory contents — there is no directory listing API.
   - Recommendation: Use a hardcoded docs manifest (small array in `app.js` or a `data/docs/index.json` file). The MCP `list_docs` tool in Phase 4 will need a listing mechanism anyway — creating `data/docs/index.json` now serves both surfaces.

---

## Sources

### Primary (HIGH confidence)
- Context7 `/markedjs/marked` — UMD browser usage, `marked.parse()` API, CDN URL
- Context7 `/cure53/dompurify` — `DOMPurify.sanitize()` API, `USE_PROFILES` config
- `https://github.com/actions/starter-workflows/blob/main/pages/static.yml` — Official GitHub Actions static Pages workflow YAML
- `https://github.com/actions/upload-pages-artifact` — v4.0.0 release, `path: '.'` usage
- `https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site` — Pages source settings (branch vs Actions)

### Secondary (MEDIUM confidence)
- npmjs.com/package/marked — latest version 17.0.3 (verified against Context7 source)
- cure53.de/purify — DOMPurify v3.3.1 latest (from npm search result)
- MDN Hash routing glossary — hash routing semantics and `hashchange` event
- GitHub community discussion #64096 — GitHub Pages does not support History API routing
- multiple sources confirming: relative paths (no leading slash) required for project Pages

### Tertiary (LOW confidence)
- None — all claims supported by primary or secondary sources

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — marked.js and DOMPurify are project decisions; versions verified via npm; CDN URLs verified via Context7 and jsDelivr
- Architecture: HIGH — hash routing requirement is well-documented; relative path requirement confirmed by multiple sources; GitHub Actions workflow is from official starter repo
- Pitfalls: HIGH — all pitfalls derived from verified technical constraints (GitHub Pages architecture, marked.js API history, script load order)
- Data layer consumption: HIGH — Phase 1 summary and key files fully reviewed; split-file pattern confirmed
- Priority field conflict: MEDIUM — conflict is factual; recommended resolution is interpretive

**Research date:** 2026-02-22
**Valid until:** 2026-04-22 (stable ecosystem — marked.js, DOMPurify, GitHub Actions Pages API are all mature)
