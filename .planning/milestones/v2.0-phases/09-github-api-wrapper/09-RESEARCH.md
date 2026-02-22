# Phase 9: GitHub API Wrapper - Research

**Researched:** 2026-02-22
**Domain:** GitHub Contents REST API, browser Base64 encoding/decoding, async serialization, vanilla JS module design
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRUD-05 | All site doc writes go through the GitHub Contents API (commit to repo) | GitHub Contents API fully supports browser fetch with CORS; PUT for create/update, DELETE for delete; all require sha for updates and deletes. Serialized write queue prevents 409s. TextEncoder-based Base64 handles Unicode safely. |
</phase_requirements>

---

## Summary

Phase 9 builds a thin GitHub API wrapper module — a single file (`github.js`) in the project root — that wraps the GitHub Contents API's create, read, update, and delete operations. The module must solve three distinct technical problems that are common failure modes for browser-based GitHub API clients: (1) SHA staleness causing 409 Conflict errors, (2) `btoa()` throwing `InvalidCharacterError` on non-ASCII characters, and (3) `atob()` failing on the newline-padded Base64 strings GitHub returns in GET responses.

The solution for each problem is well-established and independently verifiable. SHA staleness is solved by fetching the current SHA immediately before every write — never caching or reusing it across calls. Concurrent 409s are solved by a serialized promise queue: a one-liner pattern that chains all write operations so they execute one at a time. Unicode Base64 is solved by using `TextEncoder` to get UTF-8 bytes and then `btoa()` on the binary string, and the inverse `TextDecoder` path for decode. GitHub API Base64 responses contain embedded newlines (line-wrapped at ~76 characters); these must be stripped with `.replace(/\s/g, '')` before passing to `atob()`.

The module needs to know three pieces of configuration to call the API: the GitHub owner (`Keloia`), the repository name (`KELOIA-DOCS`), and the authenticated token retrieved from Phase 8's `getAuthToken()` accessor. The CORS policy for the GitHub REST API explicitly allows `GET`, `PUT`, and `DELETE` methods with `Authorization` and `Content-Type` headers — no proxy needed. Note: `X-GitHub-Api-Version` is NOT in the `Access-Control-Allow-Headers` list and must not be sent on write operations to avoid preflight failures (consistent with the Phase 8 research decision).

**Primary recommendation:** Implement a single `github.js` module with five functions (`getFile`, `createFile`, `updateFile`, `deleteFile`, and a serialized `writeFile` dispatcher that calls create vs update based on file existence), using a promise-chain write queue for serialization. No npm dependencies — pure vanilla JS using `fetch`, `TextEncoder`/`TextDecoder`, and module-level state.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| GitHub REST API `/repos/{owner}/{repo}/contents/{path}` | 2022-11-28 | Create, read, update, delete files as commits | Official API; full CORS support for browser fetch; SHA-based conflict prevention is the documented write protocol |
| `fetch` (browser native) | browser-native | HTTP requests to GitHub API | Already used throughout app.js; no new dependencies needed |
| `TextEncoder` / `TextDecoder` (browser native) | browser-native | Unicode-safe Base64 encode/decode | Required to avoid `InvalidCharacterError` on non-ASCII markdown content |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `btoa` / `atob` (browser native) | browser-native | Base64 encode/decode | Used as the final step after TextEncoder byte conversion; NOT called directly on raw strings |
| `getAuthToken()` (Phase 8 export) | project-local | Token retrieval | Called inside every API function — no token storage in this module |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `fetch` | Octokit.js from CDN | Octokit adds ~130KB CDN load for features we don't need; raw fetch is sufficient for 4 operations |
| Promise-chain queue (hand-rolled) | `p-queue` npm package | p-queue is a great library but requires npm and a module bundler; the 5-line promise chain pattern is sufficient and zero-dep |
| `TextEncoder` approach | `encodeURIComponent` + `escape` trick | The `escape()` function is deprecated; `TextEncoder` is the current MDN-documented standard pattern |

**Installation:** No new packages needed. Everything is native browser APIs.

---

## Architecture Patterns

### Recommended Project Structure

```
github.js          — new module: GitHub Contents API wrapper
app.js             — imports getAuthToken(); Phase 10/11 will import writeFile/deleteFile from github.js
index.html         — adds <script src="github.js"> before app.js
```

