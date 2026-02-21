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
  await router();
});
