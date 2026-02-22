# Phase 12: Cross-Phase Integration Fixes - Research

**Researched:** 2026-02-22
**Domain:** Vanilla JS SPA wiring — search index lifecycle, route guards, script load order, MCP index access
**Confidence:** HIGH

---

## Summary

Phase 12 is a pure wiring fix phase. Every change is surgical: one module (app.js) and one data file (index.json) need targeted edits. No new libraries, no new architecture — just closing four gaps discovered by the v2.0 milestone audit.

The two medium-severity gaps (INT-01, INT-02) fix broken user-visible behavior: search going stale after CRUD, and the edit form rendering for unauthenticated users. The two low-severity gaps (INT-03, INT-04) fix a maintenance hazard (script order) and a silent capability gap (mcp-guide invisible to MCP tools). All four fixes are small and fully localized to the audited code paths.

The most important gap is INT-01: `searchIndex` is module-level state that is set once and never cleared. After a create, edit, or delete, the old MiniSearch instance is still active — new docs are missing, deleted docs still appear, edited content remains stale. The fix pattern is `searchIndex = null` at the success path of each CRUD operation, which forces `buildSearchIndex()` to rebuild on the next user search focus or input event.

**Primary recommendation:** Implement all four gaps in a single plan (12-01) in this order: INT-01 (search reset in create/edit/delete) → INT-02 (auth guard in router) → INT-03 (script order swap in index.html) → INT-04 (add mcp-guide to index.json). Test each success criterion in sequence.

---

<phase_requirements>
## Phase Requirements

Phase 12 carries no new REQUIREMENTS.md IDs — it closes integration gaps from the audit. The gaps reference prior requirements as affected context.

| Gap ID | Description | Affected Requirements | Research Support |
|--------|-------------|----------------------|-----------------|
| INT-01 | Search index not invalidated after CRUD | SRCH-01–04, CRUD-01, CRUD-02, CRUD-04 | `searchIndex = null` in success paths of renderCreateView, renderEditView (save handler), showDeleteModal (confirm handler) |
| INT-02 | Edit route accessible without authentication | AUTH-04, CRUD-02 | `getAuthToken()` check in router `subview === 'edit'` branch before calling `renderEditView` |
| INT-03 | Script load order is dependency-inverted | (none — maintenance hazard) | Swap `<script>` tags in index.html: github.js before app.js |
| INT-04 | mcp-guide.md excluded from MCP tool access | GUID-01 | Add `{ "slug": "mcp-guide", "title": "MCP Setup Guide" }` to `data/docs/index.json` |
| FLOW-01 | Create doc → search for new doc fails | CRUD-01, SRCH-01 | Resolved by INT-01 fix |
| FLOW-02 | Edit doc → search for edited content fails | CRUD-02, SRCH-01 | Resolved by INT-01 fix |
</phase_requirements>

---

## Standard Stack

### Core (already in project — no new installs)

| Component | Version | Purpose | Status |
|-----------|---------|---------|--------|
| MiniSearch | 7.2.0 (CDN) | Full-text search index | Already loaded — just reset the module variable |
| Vanilla JS | ES2020 | SPA routing and DOM manipulation | Already in use throughout app.js |
| HTML `<script defer>` | HTML5 | Script load ordering | Already used — fix is swap of two lines |
| Node.js fs + JSON | Node built-ins | MCP tool file reading | Already used — fix is editing one JSON file |

### No New Dependencies

Phase 12 requires zero new libraries. All fixes use existing primitives.

---

## Architecture Patterns

### Recommended Fix Structure

All fixes land in two files only:

```
index.html          # INT-03: swap script order
app.js              # INT-01: searchIndex = null; INT-02: auth guard in router
data/docs/index.json  # INT-04: add mcp-guide entry
```

The MCP tools in `mcp-server/src/tools/docs.ts` require NO changes — they already read `index.json` correctly. The fix is entirely in the data file.

### Pattern 1: Search Index Invalidation (INT-01)

**What:** After any successful CRUD write, set `searchIndex = null`. On the next user search interaction, `buildSearchIndex()` will see `searchIndex === null` and `indexBuilding === false`, then rebuild from the current `data/docs/index.json`.

