/**
 * pool.js
 * ------------------------------------------------------------
 * InsightRecoder v0.7 — optional GitHub-Issues-backed "Insight Pool"
 * that lets multiple users share inspirations without breaking
 * the v0.6.2 local-first default.
 *
 * Architecture
 *   - This module is a *thin client* of the GitHub REST API. The
 *     only network calls are to `https://api.github.com`. No
 *     server of our own; no LLM calls. CORS is allowed by GitHub
 *     for the endpoints we use.
 *   - Read (`fetchAll`) is unauthenticated for public repos and
 *     is rate-limited by IP (60/hr). Write (`publish` / `react` /
 *     `unreact`) requires a fine-grained PAT with `issues: write`
 *     scope. The token is supplied by the user in Settings and
 *     stored in localStorage. It is NEVER written to a URL, a
 *     log line, or the exported JSON.
 *   - The Pool class keeps an in-memory `cache: Map` of the most
 *     recent `fetchAll` result plus a `lastSync` timestamp. The
 *     Storage layer is the source of truth across reloads; the
 *     in-memory cache lets us render the Pool tab in <1 frame on
 *     a warm cache. `isStale(ttlMs)` is the gate for triggering
 *     a network fetch.
 *
 *   - Errors are typed so the UI can show a friendly toast:
 *     `PoolAuthError` (401/403 with bad credentials),
 *     `PoolRateLimit` (403 with rate-limit headers), and
 *     `PoolNetworkError` (network down, CORS, parse failure).
 *     `PoolNotConfigured` is thrown by `publish`/`react`/
 *     `unreact` when no PAT is set.
 *
 * No build step. This file uses ESM `export` so the smoke test
 * (`e2e-pool.mjs`) can import the same class the browser uses.
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} PoolOrigin
 * @property {string} owner
 * @property {string} repo
 * @property {number} number
 * @property {string} htmlUrl
 */

/**
 * @typedef {Object} PoolAuthor
 * @property {string} login
 * @property {string} [avatar]
 */

/**
 * @typedef {Object} PoolInspiration
 * @property {string} id            'pool-<issue number>'
 * @property {string} text          title (preferred) or first body line
 * @property {string} [body]        full body text (for the side panel)
 * @property {number} createdAt
 * @property {string[]} tags        from labels
 * @property {'pool'} source
 * @property {PoolOrigin} origin
 * @property {PoolAuthor} author
 * @property {Object<string, number>} reactions
 * @property {'+1'|'-1'|null} myReaction  set locally from getReactions()
 * @property {boolean} isLocal      always false for pool items
 */

// Custom error classes. Exported individually so the UI can
// `instanceof`-check them and choose a different toast copy.
export class PoolAuthError extends Error {
  constructor(message = 'Pool auth failed', details) {
    super(message);
    this.name = 'PoolAuthError';
    if (details) this.details = details;
  }
}
export class PoolRateLimit extends Error {
  constructor(message = 'GitHub rate limit reached', retryAfterSec) {
    super(message);
    this.name = 'PoolRateLimit';
    if (typeof retryAfterSec === 'number') this.retryAfterSec = retryAfterSec;
  }
}
export class PoolNotConfigured extends Error {
  constructor(message = 'Pool is not configured (no token or owner/repo)') {
    super(message);
    this.name = 'PoolNotConfigured';
  }
}
export class PoolNetworkError extends Error {
  constructor(message = 'Pool network error', cause) {
    super(message);
    this.name = 'PoolNetworkError';
    if (cause) this.cause = cause;
  }
}

const DEFAULT_BASE_URL = 'https://api.github.com';

/**
 * Normalize the various reaction count shapes the GitHub API
 * returns. The Issue payload does NOT include a `reactions`
 * object; you have to hit the `/reactions` sub-endpoint to get
 * the count, OR include `Accept: application/vnd.github.squirrel-girl-preview`
 * to get it inline as `{ '+1': 3, '-1': 0, ... }`. We use the
 * preview header so the call stays to one round trip. The keys
 * can be either string or identifier form depending on the
 * endpoint, so we normalize.
 * @param {Object|null|undefined} raw
 * @returns {Object<string, number>}
 */
function normalizeReactions(raw) {
  const out = { '+1': 0, '-1': 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (typeof v !== 'number') continue;
    // GitHub returns keys like '+1' (string) for some previews
    // and '+1' as a literal symbol for others. We just keep the
    // string form internally.
    out[String(k)] = v;
  }
  return out;
}

