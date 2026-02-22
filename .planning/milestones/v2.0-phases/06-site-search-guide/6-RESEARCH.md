# Phase 6: Site Search + Guide - Research

**Researched:** 2026-02-22
**Domain:** Client-side full-text search (MiniSearch), lazy index initialization, debounced input, static guide page
**Confidence:** HIGH

---

## Summary

Phase 6 adds two independent features to the existing vanilla JS SPA: a full-text search box in the sidebar, and a static MCP setup guide page accessible from the sidebar navigation. Both features have no auth or API dependency and operate entirely on the existing `data/docs/` files that the site already fetches.

The search library decision is already locked in STATE.md: **MiniSearch** (over FlexSearch) because it has a cleaner snippet API for this corpus size. MiniSearch 7.2.0 is available via the same jsDelivr CDN pattern already used by `marked` and `DOMPurify`. The index must be built on first search-box focus, not on page load — this is a hard requirement from the success criteria and is straightforward with a one-time `focus` listener that triggers lazy loading of all doc content.

The guide page is the simpler of the two features. It is just another markdown doc registered in `data/docs/index.json` (slug: `mcp-guide`) plus a hard-coded sidebar link in `index.html`. Because the site already renders any `.md` file via `renderDoc(slug)`, the guide page needs zero new rendering logic — only the content file and a nav entry.

**Primary recommendation:** Add MiniSearch via CDN script tag, build the index lazily on first focus, implement a debounced `input` listener, and render results as a dropdown below the search input. The guide page is a data file addition plus one nav `<li>`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | User can type in a search box at the top of the sidebar to search doc content | Search input element placed above the Docs nav section in `index.html`; populated in `app.js` |
| SRCH-02 | Search results update live as user types (debounced) | MiniSearch `.search()` called inside a 150–200ms debounce on the `input` event |
| SRCH-03 | Search results show doc name and a text snippet with the matching content | `storeFields: ['title', 'text', 'slug']` on MiniSearch; snippet extracted from stored `text` using matched term position |
| SRCH-04 | User can click a search result to navigate to that doc | Result items rendered with `href="#/docs/{slug}"` or a click handler calling `window.location.hash` |
| GUID-01 | MCP setup guide page is accessible from the site navigation | Hard-coded `<li>` under Views section in `index.html`; `#/docs/mcp-guide` hash route handled by existing router |
| GUID-02 | Guide includes setup instructions with copy-paste config for Cursor, Claude Code, and Windsurf | `data/docs/mcp-guide.md` file authored with fenced code blocks for each editor config; registered in `data/docs/index.json` |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| MiniSearch | 7.2.0 | In-browser full-text search index | Pre-decided in STATE.md; CDN-compatible UMD build; matches project "no build step" constraint; snippet data available via `storeFields` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Native `setTimeout`/`clearTimeout` | Built-in | Debounce implementation | No library needed for a simple debounce; matches project's zero-dependency vanilla JS stance |
| Native `focus` event | Built-in | Lazy index initialization trigger | One-time listener to defer fetching and indexing all doc content until user interacts with search |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| MiniSearch | FlexSearch | FlexSearch has no clean snippet extraction API at this size; STATE.md locked this decision |
| MiniSearch | Lunr.js | Lunr is larger and older; MiniSearch is lighter and more actively maintained |
| MiniSearch | Pagefind | Pagefind requires a build step; violates project constraint |
| Custom debounce | Lodash debounce | Lodash is overkill; a 3-line debounce is sufficient and the project has no other Lodash use |

**Installation:**
```bash
# No npm install — CDN only, per project "no build step" constraint
# Add to index.html <head> before app.js:
# <script src="https://cdn.jsdelivr.net/npm/minisearch@7.2.0/dist/umd/index.min.js"></script>
```

---

## Architecture Patterns

### Recommended Project Structure

No new files or directories needed for the search feature. All additions go into existing files:

```
index.html           # Add: MiniSearch CDN <script>, search <input> + results container in sidebar
app.js               # Add: search module (initSearch, buildIndex, renderResults, debounce)
style.css            # Add: search input, results dropdown, result item styles
data/
  docs/
    index.json       # Update: add mcp-guide entry
    mcp-guide.md     # New: MCP setup guide content
```

