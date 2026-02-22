# Phase 11: Interactive Kanban - Research

**Researched:** 2026-02-22
**Domain:** HTML5 Drag and Drop API, vanilla JS event handling, GitHub Contents API write (already implemented)
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| KNBN-01 | Authenticated user can drag kanban cards between columns | HTML5 `draggable` attribute on cards; `dragstart`, `dragover` (with `preventDefault()`), and `drop` events on columns; auth-gated via `body.authenticated` CSS class — no new libraries needed |
| KNBN-02 | A confirmation modal appears before saving the column change | On `drop`, store the pending move (task ID + destination column) in a JS variable; show a modal (reuse existing `.modal-overlay` / `.modal-box` CSS pattern from Phase 10) naming the task title and destination column; only call `writeFile` if the user clicks Confirm |
| KNBN-03 | Column change is persisted via GitHub Contents API | On confirm, call `writeFile('data/kanban/task-NNN.json', updatedJSON, commitMsg)` — reuses the already-global `writeFile` from `github.js`; same SHA-aware write pattern used by Phase 10 |
</phase_requirements>

---

## Summary

Phase 11 adds interactive drag-and-drop to the existing kanban board view. The full API wrapper (`writeFile`, `getFile`) is already global from Phase 9. The modal pattern (overlay + box + confirm/cancel buttons + inline error) is already proven in Phase 10's delete modal. The auth gating CSS system (`body.authenticated .auth-only`) is already in place from Phase 8. The kanban data schema (individual `task-NNN.json` files, each with an `id`, `title`, `column`, `description`, `assignee` field) is already defined.

The core technical domain for this phase is the **HTML5 Drag and Drop API** — a browser-native capability requiring zero additional libraries. Cards get the `draggable="true"` attribute. Column drop zones respond to `dragover` (must call `event.preventDefault()` to unlock the `drop` event) and `drop` events. On drop, instead of immediately persisting, a confirmation modal is shown. Only after the user clicks Confirm does `writeFile` update the task's JSON file on GitHub.

The primary pitfall is the **mandatory `dragover` `preventDefault()` call**: omitting it causes the `drop` event to never fire — silently, with no console errors. A secondary pitfall is the **dragleave child-element flickering** problem: as the mouse crosses over child elements inside a column (card titles, descriptions), `dragleave` fires spuriously, causing drop-zone highlighting to flicker. The fix is checking `event.relatedTarget` — or skipping `dragleave` altogether for this use case and using only `dragenter`/`drop` for visual state.

**Primary recommendation:** Extend `renderKanban()` in `app.js` to (1) add `draggable="true"` and `data-task-id` to each card when authenticated, (2) wire `dragstart`, `dragover`, `drop` on columns, and (3) call a `showMoveModal(taskId, taskTitle, targetColumn)` function on drop — which follows the exact same modal pattern as `showDeleteModal`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| HTML5 Drag and Drop API | Browser-native | Drag cards between columns | Zero library overhead; works in all modern desktop browsers; the MDN Kanban tutorial uses exactly this API |
| `writeFile` (global, Phase 9) | — | Persist column change to GitHub | Already implemented, SHA-aware, queued; same function used in Phase 10 |
| `getAuthToken` (global, Phase 8) | — | Auth guard on drag UI | Already implemented; used by `github.js` internally |
| Vanilla JS / CSS | — | Modal, event handlers, CSS gating | Project constraint; no build step |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing `.modal-overlay` / `.modal-box` CSS | Phase 10 | Confirmation modal UI | Already defined in `style.css`; reuse verbatim |
| `body.authenticated` CSS class + `.auth-only` | Phase 8 | Hide drag handles when not authenticated | Already in `style.css`; add `auth-only` class to draggable card handles or set `draggable` only when authenticated |
| `escapeHtml()` (global in app.js) | — | Safe modal text rendering | Already exists |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HTML5 DnD API | SortableJS, interact.js, dnd-kit | External libraries add weight, require CDN or build step; HTML5 DnD is sufficient for cross-column movement; within-column reorder (KNBN-04) is explicitly deferred to future |
| HTML5 DnD API | Pointer Events API (manual DnD) | More control and mobile support, but significantly more code; mobile DnD is explicitly out of scope per REQUIREMENTS.md |
| Modifying `renderKanban()` in place | A separate `renderKanbanEditable()` function | Conditional logic inside one function is simpler at this scale; avoids duplicating the full render path |

