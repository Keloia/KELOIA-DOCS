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
   Placeholder Views (implemented in Plan 02)
   ============================================================ */
function renderKanban() {
  mainEl.innerHTML = '<p>Kanban board loading...</p>';
}

function renderProgress() {
  mainEl.innerHTML = '<p>Progress tracker loading...</p>';
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
