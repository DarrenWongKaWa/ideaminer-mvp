/**
 * storage.js
 * ------------------------------------------------------------
 * Abstract Storage interface + LocalStorageProvider implementation
 * for InsightRecoder v0.6.
 *
 * v0.6 data model:
 *   - inspiration: { id, text, createdAt, tags[], source }
 *   - link:        { source, target, score, kind: 'inferred'|'pinned', createdAt }
 *
 * localStorage keys:
 *   - insightrecoder.inspirations.v1   array, newest first
 *   - insightrecoder.links.v1          array
 *   - insightrecoder.profile.v1        { field, direction, age }
 *   - insightrecoder.provider.v1       ProviderSettings (settings page only)
 *
 * The class also implements an in-memory mirror so the smoke test
 * can run in node without a window. (Same `_hasLS / _mem` pattern
 * as v0.5.x — see git history.)
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} Inspiration
 * @property {string} id
 * @property {string} text
 * @property {number} createdAt    epoch ms
 * @property {string[]} [tags]     lowercase, deduped
 * @property {'text'|'voice'} [source]
 */

/**
 * @typedef {Object} Link
 * @property {string} source
 * @property {string} target
 * @property {number} score
 * @property {'inferred'|'pinned'} kind
 * @property {number} createdAt
 */

/**
 * @typedef {Object} ResearchProfile
 * @property {string} field
 * @property {string} direction
 * @property {string} age
 */

const KEYS = {
  profile:       'insightrecoder.profile.v1',
  inspirations:  'insightrecoder.inspirations.v1',
  links:         'insightrecoder.links.v1',
  // v0.7 — Insight Pool (GitHub-Issues-backed multi-user layer)
  poolConfig:    'insightrecoder.pool-config.v1',
  poolCache:     'insightrecoder.pool-cache.v1',
  poolReactions: 'insightrecoder.pool-reactions.v1',
  // Legacy v0.5.x keys — read once on boot for one-shot migration,
  // then deleted. The v0.6.0 migration only handled user-ideas, which
  // is why users who had saved/favorite ideas (ideaminer.saved.v1) or
  // feedback history (ideaminer.feedback.v1) saw their data
  // "disappear" after upgrading. v0.6.2 migrates all four legacy keys.
  legacyUserIdeas: 'ideaminer.user-ideas.v1',
  legacySaved:     'ideaminer.saved.v1',
  legacyFeedback:  'ideaminer.feedback.v1',
  legacyProfile:   'ideaminer.profile.v1',
};

export class Storage {
  // Profile (kept from v0.5.x; used by #/profile)
  getProfile() { throw new Error('not implemented'); }
  setProfile(_p) { throw new Error('not implemented'); }

  // Inspirations
  addInspiration(_draft) { throw new Error('not implemented'); }
  getInspirations() { throw new Error('not implemented'); }
  getInspiration(_id) { throw new Error('not implemented'); }
  deleteInspiration(_id) { throw new Error('not implemented'); }
  updateInspiration(_id, _patch) { throw new Error('not implemented'); }

  // Links
  addLink(_source, _target, _score, _kind) { throw new Error('not implemented'); }
  removeLink(_source, _target) { throw new Error('not implemented'); }
  getLinks() { throw new Error('not implemented'); }
  getPinnedLinks() { throw new Error('not implemented'); }

  // Migration (legacy)
  migrateLegacyUserIdeas() { throw new Error('not implemented'); }

  // Pool (v0.7 — optional GitHub-Issues-backed multi-user layer)
  getPoolConfig() { throw new Error('not implemented'); }
  setPoolConfig(_cfg) { throw new Error('not implemented'); }
  getPoolCache() { throw new Error('not implemented'); }
  setPoolCache(_list) { throw new Error('not implemented'); }
  getReactions() { throw new Error('not implemented'); }
  setReaction(_number, _content) { throw new Error('not implemented'); }
  setPoolOrigin(_id, _origin) { throw new Error('not implemented'); }
}

export class LocalStorageProvider extends Storage {
  constructor() {
    super();
    this._hasLS = (() => {
      try {
        const t = '__ir_test__';
        window.localStorage.setItem(t, '1');
        window.localStorage.removeItem(t);
        return true;
      } catch (_) {
        return false;
      }
    })();
    this._mem = {
      profile: null,
      inspirations: [],
      links: [],
      poolConfig: null,
      poolCache: [],
      poolReactions: {},
    };
  }