**Installation:** No new packages or CDN scripts needed. Zero additions to `index.html`.

---

## Architecture Patterns

### Recommended Project Structure

No new files needed. All changes go into existing files:

```
app.js       — extend renderKanban() with draggable cards (auth-gated), add showMoveModal()
style.css    — add drag-handle cursor CSS, drop-zone highlight, dragging opacity
index.html   — no changes
github.js    — no changes
```

The kanban data schema is unchanged. The persisted change is a single field update: `task.column = newColumn`, then `JSON.stringify(task)` written back via `writeFile`.

### Pattern 1: Auth-Gated `draggable` Attribute

**What:** Cards are only draggable when authenticated. Two approaches:

**Option A — Set `draggable` conditionally in template string:**
```javascript
const isAuth = document.body.classList.contains('authenticated');
const draggableAttr = isAuth ? 'draggable="true"' : '';
return `<div class="kanban-card ${draggableAttr ? 'card-draggable' : ''}" ${draggableAttr} data-task-id="${task.id}">`;
```

**Option B — Always render with `draggable="true"`, use `pointer-events: none` on handles when not authenticated:**
Less clean — keep Option A. The `draggable` attribute presence is the gating mechanism.

**Recommendation:** Option A. Conditional attribute in template string, consistent with how `renderKanban` already builds HTML. No extra CSS class needed — just check `body.classList.contains('authenticated')` at render time.

**Key insight:** `renderKanban()` is called on every navigation to `#/kanban`. By the time it runs, `initAuth()` (non-blocking from boot) will have resolved for most page loads. The `body.authenticated` class will already be set. This is safe to read synchronously.

### Pattern 2: Drag-and-Drop Event Wiring

**What:** After `mainEl.innerHTML = ...` sets the board HTML, wire DnD events via DOM queries.

**Source: MDN HTML Drag and Drop API / Kanban Board tutorial**

```javascript
// In renderKanban(), after setting mainEl.innerHTML:

const isAuth = document.body.classList.contains('authenticated');
if (!isAuth) return; // No DnD wiring for unauthenticated users

let draggedTaskId = null;
let draggedTaskTitle = null;

// Wire cards
mainEl.querySelectorAll('.kanban-card[draggable]').forEach(card => {
  card.addEventListener('dragstart', (e) => {
    draggedTaskId = card.dataset.taskId;
    draggedTaskTitle = card.dataset.taskTitle;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedTaskId); // type used to validate in dragover
    card.classList.add('card-dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('card-dragging');
    draggedTaskId = null;
    draggedTaskTitle = null;
  });
});

// Wire columns as drop zones
mainEl.querySelectorAll('.kanban-column').forEach(col => {
  col.addEventListener('dragover', (e) => {
    // CRITICAL: Must call preventDefault() or drop event will never fire
    if (e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault();
      col.classList.add('col-drop-over');
    }
  });

  col.addEventListener('dragleave', (e) => {
    // Only remove highlight when truly leaving the column (not entering a child)
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove('col-drop-over');
    }
  });

  col.addEventListener('drop', (e) => {
    e.preventDefault();
    col.classList.remove('col-drop-over');

    const targetColumn = col.dataset.colName; // set via data-col-name attribute in HTML
    const sourceColumn = /* read from taskFiles */ currentTaskColumn(draggedTaskId);

    if (!draggedTaskId || targetColumn === sourceColumn) return; // no-op

    showMoveModal(draggedTaskId, draggedTaskTitle, targetColumn);
  });
});
```

**HTML template for columns must include `data-col-name`:**
```javascript
return `<div class="kanban-column column-${cls}" data-col-name="${escapeHtml(colName)}">
  <h3>${escapeHtml(colName)} <span class="col-count">${colTasks.length}</span></h3>
  ${cardsHtml || '<p class="empty-column">No tasks</p>'}
