# Phase 10: Site Doc CRUD - Research

**Researched:** 2026-02-22
**Domain:** Vanilla JS in-page editor, markdown preview, GitHub Contents API writes, modal UI, sidebar navigation refresh
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRUD-01 | Authenticated user can create a new doc with title and markdown content | Use `writeFile('data/docs/slug.md', content, msg)` then update `data/docs/index.json` via `writeFile`. Sidebar repopulated by calling `populateDocList()` after success. |
| CRUD-02 | Authenticated user can edit an existing doc in a markdown textarea | Router renders an edit view (textarea pre-filled from `fetch('data/docs/slug.md')`); save calls `writeFile`. |
| CRUD-03 | User can toggle a preview of the rendered markdown while editing | Single toggle button swaps between textarea and a `<div>` rendered via `marked.parse()` + `DOMPurify.sanitize()` — already loaded on page. |
| CRUD-04 | Authenticated user can delete a doc via a confirmation modal | Modal names the doc title for confirmation; on confirm calls `deleteFile('data/docs/slug.md', msg)` then updates index.json; sidebar refreshed. |
</phase_requirements>

---

## Summary

Phase 10 wires the already-complete GitHub API wrapper (Phase 9) and auth system (Phase 8) together into a functional doc authoring UI. No new libraries are needed — `marked.js` and `DOMPurify` are already on the page, `writeFile`/`deleteFile`/`getFile` are already global, and the `body.authenticated` CSS gate is already in place.

The core work is UI: an edit view rendered into `#main` when authenticated, a create form (slug + title + body), and a delete confirmation modal. The sidebar navigation update after a create or delete requires calling `populateDocList()` again and then re-running `updateActiveNav()`. After a successful save, the router navigates to the doc hash so the fresh content is fetched from GitHub and rendered.

The preview toggle (CRUD-03) is the only slightly tricky piece: it must show either the raw textarea or a rendered `<div>` without losing the edited text buffer. The solution is to read `textarea.value` into a variable before showing the preview, and restore it when toggling back to edit mode — or keep the textarea in the DOM but hidden, which is simpler.

**Primary recommendation:** Render edit/create/delete controls directly in `app.js` via inline HTML generation (same pattern as `renderDoc`, `renderKanban`). No new files needed. New functions: `renderEditView(slug)`, `renderCreateView()`, a `showDeleteModal(slug, title)` helper, and sidebar action buttons injected per doc-list item (visible only to `.auth-only`).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `marked.js` (CDN, already loaded) | Latest UMD via jsdelivr | Markdown-to-HTML for preview render | Already on page; `marked.parse(text)` is the one-liner needed |
| `DOMPurify` (CDN, already loaded) | Latest via jsdelivr | XSS-safe innerHTML insertion of preview | Already on page; `DOMPurify.sanitize(rawHtml)` pattern used in `renderDoc` |
| `writeFile` / `deleteFile` / `getFile` (global, Phase 9) | — | GitHub Contents API write operations | Already implemented; encapsulates SHA, Base64, queue |
| `getAuthToken` (global, Phase 8) | — | Token retrieval for auth guard | Already implemented |
| Vanilla JS / CSS | — | UI rendering | Project constraint; no build step |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `populateDocList()` (existing in app.js) | — | Refresh sidebar doc list after create/delete | Call after any operation that modifies `data/docs/index.json` |
| `router()` (existing in app.js) | — | Re-render current view after save | Navigate to `#/docs/slug` after create/edit to show fresh content |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline HTML generation in app.js | Separate editor.js file | No reason to split for this feature set; app.js already handles renderDoc, renderKanban, renderProgress in the same file |
| Keep textarea hidden during preview | Destroy and re-create textarea | Hiding is simpler — no state loss, no extra DOM manipulation |
| Inline modal HTML (dynamic) | Static modal HTML in index.html | Dynamic is cleaner — no need for a modal in the DOM when user is not authenticated; also avoids CSS complexity of modal overlay always present |

**Installation:** No new packages needed. Zero CDN additions.

---

## Architecture Patterns

### Recommended Project Structure

No new files needed. All changes go into existing files:

```
app.js       — renderEditView(), renderCreateView(), showDeleteModal(), save/delete handlers, sidebar button injection
style.css    — edit view styles (textarea, toolbar, preview div, modal overlay)
index.html   — no changes required (modal is dynamic)
```