  _read(key, fallback) {
    if (!this._hasLS) {
      const memKey = this._memKey(key);
      if (memKey && memKey in this._mem) return this._mem[memKey];
      return fallback;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  /**
   * Custom error class so the UI can distinguish "storage full" from
   * other failures (which are silently absorbed for resilience). When
   * quota is exceeded, the public method rolls back its in-memory
   * mirror and re-throws; the UI catches this and shows a friendly
   * "Storage full — clear some data in Settings" toast. This prevents
   * silent data loss where the UI says "Saved" but the next page
   * reload finds nothing.
   */
  static StorageFullError = class StorageFullError extends Error {
    constructor(message = 'localStorage quota exceeded') {
      super(message);
      this.name = 'StorageFullError';
    }
  };

  _write(key, val) {
    if (!this._hasLS) {
      // Node smoke-test path: keep the mirror consistent.
      const memKey = this._memKey(key);
      if (memKey) this._mem[memKey] = val;
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(val));
      // Mirror only after the write succeeds, so a quota error
      // never leaves the in-memory state ahead of persisted state.
      const memKey = this._memKey(key);
      if (memKey) this._mem[memKey] = val;
    } catch (err) {
      if (err && (err.name === 'QuotaExceededError'
          || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
          || (typeof DOMException !== 'undefined' && err instanceof DOMException
              && err.code === DOMException.QUOTA_EXCEEDED_ERR))) {
        throw new LocalStorageProvider.StorageFullError(
          `localStorage quota exceeded while writing ${key}`
        );
      }
      // Other failures (security, disabled storage) — degrade silently
      // to keep the app responsive. The next page reload will start
      // fresh from localStorage and the user will see what persisted.
    }
  }

  _memKey(lsKey) {
    if (lsKey === KEYS.profile)       return 'profile';
    if (lsKey === KEYS.inspirations)  return 'inspirations';
    if (lsKey === KEYS.links)         return 'links';
    if (lsKey === KEYS.poolConfig)    return 'poolConfig';
    if (lsKey === KEYS.poolCache)     return 'poolCache';
    if (lsKey === KEYS.poolReactions) return 'poolReactions';
    return null;
  }

  // ---- Profile ----
  getProfile() {
    const v = this._read(KEYS.profile, null);
    return v && typeof v === 'object' ? v : null;
  }
  setProfile(profile) {
    this._write(KEYS.profile, profile);
  }

  // ---- Inspirations ----
  _newInspirationId() {
    return 'insp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * @param {{ text: string, tags?: string[], source?: 'text'|'voice' }} draft
   * @returns {Inspiration}
   */
  addInspiration(draft) {
    const text = String((draft && draft.text) || '').trim();
    if (!text) {
      throw new Error('addInspiration: text is required');
    }
    const tags = Array.isArray(draft && draft.tags)
      ? Array.from(new Set(draft.tags.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean)))
      : [];
    const source = draft && (draft.source === 'voice' || draft.source === 'text') ? draft.source : 'text';
    const record = {
      id: this._newInspirationId(),
      text,
      createdAt: Date.now(),
      tags,
      source,
    };
    // Copy the list before mutating so a failed _write can roll back
    // without leaving the in-memory state modified. The in-memory
    // mirror is what getInspirations() returns; we only want to
    // mirror to it after a successful write.
    const current = this.getInspirations();
    const list = [record, ...current];
    try {
      this._write(KEYS.inspirations, list);
    } catch (err) {
      if (err && err.name === 'StorageFullError') {
        throw err;
      }
      throw err;
    }
    return record;
  }

  /** @returns {Inspiration[]} newest first */
  getInspirations() {
    const v = this._read(KEYS.inspirations, []);
    return Array.isArray(v) ? v : [];
  }

  /** @param {string} id @returns {Inspiration|null} */
  getInspiration(id) {
    if (!id) return null;
    return this.getInspirations().find((x) => x.id === id) || null;
  }

  /**
   * @param {string} id
   * @returns {boolean} true if removed, false if not found
   */
    deleteInspiration(id) {
    if (!id) return false;
    const list = this.getInspirations();
    const next = list.filter((x) => x.id !== id);
    if (next.length === list.length) return false;
    // Snapshot the in-memory list + links so we can roll back on quota.
    const prevList = list.slice();
    const links = this.getLinks();
    const nextLinks = links.filter((l) => l.source !== id && l.target !== id);
    try {
      this._write(KEYS.inspirations, next);
      if (nextLinks.length !== links.length) this._write(KEYS.links, nextLinks);
    } catch (err) {
      if (err && err.name === 'StorageFullError') {
        // Restore the original in-memory list; the in-memory mirror
        // is already untouched (since _write now only mirrors on
        // success), but be explicit for readers tracing this code.
        this._mem.inspirations = prevList;
        throw err;
      }
      throw err;
    }
    return true;
  }

  /**
   * @param {string} id
   * @param {Partial<Inspiration>} patch
   * @returns {Inspiration|null}
   */
  updateInspiration(id, patch) {
    if (!id || !patch) return null;
    const list = this.getInspirations();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    const next = { ...list[idx] };
    if ('text' in patch) next.text = String(patch.text || '').trim();
    if ('tags' in patch && Array.isArray(patch.tags)) {
      next.tags = Array.from(new Set(patch.tags.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean)));
    }
    if ('source' in patch) next.source = patch.source === 'voice' ? 'voice' : 'text';
    list[idx] = next;
    this._write(KEYS.inspirations, list);
    return next;
  }

