/* ============================================================
   Keloia SPA — Hash Router + Doc Rendering
   ============================================================ */

const mainEl = document.getElementById('main');

/* ============================================================
   Active Nav Highlighting
   ============================================================ */
function updateActiveNav(view, param) {
  // Remove active from all sidebar links
  document.querySelectorAll('#sidebar a').forEach(a => {
    a.classList.remove('active');
  });

  if (view === 'docs' && param) {
    // Highlight the specific doc link
    const link = document.querySelector(`a[href="#/docs/${param}"]`);
    if (link) link.classList.add('active');
  } else if (view === 'docs') {
    // No specific doc: highlight first doc link if present
    const firstDocLink = document.querySelector('#doc-list a');
    if (firstDocLink) firstDocLink.classList.add('active');
  } else {
    // Kanban, Progress, etc — match by data-view
    const link = document.querySelector(`a[data-view="${view}"]`);
    if (link) link.classList.add('active');
  }
}

/* ============================================================
   Doc Sidebar Population
   ============================================================ */
async function populateDocList() {
  try {
    const res = await fetch('data/docs/index.json');
    if (!res.ok) return;
    const data = await res.json();

    const docList = document.getElementById('doc-list');

    // Group docs by project
    const projects = data.projects || [];
    const docsByProject = {};
    for (const doc of data.docs) {
      const proj = doc.project || 'other';
      if (!docsByProject[proj]) docsByProject[proj] = [];
      docsByProject[proj].push(doc);
    }

    let html = '';
    for (const proj of projects) {
      const projectDocs = docsByProject[proj.id] || [];
      if (projectDocs.length === 0) continue;
      html += `<li class="doc-project-header">${escapeHtml(proj.name)}</li>`;
      html += projectDocs.map(doc => `
        <li class="doc-list-item">
          <a href="#/docs/${doc.slug}" data-view="docs" data-slug="${doc.slug}">
            ${escapeHtml(doc.title)}
          </a>
          <span class="doc-actions auth-only">
            <button class="btn-icon" data-action="edit" data-slug="${doc.slug}" title="Edit">&#9999;</button>
            <button class="btn-icon btn-danger-icon" data-action="delete" data-slug="${doc.slug}" data-title="${escapeHtml(doc.title)}" title="Delete">&#x2715;</button>
          </span>
        </li>
      `).join('');
    }

    // Render any ungrouped docs
    const ungrouped = docsByProject['other'] || [];
    if (ungrouped.length > 0) {
      html += ungrouped.map(doc => `
        <li class="doc-list-item">
          <a href="#/docs/${doc.slug}" data-view="docs" data-slug="${doc.slug}">
            ${escapeHtml(doc.title)}
          </a>
        </li>
      `).join('');
    }

    docList.innerHTML = html;

    docList.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.action === 'edit') {
        window.location.hash = '#/docs/' + btn.dataset.slug + '/edit';
      } else if (btn.dataset.action === 'delete') {
        showDeleteModal(btn.dataset.slug, btn.dataset.title);
      }
    });
  } catch (err) {
    console.error('Failed to populate doc list:', err);
  }
}

/* ============================================================
   Doc Rendering
   ============================================================ */
async function renderDoc(slug) {
  // If no slug, fall back to first doc from registry
  if (!slug) {
    try {
      const res = await fetch('data/docs/index.json');
      if (res.ok) {
        const data = await res.json();
        if (data.docs && data.docs.length > 0) {
          slug = data.docs[0].slug;
        }
      }
    } catch (err) {
      // fallthrough to default
    }
    if (!slug) {
      mainEl.innerHTML = '<p>No documents found.</p>';
      return;
    }
  }

  try {
    const res = await fetch(`data/docs/${slug}.md`);
    if (!res.ok) {
      mainEl.innerHTML = '<p>Document not found.</p>';
      return;
    }
    const markdown = await res.text();
    const rawHtml = marked.parse(markdown);
    const safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
    mainEl.innerHTML =
      '<div class="doc-toolbar"><button class="btn-copy-md" title="Copy as Markdown">Copy MD</button></div>' +
      safeHtml;

    // Wire up copy button
    mainEl.querySelector('.btn-copy-md').addEventListener('click', function () {
      navigator.clipboard.writeText(markdown).then(() => {
        this.textContent = 'Copied!';
        setTimeout(() => { this.textContent = 'Copy MD'; }, 1500);
      });
    });
  } catch (err) {
    console.error('Failed to render doc:', err);
    mainEl.innerHTML = '<p>Error loading document.</p>';
  }
}

