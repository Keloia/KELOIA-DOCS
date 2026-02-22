# Phase 8: GitHub Auth - Research

**Researched:** 2026-02-22
**Domain:** Client-side PAT authentication, localStorage persistence, GitHub REST API token verification, vanilla JS UI gating
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | User can enter a GitHub Personal Access Token to authenticate | GitHub `/user` API endpoint verifies PAT with a single fetch; 200 = valid, 401 = invalid. Pattern: modal/inline form → fetch → store or reject. |
| AUTH-02 | Token is stored in localStorage and persists across sessions | `localStorage.setItem('ghToken', token)` / `getItem` — standard and sufficient. Token read at DOMContentLoaded to restore auth state. |
| AUTH-03 | User can log out (clears stored token) | `localStorage.removeItem('ghToken')` + UI state reset. Logout button visible only when authenticated. |
| AUTH-04 | Write UI controls (edit, add, delete, drag) are hidden when not authenticated and appear when authenticated | CSS class toggle on `<body>` (`body.authenticated`) controls visibility via `.auth-only { display: none }` / `body.authenticated .auth-only { display: ... }`. No per-element imperative toggling needed. |
</phase_requirements>

---

## Summary

Phase 8 is a client-side-only authentication layer. There is no OAuth callback, no server, and no session cookie. The user enters a GitHub Personal Access Token, the site verifies it by calling the GitHub `/user` REST API endpoint from the browser, and the token is stored in localStorage if valid. All "write" UI controls are hidden behind a CSS class toggle on the body element — when the body has class `authenticated`, those controls become visible.

The GitHub REST API fully supports CORS for browser-originated fetch requests, including the `Authorization` header, so the verification call works directly from a GitHub Pages origin with no proxy. The only security consideration worth noting is that localStorage is accessible to any JavaScript running on the page; since this site already uses DOMPurify to sanitize all markdown output, and the site has no user-controlled non-markdown inputs, the XSS attack surface is minimal and the risk is acceptable for a 1-2 user developer tool.

The phase requires no new npm dependencies, no CDN additions, and no changes to the MCP server. It is pure vanilla JS + CSS additions to `app.js` and `style.css`, plus a small sidebar HTML addition for the auth control area.

**Primary recommendation:** Use a body-class toggle pattern (`body.authenticated`) with CSS-driven visibility for write controls. Verify the PAT with a single `fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer TOKEN' } })` call. Store the raw token string in localStorage under a consistent key (e.g. `keloia_gh_token`).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| GitHub REST API `/user` | 2022-11-28 | Token verification | Official endpoint; no-scope fine-grained tokens can access it; returns 401 on invalid token |
| `localStorage` (native) | browser-native | Token persistence | Only persistent client-side storage available without a backend; appropriate for developer-tool PAT |
| Vanilla JS / CSS | — | UI state management | Existing project constraint: zero build step, no framework |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| DOMPurify (already loaded) | 3.x via CDN | XSS protection on rendered markdown | Already in project; ensures that no injected script can exfiltrate the stored token via DOM injection |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| localStorage | sessionStorage | sessionStorage clears on tab close, which violates AUTH-02 requirement for persistence across sessions |
| localStorage | In-memory JS variable | Resets on page reload — same problem as sessionStorage |
| `fetch` to `/user` | Octokit.js from CDN | ~130KB additional CDN load for a single verification call is unjustified; raw fetch is sufficient |
| Modal dialog for login | Inline sidebar form | Both patterns work; sidebar inline form is simpler for this SPA layout — avoids extra modal overlay CSS |

**Installation:** No new packages needed. Everything is native browser APIs and the existing GitHub REST API.

---

## Architecture Patterns

### Recommended Project Structure

No new files required. All changes go into existing files:

```
app.js         — auth state management, token read/write, verification fetch, UI gating
style.css      — .auth-only visibility rules, auth UI styling (login form, logout button)
index.html     — auth controls section added to sidebar (login input + button, logout button)
```

### Pattern 1: Body-Class Auth Gating (CSS-driven visibility)

**What:** A single class on `<body>` controls the visibility of all write UI elements. Elements that should only appear when authenticated get class `auth-only`. The CSS hides them by default and reveals them when `body.authenticated` is present.

**When to use:** When multiple UI elements across the page need to appear/disappear together based on a single state. Avoids imperative `element.style.display` scattered through the codebase.