### Pattern 1: CDN Script Tag (consistent with existing approach)

**What:** Load MiniSearch as a UMD global via jsDelivr, same pattern as `marked` and `DOMPurify` already used in the project.
**When to use:** Always — this project has no build step and uses CDN for all libraries.

```html
<!-- Source: https://lucaong.github.io/minisearch/ -->
<!-- Add BEFORE app.js in index.html <head> -->
<script src="https://cdn.jsdelivr.net/npm/minisearch@7.2.0/dist/umd/index.min.js"></script>
```

### Pattern 2: Lazy Index Build on First Focus

**What:** Attach a one-time `focus` listener to the search input. On first focus, fetch all doc markdown files, build the MiniSearch index, then remove the listener. Subsequent keystrokes search the already-built in-memory index.

**Why lazy:** The success criteria explicitly require "the search index is not built at page load — it builds on first focus." Also, fetching all doc content at load would add N network requests to every page load even for users who never search.

```javascript
// Source: patterns.dev/vanilla/import-on-interaction + MiniSearch README
let searchIndex = null;
let indexBuilding = false;

async function buildSearchIndex() {
  if (searchIndex || indexBuilding) return;
  indexBuilding = true;

  const res = await fetch('data/docs/index.json');
  const data = await res.json();

  const miniSearch = new MiniSearch({
    fields: ['title', 'text'],         // fields to full-text index
    storeFields: ['title', 'slug', 'text'] // fields returned in results
  });

  const docs = await Promise.all(
    data.docs.map(async (doc) => {
      const mdRes = await fetch(`data/docs/${doc.slug}.md`);
      const text = await mdRes.text();
      return { id: doc.slug, slug: doc.slug, title: doc.title, text };
    })
  );

  miniSearch.addAll(docs);
  searchIndex = miniSearch;
  indexBuilding = false;
}

const searchInput = document.getElementById('search-input');
searchInput.addEventListener('focus', buildSearchIndex, { once: true });
```

### Pattern 3: Debounced Input Handler

**What:** Call `MiniSearch.search()` inside a debounced `input` event handler. 150ms delay is fast enough to feel live while avoiding excessive calls during fast typing.

```javascript
// Standard vanilla JS debounce — no library needed
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const handleSearch = debounce((query) => {
  if (!searchIndex || !query.trim()) {
    renderSearchResults([]);
    return;
  }
  const results = searchIndex.search(query, {
    prefix: true,
    boost: { title: 2 },
    limit: 5
  });
  renderSearchResults(results, query);
}, 150);

searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
```

### Pattern 4: Snippet Extraction from Stored Text

**What:** MiniSearch does NOT have a built-in snippet extractor. Results include a `match` object (term -> field array mapping) but no character offsets. The snippet must be extracted manually from the stored `text` field using the matched term.

**Approach:** Find the first occurrence of any matched term in the stored `text`, then slice a window of ~120 characters around it. This is sufficient for < 20 docs.

```javascript
// Source: MiniSearch README + community pattern
function extractSnippet(text, query, windowSize = 120) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();

  // Find first term match position
  let pos = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (pos === -1 || idx < pos)) pos = idx;
  }

  if (pos === -1) return text.slice(0, windowSize) + '…';

  const start = Math.max(0, pos - 40);
  const end = Math.min(text.length, start + windowSize);
  const snippet = text.slice(start, end).replace(/\n+/g, ' ');
  return (start > 0 ? '…' : '') + snippet + (end < text.length ? '…' : '');
}
```

### Pattern 5: Guide Page as a Regular Doc

**What:** The MCP setup guide is just another markdown file registered in `data/docs/index.json`. The existing `renderDoc(slug)` function handles it with zero new code. The only additions are: (1) the `.md` file, (2) an entry in `index.json`, and (3) a hard-coded `<li>` in the sidebar HTML (or added dynamically alongside other docs).