/* ============================================================
   Kanban Board View
   ============================================================ */
async function renderKanban() {
  mainEl.innerHTML = '<p>Loading kanban board...</p>';

  try {
    // Fetch index to get columns and task IDs
    const indexRes = await fetch('data/kanban/index.json');
    if (!indexRes.ok) throw new Error(`Failed to fetch kanban index: ${indexRes.status}`);
    const indexData = await indexRes.json();

    // Fan-out: fetch all individual task files in parallel
    // When authenticated, read via GitHub API so writes are immediately visible
    const isAuth = document.body.classList.contains('authenticated');
    const taskFiles = await Promise.all(
      indexData.tasks.map(async id => {
        if (isAuth) {
          const file = await getFile(`data/kanban/${id}.json`);
          if (!file) throw new Error(`Task ${id} not found`);
          return JSON.parse(file.content);
        }
        const r = await fetch(`data/kanban/${id}.json`);
        if (!r.ok) throw new Error(`Failed to fetch task ${id}: ${r.status}`);
        return r.json();
      })
    );

    // Derive CSS class from column name: lowercase, spaces -> hyphens
    function columnClass(name) {
      return name.toLowerCase().replace(/\s+/g, '-');
    }

    // Render columns
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

    if (isAuth) {
      wireDragAndDrop();
    }
  } catch (err) {
    console.error('Failed to render kanban:', err);
    mainEl.innerHTML = '<p class="error-message">Error loading kanban board.</p>';
  }
}

function wireDragAndDrop() {
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
      const targetColumn = col.dataset.colName;

      if (!draggedTaskId || targetColumn === draggedSourceColumn) return;

      showMoveModal(draggedTaskId, draggedTaskTitle, targetColumn);
    });
  });
}

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
      await renderKanban();
    } catch (err) {
      errorEl.textContent = 'Move failed: ' + (err.message || 'Check your connection and try again.');
      errorEl.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Move';
    }
  });
}

/* ============================================================
   Progress Tracker View
   ============================================================ */
async function renderProgress() {
  mainEl.innerHTML = '<p>Loading progress tracker...</p>';

  try {
    // Fetch index to get milestone IDs
    const indexRes = await fetch('data/progress/index.json');
    if (!indexRes.ok) throw new Error(`Failed to fetch progress index: ${indexRes.status}`);
    const indexData = await indexRes.json();

    // Fan-out: fetch all individual milestone files in parallel
    const milestones = await Promise.all(
      indexData.milestones.map(id =>
        fetch(`data/progress/${id}.json`).then(r => {
          if (!r.ok) throw new Error(`Failed to fetch milestone ${id}: ${r.status}`);
          return r.json();
        })
      )
    );

    // Status badge color mapping
    function statusClass(status) {
      if (status === 'complete') return 'badge-complete';
      if (status === 'in-progress') return 'badge-in-progress';
      return 'badge-pending';
    }

    const milestonesHtml = milestones.map(m => {
      // Calculate progress at render time — never read stored percentage
      const total = m.tasksTotal || 0;
      const completed = m.tasksCompleted || 0;
      const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

      const notes = m.notes
        ? `<p class="milestone-notes">${escapeHtml(m.notes)}</p>`
        : '';

      const doneClass = (m.status === 'done' || m.status === 'complete') ? ' milestone-done' : '';
      return `<div class="milestone-card${doneClass}">
        <div class="milestone-title">
          <span class="milestone-name">${escapeHtml(m.title || '')}</span>
          <span class="badge badge-phase">Phase ${m.phase}</span>
          <span class="badge ${statusClass(m.status)}">${escapeHtml(m.status || 'pending')}</span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width: ${percent}%"></div>
        </div>
        <p class="progress-stats">${completed} of ${total} tasks complete (${percent}%)</p>
        ${notes}
      </div>`;
    }).join('');

    mainEl.innerHTML = `<div class="progress-tracker">
      <h1>Project Progress</h1>
      <label class="progress-filter">
        <input type="checkbox" id="hide-done-toggle" />
        <span>Hide completed</span>
      </label>
      ${milestonesHtml}
    </div>`;

    // Wire up hide-done filter
    const hideDoneToggle = document.getElementById('hide-done-toggle');
    const savedHideDone = localStorage.getItem('keloia_hide_done') === '1';
    hideDoneToggle.checked = savedHideDone;
    if (savedHideDone) mainEl.querySelector('.progress-tracker').classList.add('hide-done');

    hideDoneToggle.addEventListener('change', () => {
      mainEl.querySelector('.progress-tracker').classList.toggle('hide-done', hideDoneToggle.checked);
      localStorage.setItem('keloia_hide_done', hideDoneToggle.checked ? '1' : '0');
    });
  } catch (err) {
    console.error('Failed to render progress:', err);
    mainEl.innerHTML = '<p class="error-message">Error loading progress tracker.</p>';
  }
}