No new directories. Single new file added to root alongside `app.js`.

### Pattern 1: SHA-Fresh-Before-Write (No Cached SHAs)

**What:** Every update and delete operation fetches the current file SHA via a GET immediately before the write. The SHA is never stored in module state, never passed in from the caller, and never cached between calls.

**When to use:** Every `updateFile` and `deleteFile` call. The GET + PUT/DELETE pairing must be atomic within the write queue (no other write can interleave).

**Why this matters:** If two writes happen in rapid succession and the first modifies the file, the second write's SHA is already stale. The only safe approach is to fetch SHA at the moment of writing, not earlier.

**Example:**
```javascript
// Source: https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28
async function updateFile(path, content, commitMessage) {
  // Step 1: fetch current SHA fresh — never reuse a cached SHA
  const current = await getFile(path);
  if (!current) throw new Error(`Cannot update ${path}: file does not exist`);

  // Step 2: encode content safely (Unicode-aware)
  const encoded = encodeToBase64(content);

  // Step 3: PUT with fresh SHA
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + getAuthToken(),
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: commitMessage,
      content: encoded,
      sha: current.sha
    })
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}
```

### Pattern 2: Serialized Write Queue (Promise Chain)

**What:** A module-level promise chain ensures all write operations execute sequentially, never in parallel. Each write call appends to the chain; the queue tail is updated to point to the new end; if a write fails, the queue continues with the next operation.

**When to use:** Wrap all write operations (`createFile`, `updateFile`, `deleteFile`) through this queue. Read operations (`getFile`) do not need to be queued.

**Why this matters:** Without serialization, two rapid save-button clicks on the same file will both read the same SHA, then both attempt to write with the same (now stale after first write) SHA, causing a 409 Conflict on the second write.

**Example:**
```javascript
// Source: https://advancedweb.hu/how-to-serialize-calls-to-an-async-function/
// Minimal promise queue — serializes all write operations

let writeQueue = Promise.resolve();

function enqueueWrite(fn) {
  const result = writeQueue.then(() => fn());
  writeQueue = result.catch(() => {}); // prevent rejection from blocking the queue
  return result;
}

// All public write functions go through enqueueWrite:
function writeFile(path, content, commitMessage) {
  return enqueueWrite(() => _writeFileImpl(path, content, commitMessage));
}

function deleteFile(path, commitMessage) {
  return enqueueWrite(() => _deleteFileImpl(path, commitMessage));
}
```

### Pattern 3: Unicode-Safe Base64 Encode/Decode

**What:** Two helper functions that use `TextEncoder`/`TextDecoder` to safely handle any Unicode content through Base64. Never call `btoa()` directly on raw strings.

**When to use:** Always — for both encoding content before sending to the API and decoding content received from the API.

**Example:**
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Window/btoa
// (TextEncoder/TextDecoder pattern, documented under "Unicode strings" section)

function encodeToBase64(str) {
  // 1. Convert string to UTF-8 bytes
  const bytes = new TextEncoder().encode(str);
  // 2. Convert bytes to binary string
  const binString = Array.from(bytes, b => String.fromCodePoint(b)).join('');
  // 3. Base64-encode the binary string
  return btoa(binString);
}

function decodeFromBase64(base64) {
  // GitHub API returns base64 with embedded newlines — strip before decoding
  const clean = base64.replace(/\s/g, '');
  // Reverse: atob → binary string → bytes → string
  const binString = atob(clean);
  const bytes = Uint8Array.from(binString, c => c.codePointAt(0));
  return new TextDecoder().decode(bytes);
}
```

### Pattern 4: getFile — SHA Retrieval and Content Decode

**What:** A `getFile` function that performs a GET request, strips whitespace from the Base64 content, decodes it safely, and returns both the decoded content string and the raw SHA. Returns `null` if the file does not exist (404).

**Example:**
```javascript
// Source: https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28