**When to use:** Immediately after each `await writeFile(...)` / `await deleteFile(...)` success, before navigation or sidebar refresh.

**Three locations in app.js:**

```javascript
// --- renderCreateView: success path (after both writeFile calls succeed) ---
// After: await writeFile('data/docs/index.json', ...)
searchIndex = null;  // INT-01: invalidate stale index
await populateDocList();
window.location.hash = '#/docs/' + slug;

// --- renderEditView: save button click handler success path ---
// After: await writeFile('data/docs/' + slug + '.md', ...)
searchIndex = null;  // INT-01: invalidate stale index
window.location.hash = '#/docs/' + slug;

// --- showDeleteModal: confirm delete button success path ---
// After: await deleteFile(...)
searchIndex = null;  // INT-01: invalidate stale index
overlay.remove();
await populateDocList();
window.location.hash = '#/docs';
```

**Why `searchIndex = null` is correct:** `buildSearchIndex()` guards with `if (searchIndex || indexBuilding) return;`. Setting `searchIndex = null` makes that guard pass, allowing a fresh build. Setting `indexBuilding` is not needed — it resets itself at the end of the build.

**Important:** The `{ once: true }` listener on focus will NOT fire again after the first build. The rebuild is triggered via the `input` event listener on `searchInput`, which calls `handleSearch` → `buildSearchIndex()` is NOT called from there directly. Wait — re-examine:

```javascript
// Bootstrap (line 825):
searchInput.addEventListener('focus', () => buildSearchIndex(), { once: true });
searchInput.addEventListener('input', e => handleSearch(e.target.value));

// handleSearch calls searchIndex.search() directly — does NOT call buildSearchIndex()
// buildSearchIndex() is ONLY triggered by the focus { once: true } listener
```

**This is a known complication:** After `searchIndex = null`, `handleSearch` will see `!searchIndex` and return early (no results). The user would need to re-focus the search box, but `{ once: true }` means the focus listener fired only once and is now gone.

**Correct fix requires two parts:**

1. Set `searchIndex = null` to clear the stale index.
2. Trigger a rebuild immediately: either call `buildSearchIndex()` directly after nulling, or change the focus listener to not use `{ once: true }` (but then `{ once: true }` is the optimization — removing it means every focus rebuilds).

**Recommended approach:** Call `buildSearchIndex()` directly after `searchIndex = null` in each success path. This starts the async rebuild immediately. The user gets fresh results as soon as the rebuild completes (typically instant for <20 docs).

```javascript
searchIndex = null;
buildSearchIndex(); // non-blocking: starts rebuild in background
```

This is consistent with the existing pattern at the bottom of `buildSearchIndex()`:
```javascript
// If the user typed while the index was building, trigger a search now
if (searchInput && searchInput.value.trim()) {
  handleSearch(searchInput.value);
}
```

So the rebuild chain is: `searchIndex = null` → `buildSearchIndex()` (non-blocking) → index rebuilt → if user has typed, `handleSearch` fires automatically.

### Pattern 2: Auth Guard in Router (INT-02)

**What:** Before dispatching to `renderEditView`, check `getAuthToken()`. If no token, redirect to the doc view.

**Location:** `router()` function, the `subview === 'edit'` branch.

**Current code (lines ~782-788):**
```javascript
} else if (subview === 'edit' && param) {
  await renderEditView(param);
  updateActiveNav('docs', param);
  break;
}
```

**Fixed code:**
```javascript
} else if (subview === 'edit' && param) {
  if (!getAuthToken()) {
    window.location.hash = '#/docs/' + param;
    return;
  }
  await renderEditView(param);
  updateActiveNav('docs', param);
  break;
}
```

**Why `return` not `break`:** The `hashchange` event fires when we set `window.location.hash`, which re-enters `router()`. Using `return` prevents the current router invocation from continuing after the redirect. `break` would also work since it exits the switch, but `return` is more explicit about "stop now."