/* ============================================================
   Utility
   ============================================================ */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

/* ============================================================
   Authentication
   ============================================================ */
const TOKEN_KEY = 'keloia_gh_token';
let currentToken = null;

async function verifyToken(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json'
      }
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

function setAuthState(token) {
  currentToken = token;
  if (token) {
    document.body.classList.add('authenticated');
  } else {
    document.body.classList.remove('authenticated');
  }
}

function getAuthToken() {
  return currentToken;
}

async function initAuth() {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return;

  const valid = await verifyToken(stored);
  if (valid) {
    setAuthState(stored);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    setAuthState(null);
  }
}

/* ============================================================
   Site Search
   ============================================================ */
let searchIndex = null;
let indexBuilding = false;

async function buildSearchIndex() {
  if (searchIndex || indexBuilding) return;
  indexBuilding = true;

  try {
    const res = await fetch('data/docs/index.json');
    const data = await res.json();
    const docs = data.docs;

    const documents = await Promise.all(
      docs.map(async doc => {
        const r = await fetch(`data/docs/${doc.slug}.md`);
        const text = r.ok ? await r.text() : '';
        return { id: doc.slug, slug: doc.slug, title: doc.title, text };
      })
    );

    const miniSearch = new MiniSearch({ fields: ['title', 'text'], storeFields: ['title', 'slug', 'text'] });
    miniSearch.addAll(documents);
    searchIndex = miniSearch;
  } catch (err) {
    console.error('Failed to build search index:', err);
  }

  indexBuilding = false;

  // If the user typed while the index was building, trigger a search now
  const modalInput = document.getElementById('search-modal-input');
  if (modalInput && modalInput.value.trim()) {
    handleSearch(modalInput.value);
  }
}

function extractSnippet(text, query, windowSize = 120) {
  const lowerText = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let matchIndex = -1;
  for (const term of terms) {
    const idx = lowerText.indexOf(term);
    if (idx !== -1) { matchIndex = idx; break; }
  }

  if (matchIndex === -1) {
    return text.slice(0, windowSize).replace(/\n/g, ' ') + '…';
  }

  const start = Math.max(0, matchIndex - 40);
  const end = start + windowSize;
  let snippet = text.slice(start, end).replace(/\n/g, ' ');
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  return snippet;
}

/* ---- Search Modal Logic ---- */
let searchActiveIndex = -1;
let searchCurrentResults = [];

function openSearchModal() {
  const modal = document.getElementById('search-modal');
  const input = document.getElementById('search-modal-input');
  modal.hidden = false;
  input.value = '';
  document.getElementById('search-modal-results').innerHTML = '';
  searchActiveIndex = -1;
  searchCurrentResults = [];
  input.focus();
  buildSearchIndex();
}

function closeSearchModal() {
  const modal = document.getElementById('search-modal');
  modal.hidden = true;
  document.getElementById('search-modal-input').value = '';
  document.getElementById('search-modal-results').innerHTML = '';
  searchActiveIndex = -1;
  searchCurrentResults = [];
}