  // ---- Links ----
  /**
   * @param {string} source
   * @param {string} target
   * @param {number} score   0..1
   * @param {'inferred'|'pinned'} kind
   */
  addLink(source, target, score, kind) {
    if (!source || !target || source === target) return;
    const list = this.getLinks();
    // Dedupe by (source,target) regardless of kind — keep the stronger score
    const idx = list.findIndex((l) => l.source === source && l.target === target);
    const k = (kind === 'pinned') ? 'pinned' : 'inferred';
    if (idx >= 0) {
      const prev = list[idx];
      // Promote to pinned if either side is pinned
      const promotedKind = (prev.kind === 'pinned' || k === 'pinned') ? 'pinned' : 'inferred';
      list[idx] = {
        ...prev,
        score: Math.max(prev.score, Number(score) || 0),
        kind: promotedKind,
        createdAt: prev.createdAt || Date.now(),
      };
    } else {
      // Store a single direction; consumers filter with
      // (source===id || target===id) which is direction-agnostic.
      list.push({
        source, target,
        score: Math.max(0, Math.min(1, Number(score) || 0)),
        kind: k,
        createdAt: Date.now(),
      });
    }
    try {
      this._write(KEYS.links, list);
    } catch (err) {
      if (err && err.name === 'StorageFullError') {
        // Roll back the in-memory link list.
        const original = this._read(KEYS.links, []);
        this._mem.links = Array.isArray(original) ? original : [];
        throw err;
      }
      throw err;
    }
  }

  /**
   * @param {string} source
   * @param {string} target
   * @returns {boolean}
   */
  removeLink(source, target) {
    if (!source || !target) return false;
    const list = this.getLinks();
    const next = list.filter((l) => !(l.source === source && l.target === target)
      && !(l.source === target && l.target === source));
    if (next.length === list.length) return false;
    try {
      this._write(KEYS.links, next);
    } catch (err) {
      if (err && err.name === 'StorageFullError') {
        const original = this._read(KEYS.links, []);
        this._mem.links = Array.isArray(original) ? original : [];
        throw err;
      }
      throw err;
    }
    return true;
  }

  /** @returns {Link[]} */
  getLinks() {
    const v = this._read(KEYS.links, []);
    return Array.isArray(v) ? v : [];
  }

  /** @returns {Link[]} subset with kind='pinned' */
  getPinnedLinks() {
    return this.getLinks().filter((l) => l.kind === 'pinned');
  }

  // ---- Pool (v0.7) ----
  /**
   * The pool config: which GitHub repo to use as the multi-user
   * "Insight Pool" and (optionally) the PAT to publish / react
   * with. The token is stored in plaintext in localStorage —
   * acceptable for an MVP. v0.8 may wrap this with Web Crypto
   * (user-supplied passphrase). Returning `null` (not `{}`)
   * lets the UI distinguish "never configured" from
   * "configured and then cleared".
   *
   * @returns {{ owner: string, repo: string, token: string|null }|null}
   */
  getPoolConfig() {
    const v = this._read(KEYS.poolConfig, null);
    if (!v || typeof v !== 'object') return null;
    if (!v.owner || !v.repo) return null;
    return {
      owner: String(v.owner),
      repo: String(v.repo),
      token: v.token ? String(v.token) : null,
    };
  }

  /**
   * @param {{ owner: string, repo: string, token?: string|null }} cfg
   */
  setPoolConfig(cfg) {
    if (!cfg || !cfg.owner || !cfg.repo) {
      throw new Error('setPoolConfig: owner and repo are required');
    }
    const out = {
      owner: String(cfg.owner).trim(),
      repo:  String(cfg.repo).trim(),
      token: cfg.token ? String(cfg.token) : null,
    };
    this._write(KEYS.poolConfig, out);
  }