**Note on auth timing:** `initAuth()` is non-blocking — it resolves in the background while the page renders. If a user navigates to `#/docs/slug/edit` very rapidly before `initAuth()` resolves, `getAuthToken()` may return null even for an authenticated user. This is an acceptable edge case: the user will be redirected to the doc view and can navigate back to edit after auth resolves. No additional fix needed.

### Pattern 3: Script Load Order (INT-03)

**What:** Swap the two `<script defer>` tags so `github.js` loads before `app.js`.

**Current order (index.html):**
```html
<script src="app.js" defer></script>
<script src="github.js" defer></script>
```

**Fixed order:**
```html
<script src="github.js" defer></script>
<script src="app.js" defer></script>
```

**Why this is safe:** Both scripts use `defer`, which means they execute after HTML parsing, in document order. Swapping the order means `github.js` executes first, exposing `getFile`, `writeFile`, `deleteFile` as globals before `app.js` runs. Currently `github.js` calls `getAuthToken()` (defined in `app.js`) — this works because `getAuthToken()` is only invoked lazily inside `authHeaders()`, which is only called when a user triggers a write operation (not at script evaluation time). The only concern is the reverse: does `app.js` eagerly call any `github.js` functions at evaluation time? No — all github.js calls in app.js are inside async handlers, not at module evaluation time. The swap is safe in both directions.

**Important:** The Phase 9 STATE.md decision says "github.js loaded with defer after app.js — getAuthToken() (app.js) defined before github.js functions invoked." This was based on the assumption that `getAuthToken()` must be defined before `github.js` loads. But since `getAuthToken()` is only invoked lazily (inside `authHeaders()`, inside `getFile`/`writeFile`/`deleteFile`), the load order doesn't actually matter at runtime — it's the invocation order that matters, and both files are fully evaluated before any user interaction. The audit correctly identifies this as a maintenance hazard, not a runtime bug. The fix eliminates the hazard.

### Pattern 4: Add mcp-guide to index.json (INT-04)

**What:** Add the mcp-guide entry to `data/docs/index.json`.

**Current index.json:**
```json
{
  "schemaVersion": 1,
  "docs": [
    { "slug": "architecture", "title": "Architecture" },
    { "slug": "value-proposition", "title": "Value Proposition" }
  ]
}
```

**Fixed index.json:**
```json
{
  "schemaVersion": 1,
  "docs": [
    { "slug": "architecture", "title": "Architecture" },
    { "slug": "value-proposition", "title": "Value Proposition" },
    { "slug": "mcp-guide", "title": "MCP Setup Guide" }
  ]
}
```

**Why this works:** `keloia_search_docs` reads `index.json` to get the list of docs to search. With `mcp-guide` in the index, it will read `data/docs/mcp-guide.md` and search its content. The `keloia_read_doc` tool (if it exists) would also gain access.

**Site search side effect:** `buildSearchIndex()` in app.js currently hardcodes mcp-guide into its doc list:
```javascript
const docs = [...data.docs, { slug: 'mcp-guide', title: 'MCP Setup Guide' }];
```
After adding mcp-guide to `index.json`, this hardcoded spread will produce a duplicate entry in the search index. The fix requires removing the hardcoded addition:
```javascript
// BEFORE (with hardcoded mcp-guide):
const docs = [...data.docs, { slug: 'mcp-guide', title: 'MCP Setup Guide' }];

// AFTER (mcp-guide is now in index.json, so no hardcode needed):
const docs = data.docs;
```

**This is the correct approach** — it makes the single source of truth `index.json` rather than having mcp-guide split across two definitions.

**Site sidebar side effect:** The sidebar currently has mcp-guide as a manually-added link in the Resources section — NOT rendered by `populateDocList()`. The State.md decision says "mcp-guide excluded from data/docs/index.json — router handles #/docs/mcp-guide directly, avoids duplicate sidebar entries." Adding mcp-guide to index.json will cause `populateDocList()` to render it in the Docs section in addition to its hardcoded link in the Resources section — creating a duplicate.

**Resolution options:**

Option A: Add mcp-guide to index.json + remove the hardcoded Resources link in index.html + remove the `{ slug: 'mcp-guide', ... }` spread in buildSearchIndex. Sidebar entry appears in Docs list. Clean single source of truth.