/**
 * Parse an ISO date string into epoch ms, falling back to
 * `Date.now()` on parse failure. We never throw on a bad date —
 * the UI should still render the card even if `updated_at` is
 * malformed.
 * @param {string|null|undefined} iso
 */
function toEpochMs(iso) {
  if (!iso) return Date.now();
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Date.now();
}

/**
 * GitHubIssuePool — see module header for design notes.
 *
 * Constructor arguments:
 *   { owner, repo, token?, baseUrl? }
 *
 * `token` is optional. A read-only pool (used for browsing a
 * public repo) is constructed with no token. The instance
 * stores the config in memory; persistence is the caller's job
 * (typically `Storage.setPoolConfig`). The constructor does NOT
 * call any GitHub endpoints.
 */
export class GitHubIssuePool {
  constructor({ owner, repo, token, baseUrl } = {}) {
    if (!owner || !repo) {
      throw new Error('GitHubIssuePool: owner and repo are required');
    }
    this.owner = String(owner);
    this.repo = String(repo);
    this.token = token ? String(token) : null;
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    /** @type {Map<string, PoolInspiration>} */
    this.cache = new Map();
    this.lastSync = null;
  }

  // ---- public config surface (mirrors Storage.getPoolConfig) ----
  getConfig() {
    return { owner: this.owner, repo: this.repo, token: this.token, baseUrl: this.baseUrl };
  }
  setConfig({ owner, repo, token, baseUrl } = {}) {
    if (owner) this.owner = String(owner);
    if (repo)  this.repo  = String(repo);
    if (token != null) this.token = token ? String(token) : null;
    if (baseUrl) this.baseUrl = String(baseUrl).replace(/\/+$/, '');
  }

  // ---- cache helpers (in-memory + persisted via storage) ----
  /**
   * @returns {PoolInspiration[]}
   */
  getCache() {
    return Array.from(this.cache.values());
  }

  /**
   * Replace the cache with a fresh list. Dedupes by `.id`
   * (which is `pool-<issue number>`).
   * @param {PoolInspiration[]} list
   */
  setCache(list) {
    this.cache = new Map();
    if (!Array.isArray(list)) return;
    for (const it of list) {
      if (!it || !it.id) continue;
      this.cache.set(it.id, it);
    }
    this.lastSync = Date.now();
  }

  /**
   * Return true if the cache is older than `ttlMs` (default
   * 5 minutes). A null `lastSync` is always stale. We use `>=`
   * (not `>`) so `isStale(0)` returns true as soon as
   * `lastSync` is set — at the same ms tick `Date.now()` may
   * not have advanced, and the caller usually wants "trigger a
   * refresh on the next event loop tick" semantics.
   * @param {number} [ttlMs]
   * @returns {boolean}
   */
  isStale(ttlMs = 5 * 60 * 1000) {
    if (this.lastSync == null) return true;
    return (Date.now() - this.lastSync) >= ttlMs;
  }

  // ---- request helper ----
  /**
   * @param {string} path  e.g. `/repos/{owner}/{repo}/issues`
   * @param {Object} [opts]
   * @param {'GET'|'POST'|'DELETE'} [opts.method]
   * @param {Object} [opts.body]
   * @param {Object} [opts.headers]
   * @param {AbortSignal} [opts.signal]
   * @param {boolean} [opts.requiresAuth]
   * @returns {Promise<{ ok: boolean, status: number, json: any, headers: Headers }>}
   */
  async _request(path, opts = {}) {
    const method = opts.method || 'GET';
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    };
    // Inline the squirrel-girl reactions preview so the
    // issues list call returns the reaction counts without a
    // second round trip per issue.
    headers['Accept'] = `${headers['Accept']},application/vnd.github.squirrel-girl-preview+json`;

    if (this.token) headers['Authorization'] = `token ${this.token}`;
    let body;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const url = `${this.baseUrl}${path}`;
    const fetchOpts = { method, headers };
    if (body) fetchOpts.body = body;
    if (opts.signal) fetchOpts.signal = opts.signal;

    let res;
    try {
      res = await fetch(url, fetchOpts);
    } catch (err) {
      throw new PoolNetworkError(`Network error contacting ${url}`, err);
    }