**Decision:** Hard-code a nav entry for the guide rather than relying on the dynamically populated `#doc-list`. This keeps it visually separated under "Resources" or alongside "Views", matching the sidebar's section pattern.

```html
<!-- In index.html, add under the Views section or a new Resources section -->
<section class="nav-section">
  <h3 class="nav-section-title">Resources</h3>
  <ul class="nav-list">
    <li><a href="#/docs/mcp-guide" data-view="docs" data-slug="mcp-guide">MCP Setup Guide</a></li>
  </ul>
</section>
```

### Anti-Patterns to Avoid

- **Building the index at DOMContentLoaded:** Violates success criterion #5 and wastes network requests on every page load.
- **Fetching doc content per keystroke:** The index must be built once and reused. Do not re-fetch on each search.
- **Storing full raw markdown in the result display:** Strip markdown syntax from snippets or accept minor noise (backticks, `#` chars). For < 20 docs this is acceptable without a full markdown stripper.
- **Using `keyup` instead of `input`:** `input` fires on paste, autocomplete, and voice input; `keyup` misses these. Use `input`.
- **Re-indexing on every route change:** The index is built once per page session and reused across all routes.
- **Adding mcp-guide to the dynamic doc list:** It would then appear twice (dynamic list + hard-coded nav). Either exclude it from the dynamic list or only show it hard-coded.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full-text tokenization, BM25 scoring, stop-word removal | Custom search engine | MiniSearch 7.2.0 | MiniSearch handles tokenization, term frequency scoring, prefix matching, and field boosting — all edge cases handled |
| Fuzzy matching for typos | Custom Levenshtein distance | `MiniSearch.search(q, { fuzzy: 0.2 })` | Correct fuzzy distance implementation is non-trivial; MiniSearch has it built in |

**Key insight:** The only thing to hand-roll is the snippet extractor and the debounce — both are simple (< 20 lines each). Everything search-algorithm related is MiniSearch's domain.

---

## Common Pitfalls

### Pitfall 1: Race condition on first focus + fast first keystroke

**What goes wrong:** User focuses the search input and immediately types before `buildSearchIndex()` resolves. `searchIndex` is still `null`, so the debounced handler returns no results even though the query is valid.

**Why it happens:** `buildSearchIndex()` is async. The `focus` handler fires it, but the first `input` event arrives before all doc fetches complete.

**How to avoid:** In `handleSearch`, check `indexBuilding` flag. If true, do nothing (the index will be ready before 150ms debounce fires in most cases for < 20 docs). Alternatively, queue the pending query and re-run it when the index resolves.

**Warning signs:** Search box appears empty or unresponsive on very fast first interaction.

### Pitfall 2: Snippet contains raw markdown syntax

**What goes wrong:** The stored `text` field contains raw markdown (`# Heading`, `**bold**`, `- list item`). Snippets shown in results look noisy.

**Why it happens:** Doc content is fetched as raw `.md` text and stored as-is.

**How to avoid:** Either (a) strip markdown minimally before storing (remove `#`, `*`, `-` list markers, backticks), or (b) accept the noise — for 2 current docs and < 20 total, the snippet is still readable. Option (b) is simpler and appropriate for this corpus.

**Warning signs:** Search results show `## Architecture`, `**bold**` in snippets.

### Pitfall 3: Guide page appearing in both nav sections

**What goes wrong:** `mcp-guide` is added to `data/docs/index.json` and also as a hard-coded nav `<li>`. The dynamic `populateDocList()` renders it in the Docs section AND the hard-coded entry renders it in Resources — duplicate links.

**Why it happens:** `populateDocList()` renders all entries from `index.json` without exclusion logic.

**How to avoid:** Either (a) exclude `mcp-guide` from `index.json` and only hard-code the nav entry (the router handles any slug route, with or without index registration), or (b) filter it out in `populateDocList()`. Option (a) is simpler but means the guide won't appear in MCP tool listings that read the index — which is acceptable since Phase 7 handles search.

**Warning signs:** "MCP Setup Guide" appears twice in the sidebar.

### Pitfall 4: Search results persist when navigating away