function renderSearchResults(results, query) {
  const container = document.getElementById('search-modal-results');
  searchCurrentResults = results || [];
  searchActiveIndex = -1;

  if (!results || results.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = results.map((r, i) => `
    <li class="search-result-item" data-index="${i}">
      <a href="#/docs/${escapeHtml(r.slug)}">
        <span class="result-title">${escapeHtml(r.title)}</span>
        <span class="result-snippet">${escapeHtml(extractSnippet(r.text, query))}</span>
      </a>
    </li>
  `).join('');

  container.querySelectorAll('.search-result-item a').forEach(link => {
    link.addEventListener('click', () => closeSearchModal());
  });
}

function updateSearchHighlight() {
  const items = document.querySelectorAll('#search-modal-results .search-result-item');
  items.forEach((item, i) => {
    item.classList.toggle('search-result-active', i === searchActiveIndex);
  });
  // Scroll active item into view
  if (searchActiveIndex >= 0 && items[searchActiveIndex]) {
    items[searchActiveIndex].scrollIntoView({ block: 'nearest' });
  }
}

const handleSearch = debounce((query) => {
  if (!searchIndex || !query.trim()) {
    renderSearchResults([]);
    return;
  }
  const results = searchIndex.search(query, { prefix: true, boost: { title: 2 }, fuzzy: 0.2, limit: 10 });
  renderSearchResults(results, query);
}, 150);

/* ============================================================
   Doc Edit View
   ============================================================ */
async function renderEditView(slug) {
  const res = await fetch(`data/docs/${slug}.md`);
  if (!res.ok) {
    mainEl.innerHTML = '<p>Document not found.</p>';
    return;
  }
  const markdown = await res.text();

  mainEl.innerHTML = `
    <div class="edit-view">
      <div class="edit-toolbar">
        <button id="save-btn" class="btn-action">Save</button>
        <button id="preview-toggle-btn" class="btn-action btn-secondary">Preview</button>
        <button id="cancel-btn" class="btn-action btn-secondary">Cancel</button>
      </div>
      <textarea id="edit-textarea" class="edit-textarea"></textarea>
      <div id="edit-preview" class="edit-preview" hidden></div>
    </div>
  `;

  // Set value AFTER innerHTML — never use innerHTML or template literal to set textarea content
  document.getElementById('edit-textarea').value = markdown;

  let previewing = false;
  const textarea = document.getElementById('edit-textarea');
  const preview = document.getElementById('edit-preview');
  const previewBtn = document.getElementById('preview-toggle-btn');

  previewBtn.addEventListener('click', () => {
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
    window.location.hash = '#/docs/' + slug;
  });

  document.getElementById('save-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await writeFile('data/docs/' + slug + '.md', textarea.value, 'docs: update ' + slug);
      searchIndex = null;
      buildSearchIndex();
      window.location.hash = '#/docs/' + slug;
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      // Show inline error
      let errEl = document.getElementById('edit-save-error');
      if (!errEl) {
        errEl = document.createElement('p');
        errEl.id = 'edit-save-error';
        errEl.className = 'edit-error';
        document.querySelector('.edit-toolbar').after(errEl);
      }
      errEl.textContent = 'Save failed. Check your connection and try again.';
    }
  });
}

/* ============================================================
   Doc Create View
   ============================================================ */