    let json = null;
    // Some endpoints (e.g. 204 No Content for delete) have no body.
    // Use the .json() method when present (real fetch + the
    // test fixture both expose it). Fall back to .text() if
    // the response object only has a text body (some test
    // shims and certain non-spec fetch implementations).
    if (typeof res.json === 'function') {
      try { json = await res.json(); }
      catch (err) {
        if (!res.ok) {
          throw new PoolNetworkError(
            `JSON parse failed on status ${res.status} from ${url}: ${(err && err.message) || 'unknown'}`,
            err
          );
        }
        // 2xx with non-JSON body is unusual but not fatal; keep `json = null`.
      }
    } else if (typeof res.text === 'function') {
      const text = await res.text().catch(() => '');
      if (text) {
        try { json = JSON.parse(text); }
        catch (err) {
          if (!res.ok) {
            throw new PoolNetworkError(
              `Non-JSON response (status ${res.status}) from ${url}: ${text.slice(0, 200)}`,
              err
            );
          }
        }
      }
    }

    if (!res.ok) {
      if (res.status === 401 || (res.status === 403 && json && /Bad credentials/i.test(json.message || ''))) {
        throw new PoolAuthError(`GitHub auth failed: ${(json && json.message) || res.statusText}`);
      }
      if (res.status === 403 && json && /rate limit/i.test(json.message || '')) {
        let ra = 0;
        try {
          ra = Number(res.headers && typeof res.headers.get === 'function'
            ? res.headers.get('x-ratelimit-reset')
            : 0) || 0;
        } catch (_) { ra = 0; }
        const retryAfterSec = ra > 0 ? Math.max(0, ra - Math.floor(Date.now() / 1000)) : 60;
        throw new PoolRateLimit('GitHub rate limit reached', retryAfterSec);
      }
      if (res.status === 404) {
        // 404 on `/repos/.../issues` usually means the repo is
        // private and the token is missing/insufficient, or the
        // repo simply doesn't exist. Surface as auth so the user
        // is prompted to check the config rather than chasing a
        // network bug.
        throw new PoolAuthError(`Repo not found or not accessible: ${this.owner}/${this.repo}`);
      }
      const msg = (json && json.message) || res.statusText || `HTTP ${res.status}`;
      throw new PoolNetworkError(`GitHub API error ${res.status}: ${msg}`);
    }