**What goes wrong:** User searches, sees results dropdown, clicks a result to navigate — but the search box still shows the query and results dropdown remains visible after navigation.

**Why it happens:** The router replaces `main` content but does not clear the search state.

**How to avoid:** On `hashchange`, clear the search input value and hide the results container.

### Pitfall 5: MiniSearch UMD global not available when app.js runs

**What goes wrong:** `new MiniSearch(...)` throws `ReferenceError: MiniSearch is not defined` because the CDN script hasn't loaded yet.

**Why it happens:** If the MiniSearch `<script>` tag appears after `app.js` in `index.html`, or if `app.js` is loaded without `defer` while MiniSearch is deferred.

**How to avoid:** Place the MiniSearch `<script>` tag in `<head>` before the `app.js` `<script defer>` tag. The existing pattern in `index.html` already does this correctly for `marked` and `DOMPurify`.

---

## Code Examples

Verified patterns from official sources:

### MiniSearch initialization with storeFields

```javascript
// Source: https://github.com/lucaong/minisearch/blob/master/README.md
const miniSearch = new MiniSearch({
  fields: ['title', 'text'],            // indexed for full-text search
  storeFields: ['title', 'slug', 'text'] // returned in search results
});
miniSearch.addAll(documents);
```

### MiniSearch search with prefix and boost

```javascript
// Source: https://github.com/lucaong/minisearch/blob/master/README.md
const results = miniSearch.search(query, {
  prefix: true,        // 'arch' matches 'architecture'
  boost: { title: 2 }, // title matches rank higher
  fuzzy: 0.2,          // tolerate minor typos
  limit: 5             // top 5 results only
});
// results: [{ id, title, slug, text, score, match }, ...]
```

### CDN script tag (consistent with existing project pattern)

```html
<!-- Source: https://lucaong.github.io/minisearch/ -->
<script src="https://cdn.jsdelivr.net/npm/minisearch@7.2.0/dist/umd/index.min.js"></script>
```

### Search input HTML structure

```html
<!-- Place inside #sidebar, above the first .nav-section -->
<div class="search-container">
  <input
    type="search"
    id="search-input"
    class="search-input"
    placeholder="Search docs…"
    autocomplete="off"
  />
  <ul id="search-results" class="search-results" hidden></ul>
</div>
```

### Result rendering

```javascript
function renderSearchResults(results, query = '') {
  const el = document.getElementById('search-results');
  if (!results.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.innerHTML = results.map(r => {
    const snippet = extractSnippet(r.text, query);
    return `<li class="search-result-item">
      <a href="#/docs/${escapeHtml(r.slug)}">
        <span class="result-title">${escapeHtml(r.title)}</span>
        <span class="result-snippet">${escapeHtml(snippet)}</span>
      </a>
    </li>`;
  }).join('');
  el.hidden = false;
}
```

### Guide page doc registration

```json
// data/docs/index.json — update to include the guide
{
  "schemaVersion": 1,
  "docs": [
    { "slug": "architecture", "title": "Architecture" },
    { "slug": "value-proposition", "title": "Value Proposition" }
  ]
}
// Note: mcp-guide is NOT added here to avoid duplicate nav rendering.
// The router handles #/docs/mcp-guide by fetching data/docs/mcp-guide.md directly.
```

### MCP guide config content shape (for GUID-02)