**Example:**
```css
/* style.css — hide write controls by default */
.auth-only {
  display: none;
}

/* reveal when authenticated */
body.authenticated .auth-only {
  display: /* same as the element's natural display value: block, flex, etc. */;
}

/* show login UI only when NOT authenticated */
.unauth-only {
  display: /* natural value */;
}
body.authenticated .unauth-only {
  display: none;
}
```

```javascript
// app.js — toggle auth state
function setAuthState(token) {
  if (token) {
    document.body.classList.add('authenticated');
  } else {
    document.body.classList.remove('authenticated');
  }
}
```

### Pattern 2: PAT Verification via `/user` API

**What:** A single fetch to `https://api.github.com/user` with the token in the Authorization header. A 200 response means the token is valid. A 401 means invalid.

**When to use:** On login form submit (after user enters PAT). Also recommended at page load to re-verify the stored token before trusting it (tokens can be revoked or expired).

**Example:**
```javascript
// Source: https://docs.github.com/en/rest/users/users?apiVersion=2022-11-28
async function verifyToken(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    return res.ok; // true = 200, false = 401/403
  } catch (err) {
    // Network error (offline) — treat as unverifiable, not invalid
    return false;
  }
}
```

### Pattern 3: localStorage Token Persistence

**What:** Store and read the token key from localStorage on every page load. On DOMContentLoaded, read the stored token, re-verify it, then set auth state.

**Example:**
```javascript
const TOKEN_KEY = 'keloia_gh_token';

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function loadToken() {
  return localStorage.getItem(TOKEN_KEY); // null if not set
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// In DOMContentLoaded bootstrap:
const stored = loadToken();
if (stored) {
  const valid = await verifyToken(stored);
  if (valid) {
    setAuthState(stored);
  } else {
    clearToken(); // token was revoked or expired
    setAuthState(null);
  }
}
```

### Pattern 4: Sidebar Auth Controls (HTML structure)

**What:** A `nav-section` in the sidebar contains: (a) an unauth-only login area with a password-type input and a button, (b) an auth-only logout button. These swap visibility via the body-class pattern.

**Example (index.html addition):**
```html
<section class="nav-section" id="auth-section">
  <!-- Shown when NOT authenticated -->
  <div class="unauth-only">
    <input
      type="password"
      id="token-input"
      class="token-input"
      placeholder="GitHub PAT..."
      autocomplete="off"
    />
    <button id="login-btn" class="btn-auth">Login</button>
  </div>

  <!-- Shown when authenticated -->
  <div class="auth-only">
    <button id="logout-btn" class="btn-auth btn-logout">Logout</button>
  </div>
</section>
```

### Anti-Patterns to Avoid

- **Imperative per-element toggling:** Calling `element.style.display = 'none'` or `element.style.display = 'block'` on each write control individually. When more write controls are added in Phases 10–11, this approach creates maintenance debt. Use the body-class CSS pattern instead.
- **Storing token before verifying:** Saving to localStorage before the `/user` fetch returns 200. If the API call fails, a bad token gets persisted and the user is stuck with an error state on every page reload.
- **Assuming stored token is still valid without re-verification:** PATs can be revoked. Always re-verify the stored token at page load before applying `authenticated` state.
- **Using `Authorization: token` header format with fine-grained PATs:** GitHub documentation recommends `Authorization: Bearer TOKEN`. Both work for classic PATs, but `Bearer` is the documented current standard and works for all PAT types.
- **Blocking page load on auth verification:** The page should render normally while the stored token is being verified. Set auth state AFTER the verification resolves, not before first render.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token expiry detection | Custom expiry-tracking logic | Re-verify with `/user` at page load | PATs don't have expiry metadata accessible client-side; the API call IS the verification |
| Token scope validation | Parsing token prefix (`ghp_` vs `github_pat_`) | Let the API return 200/401 | Prefix parsing is fragile; fine-grained and classic PATs have different prefixes; a successful `/user` call is the ground truth |
| UI auth state persistence | Custom auth state serialization to localStorage | Store only the raw token string; derive state from token presence | State derivation from token is trivial and avoids stale state bugs |

**Key insight:** For a PAT-based auth flow, the GitHub API is both the auth provider and the validator. There is no need for a local auth library or JWT handling. The entire verification logic is one fetch call.