  /**
   * @returns {Array<{ id: string, text: string, tags: string[],
   *   source: 'pool', origin: object, author: object,
   *   reactions: object, myReaction: string|null, isLocal: boolean }>}
   */
  getPoolCache() {
    const v = this._read(KEYS.poolCache, []);
    return Array.isArray(v) ? v : [];
  }

  /**
   * Replace the pool cache. Dedupes by `.id` (which is
   * `pool-<issue number>`) — if the same issue appears twice,
   * the last one wins. Mirrors to the in-memory cache so the
   * GitHubIssuePool instance can pick it up on next mount.
   *
   * @param {Array<object>} list
   */
  setPoolCache(list) {
    const arr = Array.isArray(list) ? list : [];
    const dedup = new Map();
    for (const it of arr) {
      if (!it || !it.id) continue;
      dedup.set(it.id, it);
    }
    this._write(KEYS.poolCache, Array.from(dedup.values()));
  }

  /**
   * Local override map of `issueNumber -> reaction content`. The
   * user can react even when the GitHub issue is briefly
   * unavailable (rate limit, network) and the UI stays snappy
   * because the toggle reads from this map first.
   *
   * @returns {Record<string, '+1'|'-1'|null>}
   */
  getReactions() {
    const v = this._read(KEYS.poolReactions, {});
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v;
  }

  /**
   * @param {number|string} number  issue number (string-coerced for map key)
   * @param {'+1'|'-1'|'laugh'|'hooray'|'confused'|'heart'|'rocket'|'eyes'|null} content
   */
  setReaction(number, content) {
    const key = String(Number(number) || 0);
    if (key === '0') return;  // invalid number
    const map = this.getReactions();
    if (content == null) {
      map[key] = null;
    } else {
      map[key] = String(content);
    }
    this._write(KEYS.poolReactions, map);
  }

  /**
   * Tag an existing local inspiration with a `_poolOrigin`
   * marker so the /my view can show "Published to <repo>"
   * separately. We add this field in-place to keep the
   * existing Inspiration shape backward compatible.
   *
   * @param {string} id
   * @param {{ owner: string, repo: string, number: number, htmlUrl: string }|null} origin
   * @returns {boolean} true if the inspiration was updated
   */
  setPoolOrigin(id, origin) {
    if (!id) return false;
    const list = this.getInspirations();
    const idx = list.findIndex((x) => x && x.id === id);
    if (idx < 0) return false;
    const next = { ...list[idx] };
    if (origin == null) {
      delete next._poolOrigin;
    } else {
      next._poolOrigin = {
        owner: String(origin.owner || ''),
        repo: String(origin.repo || ''),
        number: Number(origin.number) || 0,
        htmlUrl: String(origin.htmlUrl || ''),
      };
    }
    list[idx] = next;
    try {
      this._write(KEYS.inspirations, list);
    } catch (err) {
      if (err && err.name === 'StorageFullError') throw err;
      throw err;
    }
    return true;
  }