```markdown
# MCP Setup Guide

## What is Keloia MCP?

The Keloia MCP server exposes your project docs, kanban board,
and milestones to AI tools via the Model Context Protocol.

## Setup

### Prerequisites
- Node.js 18+
- The Keloia repository cloned locally

### Cursor

Add to `.cursor/mcp.json`:

\`\`\`json
{
  "mcpServers": {
    "keloia": {
      "command": "node",
      "args": ["/absolute/path/to/your-repo/mcp-server/dist/index.js"]
    }
  }
}
\`\`\`

### Claude Code

Add to your Claude Code MCP config:

\`\`\`json
{
  "mcpServers": {
    "keloia": {
      "command": "node",
      "args": ["/absolute/path/to/your-repo/mcp-server/dist/index.js"]
    }
  }
}
\`\`\`

### Windsurf

Add to Windsurf MCP settings:

\`\`\`json
{
  "mcpServers": {
    "keloia": {
      "command": "node",
      "args": ["/absolute/path/to/your-repo/mcp-server/dist/index.js"]
    }
  }
}
\`\`\`

## Available Tools

| Tool | Description |
|------|-------------|
| `keloia_list_docs` | List all docs |
| `keloia_read_doc` | Read a doc by slug |
| `keloia_list_tasks` | List kanban tasks |
| `keloia_get_task` | Get a task by ID |
| `keloia_get_progress` | Read milestone progress |
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Algolia/Typesense for static site search | MiniSearch in-browser | 2019-present | No backend, no API key, no build step — fits the project constraint perfectly |
| Build-time search index (Jekyll, Hugo plugins) | Runtime lazy index | N/A for this project | Eliminates build step dependency |
| FlexSearch as lightweight alternative | MiniSearch preferred | STATE.md decision | MiniSearch has cleaner snippet ergonomics via `storeFields` |

**Deprecated/outdated:**
- Lunr.js: still works but last major release was 2022; MiniSearch is more actively maintained and lighter.
- Pagefind: excellent but requires a build step — explicitly out of scope per REQUIREMENTS.md.

---

## Open Questions

1. **Should `mcp-guide` be in `data/docs/index.json`?**
   - What we know: Adding it causes it to appear in the dynamic `#doc-list` AND in the hard-coded nav — duplicate.
   - What's unclear: Whether Phase 7's `keloia_list_docs` MCP tool should include the guide in its output.
   - Recommendation: Exclude from `index.json` for now. The guide is a "meta" page, not a project doc. Phase 7 can revisit if the MCP search tool needs to find it.

2. **Snippet rendering with markdown noise**
   - What we know: Raw `.md` text stored in MiniSearch will contain `#`, `**`, `-` markers.
   - What's unclear: How noisy the actual snippets will be given current doc content (2 docs, both prose-heavy).
   - Recommendation: Accept the noise for now. A simple `.replace(/[#*`_]/g, '')` can be applied to the stored text before indexing if snippets look too noisy in practice. Do not add a full markdown stripper library.

3. **Search input visibility on mobile**
   - What we know: The sidebar collapses to a horizontal strip on mobile (per existing CSS). A search box above the doc list may not fit well in the collapsed horizontal layout.
   - What's unclear: Whether search should be hidden on mobile or the sidebar layout should change.
   - Recommendation: Include the search box but verify it doesn't break the mobile layout. The existing responsive CSS may need a small tweak to handle the search input width.

---

## Sources

### Primary (HIGH confidence)
- `/lucaong/minisearch` (Context7) — CDN tag, `storeFields`, `search()` API, `addAll()`, prefix/fuzzy/boost options, `autoSuggest`
- https://lucaong.github.io/minisearch/ — Current version (7.2.0), CDN URL confirmed
- https://github.com/lucaong/minisearch/blob/master/README.md — All API patterns verified

### Secondary (MEDIUM confidence)
- https://www.jsdelivr.com/package/npm/minisearch — CDN availability and version 7.2.0 confirmed
- https://www.npmjs.com/package/minisearch — Package metadata, zero-dependency confirmed
- https://www.patterns.dev/vanilla/import-on-interaction/ — "Import on interaction" lazy loading pattern

### Tertiary (LOW confidence — for general patterns only)
- WebSearch results on debounce patterns — standard `setTimeout`/`clearTimeout` approach universally consistent across sources; no single authoritative spec needed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — MiniSearch 7.2.0 verified via Context7 and official docs; CDN URL confirmed via jsDelivr
- Architecture: HIGH — patterns derived from existing project code (`app.js`, `index.html`, `style.css`) and verified MiniSearch API
- Pitfalls: HIGH for race conditions and duplicate nav (derived from code analysis); MEDIUM for mobile layout (untested in project context)

**Research date:** 2026-02-22
**Valid until:** 2026-03-24 (MiniSearch is stable; CDN URL unlikely to change; 30-day window)