async function renderCreateView() {
  mainEl.innerHTML = `
    <div class="create-view">
      <h1>New Doc</h1>
      <div class="form-field">
        <label for="new-slug">Slug</label>
        <input type="text" id="new-slug" class="form-input" placeholder="my-doc-name" autocomplete="off" />
        <p class="field-hint">Lowercase letters, numbers, hyphens only</p>
      </div>
      <div class="form-field">
        <label for="new-title">Title</label>
        <input type="text" id="new-title" class="form-input" placeholder="My Doc Name" autocomplete="off" />
      </div>
      <div class="form-field">
        <label for="new-body">Content</label>
        <button id="new-preview-btn" class="btn-action btn-secondary" style="margin-bottom:0.5rem">Preview</button>
        <textarea id="new-body" class="edit-textarea" style="height:300px"></textarea>
        <div id="new-preview" class="edit-preview" hidden></div>
      </div>
      <p id="create-error" class="form-error" hidden></p>
      <div class="form-actions">
        <button id="create-btn" class="btn-action">Create Doc</button>
        <button id="create-cancel-btn" class="btn-action btn-secondary">Cancel</button>
      </div>
    </div>
  `;

  let previewing = false;
  const textarea = document.getElementById('new-body');
  const preview = document.getElementById('new-preview');
  const previewBtn = document.getElementById('new-preview-btn');
  const errorEl = document.getElementById('create-error');

  previewBtn.addEventListener('click', () => {
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

  document.getElementById('create-cancel-btn').addEventListener('click', () => {
    window.location.hash = '#/docs';
  });

  document.getElementById('create-btn').addEventListener('click', async () => {
    const slug = document.getElementById('new-slug').value.trim();
    const title = document.getElementById('new-title').value.trim();
    const body = textarea.value.trim();

    const showError = (msg) => {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    };

    errorEl.hidden = true;

    // Validate slug
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      showError('Slug must be lowercase letters, numbers, and hyphens only.');
      return;
    }

    // Validate title
    if (!title) {
      showError('Title is required.');
      return;
    }

    // Validate body
    if (!body) {
      showError('Content is required.');
      return;
    }

    // Check for duplicate slug
    let indexData;
    try {
      const indexFile = await getFile('data/docs/index.json');
      indexData = JSON.parse(indexFile.content);
    } catch (err) {
      showError('Failed to load index. Check your connection and try again.');
      return;
    }

    if (indexData.docs.some(d => d.slug === slug)) {
      showError('A doc with this slug already exists.');
      return;
    }

    const createBtn = document.getElementById('create-btn');
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      // Write the markdown file first
      await writeFile('data/docs/' + slug + '.md', body, 'docs: create ' + slug);

      // Update the index
      indexData.docs.push({ slug, title });
      await writeFile('data/docs/index.json', JSON.stringify(indexData, null, 2), 'docs: add ' + slug);

      searchIndex = null;
      buildSearchIndex();

      // Refresh sidebar
      await populateDocList();

      // Navigate to new doc
      window.location.hash = '#/docs/' + slug;
    } catch (err) {
      createBtn.disabled = false;
      createBtn.textContent = 'Create Doc';
      showError('Create failed: ' + (err.message || 'Check your connection and try again.'));
    }
  });
}

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
      <p id="modal-error" class="form-error" hidden></p>
      <div class="modal-actions">
        <button id="confirm-delete-btn" class="btn-action btn-danger">Delete</button>
        <button id="cancel-delete-btn" class="btn-action btn-secondary">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('cancel-delete-btn').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('confirm-delete-btn');
    const modalError = document.getElementById('modal-error');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';
    modalError.hidden = true;

    try {
      // Update index first
      const indexFile = await getFile('data/docs/index.json');
      const indexData = JSON.parse(indexFile.content);
      const updated = { ...indexData, docs: indexData.docs.filter(d => d.slug !== slug) };
      await writeFile('data/docs/index.json', JSON.stringify(updated, null, 2), 'docs: remove ' + slug);

      // Then delete the file
      await deleteFile('data/docs/' + slug + '.md', 'docs: delete ' + slug);

      searchIndex = null;
      buildSearchIndex();

      // Remove overlay
      overlay.remove();

      // Refresh sidebar
      await populateDocList();

      // Navigate to docs
      window.location.hash = '#/docs';
    } catch (err) {
      modalError.textContent = 'Delete failed: ' + (err.message || 'Check your connection and try again.');
      modalError.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete';
    }
  });
}

/* ============================================================
   MCP Integration View
   ============================================================ */
