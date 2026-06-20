/**
 * PageScoreIQ — client-side auth helper (JWT).
 *
 * Tokens live in localStorage. authFetch() attaches the access token and, on a
 * 401, transparently uses the refresh token to get a new pair and retries once.
 */
(function (global) {
  const ACCESS_KEY = "psiq_access";
  const REFRESH_KEY = "psiq_refresh";
  const USER_KEY = "psiq_user";

  function saveAuth(result) {
    if (result.accessToken) localStorage.setItem(ACCESS_KEY, result.accessToken);
    if (result.refreshToken) localStorage.setItem(REFRESH_KEY, result.refreshToken);
    if (result.user) localStorage.setItem(USER_KEY, JSON.stringify(result.user));
  }

  function clearAuth() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  }

  const getAccess = () => localStorage.getItem(ACCESS_KEY);
  const getRefresh = () => localStorage.getItem(REFRESH_KEY);
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; }
  }

  /** Redirect to /login unless an access token is present. */
  function requireAuth() {
    if (!getAccess()) { window.location.href = "/login"; return false; }
    return true;
  }

  async function tryRefresh() {
    const refreshToken = getRefresh();
    if (!refreshToken) return false;
    try {
      const r = await fetch("/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      const j = await r.json();
      if (r.ok && j.success) { saveAuth(j); return true; }
    } catch (_) {}
    return false;
  }

  /** fetch() with the bearer token attached + one transparent refresh-and-retry on 401. */
  async function authFetch(url, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + getAccess() });
    let resp = await fetch(url, Object.assign({}, opts, { headers }));
    if (resp.status === 401 && (await tryRefresh())) {
      const retryHeaders = Object.assign({}, opts.headers, { Authorization: "Bearer " + getAccess() });
      resp = await fetch(url, Object.assign({}, opts, { headers: retryHeaders }));
    }
    return resp;
  }

  /** Best-effort server-side logout, then clear local tokens and go to /login. */
  async function logout() {
    const refreshToken = getRefresh();
    try {
      await fetch("/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch (_) {}
    clearAuth();
    window.location.href = "/login";
  }

  global.PSIQAuth = {
    saveAuth, clearAuth, getAccess, getRefresh, getUser, requireAuth, authFetch, logout,
  };
})(window);
