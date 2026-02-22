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
    docList.innerHTML = data.docs.map(doc => `
      <li>
        <a href="#/docs/${doc.slug}" data-view="docs" data-slug="${doc.slug}">
          ${escapeHtml(doc.title)}
        </a>
      </li>
    `).join('');
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
    mainEl.innerHTML = safeHtml;
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
    const taskFiles = await Promise.all(
      indexData.tasks.map(id =>
        fetch(`data/kanban/${id}.json`).then(r => {
          if (!r.ok) throw new Error(`Failed to fetch task ${id}: ${r.status}`);
          return r.json();
        })
      )
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
        return `<div class="kanban-card">
          <p class="card-title">${title}</p>
          ${desc}
          ${assignee}
        </div>`;
      }).join('');

      return `<div class="kanban-column column-${cls}">
        <h3>${escapeHtml(colName)} <span class="col-count">${colTasks.length}</span></h3>
        ${cardsHtml || '<p class="empty-column">No tasks</p>'}
      </div>`;
    }).join('');

    mainEl.innerHTML = `<div class="kanban-board">${columnsHtml}</div>`;
  } catch (err) {
    console.error('Failed to render kanban:', err);
    mainEl.innerHTML = '<p class="error-message">Error loading kanban board.</p>';
  }
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

      return `<div class="milestone-card">
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
      ${milestonesHtml}
    </div>`;
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
    const docs = [...data.docs, { slug: 'mcp-guide', title: 'MCP Setup Guide' }];

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
  const searchInput = document.getElementById('search-input');
  if (searchInput && searchInput.value.trim()) {
    handleSearch(searchInput.value);
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

function renderSearchResults(results, query) {
  const container = document.getElementById('search-results');
  if (!results || results.length === 0) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  container.innerHTML = results.map(r => `
    <li class="search-result-item">
      <a href="#/docs/${escapeHtml(r.slug)}">
        <span class="result-title">${escapeHtml(r.title)}</span>
        <span class="result-snippet">${escapeHtml(extractSnippet(r.text, query))}</span>
      </a>
    </li>
  `).join('');
  container.hidden = false;

  // Add click listeners for immediate visual feedback
  container.querySelectorAll('.search-result-item a').forEach(link => {
    link.addEventListener('click', () => {
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = '';
      container.hidden = true;
      container.innerHTML = '';
    });
  });
}

const handleSearch = debounce((query) => {
  if (!searchIndex || !query.trim()) {
    renderSearchResults([]);
    return;
  }
  const results = searchIndex.search(query, { prefix: true, boost: { title: 2 }, fuzzy: 0.2, limit: 5 });
  renderSearchResults(results, query);
}, 150);

/* ============================================================
   Router
   ============================================================ */
async function router() {
  const hash = window.location.hash || '#/docs';
  // Strip the leading '#' then split on '/'
  // hash: '#/docs/architecture' => parts: ['', 'docs', 'architecture']
  const parts = hash.slice(1).split('/');
  const view = parts[1] || 'docs';
  const param = parts[2] || null;

  // Clear search state on navigation
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  if (searchInput) searchInput.value = '';
  if (searchResults) { searchResults.hidden = true; searchResults.innerHTML = ''; }

  switch (view) {
    case 'docs':
      await renderDoc(param);
      updateActiveNav('docs', param);
      break;
    case 'kanban':
      renderKanban();
      updateActiveNav('kanban', null);
      break;
    case 'progress':
      renderProgress();
      updateActiveNav('progress', null);
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

  // Search event listeners
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('focus', () => buildSearchIndex(), { once: true });
    searchInput.addEventListener('input', e => handleSearch(e.target.value));
  }

  // Close search results when clicking outside the search container
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-container')) {
      const searchResults = document.getElementById('search-results');
      const si = document.getElementById('search-input');
      if (searchResults) { searchResults.hidden = true; searchResults.innerHTML = ''; }
      if (si) si.value = '';
    }
  });

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
