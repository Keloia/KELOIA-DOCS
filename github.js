/* ============================================================
   GitHub Contents API Wrapper
   Provides: getFile, writeFile, deleteFile
   ============================================================ */

const OWNER = 'Keloia';
const REPO = 'KELOIA-DOCS';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;

/* ---- Write queue: serializes all PUT/DELETE operations ---- */

let writeQueue = Promise.resolve();

function enqueueWrite(fn) {
  const result = writeQueue.then(fn);
  writeQueue = result.catch(() => {});
  return result;
}

/* ---- Unicode-safe Base64 helpers ---- */

function encodeToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, b => String.fromCodePoint(b)).join('');
  return btoa(binString);
}

function decodeFromBase64(base64) {
  const clean = base64.replace(/\s/g, '');
  const binString = atob(clean);
  const bytes = Uint8Array.from(binString, c => c.codePointAt(0));
  return new TextDecoder().decode(bytes);
}

/* ---- Auth helper ---- */

function authHeaders() {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json'
  };
}

/* ---- Public: getFile ---- */

async function getFile(path) {
  const res = await fetch(`${API}/${path}`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getFile failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return { sha: data.sha, content: decodeFromBase64(data.content) };
}

/* ---- Private: _writeFileImpl ---- */

async function _writeFileImpl(path, content, commitMessage) {
  const existing = await getFile(path);
  const body = { message: commitMessage, content: encodeToBase64(content) };
  if (existing) body.sha = existing.sha;
  const res = await fetch(`${API}/${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`writeFile failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/* ---- Private: _deleteFileImpl ---- */

async function _deleteFileImpl(path, commitMessage) {
  const existing = await getFile(path);
  if (!existing) throw new Error(`Cannot delete ${path}: file not found`);
  const res = await fetch(`${API}/${path}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: commitMessage, sha: existing.sha })
  });
  if (!res.ok) throw new Error(`deleteFile failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/* ---- Public API (exposed as globals) ---- */

function writeFile(path, content, commitMessage) {
  return enqueueWrite(() => _writeFileImpl(path, content, commitMessage));
}

function deleteFile(path, commitMessage) {
  return enqueueWrite(() => _deleteFileImpl(path, commitMessage));
}