Option B: Add mcp-guide to index.json + filter it out of `populateDocList()` rendering. More complex. Not recommended.

Option C: Skip adding to index.json; instead special-case mcp-guide in the MCP tools. More complex MCP code. Not recommended.

**Recommendation: Option A.** The Resources section was a workaround for mcp-guide being excluded from index.json. With mcp-guide in the index, `populateDocList()` renders it in the Docs list naturally. Remove the hardcoded Resources nav link and the hardcoded spread in `buildSearchIndex`. This unifies mcp-guide with all other docs.

**Risk:** The Resources section also has the `data-slug="mcp-guide"` attribute and `data-view="docs"` which the active nav highlighter uses. Removing it requires verifying nav highlighting still works for mcp-guide via the doc-list link. Since `updateActiveNav('docs', 'mcp-guide')` looks for `a[href="#/docs/mcp-guide"]`, and `populateDocList()` generates links with `href="#/docs/${doc.slug}"`, the highlighting will work correctly once mcp-guide is in the doc list.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Search rebuild after CRUD | Custom index diffing/patching | `searchIndex = null; buildSearchIndex()` | Full rebuild is instant for <20 docs; diffing adds complexity with no benefit |
| Auth check in router | Middleware pattern, decorators | Inline `if (!getAuthToken()) { redirect; return; }` | Project uses vanilla JS; simple guard is idiomatic |
| Script dependency management | Module bundler, import maps | Correct `defer` ordering | Project is already static HTML; don't introduce build step |
| MCP guide access | Special-case allowlist in MCP tools | Add to index.json | Single source of truth; tools already work correctly for index entries |

---

## Common Pitfalls

### Pitfall 1: Forgetting the `{ once: true }` listener problem
**What goes wrong:** Set `searchIndex = null` but never trigger rebuild → search returns empty results forever after CRUD.
**Why it happens:** `buildSearchIndex()` is wired to a `focus` event with `{ once: true }` — after first use, the listener is gone. Nulling `searchIndex` alone doesn't rebuild it.
**How to avoid:** Always call `buildSearchIndex()` immediately after `searchIndex = null` in each CRUD success path.
**Warning signs:** After creating a doc, search input returns no results at all (not just missing the new doc).

### Pitfall 2: Duplicate mcp-guide in search index
**What goes wrong:** Add mcp-guide to index.json but forget to remove the hardcoded spread in `buildSearchIndex()` → MiniSearch throws or produces duplicate results.
**Why it happens:** MiniSearch's `addAll()` will throw if two documents have the same `id` field. The id is the slug, so two mcp-guide entries will conflict.
**How to avoid:** Remove `{ slug: 'mcp-guide', title: 'MCP Setup Guide' }` from the `buildSearchIndex()` spread when adding it to index.json.
**Warning signs:** Console error from MiniSearch about duplicate id after page load.

### Pitfall 3: Auth redirect causes router loop
**What goes wrong:** Setting `window.location.hash = '#/docs/' + param` inside router fires `hashchange`, re-entering router, which routes to the doc view correctly — but the original router invocation continues after the assignment.
**Why it happens:** `window.location.hash = ...` is synchronous assignment but the `hashchange` event fires asynchronously. The current router invocation continues unless explicitly stopped.
**How to avoid:** Use `return` immediately after the redirect hash assignment, not `break`.
**Warning signs:** `renderDoc` called twice for the same slug when navigating to an edit URL without auth.

### Pitfall 4: Duplicate sidebar entries for mcp-guide
**What goes wrong:** Add mcp-guide to index.json, populateDocList renders it in Docs list, but the hardcoded Resources link still exists → mcp-guide appears twice in the sidebar.
**Why it happens:** index.html has a static Resources `<li>` for mcp-guide that was originally the only entry point.
**How to avoid:** Remove the hardcoded Resources `<section>` / `<li>` for mcp-guide when adding it to index.json (Option A). Or keep the section but filter mcp-guide from populateDocList rendering (Option B, not recommended).
**Warning signs:** Two "MCP Setup Guide" links in the sidebar after the fix.