  // ---- Migration ----
  /**
   * One-shot migration from v0.5.x storage (all four legacy keys):
   *   - `ideaminer.user-ideas.v1`  → `insightrecoder.inspirations.v1`
   *       (each {id, question, field, ...} → {id, text, tags:[field], source})
   *   - `ideaminer.saved.v1`       → `insightrecoder.saved.v1` (a NEW
   *       key that v0.6 did not expose; we now also back up the
   *       v0.5.x "saved" list so the user can re-link them). v0.6
   *       removed the saved/favorite feature entirely, so the
   *       migrated entries are kept under a fresh key for future
   *       use (the user can hand-reconnect them once we restore the
   *       feature).
   *   - `ideaminer.feedback.v1`    → `insightrecoder.legacy-feedback.v1`
   *       (like/dislike history; v0.6 dropped like/dislike, so we
   *       keep the raw history under a clearly-marked legacy key
   *       in case a future release wants to re-import it).
   *   - `ideaminer.profile.v1`      → `insightrecoder.profile.v1`
   *       (the new profile key uses a different namespace; the
   *       v0.5.x profile is copied over if the new key is empty).
   *
   * All four migrations are idempotent: if the new key already
   * exists, the legacy data is left in place and the legacy key is
   * NOT deleted (so the user can still recover via a manual
   * download if needed). Once the new key is empty AND the legacy
   * key has data, the migration runs and the legacy key is deleted.
   *
   * @returns {{
   *   inspirationsMigrated: number,
   *   savedMigrated: number,
   *   feedbackMigrated: number,
   *   profileMigrated: boolean,
   *   hadAnyLegacy: boolean,
   * }}
   */
  migrateLegacyUserIdeas() {
    const report = {
      inspirationsMigrated: 0,
      savedMigrated: 0,
      feedbackMigrated: 0,
      profileMigrated: false,
      hadAnyLegacy: false,
    };
    if (!this._hasLS) return report;

    const safeGet = (k) => {
      try { return window.localStorage.getItem(k); } catch (_) { return null; }
    };
    const safeRemove = (k) => {
      try { window.localStorage.removeItem(k); } catch (_) { /* ignore */ }
    };
    const safeParse = (raw) => {
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch (_) { return null; }
    };

    // 1) Profile
    const oldProfile = safeGet(KEYS.legacyProfile);
    if (oldProfile) {
      report.hadAnyLegacy = true;
      const newProfile = safeGet(KEYS.profile);
      if (!newProfile) {
        const p = safeParse(oldProfile);
        if (p && typeof p === 'object' && (p.field || p.direction || p.age)) {
          this._write(KEYS.profile, {
            field: String(p.field || ''),
            direction: String(p.direction || ''),
            age: String(p.age || ''),
          });
          report.profileMigrated = true;
          safeRemove(KEYS.legacyProfile);
        } else {
          // unparseable / empty legacy profile; just drop the key
          safeRemove(KEYS.legacyProfile);
        }
      }
      // If new profile already exists, leave legacy in place; the
      // user can recover via download if they ever need it.
    }

    // 2) User-submitted ideas → inspirations
    const oldIdeas = safeGet(KEYS.legacyUserIdeas);
    if (oldIdeas) {
      report.hadAnyLegacy = true;
      const newIdeas = safeGet(KEYS.inspirations);
      if (!newIdeas) {
        const parsed = safeParse(oldIdeas);
        let oldList = [];
        if (Array.isArray(parsed)) oldList = parsed;
        else if (parsed && Array.isArray(parsed.ideas)) oldList = parsed.ideas;
        const migrated = oldList
          .filter((x) => x && typeof x === 'object' && x.question)
          .map((x) => {
            const field = String(x.field || '').trim().toLowerCase();
            const oldId = String(x.id || '');
            const newId = oldId.startsWith('user-')
              ? 'insp-' + oldId.slice(5)
              : (oldId || ('insp-mig-' + Math.random().toString(36).slice(2, 10)));
            return {
              id: newId,
              text: String(x.question || '').trim(),
              createdAt: Number(x.generatedAt) || Date.now(),
              tags: field ? [field] : [],
              source: 'text',
            };
          })
          .filter((x) => x.text);
        if (migrated.length > 0) {
          this._write(KEYS.inspirations, migrated);
          report.inspirationsMigrated = migrated.length;
        }
        safeRemove(KEYS.legacyUserIdeas);
      }
      // If new inspirations already exist, leave legacy in place.
    }

    // 3) Saved ideas → kept under a fresh insightrecoder.saved.v1
    //    key. v0.6 has no UI for saved ideas yet, but we preserve
    //    the data so a future release can re-link them. The user
    //    can also download it via the JS console: localStorage
    //    .getItem('insightrecoder.saved.v1').
    const oldSaved = safeGet(KEYS.legacySaved);
    if (oldSaved) {
      report.hadAnyLegacy = true;
      const newSaved = safeGet('insightrecoder.saved.v1');
      if (!newSaved) {
        const parsed = safeParse(oldSaved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._write('insightrecoder.saved.v1', parsed);
          report.savedMigrated = parsed.length;
        }
        safeRemove(KEYS.legacySaved);
      }
    }

    // 4) Feedback history → insightrecoder.legacy-feedback.v1
    const oldFeedback = safeGet(KEYS.legacyFeedback);
    if (oldFeedback) {
      report.hadAnyLegacy = true;
      const newFeedback = safeGet('insightrecoder.legacy-feedback.v1');
      if (!newFeedback) {
        const parsed = safeParse(oldFeedback);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._write('insightrecoder.legacy-feedback.v1', parsed);
          report.feedbackMigrated = parsed.length;
        }
        safeRemove(KEYS.legacyFeedback);
      }
    }

    return report;
  }
}