</div>`;
```

**HTML template for cards must include `data-task-id` and `data-task-title`:**
```javascript
const draggableAttr = isAuth ? 'draggable="true"' : '';
return `<div class="kanban-card" ${draggableAttr} data-task-id="${escapeHtml(task.id)}" data-task-title="${escapeHtml(task.title || '')}">
  <p class="card-title">${title}</p>
  ${desc}
  ${assignee}
</div>`;
```

### Pattern 3: Confirmation Modal (showMoveModal)

**What:** On drop, instead of writing immediately, show a modal naming the task title and destination column. Only write on Confirm.

**Pattern is identical to Phase 10's `showDeleteModal` — reuse verbatim structure:**

```javascript
function showMoveModal(taskId, taskTitle, targetColumn) {
  // Remove any existing modal
  document.getElementById('move-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'move-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h2>Move task?</h2>
      <p>Move <strong>${escapeHtml(taskTitle)}</strong> to <strong>${escapeHtml(targetColumn)}</strong>?</p>
      <p id="move-modal-error" class="form-error" hidden></p>
      <div class="modal-actions">
        <button id="confirm-move-btn" class="btn-action">Move</button>
        <button id="cancel-move-btn" class="btn-action btn-secondary">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('cancel-move-btn').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById('confirm-move-btn').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('confirm-move-btn');
    const errorEl = document.getElementById('move-modal-error');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Moving...';
    errorEl.hidden = true;

    try {
      // Fetch current task file to get SHA and current content
      const taskFile = await getFile(`data/kanban/${taskId}.json`);
      const taskData = JSON.parse(taskFile.content);
      taskData.column = targetColumn;
      await writeFile(
        `data/kanban/${taskId}.json`,
        JSON.stringify(taskData, null, 2),
        `kanban: move ${taskId} to ${targetColumn}`
      );
      overlay.remove();
      // Re-render the board to reflect the move
      await renderKanban();
    } catch (err) {
      errorEl.textContent = 'Move failed: ' + (err.message || 'Check your connection and try again.');
      errorEl.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Move';
    }
  });
}
```

**Key detail:** `getFile` inside the confirm handler fetches the current task file fresh from the GitHub API. This gives the current SHA needed for `writeFile` to succeed. Do not cache the SHA at drag-start time — always fetch fresh at write time.

### Pattern 4: Re-render After Confirm

**What:** After a successful `writeFile`, call `await renderKanban()` to re-render the board from the updated data.

**Why this works:** `renderKanban()` fetches fresh data from GitHub (or CDN cache) and rebuilds the HTML. The just-written task file will be fetched again. Because GitHub Pages serves from the repo, the updated file will be available immediately after the commit completes.

**Caution on caching:** GitHub Pages may cache task JSON files for a few seconds. In practice, the re-render after commit will show the new state because `writeFile` awaits the API response before the re-render call. No additional cache-busting is needed for this use case.

### Anti-Patterns to Avoid