The add button in the sidebar (`.auth-only`) can be injected by `populateDocList()` or added statically to the "Docs" nav-section title row in `index.html`. The per-doc edit/delete buttons are best injected into each `<li>` in `populateDocList()` — they are `auth-only` elements so CSS hides them when not authenticated.

### Pattern 1: Edit View Rendered Into #main

**What:** `renderEditView(slug)` fetches the doc content, then sets `mainEl.innerHTML` to an editor shell: a toolbar (save, preview toggle, cancel), a textarea, and a hidden preview div.

**When to use:** When authenticated user clicks an "Edit" button on a doc.

**Example:**

```javascript
async function renderEditView(slug) {
  // Fetch current content
  const res = await fetch(`data/docs/${slug}.md`);
  if (!res.ok) { mainEl.innerHTML = '<p>Document not found.</p>'; return; }
  const markdown = await res.text();

  mainEl.innerHTML = `
    <div class="edit-view">
      <div class="edit-toolbar">
        <button id="save-btn" class="btn-action">Save</button>
        <button id="preview-toggle-btn" class="btn-action btn-secondary">Preview</button>
        <button id="cancel-btn" class="btn-action btn-secondary">Cancel</button>
      </div>
      <textarea id="edit-textarea" class="edit-textarea">${escapeHtml(markdown)}</textarea>
      <div id="edit-preview" class="edit-preview" hidden></div>
    </div>
  `;

  let previewing = false;
  const textarea = document.getElementById('edit-textarea');
  const preview = document.getElementById('edit-preview');
  const previewBtn = document.getElementById('preview-toggle-btn');

  document.getElementById('preview-toggle-btn').addEventListener('click', () => {
    previewing = !previewing;
    if (previewing) {
      const rawHtml = marked.parse(textarea.value);
      preview.innerHTML = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
      textarea.hidden = true;
      preview.hidden = false;
      previewBtn.textContent = 'Edit';
    } else {
      textarea.hidden = false;
      preview.hidden = true;
      previewBtn.textContent = 'Preview';
    }
  });

  document.getElementById('cancel-btn').addEventListener('click', () => {
    window.location.hash = `#/docs/${slug}`;
  });

  document.getElementById('save-btn').addEventListener('click', async () => {
    const content = textarea.value;
    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await writeFile(`data/docs/${slug}.md`, content, `docs: update ${slug}`);
      window.location.hash = `#/docs/${slug}`;
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      // Show inline error
    }
  });
}
```

**Key insight:** The textarea value is read at save-time, not at preview-toggle time. The textarea stays in the DOM (hidden) when in preview mode, so its `.value` is always current.

### Pattern 2: Create View Rendered Into #main

**What:** `renderCreateView()` renders a form with slug, title, and body textarea fields. On submit, it writes the `.md` file, then updates `index.json` to add the new entry, then refreshes the sidebar.

**When to use:** Authenticated user clicks "New Doc" (or equivalent) button.

**The index.json update sequence:**
1. `getFile('data/docs/index.json')` — read current index
2. Parse JSON, append `{ slug, title }` to `data.docs`
3. `writeFile('data/docs/index.json', JSON.stringify(updated, null, 2), 'docs: add slug')`
4. `writeFile('data/docs/slug.md', markdownContent, 'docs: create slug')`
5. `await populateDocList()` — refresh sidebar
6. `window.location.hash = '#/docs/' + slug` — navigate to new doc

**Important:** Because `writeFile` uses the serialized write queue, steps 3 and 4 will execute in order even though they are both `writeFile` calls. They can be awaited sequentially or both awaited via `Promise.all` — either is safe given the queue.

**Slug validation:** Enforce slug format before submit: lowercase alphanumeric and hyphens only (`/^[a-z0-9-]+$/`). Check that the slug does not already exist in the index before writing.

```javascript
async function renderCreateView() {
  mainEl.innerHTML = `
    <div class="create-view">
      <h1>New Doc</h1>
      <div class="form-field">
        <label for="new-slug">Slug</label>
        <input id="new-slug" type="text" placeholder="my-doc-name" class="form-input" />
        <p class="field-hint">Lowercase letters, numbers, hyphens only</p>
      </div>
      <div class="form-field">
        <label for="new-title">Title</label>
        <input id="new-title" type="text" placeholder="My Doc Name" class="form-input" />
      </div>
      <div class="form-field">
        <label for="new-body">Content</label>
        <div class="edit-toolbar">
          <button id="new-preview-btn" class="btn-action btn-secondary">Preview</button>
        </div>
        <textarea id="new-body" class="edit-textarea" placeholder="# My Doc Name"></textarea>
        <div id="new-preview" class="edit-preview" hidden></div>
      </div>
      <p id="create-error" class="form-error" hidden></p>
      <div class="form-actions">
        <button id="create-btn" class="btn-action">Create Doc</button>
        <button id="create-cancel-btn" class="btn-action btn-secondary">Cancel</button>
      </div>
    </div>
  `;
  // ... wire event listeners ...
}
```

### Pattern 3: Delete Confirmation Modal

**What:** A dynamically created modal overlay naming the doc title appears over the current view. Cancel dismisses it; Confirm calls `deleteFile` then updates `index.json`.

**When to use:** Authenticated user clicks "Delete" on a doc's edit controls.

**The index.json update sequence for delete:**
1. `getFile('data/docs/index.json')` — read current index
2. Parse JSON, filter out the slug being deleted
3. `writeFile('data/docs/index.json', JSON.stringify(updated, null, 2), 'docs: remove slug')`
4. `deleteFile('data/docs/slug.md', 'docs: delete slug')`
5. `await populateDocList()` — refresh sidebar
6. `window.location.hash = '#/docs'` — navigate away from deleted doc

**Modal pattern (no static HTML required):**

```javascript
function showDeleteModal(slug, title) {
  // Remove any existing modal
  document.getElementById('delete-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'delete-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h2>Delete doc?</h2>
      <p>This will permanently delete <strong>${escapeHtml(title)}</strong> from the repository.</p>
      <div class="modal-actions">
        <button id="confirm-delete-btn" class="btn-action btn-danger">Delete</button>
        <button id="cancel-delete-btn" class="btn-action btn-secondary">Cancel</button>
      </div>
      <p id="modal-error" class="form-error" hidden></p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('cancel-delete-btn').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove(); // click outside closes
  });

  document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    try {
      // Update index first, then delete file
      const indexFile = await getFile('data/docs/index.json');
      const indexData = JSON.parse(indexFile.content);
      indexData.docs = indexData.docs.filter(d => d.slug !== slug);
      await writeFile('data/docs/index.json', JSON.stringify(indexData, null, 2), `docs: remove ${slug}`);
      await deleteFile(`data/docs/${slug}.md`, `docs: delete ${slug}`);
      overlay.remove();
      await populateDocList();
      window.location.hash = '#/docs';
    } catch (err) {
      const errEl = document.getElementById('modal-error');
      errEl.textContent = 'Delete failed. Try again.';
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Delete';
    }
  });
}
```

### Pattern 4: Sidebar Edit/Delete Buttons Per Doc (auth-gated)

**What:** Each `<li>` in `#doc-list` gets edit and delete icon buttons with class `auth-only`. CSS hides them when not authenticated; they appear when authenticated.