---

## Common Pitfalls

### Pitfall 1: X-GitHub-Api-Version CORS Error

**What goes wrong:** Adding `X-GitHub-Api-Version: 2022-11-28` header to the fetch request causes a CORS preflight failure in some browser/CDN configurations. A GitHub Docs issue (#24706) specifically documents this for Octokit in the browser.

**Why it happens:** The `X-GitHub-Api-Version` header may not be listed in the `Access-Control-Allow-Headers` response on some edge cached preflight responses.

**How to avoid:** Include `X-GitHub-Api-Version` in the fetch but test in browser to verify. If CORS preflight fails, omit the version header — the API defaults to the stable version and the `/user` endpoint is stable. `Accept: application/vnd.github+json` and `Authorization: Bearer` are confirmed to be in the allowed headers list per official CORS docs.

**Warning signs:** Browser console shows `CORS preflight` failure or `Access-Control-Allow-Headers` does not include the custom header.

### Pitfall 2: Storing Token Before Verification Completes

**What goes wrong:** Login button click handler saves token to localStorage, then calls `verifyToken()`. If verification fails, the bad token is already persisted.

**Why it happens:** Optimistic writes without awaiting the verification result.

**How to avoid:** Await verification before saving:
```javascript
loginBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  const valid = await verifyToken(token);
  if (valid) {
    saveToken(token);
    setAuthState(token);
    tokenInput.value = '';
  } else {
    // Show error — do NOT save
    showLoginError('Invalid token. Please check and try again.');
  }
});
```

### Pitfall 3: Auth State Out of Sync on Navigation

**What goes wrong:** `router()` calls `renderKanban()` or `renderDoc()` which re-renders the main content. If write controls are injected into main content (not the sidebar), they get replaced on navigation and lose their auth-gated state.

**Why it happens:** Mixing auth-gated controls into dynamically rendered view content.

**How to avoid:** Put the login/logout controls in the sidebar (static HTML). For Phase 8, no write controls need to be in the main content area yet (those come in Phases 10–11 for doc CRUD and Phase 11 for kanban DnD). The body-class CSS pattern handles controls in static HTML automatically without needing to re-apply state after navigation.

### Pitfall 4: Token Input as type="text"

**What goes wrong:** Using `type="text"` for the PAT input shows the token characters in plaintext, which would be visible to anyone looking at the screen.

**Why it happens:** Default input type.

**How to avoid:** Use `type="password"`. The token will be masked. Label the input clearly ("GitHub PAT" or "Personal Access Token") so the user understands what to paste.

### Pitfall 5: Rate-Limiting the Verification Call

**What goes wrong:** Multiple rapid calls to `/user` during development/testing hit GitHub's rate limit (60/hour unauthenticated, but authenticated requests count against the token's 5,000/hour limit). More importantly, if the stored token verification is re-triggered on every hashchange/navigation, it fires many times per session.

**Why it happens:** Calling `verifyToken()` from inside `router()` rather than only at page load.

**How to avoid:** Call stored-token verification exactly once at `DOMContentLoaded`. Cache the auth state in a module-level variable. Only call verification again explicitly when the user submits a new token.

---

## Code Examples

Verified patterns from official sources and confirmed behavior:

### Complete Login Flow
```javascript
// Source: https://docs.github.com/en/rest/users/users
const TOKEN_KEY = 'keloia_gh_token';
let currentToken = null; // module-level auth state cache

async function verifyToken(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    return res.ok;
  } catch {
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

// Bootstrap: restore from localStorage
async function initAuth() {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored) {
    const valid = await verifyToken(stored);
    if (valid) {
      setAuthState(stored);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      setAuthState(null);
    }
  }
}

// Login handler
document.getElementById('login-btn').addEventListener('click', async () => {
  const token = document.getElementById('token-input').value.trim();
  if (!token) return;
  const valid = await verifyToken(token);
  if (valid) {
    localStorage.setItem(TOKEN_KEY, token);
    setAuthState(token);
    document.getElementById('token-input').value = '';
  } else {
    // show inline error
  }
});

// Logout handler
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  setAuthState(null);
});
```

### Exported Token Accessor for Later Phases
```javascript
// Getter so Phase 9 (GitHub API writes) can access the current token
function getAuthToken() {
  return currentToken;
}
```