- **Omitting `event.preventDefault()` in `dragover`:** This causes the `drop` event to never fire. No console error. Silent failure. ALWAYS call `e.preventDefault()` in `dragover` when the drag data type matches.
- **Writing immediately in `drop` handler (no modal):** Violates KNBN-02. The drop event must only trigger a modal; the actual write happens only after user confirmation.
- **Caching SHA at drag-start time:** The SHA must be fetched fresh immediately before the write in the confirm handler. A cached SHA will be stale if another write happened since the page loaded.
- **Storing the full task object in `dataTransfer`:** Pass only the task ID. The full task object is re-fetched in the confirm handler to get a fresh SHA. Storing large objects in dataTransfer is not needed.
- **Not checking source column === target column:** If the user drops a card on its own column, skip the modal and return early. No-op moves should not trigger a confirmation modal.
- **Wiring DnD events to the board when not authenticated:** Check `body.classList.contains('authenticated')` before adding event listeners. This enforces KNBN-01 and AUTH-04.
- **Using `dragenter` for highlighting instead of `dragover`:** `dragenter` fires once on entry but not continuously. `dragover` fires continuously — use it for drop-zone gating (with `preventDefault()`). For visual highlight, either `dragenter` (toggled with `dragleave`) or `dragover` works; `dragenter` is lower cost (not called every 100ms).
- **Relying on `dataTransfer.getData()` in `dragover`:** `getData()` returns empty string in `dragover`. Only `dataTransfer.types` is readable. Use `e.dataTransfer.types.includes('text/plain')` to validate, not `getData()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-aware task file write | Custom fetch+SHA | `writeFile()` from github.js | Already built, handles SHA, queue, Unicode, error; same function used for docs in Phase 10 |
| Modal overlay HTML/CSS | New modal implementation | Reuse `.modal-overlay` / `.modal-box` pattern from Phase 10 | Already defined in style.css; showDeleteModal is the exact template |
| Auth check in drag handlers | New auth check | `document.body.classList.contains('authenticated')` | Phase 8's CSS class gate; no new coupling needed |
| Mobile drag-and-drop | Touch event listeners, polyfill | Nothing — mobile DnD is out of scope | REQUIREMENTS.md explicitly excludes it: "Mobile drag-and-drop: HTML5 DnD doesn't work on touch; polyfill adds complexity; defer to future" |

**Key insight:** Phase 11 is entirely a UI wiring phase, like Phase 10. All infrastructure (auth, API wrapper, modal CSS, kanban renderer) already exists. The new work is: `draggable` attribute, three event listeners per column, two event listeners per card, and `showMoveModal()`.

---

## Common Pitfalls

### Pitfall 1: `drop` Event Never Fires (Silent Failure)

**What goes wrong:** The user drops a card but nothing happens. No error in the console.

**Why it happens:** The `dragover` event handler did not call `event.preventDefault()`. By default, elements are not valid drop targets. The browser cancels the drop operation unless `dragover` is explicitly cancelled.

**How to avoid:** Always include `e.preventDefault()` in the `dragover` handler. Confirm with `e.dataTransfer.types.includes('text/plain')` before calling it to restrict drops to kanban cards only.

**Warning signs:** Drop cursor does not change to a "move" cursor. The card snaps back to its original position with a "fly-back" animation.

### Pitfall 2: `dragleave` Fires Spuriously on Child Elements

**What goes wrong:** The drop-zone highlight on a column flickers as the cursor moves over child elements (card titles, description text, assignee badges) inside the column.

**Why it happens:** `dragleave` fires every time the cursor leaves one element and enters a child element. Unlike `mouseleave`, it does not respect the containing element boundary.

**How to avoid:** In the `dragleave` handler, check `event.relatedTarget`:
```javascript
col.addEventListener('dragleave', (e) => {
  if (!col.contains(e.relatedTarget)) {
    col.classList.remove('col-drop-over');
  }
});
```
`col.contains(e.relatedTarget)` returns `true` when the cursor moved into a child element — so the highlight is preserved. It returns `false` when the cursor truly left the column.

**Alternative:** Add `pointer-events: none` to all child elements inside a kanban column during a drag. More CSS complexity, but avoids the relatedTarget check.

**Warning signs:** Column highlight flickers rapidly as cursor moves over card text.

### Pitfall 3: `getData()` Returns Empty String in `dragover`

**What goes wrong:** Code tries `e.dataTransfer.getData('text/plain')` in a `dragover` handler and gets an empty string, causing validation logic to fail and `preventDefault()` to not be called.

**Why it happens:** The HTML5 DnD spec restricts data store access during `dragover` and `dragenter`. `getData()` only works in `drop` and `dragend`.

**How to avoid:** In `dragover`, use `e.dataTransfer.types.includes('text/plain')` to check whether the dragged item is a kanban card (not a file or URL). Read the actual task ID only in the `drop` handler — or better, store the task ID in a module-scoped variable set in `dragstart`.

**Warning signs:** Validation always fails in `dragover`, dropping never works.

### Pitfall 4: Moving a Card to Its Current Column

**What goes wrong:** The user drops a card on the column it's already in. A confirmation modal appears asking to move "Task X to Backlog" even though it's already in Backlog.

**Why it happens:** The `drop` handler doesn't check whether the source column equals the target column.

**How to avoid:** Track the source column name in a variable set at `dragstart` (read from the card's parent column `data-col-name`, or store it in `dragstart` alongside the task ID). In the `drop` handler, compare source and target column names — return early if they match.

### Pitfall 5: Stale Board After Confirm (No Re-render)

**What goes wrong:** After confirming a move, the board still shows the card in the old column. The GitHub write succeeded but the UI was not updated.

**Why it happens:** The confirm handler wrote to the API but did not re-render the board.

**How to avoid:** After `await writeFile(...)` succeeds in the confirm handler, call `await renderKanban()`. This fetches fresh task data and rebuilds the full board HTML.

### Pitfall 6: SHA Conflict if Two Moves Happen Rapidly

**What goes wrong:** A 409 Conflict error from the GitHub API when a second move is confirmed before the first write completes.

**Why it happens:** The `writeFile` queue in `github.js` serializes writes, so concurrent `writeFile` calls are safe. However, if `getFile` (the SHA fetch inside `_writeFileImpl`) is called for the same file twice before either PUT completes, the second PUT's SHA may be stale.

**How to avoid:** The existing write queue in Phase 9 already handles this — each write enqueues and the queue runs sequentially. As long as both moves go through `writeFile`, the second will execute after the first completes (with a fresh SHA fetch). No additional handling needed. This is only relevant if two kanban moves could happen simultaneously, which requires two browser windows — extremely unlikely in a 1-2 user scenario.

**Warning signs:** 409 Conflict in the network tab; `writeFile failed: 409 Conflict` error in the modal.

---

## Code Examples

Verified patterns from codebase and MDN:

### Complete `renderKanban()` Extension Sketch

```javascript
// Source: MDN HTML Drag and Drop API + existing app.js renderKanban() pattern
async function renderKanban() {
  mainEl.innerHTML = '<p>Loading kanban board...</p>';

  try {
    const indexRes = await fetch('data/kanban/index.json');
    if (!indexRes.ok) throw new Error(`Failed to fetch kanban index: ${indexRes.status}`);
    const indexData = await indexRes.json();

    const taskFiles = await Promise.all(
      indexData.tasks.map(id =>
        fetch(`data/kanban/${id}.json`).then(r => {
          if (!r.ok) throw new Error(`Failed to fetch task ${id}: ${r.status}`);
          return r.json();
        })
      )
    );

    const isAuth = document.body.classList.contains('authenticated');

    function columnClass(name) {
      return name.toLowerCase().replace(/\s+/g, '-');
    }

    const columnsHtml = indexData.columns.map(colName => {
      const colTasks = taskFiles.filter(t => t.column === colName);
      const cls = columnClass(colName);

      const cardsHtml = colTasks.map(task => {
        const title = escapeHtml(task.title || '');
        const desc = task.description
          ? `<p class="card-description">${escapeHtml(task.description.slice(0, 100))}${task.description.length > 100 ? '…' : ''}</p>`
          : '';
        const assignee = task.assignee
          ? `<span class="card-assignee">${escapeHtml(task.assignee)}</span>`
          : '';
        const draggableAttr = isAuth ? 'draggable="true"' : '';
        return `<div class="kanban-card" ${draggableAttr} data-task-id="${escapeHtml(task.id)}" data-task-title="${escapeHtml(task.title || '')}">
          <p class="card-title">${title}</p>
          ${desc}
          ${assignee}
        </div>`;
      }).join('');

      return `<div class="kanban-column column-${cls}" data-col-name="${escapeHtml(colName)}">
        <h3>${escapeHtml(colName)} <span class="col-count">${colTasks.length}</span></h3>
        ${cardsHtml || '<p class="empty-column">No tasks</p>'}
      </div>`;
    }).join('');

    mainEl.innerHTML = `<div class="kanban-board">${columnsHtml}</div>`;

    // Wire DnD only when authenticated
    if (isAuth) {
      wireDragAndDrop(taskFiles);
    }
  } catch (err) {
    console.error('Failed to render kanban:', err);
    mainEl.innerHTML = '<p class="error-message">Error loading kanban board.</p>';
  }
}