**When to use:** Always — they are present in the DOM but hidden by default.

**Example modification to `populateDocList()`:**

```javascript
docList.innerHTML = data.docs.map(doc => `
  <li class="doc-list-item">
    <a href="#/docs/${doc.slug}" data-view="docs" data-slug="${doc.slug}">
      ${escapeHtml(doc.title)}
    </a>
    <span class="doc-actions auth-only">
      <button class="btn-icon" data-action="edit" data-slug="${escapeHtml(doc.slug)}" title="Edit">✏</button>
      <button class="btn-icon btn-danger-icon" data-action="delete" data-slug="${escapeHtml(doc.slug)}" data-title="${escapeHtml(doc.title)}" title="Delete">✕</button>
    </span>
  </li>
`).join('');

// Wire action buttons via delegation
docList.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'edit') {
    window.location.hash = `#/docs/${btn.dataset.slug}/edit`;
  } else if (btn.dataset.action === 'delete') {
    showDeleteModal(btn.dataset.slug, btn.dataset.title);
  }
});
```

**Router extension:** Add a case for `#/docs/slug/edit` in `router()`:

```javascript
// In router(), parts[3] for edit
const editMode = parts[3] === 'edit';
if (view === 'docs' && editMode && param) {
  await renderEditView(param);
  updateActiveNav('docs', param);
} else if (view === 'docs') {
  await renderDoc(param);
  updateActiveNav('docs', param);
}
```