### Pitfall 5: Applying `searchIndex = null` before the write succeeds
**What goes wrong:** Null the index optimistically before the write resolves → if the write fails, the user now has no search and sees stale content as empty results.
**Why it happens:** Temptation to clear early for perceived responsiveness.
**How to avoid:** Always null `searchIndex` inside the `try` block, AFTER the `await writeFile(...)` or `await deleteFile(...)` resolves successfully.

---

## Code Examples

### INT-01: Search reset in renderCreateView success path

```javascript
// In renderCreateView, after both writeFile calls:
try {
  await writeFile('data/docs/' + slug + '.md', body, 'docs: create ' + slug);
  indexData.docs.push({ slug, title });
  await writeFile('data/docs/index.json', JSON.stringify(indexData, null, 2), 'docs: add ' + slug);

  searchIndex = null;       // INT-01: invalidate stale search index
  buildSearchIndex();       // start background rebuild (non-blocking)

  await populateDocList();
  window.location.hash = '#/docs/' + slug;
} catch (err) { ... }
```

### INT-01: Search reset in renderEditView save handler

```javascript
// In renderEditView, save button click handler:
try {
  await writeFile('data/docs/' + slug + '.md', textarea.value, 'docs: update ' + slug);

  searchIndex = null;       // INT-01: invalidate stale search index
  buildSearchIndex();       // start background rebuild (non-blocking)

  window.location.hash = '#/docs/' + slug;
} catch (err) { ... }
```

### INT-01: Search reset in showDeleteModal confirm handler

```javascript
// In showDeleteModal, confirm-delete-btn click handler:
try {
  const indexFile = await getFile('data/docs/index.json');
  const indexData = JSON.parse(indexFile.content);
  const updated = { ...indexData, docs: indexData.docs.filter(d => d.slug !== slug) };
  await writeFile('data/docs/index.json', JSON.stringify(updated, null, 2), 'docs: remove ' + slug);
  await deleteFile('data/docs/' + slug + '.md', 'docs: delete ' + slug);

  searchIndex = null;       // INT-01: invalidate stale search index
  buildSearchIndex();       // start background rebuild (non-blocking)

  overlay.remove();
  await populateDocList();
  window.location.hash = '#/docs';
} catch (err) { ... }
```

### INT-02: Auth guard in router

```javascript
// In router(), the edit branch:
} else if (subview === 'edit' && param) {
  if (!getAuthToken()) {
    window.location.hash = '#/docs/' + param;
    return;   // stop current router invocation
  }
  await renderEditView(param);
  updateActiveNav('docs', param);
  break;
}
```

### INT-03: Script order in index.html

```html
<!-- BEFORE -->
<script src="app.js" defer></script>
<script src="github.js" defer></script>

<!-- AFTER -->
<script src="github.js" defer></script>
<script src="app.js" defer></script>
```

### INT-04a: index.json with mcp-guide added

```json
{
  "schemaVersion": 1,
  "docs": [
    { "slug": "architecture", "title": "Architecture" },
    { "slug": "value-proposition", "title": "Value Proposition" },
    { "slug": "mcp-guide", "title": "MCP Setup Guide" }
  ]
}
```

### INT-04b: buildSearchIndex() after removing hardcoded mcp-guide

```javascript
async function buildSearchIndex() {
  if (searchIndex || indexBuilding) return;
  indexBuilding = true;

  try {
    const res = await fetch('data/docs/index.json');
    const data = await res.json();
    // BEFORE: const docs = [...data.docs, { slug: 'mcp-guide', title: 'MCP Setup Guide' }];
    // AFTER: mcp-guide is now in index.json — no hardcode needed
    const docs = data.docs;

    const documents = await Promise.all(
      docs.map(async doc => {
        const r = await fetch(`data/docs/${doc.slug}.md`);
        const text = r.ok ? await r.text() : '';
        return { id: doc.slug, slug: doc.slug, title: doc.title, text };
      })
    );
    // ... rest unchanged
  }
}
```

### INT-04c: Remove Resources section from index.html (or just the mcp-guide li)