function wireDragAndDrop(taskFiles) {
  let draggedTaskId = null;
  let draggedTaskTitle = null;
  let draggedSourceColumn = null;

  mainEl.querySelectorAll('.kanban-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedTaskId = card.dataset.taskId;
      draggedTaskTitle = card.dataset.taskTitle;
      draggedSourceColumn = card.closest('.kanban-column').dataset.colName;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedTaskId);
      card.classList.add('card-dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('card-dragging');
      draggedTaskId = null;
      draggedTaskTitle = null;
      draggedSourceColumn = null;
    });
  });

  mainEl.querySelectorAll('.kanban-column').forEach(col => {
    col.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault(); // REQUIRED — enables drop
        col.classList.add('col-drop-over');
      }
    });

    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('col-drop-over');
      }
    });

    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('col-drop-over');
      const targetColumn = col.dataset.colName;

      if (!draggedTaskId || targetColumn === draggedSourceColumn) return;

      showMoveModal(draggedTaskId, draggedTaskTitle, targetColumn);
    });
  });
}
```

### `showMoveModal` Implementation

```javascript
// Source: app.js showDeleteModal() pattern (Phase 10), adapted for kanban move
function showMoveModal(taskId, taskTitle, targetColumn) {
  document.getElementById('move-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'move-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h2>Move task?</h2>
      <p>Move <strong>${escapeHtml(taskTitle)}</strong> to <strong>${escapeHtml(targetColumn)}</strong>?</p>
      <p id="move-modal-error" class="form-error" hidden></p>
      <div class="modal-actions">
        <button id="confirm-move-btn" class="btn-action">Move</button>
        <button id="cancel-move-btn" class="btn-action btn-secondary">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('cancel-move-btn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('confirm-move-btn').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('confirm-move-btn');
    const errorEl = document.getElementById('move-modal-error');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Moving...';
    errorEl.hidden = true;

    try {
      const taskFile = await getFile(`data/kanban/${taskId}.json`);
      const taskData = JSON.parse(taskFile.content);
      taskData.column = targetColumn;
      await writeFile(
        `data/kanban/${taskId}.json`,
        JSON.stringify(taskData, null, 2),
        `kanban: move ${taskId} to ${targetColumn}`
      );
      overlay.remove();
      await renderKanban(); // Re-render board from fresh data
    } catch (err) {
      errorEl.textContent = 'Move failed: ' + (err.message || 'Check your connection and try again.');
      errorEl.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Move';
    }
  });
}
```

### CSS for Drag Feedback

```css
/* Source: Consistent with project design system; follows MDN DnD kanban example visual patterns */