### Pattern 5: "New Doc" Button in Sidebar

**What:** A small button in the "Docs" nav-section header (visible only when authenticated) that navigates to `#/docs/new` to trigger `renderCreateView()`.

**Options:**
- **Static HTML in index.html** — add a `<button class="btn-icon auth-only" id="new-doc-btn">+</button>` next to the Docs section title; wire a `click` listener in the bootstrap block. Simple.
- **Injected by populateDocList()** — less appropriate, since the "new" button is not doc-specific.

**Recommendation:** Static HTML in index.html. Add it next to the `<h3>` in the Docs `nav-section`. Router handles `#/docs/new` as a create view.

### Anti-Patterns to Avoid

- **Re-fetching index.json on every route:** The sidebar already calls `populateDocList()` once at boot. Only re-call it after write operations that modify the index.
- **Destroying the textarea on preview toggle:** Hiding via `textarea.hidden = true` preserves `.value`. Re-creating the textarea on every toggle loses content.
- **Writing the doc file before updating the index:** The index should be updated first (add) or the file deleted after the index is cleaned (delete) to avoid dangling references if a partial failure occurs. Exception: on create, write the file first so the index never references a file that doesn't exist. See sequence details above.
- **Using `innerHTML` to set textarea value:** Use `textarea.value = markdown` directly. `innerHTML` of a textarea is for its defaultValue, not the live value — and escaping is different.
- **Routing to `#/docs/edit` without a slug:** The edit route must always include the slug: `#/docs/slug/edit`. The `new` route is `#/docs/new` (reserved slug that triggers create view).
- **Calling `populateDocList()` without awaiting it before navigation:** The sidebar update is async. Await it before changing the hash so the new entry is visible when the doc renders.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-aware GitHub writes | Custom fetch+SHA logic | `writeFile()` from github.js | Already built in Phase 9; handles SHA, queue, Unicode, error |
| Markdown rendering | Custom MD parser | `marked.parse()` + `DOMPurify.sanitize()` | Already on page; the exact same call used in `renderDoc` |
| Write serialization | Locking mechanism | `writeFile()` / `deleteFile()` queue | Already serialized in Phase 9; concurrent calls are safe |
| XSS sanitization in preview | Manual escaping | `DOMPurify.sanitize()` | Already loaded; markdown can contain arbitrary HTML |

**Key insight:** Phases 8 and 9 built the entire infrastructure. Phase 10 is purely a UI wiring phase. The most important job is to use existing functions correctly, not build new capabilities.

---

## Common Pitfalls

### Pitfall 1: Index Update Order (Create vs Delete)

**What goes wrong:** On **create**, if the index is updated before the file is written, and the file write fails, the sidebar shows a doc that 404s when clicked. On **delete**, if the file is deleted before the index is updated, the index references a nonexistent file.

**Why it happens:** Two separate write operations that must be atomic are treated independently.

**How to avoid:**
- **Create:** Write the `.md` file first, then update the index. File exists before it appears in the sidebar.
- **Delete:** Update the index first (remove the entry), then delete the file. Index never references a missing file.

**Warning signs:** After a failed create, a broken link appears in the sidebar. After a failed delete, the sidebar still shows the doc but it 404s.

### Pitfall 2: textarea innerHTML vs .value

**What goes wrong:** Setting `textarea.innerHTML = content` rather than `textarea.value = content`. This causes HTML entities to appear unescaped or escaped incorrectly in the markdown content.

**Why it happens:** `innerHTML` on a textarea affects its `defaultValue` in some browsers but is not the standard way to set the live value.

**How to avoid:** Always use `textarea.value = markdownContent` for the live value. When building the edit view HTML string, set value via JS after inserting the element, not via an attribute:

```javascript
// Wrong — HTML-escaping required, innerHTML semantics vary
textarea.innerHTML = escapeHtml(markdown);

// Correct — no escaping needed, .value is always the raw string
const textarea = document.getElementById('edit-textarea');
textarea.value = markdown;
```

This means the textarea should be created with an empty body in the HTML template, and the value set after `mainEl.innerHTML = ...`:

```javascript
mainEl.innerHTML = `...<textarea id="edit-textarea" class="edit-textarea"></textarea>...`;
document.getElementById('edit-textarea').value = markdown; // set after insertion
```