```html
<!-- REMOVE this section entirely (or remove just the mcp-guide <li>): -->
<section class="nav-section">
  <h3 class="nav-section-title">Resources</h3>
  <ul class="nav-list">
    <li><a href="#/docs/mcp-guide" data-view="docs" data-slug="mcp-guide">MCP Setup Guide</a></li>
  </ul>
</section>
```

If the Resources section has only the mcp-guide link (which it does, per current index.html), remove the entire section. If in the future other resources are added, the section can be restored without mcp-guide.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Build-time search index | MiniSearch CDN, index built on first focus | Already correct — just needs invalidation after writes |
| CSS-only auth gating | CSS + router guard | Router guard needed for direct URL bypass (INT-02) |
| mcp-guide as special-case | mcp-guide in index.json as first-class doc | Eliminates hardcoded exceptions in two files |

---

## Open Questions

1. **Does `keloia_read_doc` exist in the MCP tools?**
   - What we know: The registered tools are `keloia_search_docs`, `keloia_add_doc`, `keloia_edit_doc`, `keloia_delete_doc`. There is no `keloia_read_doc` in `docs.ts`.
   - What's unclear: Is there a read tool elsewhere in the MCP server?
   - Recommendation: Check `mcp-server/src/tools/read.ts`. If it validates against index.json, it will also benefit from INT-04 without code changes.
   - Confidence: The success criterion only mentions `keloia_search_docs` — INT-04 fix is sufficient even if `keloia_read_doc` doesn't exist.

2. **Should the Resources section be fully removed or just the mcp-guide li?**
   - What we know: Current index.html has only one link in Resources (mcp-guide).
   - What's unclear: User intent — was Resources a category intended for future use?
   - Recommendation: Remove the entire section. If future resources are needed, the section can be re-added. Leaving an empty section is worse than removing it.
   - Confidence: MEDIUM — no stated user preference; pragmatic recommendation based on current state.

3. **Does the auth race condition on edit route guard need addressing?**
   - What we know: `initAuth()` runs non-blocking; if user opens `#/slug/edit` before token verification completes, `getAuthToken()` returns null briefly.
   - What's unclear: How visible this race is in practice.
   - Recommendation: Do not add async guard (would stall router render). Accept the edge case. Document in PLAN.md as known limitation.
   - Confidence: HIGH — the audit explicitly identifies INT-02 as a CSS bypass issue, not an auth timing issue. The fix is for direct URL navigation by unauthenticated users, not race conditions.

---

## Sources

### Primary (HIGH confidence — direct code inspection)

- `/Users/enjat/Github/keloia/keloia-docs/app.js` — Full source read, line-level analysis of `buildSearchIndex` (408-440), `renderEditView` (503-575), `renderCreateView` (576-697), `showDeleteModal` (698-763), `router` (764-810)
- `/Users/enjat/Github/keloia/keloia-docs/github.js` — Full source read, confirmed `getAuthToken()` called lazily inside `authHeaders()`
- `/Users/enjat/Github/keloia/keloia-docs/index.html` — Full source read, confirmed current script order
- `/Users/enjat/Github/keloia/keloia-docs/data/docs/index.json` — Confirmed current entries (architecture, value-proposition — mcp-guide absent)
- `/Users/enjat/Github/keloia/keloia-docs/mcp-server/src/tools/docs.ts` — Full source read, confirmed slug validation against index.json in `keloia_search_docs`
- `/Users/enjat/Github/keloia/keloia-docs/.planning/v2.0-MILESTONE-AUDIT.md` — Authoritative gap definitions (INT-01 through INT-04, FLOW-01, FLOW-02)
- `/Users/enjat/Github/keloia/keloia-docs/.planning/STATE.md` — Phase decisions, confirmed Phase 6 decision about mcp-guide exclusion

### Secondary (MEDIUM confidence)

- ROADMAP.md Phase 12 description — confirms success criteria and gap closure targets
- REQUIREMENTS.md — confirmed affected requirement IDs per audit

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing code inspected directly
- Architecture: HIGH — fix locations identified at line level from source
- Pitfalls: HIGH — derived from direct analysis of control flow, MiniSearch guard logic, and `{ once: true }` listener semantics

**Research date:** 2026-02-22
**Valid until:** Stable (no external dependencies change — all fixes are internal)