async function getFile(path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + getAuthToken(),
      'Accept': 'application/vnd.github+json'
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return {
    sha: data.sha,
    content: decodeFromBase64(data.content) // strips whitespace, TextDecoder path
  };
}
```

### Pattern 5: writeFile — Create vs Update Dispatcher

**What:** A single public `writeFile` function that checks file existence and dispatches to create (no SHA) or update (fresh SHA). Callers don't need to know whether the file exists.

**Example:**
```javascript
async function _writeFileImpl(path, content, commitMessage) {
  const existing = await getFile(path);
  const encoded = encodeToBase64(content);
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const body = {
    message: commitMessage,
    content: encoded
  };
  if (existing) {
    body.sha = existing.sha; // update requires SHA
  }
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + getAuthToken(),
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}
```

### Anti-Patterns to Avoid

- **Caching SHA across calls:** Storing `sha` in module state and reusing it for subsequent writes. Any write between your read and your write invalidates the SHA. Always fetch fresh.
- **Calling `btoa()` directly on markdown:** Markdown content will contain em dashes, smart quotes, curly quotes. These are multi-byte Unicode codepoints. `btoa()` will throw `InvalidCharacterError`. Always go through `TextEncoder` first.
- **Calling `atob()` on the raw GitHub API response content field:** GitHub returns Base64 line-wrapped at 76 characters with `\n` line endings. `atob()` in some browsers rejects whitespace within the Base64 string. Always `.replace(/\s/g, '')` before passing to `atob()`.
- **Not wrapping write operations in the queue:** Allowing `writeFile` and `deleteFile` to be called concurrently bypasses the serialization guarantee. Every write must go through `enqueueWrite`.
- **Including `X-GitHub-Api-Version` header:** Per Phase 8 research and the official CORS docs, this header is NOT in the `Access-Control-Allow-Headers` list. Omit it to avoid preflight failures.
- **Sending write requests without `Content-Type: application/json`:** PUT and DELETE with a JSON body require this header. Without it, GitHub may return 400.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA conflict prevention | Retry logic with backoff | Fetch fresh SHA immediately before write (no retry needed) | A fresh SHA read immediately before write within a serialized queue is guaranteed to be current — retry logic adds complexity and doesn't fix the root cause (stale SHA) |
| Concurrency control | Semaphore, lock, mutex | Promise chain queue (5 lines) | The chain pattern is the simplest correct solution for a single-tab browser SPA with no worker threads |
| Unicode Base64 | Custom character-by-character escape | `TextEncoder` → `btoa` pipeline | TextEncoder handles all Unicode edge cases correctly; hand-rolling character escape is error-prone and well-covered by the MDN-documented pattern |
| Whitespace stripping in decode | Custom Base64 parser | `.replace(/\s/g, '')` before `atob()` | One line; no library needed; solves the newline issue in all browsers |

**Key insight:** The entire GitHub API wrapper can be implemented in ~80 lines of vanilla JS with zero new dependencies. The hard problems (SHA freshness, Unicode, serialization) each have a simple, well-documented one-liner or 5-line solution.

---

## Common Pitfalls

### Pitfall 1: 409 Conflict on Rapid Double-Save

**What goes wrong:** User clicks Save twice quickly (or a form submit fires twice). Both calls read the same current SHA. First write succeeds and creates a new commit. Second write attempts to PUT with the now-stale SHA of the pre-first-write blob — GitHub returns `409 Conflict`.

**Why it happens:** The two requests are concurrent. The second request's SHA was fetched before the first write changed the blob.

**How to avoid:** All write operations go through `enqueueWrite()`. The second save waits for the first to complete (including its GET for SHA + PUT). By the time the second write's GET fires, the file has already been updated and returns the new current SHA.

**Warning signs:** 409 responses appearing in the browser network tab for the second of two rapid writes to the same path.

### Pitfall 2: InvalidCharacterError on Non-ASCII Markdown

**What goes wrong:** User saves a doc containing an em dash (`—`), smart quotes (`"`, `"`), or any emoji. `btoa(content)` throws `InvalidCharacterError` (also reported as "Character Out Of Range" in Firefox).

**Why it happens:** `btoa()` treats its input as Latin-1 (ISO-8859-1). Code points above U+00FF (em dash is U+2014, smart quote is U+201C) are out of range.

**How to avoid:** Never call `btoa()` directly on string content. Always use the `encodeToBase64()` helper that goes through `TextEncoder` first.

**Warning signs:** JavaScript exception in the console on save. Error message includes "InvalidCharacterError" or "String contains an invalid character".

### Pitfall 3: atob() Fails on GitHub API Response Content

**What goes wrong:** `atob(data.content)` throws an exception or returns corrupted output. GitHub's API returns Base64 content with embedded `\n` characters every 76 characters (standard Base64 line-wrapping).

**Why it happens:** The HTML spec for `atob()` requires implementations to strip ASCII whitespace before decoding, but some browser versions or strict parsers reject whitespace within the Base64 string. The `.replace(/\s/g, '')` strip is the defensive correct pattern.

**How to avoid:** Always call `data.content.replace(/\s/g, '')` before passing to `atob()`. The `decodeFromBase64()` helper must do this.

**Warning signs:** Exception or garbled output when reading a file from the GitHub API before any write has been attempted.

### Pitfall 4: Write Queue Breaks on Rejection

**What goes wrong:** A write fails (network error, 422, etc.). The promise queue tail is now a rejected promise. All subsequent writes will immediately reject without executing.

**Why it happens:** Chaining `.then()` on a rejected promise skips the callback and propagates the rejection.

**How to avoid:** The queue tail assignment must use a separate catch to absorb rejection: `writeQueue = result.catch(() => {})`. The `result` (which rejects) is returned to the caller; the `writeQueue` is always a resolved promise so the next operation can proceed.

**Warning signs:** After a save error, subsequent saves appear to do nothing (no network request fires).

### Pitfall 5: Token Not Available at Call Time

**What goes wrong:** `getAuthToken()` returns `null` because the user is not authenticated. The fetch succeeds syntactically but GitHub returns 401. The error message is confusing because the caller doesn't know why.

**Why it happens:** Phase 9's module calls `getAuthToken()` (Phase 8 export) at request time. If the user navigated directly to an edit URL without logging in, or if the token verification in `initAuth()` hasn't completed yet, `currentToken` is null.

**How to avoid:** At the top of every API function, check `if (!getAuthToken()) throw new Error('Not authenticated')`. Phase 10/11 callers should also guard behind the `body.authenticated` CSS check, but the API module should defend itself.

**Warning signs:** 401 responses in network tab; callers receiving rejected promises even when the user appears logged in during the `initAuth()` background verification window.

### Pitfall 6: CORS Preflight Failure on X-GitHub-Api-Version

**What goes wrong:** Including `X-GitHub-Api-Version: 2022-11-28` in write request headers triggers a CORS preflight. The preflight fails because this header is not in GitHub's `Access-Control-Allow-Headers` list (which includes `Authorization`, `Content-Type`, `If-Match`, `If-Modified-Since`, `If-None-Match`, `If-Unmodified-Since`, `X-Requested-With` — but NOT the version header).

**Why it happens:** Same CORS issue identified in Phase 8 research (confirmed by official CORS docs).

**How to avoid:** Do not include `X-GitHub-Api-Version` in any headers sent from the browser. The API version defaults to the stable version; the Contents API endpoint is stable. Use only `Authorization: Bearer TOKEN`, `Accept: application/vnd.github+json`, and `Content-Type: application/json`.

**Warning signs:** Browser console shows `CORS preflight` failure before write operations; no request appears in GitHub API logs.

---

## Code Examples

Verified patterns from official sources:

### Complete github.js Module Structure

```javascript
// github.js
// GitHub Contents API wrapper — SHA-aware, Unicode-safe, serialized writes
// Source: https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28