### Pitfall 3: Stale Sidebar After CRUD Operations

**What goes wrong:** After creating or deleting a doc, the sidebar still shows the old doc list because `populateDocList()` was not re-called.

**Why it happens:** `populateDocList()` is only called once at `DOMContentLoaded`. Write operations do not automatically re-trigger it.

**How to avoid:** Call `await populateDocList()` after any operation that modifies `data/docs/index.json`. This is cheap — it fetches a tiny JSON file and rebuilds a short list.

### Pitfall 4: GitHub Rate Limits During Development

**What goes wrong:** Rapid save cycles (edit → save → edit → save) trigger many reads of the current SHA (every `writeFile` call does a `getFile` first). This can hit rate limits during heavy development sessions.

**Why it happens:** Each `writeFile` call makes a GET before the PUT (by design, in Phase 9, to get fresh SHA). Two writes to the same file = 2 GETs + 2 PUTs = 4 API calls.

**How to avoid:** This is by design and unavoidable for correctness. Authenticated requests get 5,000 calls/hour — enough for any development session. Not a concern in practice.

**Warning signs:** GitHub API returns 403 with `rate limit exceeded` in the response body.

### Pitfall 5: Edit Route Conflict With Existing Router

**What goes wrong:** The router parses `#/docs/slug` but not `#/docs/slug/edit`. Adding a third path segment breaks the existing `parts[2]` param extraction.

**Why it happens:** Existing router only handles two path segments.

**How to avoid:** Extend the router to handle a third segment:

```javascript
const parts = hash.slice(1).split('/');
const view = parts[1] || 'docs';
const param = parts[2] || null;        // slug (or 'new' for create)
const subview = parts[3] || null;      // 'edit' or null

if (view === 'docs') {
  if (param === 'new') {
    await renderCreateView();
  } else if (subview === 'edit' && param) {
    await renderEditView(param);
    updateActiveNav('docs', param);
  } else {
    await renderDoc(param);
    updateActiveNav('docs', param);
  }
}
```

### Pitfall 6: Slug Collision on Create

**What goes wrong:** User creates a doc with a slug that already exists. `writeFile` will overwrite the existing file with the new content silently (since it PUTs to the same path).

**Why it happens:** `writeFile` does an upsert — it creates or overwrites. There is no collision check.

**How to avoid:** Before creating, fetch the current `index.json` and check whether the slug already exists in `data.docs`. Show an inline error ("A doc with this slug already exists") without calling `writeFile`.

---

## Code Examples

Verified patterns specific to this project:

### writeFile for index.json update

```javascript
// Source: github.js (Phase 9) — writeFile is already global
async function addToIndex(slug, title) {
  const indexFile = await getFile('data/docs/index.json');
  const indexData = JSON.parse(indexFile.content);
  indexData.docs.push({ slug, title });
  await writeFile(
    'data/docs/index.json',
    JSON.stringify(indexData, null, 2),
    `docs: add ${slug}`
  );
}
```

### removeFromIndex for delete

```javascript
async function removeFromIndex(slug) {
  const indexFile = await getFile('data/docs/index.json');
  const indexData = JSON.parse(indexFile.content);
  indexData.docs = indexData.docs.filter(d => d.slug !== slug);
  await writeFile(
    'data/docs/index.json',
    JSON.stringify(indexData, null, 2),
    `docs: remove ${slug}`
  );
}
```

### textarea value set after innerHTML

```javascript
// Correct pattern — always set .value after inserting the textarea
mainEl.innerHTML = `
  <div class="edit-view">
    <div class="edit-toolbar">...</div>
    <textarea id="edit-textarea" class="edit-textarea"></textarea>
    <div id="edit-preview" class="edit-preview" hidden></div>
  </div>
`;
// Set value AFTER innerHTML assignment
document.getElementById('edit-textarea').value = markdown;
```

### Modal overlay CSS (to add to style.css)

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 420px;
  width: 90%;
}

.modal-box h2 {
  margin-bottom: 0.75rem;
  font-size: 1.125rem;
}

.modal-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.btn-danger {
  background: #c0392b;
}
```

### Edit textarea CSS

```css
.edit-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 4rem);
}

.edit-toolbar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.edit-textarea {
  flex: 1;
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  padding: 1rem;
  resize: none;
  outline: none;
}