    return { ok: res.ok, status: res.status, json, headers: res.headers };
  }

  _requireConfigured() {
    if (!this.token) {
      throw new PoolNotConfigured('Pool token is required for this operation');
    }
  }

  // ---- fetchAll ----
  /**
   * Fetch all OPEN issues from the configured repo and convert
   * them to `PoolInspiration[]`. Pull requests (entries with a
   * `pull_request` field) are filtered out.
   *
   * The `since` parameter maps to GitHub's `since` query — it
   * returns issues updated at-or-after that ISO timestamp. We
   * pass it through unchanged. `perPage` defaults to 50; max
   * 100 (GitHub's cap). We only fetch page 1; pagination is
   * out of scope for the MVP.
   *
   * @param {{ since?: string, perPage?: number, signal?: AbortSignal }} [opts]
   * @returns {Promise<PoolInspiration[]>}
   */
  async fetchAll({ since, perPage = 50, signal } = {}) {
    const perPageClamped = Math.max(1, Math.min(100, Number(perPage) || 50));
    const params = new URLSearchParams();
    params.set('state', 'open');
    params.set('per_page', String(perPageClamped));
    params.set('page', '1');
    if (since) params.set('since', since);
    const path = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/issues?${params.toString()}`;
    const { json } = await this._request(path, { method: 'GET', signal });

    if (!Array.isArray(json)) {
      // Some error responses aren't caught by _request's status
      // check (e.g. CORS preflight failure on a 200 with text
      // body). Treat as a network error.
      throw new PoolNetworkError('fetchAll: response was not an array of issues');
    }

    const out = [];
    for (const raw of json) {
      if (!raw || typeof raw !== 'object') continue;
      if (raw.pull_request) continue;  // skip PRs
      const number = Number(raw.number);
      if (!Number.isFinite(number)) continue;

      const labels = Array.isArray(raw.labels)
        ? raw.labels.map((l) => (l && typeof l === 'object' ? String(l.name || '').toLowerCase() : '')).filter(Boolean)
        : [];
      const title = String(raw.title || '').trim();
      const body = String(raw.body || '').trim();
      const text = title || (body ? body.slice(0, 80).replace(/\s+/g, ' ').trim() : '(empty)');
      const author = (raw.user && typeof raw.user === 'object')
        ? { login: String(raw.user.login || 'unknown'), avatar: raw.user.avatar_url ? String(raw.user.avatar_url) : undefined }
        : { login: 'unknown' };
      out.push({
        id: 'pool-' + number,
        number,
        text,
        body: body || undefined,
        createdAt: toEpochMs(raw.created_at),
        updatedAt: toEpochMs(raw.updated_at),
        tags: labels.slice(0, 5),
        source: 'pool',
        isLocal: false,
        origin: {
          owner: this.owner,
          repo: this.repo,
          number,
          htmlUrl: String(raw.html_url || `https://github.com/${this.owner}/${this.repo}/issues/${number}`),
        },
        author,
        reactions: normalizeReactions(raw.reactions),
        myReaction: null,
      });
    }

    this.setCache(out);
    return out;
  }

  // ---- publish ----
  /**
   * Create a new issue from an inspiration record.
   *
   * @param {{ text: string, tags?: string[] }} inspiration
   * @returns {Promise<{ number: number, html_url: string, node_id: string }>}
   */
  async publish(inspiration) {
    this._requireConfigured();
    const text = String((inspiration && inspiration.text) || '').trim();
    if (!text) throw new Error('publish: inspiration.text is required');
    const labels = Array.isArray(inspiration && inspiration.tags)
      ? inspiration.tags.slice(0, 5).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const title = text.length > 80 ? text.slice(0, 77) + '…' : text;
    const bodyLines = [
      text,
      '',
      '—',
      `Captured with [InsightRecoder v0.7](https://github.com/DarrenWongKaWa/ideaminer-mvp)`,
    ];
    const path = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/issues`;
    const { json } = await this._request(path, {
      method: 'POST',
      body: { title, body: bodyLines.join('\n'), labels },
    });
    if (!json || typeof json !== 'object' || typeof json.number !== 'number') {
      throw new PoolNetworkError('publish: response missing issue number');
    }
    return {
      number: json.number,
      html_url: String(json.html_url || ''),
      node_id: String(json.node_id || ''),
    };
  }

  // ---- react / unreact ----
  /**
   * Add a reaction to an issue.
   *
   * @param {number} number  issue number
   * @param {'+1'|'-1'|'laugh'|'hooray'|'confused'|'heart'|'rocket'|'eyes'} content
   * @returns {Promise<{ id: number, content: string }>}
   */
  async react(number, content) {
    this._requireConfigured();
    const num = Number(number);
    if (!Number.isFinite(num)) throw new Error('react: number must be a finite integer');
    const path = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/issues/${num}/reactions`;
    const { status, json } = await this._request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.github.text+json' },
      body: { content: String(content) },
    });
    if (status === 200 && json && typeof json === 'object') {
      return { id: Number(json.id) || 0, content: String(json.content || content) };
    }
    // Some preview responses return 201 with the same shape.
    if (json && typeof json === 'object' && json.content) {
      return { id: Number(json.id) || 0, content: String(json.content) };
    }
    return { id: 0, content: String(content) };
  }

  /**
   * Remove the user's existing reaction of a given content. The
   * GitHub API requires the reaction id, so this method first
   * lists the reactions on the issue, finds the one matching
   * `content`, and DELETEs it. If no matching reaction exists,
   * the call is a no-op.
   *
   * @param {number} number
   * @param {string} content
   * @returns {Promise<{ removed: boolean }>}
   */
  async unreact(number, content) {
    this._requireConfigured();
    const num = Number(number);
    if (!Number.isFinite(num)) throw new Error('unreact: number must be a finite integer');
    const listPath = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/issues/${num}/reactions?per_page=100`;
    const list = await this._request(listPath, {
      method: 'GET',
      headers: { 'Accept': 'application/vnd.github.squirrel-girl-preview+json' },
    });
    if (!Array.isArray(list.json)) {
      throw new PoolNetworkError('unreact: could not list reactions');
    }
    const mine = list.json.find((r) => r && r.content === content);
    if (!mine || typeof mine.id !== 'number') {
      return { removed: false };
    }
    const delPath = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/issues/${num}/reactions/${mine.id}`;
    await this._request(delPath, { method: 'DELETE' });
    return { removed: true };
  }
}