const OWNER = 'Keloia';
const REPO  = 'KELOIA-DOCS';
const API   = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;

// --- Write queue (serialized) ---
// Source: https://advancedweb.hu/how-to-serialize-calls-to-an-async-function/
let writeQueue = Promise.resolve();

function enqueueWrite(fn) {
  const result = writeQueue.then(() => fn());
  writeQueue = result.catch(() => {}); // keep queue running after failure
  return result;
}

// --- Unicode-safe Base64 ---
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Window/btoa (Unicode section)
function encodeToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, b => String.fromCodePoint(b)).join('');
  return btoa(binString);
}

function decodeFromBase64(base64) {
  const clean = base64.replace(/\s/g, ''); // strip GitHub line-wrapping newlines
  const binString = atob(clean);
  const bytes = Uint8Array.from(binString, c => c.codePointAt(0));
  return new TextDecoder().decode(bytes);
}

// --- API helpers ---
function authHeaders() {
  const token = getAuthToken(); // Phase 8 export
  if (!token) throw new Error('Not authenticated');
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json'
    // Note: X-GitHub-Api-Version omitted — not in CORS allow list
  };
}

// --- Read (not queued — reads are safe to run concurrently) ---
async function getFile(path) {
  const res = await fetch(`${API}/${path}`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  const data = await res.json();
  return { sha: data.sha, content: decodeFromBase64(data.content) };
}

// --- Write implementation (always called through enqueueWrite) ---
async function _writeFileImpl(path, content, commitMessage) {
  const existing = await getFile(path);
  const body = {
    message: commitMessage,
    content: encodeToBase64(content)
  };
  if (existing) body.sha = existing.sha; // update requires sha; create does not
  const res = await fetch(`${API}/${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  return res.json();
}

async function _deleteFileImpl(path, commitMessage) {
  const existing = await getFile(path); // fresh SHA — never cached
  if (!existing) throw new Error(`Cannot delete ${path}: file not found`);
  const res = await fetch(`${API}/${path}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: commitMessage, sha: existing.sha })
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  return res.json();
}