.edit-textarea:focus {
  border-color: var(--accent);
}

.edit-preview {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0;
}

.btn-action {
  padding: 6px 14px;
  border: none;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  font-size: 0.85rem;
  font-family: inherit;
}

.btn-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Building a separate editor.js | Keeping edit logic in app.js | N/A (project convention) | Consistent with existing pattern; all view logic in one file |
| `textarea.innerHTML` to set content | `textarea.value = content` after innerHTML | Browser standards (always) | Avoids HTML escaping issues with markdown content |
| Side-by-side live preview | Preview toggle (per REQUIREMENTS.md Out of Scope) | Documented in REQUIREMENTS.md | Non-trivial split-pane CSS in vanilla JS; toggle is sufficient |

**Deprecated/outdated:**
- Side-by-side live preview: Explicitly out of scope per REQUIREMENTS.md. The toggle pattern (CRUD-03) is the specified approach.

---

## Open Questions

1. **Where does the "New Doc" button live in the sidebar?**
   - What we know: It must be `.auth-only` (hidden when not authenticated). Options are: static HTML in index.html next to the Docs section title, or dynamically injected in `populateDocList()`.
   - What's unclear: No CONTEXT.md decision exists.
   - Recommendation: Static HTML in index.html — a small `+` button next to the "Docs" `<h3>`. Wire a `click` listener in the bootstrap block that sets `window.location.hash = '#/docs/new'`. Simplest approach, zero risk of the button disappearing on sidebar refresh.

2. **Should edit/delete controls be inline on each doc-list item or appear only when a doc is active?**
   - What we know: The success criteria says "An authenticated user can open an existing doc in a markdown textarea" and "delete a doc via a confirmation modal that names the doc title." This implies controls per doc.
   - What's unclear: Visual treatment — always-visible icon buttons vs hover-reveal.
   - Recommendation: Always-visible small icon buttons (edit pencil, delete X) in each `<li>`. Hover-reveal via CSS (opacity 0 → 1 on `li:hover`) is a minor enhancement that can be added in CSS without JS complexity.

3. **Should the create view support a preview toggle?**
   - What we know: CRUD-03 says "while editing" — create is also an edit context.
   - What's unclear: Whether the planner should include preview in the create form too.
   - Recommendation: Yes — include the preview toggle in the create view as well. Same implementation, same toggle pattern, trivial to reuse.

---

## Sources

### Primary (HIGH confidence)

- `/Users/enjat/Github/keloia/keloia-docs/github.js` — Phase 9 implementation of `getFile`, `writeFile`, `deleteFile`; confirmed globally accessible functions with serialized write queue
- `/Users/enjat/Github/keloia/keloia-docs/app.js` — existing patterns for `renderDoc`, `populateDocList`, `router`, `escapeHtml`, `getAuthToken`; confirmed marked.js + DOMPurify already available
- `/Users/enjat/Github/keloia/keloia-docs/style.css` — existing CSS variables and patterns; confirmed `.auth-only` / `body.authenticated .auth-only` visibility gating
- `/Users/enjat/Github/keloia/keloia-docs/.planning/REQUIREMENTS.md` — confirmed CRUD-01..04 scope and "Out of Scope" exclusion of side-by-side live preview
- `/Users/enjat/Github/keloia/keloia-docs/.planning/STATE.md` — confirmed Phase 9 complete; confirmed github.js decisions (no X-GitHub-Api-Version, defer loading, getAuthToken global accessor)
- MDN Web Docs — `textarea.value` vs `textarea.innerHTML` behavior (browser standard, HIGH confidence)

### Secondary (MEDIUM confidence)

- Browser DOM spec — `element.hidden = true/false` as boolean attribute equivalent to `style.display = 'none'`; works in all modern browsers

### Tertiary (LOW confidence)

- None — all research findings are grounded in the actual codebase or browser standards.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All libraries already in use in this codebase; no new dependencies
- Architecture: HIGH — Patterns derived directly from existing app.js structure and Phase 9 implementations
- Pitfalls: HIGH — Textarea value pitfall is a documented browser behavior; index update order is derived from the existing Phase 7 MCP delete_doc pattern (index first, file second for delete); slug collision is a direct consequence of writeFile's upsert behavior

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (all dependencies are stable browser APIs and project-internal code)