function renderMcp() {
  const MCP_URL = 'https://keloia-mcp.mfauzan-az23.workers.dev/mcp';

  const tabs = [
    {
      id: 'vscode',
      label: 'VS Code',
      instruction: 'Add this to your VS Code MCP settings (<code>settings.json</code>):',
      code: JSON.stringify({ "mcp": { "servers": { "keloia-docs": { "type": "http", "url": MCP_URL } } } }, null, 2),
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      instruction: 'Run this command in your terminal:',
      code: `claude mcp add keloia-docs --transport http --url "${MCP_URL}"`,
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      instruction: 'Add this to your Claude Desktop config (<code>claude_desktop_config.json</code>):',
      code: JSON.stringify({ "mcpServers": { "keloia-docs": { "url": MCP_URL } } }, null, 2),
    },
  ];

  const tabButtonsHtml = tabs.map(t =>
    `<button class="mcp-tab-btn" data-tab="${t.id}">${escapeHtml(t.label)}</button>`
  ).join('');

  const tabPanesHtml = tabs.map((t, i) => `
    <div class="mcp-tab-pane" data-tab-pane="${t.id}" hidden>
      <p class="mcp-instruction">${t.instruction}</p>
      <div class="mcp-code-block">
        <pre><code>${escapeHtml(t.code)}</code></pre>
        <button class="mcp-copy-btn" data-copy-idx="${i}">Copy</button>
      </div>
    </div>
  `).join('');

  const toolsList = [
    { name: 'keloia_list_docs', desc: 'List all documentation files' },
    { name: 'keloia_read_doc', desc: 'Read a document by slug' },
    { name: 'keloia_search_docs', desc: 'Search docs by keyword or regex' },
    { name: 'keloia_get_kanban', desc: 'View the kanban board' },
    { name: 'keloia_get_progress', desc: 'View milestone progress' },
    { name: 'keloia_add_task', desc: 'Create a kanban task' },
    { name: 'keloia_move_task', desc: 'Move a task between columns' },
    { name: 'keloia_update_progress', desc: 'Update a milestone' },
    { name: 'keloia_add_doc', desc: 'Create a new document' },
    { name: 'keloia_edit_doc', desc: 'Edit an existing document' },
    { name: 'keloia_delete_doc', desc: 'Delete a document' },
  ];

  const toolsTableHtml = toolsList.map(t =>
    `<tr><td><code>${escapeHtml(t.name)}</code></td><td>${escapeHtml(t.desc)}</td></tr>`
  ).join('');

  mainEl.innerHTML = `
    <div class="mcp-view">
      <h1>🧩 MCP Integration</h1>
      <p class="mcp-subtitle">Connect your AI coding assistant to access Keloia documentation via the Model Context Protocol.</p>

      <div class="mcp-card">
        <h2>🔗 Connect AI Tools via MCP</h2>
        <p>Access this documentation directly from your AI coding assistant using the Model Context Protocol.</p>

        <div class="mcp-tabs">
          ${tabButtonsHtml}
        </div>
        ${tabPanesHtml}

        <hr class="mcp-divider" />

        <h3>Available Tools</h3>
        <p>Your AI assistant will have access to these tools once connected:</p>
        <table class="mcp-tools-table">
          <thead><tr><th>Tool</th><th>Description</th></tr></thead>
          <tbody>${toolsTableHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  // Wire tabs
  const defaultTab = 'claude-code';
  const tabBtns = mainEl.querySelectorAll('.mcp-tab-btn');
  const tabPanes = mainEl.querySelectorAll('.mcp-tab-pane');

  function activateTab(tabId) {
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
    tabPanes.forEach(pane => { pane.hidden = pane.dataset.tabPane !== tabId; });
  }

  tabBtns.forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));
  activateTab(defaultTab);

  // Wire copy buttons — use index to get raw code (avoids HTML entity issues)
  mainEl.querySelectorAll('.mcp-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = tabs[parseInt(btn.dataset.copyIdx, 10)].code;
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      } catch {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      }
    });
  });
}

/* ============================================================
   Router
   ============================================================ */
async function router() {
  const hash = window.location.hash || '#/docs';
  // Strip the leading '#' then split on '/'
  // hash: '#/docs/keloia/architecture' => parts: ['', 'docs', 'keloia', 'architecture']
  const parts = hash.slice(1).split('/');
  const view = parts[1] || 'docs';
  // Support project/slug paths: #/docs/keloia/architecture or flat #/docs/new
  let param = null;
  let subview = null;
  if (parts.length >= 4 && view === 'docs') {
    // Project-based slug: parts[2]/parts[3] (e.g., keloia/architecture)
    param = parts[2] + '/' + parts[3];
    subview = parts[4] || null;
  } else {
    param = parts[2] || null;
    subview = parts[3] || null;
  }

  // Close search modal on navigation
  const searchModal = document.getElementById('search-modal');
  if (searchModal && !searchModal.hidden) closeSearchModal();

  switch (view) {
    case 'docs':
      if (param === 'new') {
        await renderCreateView();
        updateActiveNav('docs', null);
      } else if (subview === 'edit' && param) {
        if (!getAuthToken()) {
          window.location.hash = '#/docs/' + param;
          return;
        }
        await renderEditView(param);
        updateActiveNav('docs', param);
        break;
      } else {
        await renderDoc(param);
        updateActiveNav('docs', param);
      }
      break;
    case 'kanban':
      renderKanban();
      updateActiveNav('kanban', null);
      break;
    case 'progress':
      renderProgress();
      updateActiveNav('progress', null);
      break;
    case 'mcp':
      renderMcp();
      updateActiveNav('mcp', null);
      break;
    default:
      // Redirect unknown routes to docs
      window.location.hash = '#/docs';
      break;
  }
}

/* ============================================================
   Bootstrap
   ============================================================ */
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', async () => {
  await populateDocList();
  initAuth(); // non-blocking — verifies stored token in background
  await router();

  // New Doc button
  document.getElementById('new-doc-btn').addEventListener('click', () => {
    window.location.hash = '#/docs/new';
  });

  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');

  function closeMobileMenu() {
    sidebar.classList.remove('is-open');
    mobileMenuBtn.classList.remove('is-active');
    sidebarBackdrop.classList.remove('is-visible');
  }

  function toggleMobileMenu() {
    const isOpen = sidebar.classList.toggle('is-open');
    mobileMenuBtn.classList.toggle('is-active', isOpen);
    sidebarBackdrop.classList.toggle('is-visible', isOpen);
  }

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', toggleMobileMenu);
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeMobileMenu);
  }

  // Close mobile menu on navigation
  sidebar.addEventListener('click', e => {
    if (e.target.closest('a[href]')) closeMobileMenu();
  });

  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  function applyThemeUI(theme) {
    const icon = themeToggle.querySelector('.theme-toggle-icon');
    const label = themeToggle.querySelector('.theme-toggle-label');
    if (theme === 'light') {
      icon.textContent = '\u2600\uFE0F';
      label.textContent = 'Light';
    } else {
      icon.textContent = '\uD83C\uDF19';
      label.textContent = 'Dark';
    }
  }

  // Set initial UI to match applied theme
  applyThemeUI(document.documentElement.getAttribute('data-theme') || 'dark');

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('keloia_theme', next);
    applyThemeUI(next);
  });

  // Search modal — trigger button
  const searchTrigger = document.getElementById('search-trigger');
  if (searchTrigger) {
    searchTrigger.addEventListener('click', () => openSearchModal());
  }

  // Search modal — Cmd+K / Ctrl+K global shortcut
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const modal = document.getElementById('search-modal');
      if (modal.hidden) {
        openSearchModal();
      } else {
        closeSearchModal();
      }
    }
  });

  // Search modal — input, keyboard nav, escape, backdrop click
  const modalInput = document.getElementById('search-modal-input');
  const modalOverlay = document.getElementById('search-modal');

  if (modalInput) {
    modalInput.addEventListener('input', e => handleSearch(e.target.value));

    modalInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeSearchModal();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (searchCurrentResults.length === 0) return;
        searchActiveIndex = (searchActiveIndex + 1) % searchCurrentResults.length;
        updateSearchHighlight();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (searchCurrentResults.length === 0) return;
        searchActiveIndex = (searchActiveIndex - 1 + searchCurrentResults.length) % searchCurrentResults.length;
        updateSearchHighlight();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (searchActiveIndex >= 0 && searchCurrentResults[searchActiveIndex]) {
          window.location.hash = '#/docs/' + searchCurrentResults[searchActiveIndex].slug;
          closeSearchModal();
        }
        return;
      }
    });
  }

  // Backdrop click closes modal
  if (modalOverlay) {
    modalOverlay.addEventListener('click', e => {
      if (e.target === modalOverlay) closeSearchModal();
    });
  }

  // Login handler
  const loginBtn = document.getElementById('login-btn');
  const tokenInput = document.getElementById('token-input');
  const loginError = document.getElementById('login-error');

  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      const token = tokenInput.value.trim();
      if (!token) return;

      // Disable button, show verifying state
      loginBtn.disabled = true;
      loginBtn.textContent = 'Verifying...';
      loginError.hidden = true;

      const valid = await verifyToken(token);

      if (valid) {
        localStorage.setItem(TOKEN_KEY, token);
        setAuthState(token);
        tokenInput.value = '';
      } else {
        loginError.textContent = 'Invalid token. Check and try again.';
        loginError.hidden = false;
      }

      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
    });
  }

  // Enter key triggers login
  if (tokenInput) {
    tokenInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && loginBtn) loginBtn.click();
    });
  }

  // Logout handler
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem(TOKEN_KEY);
      setAuthState(null);
    });
  }
});