// --- Public API (Phase 10/11 consume these) ---
function writeFile(path, content, commitMessage) {
  return enqueueWrite(() => _writeFileImpl(path, content, commitMessage));
}

function deleteFile(path, commitMessage) {
  return enqueueWrite(() => _deleteFileImpl(path, commitMessage));
}
```

### Success Criteria Verification Tests

Each of these can be manually verified in the browser console or network tab:

```javascript
// Test 1: No 409 on rapid double-write
// Call writeFile twice in immediate succession — second must await first
const p1 = writeFile('data/docs/test.md', 'first write', 'test: write 1');
const p2 = writeFile('data/docs/test.md', 'second write', 'test: write 2');
await Promise.all([p1, p2]); // both must succeed, p2 must complete after p1

// Test 2: Non-ASCII content encodes without error
const nonAscii = 'Em dash — smart quotes \u201C\u201D curly apostrophe \u2019';
const encoded = encodeToBase64(nonAscii);
const decoded = decodeFromBase64(encoded);
console.assert(decoded === nonAscii, 'Unicode round-trip failed');

// Test 3: atob on GitHub response with newlines
const withNewlines = 'SGVsbG8g\nd29ybGQ='; // "Hello world" with embedded newline
const result = decodeFromBase64(withNewlines); // must not throw

// Test 4: SHA freshness — verify no SHA caching
// Write file, then update it. The update must not use a cached SHA from step 1.
// Verified by confirming two distinct SHAs appear in network tab GET calls.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `btoa(content)` directly | `TextEncoder` → bytes → `btoa(binString)` | MDN updated recommendation; `escape()` trick officially deprecated | Required for any non-ASCII content; em dashes appear in real project docs |
| `atob(base64)` directly on API response | `.replace(/\s/g, '')` then `atob()` | Always required but frequently missed | GitHub wraps Base64 at 76 chars; raw `atob()` may fail depending on browser implementation strictness |
| Retry logic for 409s | Serialized write queue + fresh SHA on every write | N/A | Retry logic doesn't fix the root cause; serialization + fresh SHA is deterministic, not probabilistic |
| `Authorization: token TOKEN` | `Authorization: Bearer TOKEN` | GitHub docs updated ~2022-2023 | Both still work for classic PATs; `Bearer` is the documented standard; consistent with Phase 8 decision |

**Deprecated/outdated:**
- `escape()` + `unescape()` tricks for Unicode Base64: These use a deprecated global function. Use `TextEncoder`/`TextDecoder` instead.
- `btoa()` called directly on arbitrary strings: Works only for ASCII/Latin-1 content. Breaks on any markdown with typographic characters.
- Storing SHA after a write and reusing it: The commit SHA differs from the blob SHA; even if you capture the blob SHA from the write response, any concurrent write from another browser tab or MCP tool invalidates it.

---

## Open Questions