### CSS Auth Gating Pattern
```css
/* Write controls hidden by default */
.auth-only {
  display: none;
}

/* Login UI hidden when authenticated */
body.authenticated .unauth-only {
  display: none;
}

/* Write controls visible when authenticated */
body.authenticated .auth-only {
  display: block; /* or flex, inline-block — depends on element */
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Authorization: token TOKEN` | `Authorization: Bearer TOKEN` | GitHub docs updated ~2022-2023 with API versioning | Both still work for classic PATs; `Bearer` is documented standard and works for fine-grained PATs too |
| 60 req/hr unauthenticated was reliable | GitHub tightened unauthenticated limits (May 2025) | May 2025 — GitHub rate limit crackdown | Verification call must succeed before user is put into auth state — cannot rely on anonymous API access |
| OAuth implicit flow for SPAs | PAT entry (as specified for this project) | N/A | AUTH-05 (full OAuth) is deferred to Future Requirements; PAT flow is the explicit v2.0 choice |

**Deprecated/outdated:**
- `Authorization: token TOKEN` header: Still functional but not the documented recommendation. Use `Bearer`.
- Storing token in sessionStorage: Violates AUTH-02 (must persist across sessions).

---

## Open Questions

1. **Should the login UI be in the sidebar or a modal overlay?**
   - What we know: Both are technically viable. The existing site uses the sidebar for all controls (search, nav). A modal requires overlay CSS and focus-trap handling.
   - What's unclear: User preference. No CONTEXT.md was found, so no locked decision exists.
   - Recommendation: Use a sidebar inline form (consistent with existing patterns, simpler implementation). A `<section class="nav-section">` at the bottom of the sidebar matches existing structure. No modal needed for login.

2. **Should `initAuth()` block `router()` during page load?**
   - What we know: Awaiting `initAuth()` before `router()` means the main content does not render until the `/user` API call resolves (~200-500ms). Not awaiting means the page shows unauthenticated state briefly even if the token is valid.
   - What's unclear: Whether the brief flash of unauthenticated state (hidden write controls) is acceptable. Since Phase 8 adds no write controls to the main content (only sidebar controls), this flash is invisible.
   - Recommendation: Run `initAuth()` in parallel with `populateDocList()` and `router()` using `Promise.all` or by not awaiting in the bootstrap sequence. Auth state is sidebar-only in Phase 8, so the flash has no visible effect.

3. **What loading/error feedback to show during token verification?**
   - What we know: The verification fetch takes ~200-500ms. No feedback during this window creates uncertainty for the user.
   - Recommendation: Disable the login button and show a brief "Verifying..." text during the fetch. On error, show an inline message "Invalid token" near the input. Keep error UI simple — one line of text, no toast system needed.

---

## Sources

### Primary (HIGH confidence)
- https://docs.github.com/en/rest/users/users?apiVersion=2022-11-28 — `/user` endpoint spec, response structure, Authorization header format
- https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api — PAT authentication requirements, 401 error behavior
- https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests — CORS support confirmed for browser fetch with Authorization header
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — Rate limits: 60/hr unauthenticated, 5000/hr authenticated
- https://news.ycombinator.com/item?id=43936992 — GitHub unauthenticated rate limit tightening (May 2025)

### Secondary (MEDIUM confidence)
- https://github.com/github/docs/issues/24706 — CORS issue with `X-GitHub-Api-Version` header in browser context (Octokit issue, verified as real but specific conditions unclear)
- https://pragmaticwebsecurity.com/articles/oauthoidc/localstorage-xss.html — Nuanced analysis of localStorage token storage risk for SPAs with DOMPurify protection
- WebSearch results on classic vs fine-grained PAT authorization header format — multiple sources agree `Bearer` is preferred

### Tertiary (LOW confidence)
- WebSearch findings on modal vs inline login patterns — community pattern, no single authoritative source

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — GitHub API docs are authoritative; localStorage is a browser standard; no third-party libraries involved
- Architecture: HIGH — Body-class CSS pattern is well-established and consistent with existing project code style
- Pitfalls: MEDIUM — CORS issue with X-GitHub-Api-Version is sourced from a real GitHub issue; rate-limit behavior sourced from confirmed community reports; token-before-verify pitfall is logic-level, not source-verified

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (GitHub API auth changes infrequently; localStorage behavior is stable)