/* Dragging state: dim the card being dragged */
.kanban-card.card-dragging {
  opacity: 0.4;
}

/* Card cursor hint for draggable cards */
.kanban-card[draggable="true"] {
  cursor: grab;
}

.kanban-card[draggable="true"]:active {
  cursor: grabbing;
}

/* Drop zone highlight */
.kanban-column.col-drop-over {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
  background: rgba(74, 158, 255, 0.08);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jQuery UI draggable/sortable | Native HTML5 DnD API | ~2016 (HTML5 widespread) | No jQuery dependency; all modern browsers support it for desktop |
| Writing immediately on drop | Confirmation modal before write | Project requirement (KNBN-02) | Prevents accidental moves; consistent with delete confirmation pattern in Phase 10 |
| Re-fetching SHA at drag-start | Fetching SHA fresh at confirm-time | Phase 9 decision (SHA discipline) | Avoids stale SHA writes; getFile always returns current SHA |

**Deprecated/outdated:**
- Mobile touch polyfills (dragdroptouch, mobile-drag-drop): Explicitly out of scope per REQUIREMENTS.md. The polyfills exist but add complexity; the project decision is to defer mobile DnD to a future version.
- Storing full object in dataTransfer: Only the task ID needs to be carried through the drag. Full re-fetch at confirm time follows the project's SHA discipline.

---

## Open Questions

1. **Where to track `draggedSourceColumn` — in a scoped variable or on `card.dataset`?**
   - What we know: `dragstart` fires before `drop`; a closure variable in `wireDragAndDrop` is simple and scoped to one board render.
   - What's unclear: Nothing — the closure variable approach is clean and standard.
   - Recommendation: Module-scoped within `wireDragAndDrop`. Set in `dragstart`, cleared in `dragend`. No data-attribute needed.

2. **Should the board re-render immediately on drop (optimistic) or only after confirm?**
   - What we know: KNBN-02 says the move must not be saved until the user confirms. Optimistic UI (moving the card DOM before confirm) would require rolling back on cancel — more complexity.
   - What's unclear: Nothing — the spec is clear.
   - Recommendation: Do not move the card in the DOM at drop time. Show the modal; only call `renderKanban()` after a successful `writeFile`. The visual update happens post-confirm.

3. **Does `renderKanban()` need to be made async-safe for concurrent calls?**
   - What we know: `renderKanban()` is already `async`. It's called from `router()` and now also from `showMoveModal`. If two calls run concurrently, both will set `mainEl.innerHTML` at the end — the second one wins.
   - What's unclear: Whether a rapid confirm + route change could cause a race.
   - Recommendation: Not a real concern for a 1-2 user tool. The modal overlay prevents any navigation while it's open. After `overlay.remove()` and `await renderKanban()`, the user is back on the kanban view.

---

## Sources

### Primary (HIGH confidence)

- `/Users/enjat/Github/keloia/keloia-docs/app.js` — existing `renderKanban()` implementation; confirmed card and column HTML structure, `escapeHtml`, modal pattern from `showDeleteModal`
- `/Users/enjat/Github/keloia/keloia-docs/github.js` — `writeFile`, `getFile` globals; SHA-fetch-then-write pattern
- `/Users/enjat/Github/keloia/keloia-docs/style.css` — existing `.modal-overlay`, `.modal-box`, `.modal-actions`, `.btn-action`, `.btn-secondary`, `.form-error` CSS (all reusable)
- `/Users/enjat/Github/keloia/keloia-docs/data/kanban/index.json` — confirmed columns: ["Backlog", "In Progress", "Done"]; tasks array
- `/Users/enjat/Github/keloia/keloia-docs/data/kanban/task-001.json` — confirmed task schema: `{ id, title, column, description, assignee }`
- `/Users/enjat/Github/keloia/keloia-docs/.planning/REQUIREMENTS.md` — confirmed KNBN-01/02/03 scope; confirmed mobile DnD explicitly out of scope
- MDN Web Docs (HTML Drag and Drop API / Kanban Board) — `dragstart`/`dragover`/`drop` event sequence; `dataTransfer.effectAllowed`, `setData`, `types`; `dragover` must call `preventDefault()` to enable drop; `getData()` only works in `drop` and `dragend`
- MDN Web Docs (Drag Operations) — complete event sequence; `effectAllowed` and `dropEffect` values; data accessibility per event

### Secondary (MEDIUM confidence)

- [MDN HTMLElement: dragleave event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dragleave_event) — `event.relatedTarget` technique to avoid child-element flickering
- [web.dev: The HTML5 Drag and Drop API](https://web.dev/articles/drag-and-drop) — `dragenter` vs `dragover` for visual feedback; CSS class toggle pattern for drop-zone highlight
- Community sources (Stack Overflow, timonweb.com) — confirmed `dragover.preventDefault()` as the canonical fix for drop not firing; `contains(relatedTarget)` as the canonical fix for dragleave flickering

### Tertiary (LOW confidence)

- None — all critical claims are grounded in MDN official documentation or the project codebase.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — HTML5 DnD is a browser standard; `writeFile`/`getFile` are verified in this codebase; modal CSS already exists
- Architecture: HIGH — patterns derived directly from existing `renderKanban()` and `showDeleteModal()` implementations; no new patterns needed
- Pitfalls: HIGH — `dragover.preventDefault()` requirement is explicitly documented in MDN; `dragleave`/`relatedTarget` issue is well-documented with multiple authoritative sources; SHA discipline from Phase 9 applies directly

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (HTML5 DnD is a stable browser standard; project code is under direct control)