1. **Should `getFile` be usable by Phase 10/11 to pre-populate edit forms?**
   - What we know: Phase 10 (doc edit) needs to load the current doc content into a textarea. This is a read operation — `getFile` returns `{ sha, content }`. Phase 10 could use `getFile` to pre-load the textarea, but then the SHA from that pre-load is already potentially stale by save time.
   - What's unclear: Whether Phase 10 should call `getFile` twice (once to load for display, once fresh on save) or just once on save.
   - Recommendation: Phase 10 should load doc content from the existing `fetch('data/docs/slug.md')` relative path (which works for GitHub Pages) for display purposes. On save, `writeFile` internally fetches the fresh SHA via `getFile`. No need to expose SHA to Phase 10 callers at all. The `writeFile` API is simpler: `writeFile(path, content, commitMessage)` — callers never touch SHA.

2. **What commit message format to use?**
   - What we know: The GitHub API requires a non-empty `message` string. GitHub displays this in the repository commit history. The project uses conventional-ish commit messages in its planning (e.g., `docs(phase-08): complete phase execution`).
   - Recommendation: Use simple descriptive messages for browser-initiated commits: `"docs: update architecture.md"`, `"docs: create new-doc.md"`, `"docs: delete old-doc.md"`. Phase 10/11 can generate these from the file path and operation. The message does not need to be user-editable in v2.0.

3. **What happens if the token has insufficient permissions?**
   - What we know: The PAT entered in Phase 8 is verified only against `/user` (read permission). A token with no `repo` scope or no `Contents: write` fine-grained permission will pass `verifyToken()` but fail with 403 on write operations.
   - What's unclear: Whether to detect this at login time or surface it at write time.
   - Recommendation: Surface the error at write time with a clear error message. The module should throw an error with status 403; Phase 10/11 callers should display "Permission denied — ensure your PAT has Contents: write permission." Adding write-permission verification at login would require an additional API call and makes the auth flow more complex. Defer to write-time error for v2.0.

4. **Should the module handle the `data/docs/index.json` update atomically with the file write?**
   - What we know: Creating a new doc requires two writes: the `.md` file and the `index.json`. These are separate PUT requests. Failure of the second write leaves the repo in an inconsistent state (doc file exists but not in index).
   - Recommendation: Phase 9 exposes `writeFile` and `deleteFile` as primitives. Phase 10 orchestrates the two-write sequence (md file + index.json). The write queue ensures they are serialized. Document this expectation clearly in Phase 9's exported API comment so Phase 10 knows what to expect.

---

## Sources

### Primary (HIGH confidence)

- https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28 — Full Contents API: create, read, update, delete specs; SHA requirement; 409 Conflict note; Base64 requirement; committer optional behavior
- https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests — Confirmed `PUT` and `DELETE` in `Access-Control-Allow-Methods`; confirmed `Authorization`, `Content-Type` in `Access-Control-Allow-Headers`; confirmed `X-GitHub-Api-Version` is NOT in allow list
- https://developer.mozilla.org/en-US/docs/Web/API/Window/btoa — `InvalidCharacterError` behavior; `TextEncoder`/`TextDecoder` pattern for Unicode-safe Base64; `.replace(/\s/g, '')` for decode
- https://advancedweb.hu/how-to-serialize-calls-to-an-async-function/ — Minimal promise chain queue pattern; rejection-safe tail assignment

### Secondary (MEDIUM confidence)

- https://community.latenode.com/t/github-api-how-to-handle-409-conflict-errors-when-modifying-repository-files/1984 — SHA freshness as primary 409 prevention; confirmed by multiple community reports
- https://github.com/orgs/community/discussions/111029 — GitHub API Base64 decode issues; whitespace stripping approach identified
- https://github.com/orgs/community/discussions/134693 — Additional Base64 decode discussion; confirmed newline-wrapping in GitHub responses
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens — Fine-grained PAT: "Contents: Read and Write" required for write operations

### Tertiary (LOW confidence)

- WebSearch findings on JavaScript promise queue patterns — cross-verified with official pattern above; community consensus matches

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — GitHub API docs are authoritative; TextEncoder/btoa pattern is MDN-documented; fetch is browser-native
- Architecture: HIGH — Promise chain queue is a well-established pattern; SHA-fresh-before-write is the documented GitHub approach; module boundary is clear
- Pitfalls: HIGH — InvalidCharacterError and Base64 whitespace issues are confirmed by official MDN docs and GitHub community discussions; 409 Conflict cause is documented by GitHub; CORS header list is from official CORS docs

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (GitHub Contents API is stable; TextEncoder is a browser standard; promise patterns are language-level)
