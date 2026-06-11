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
  // Legacy v0.5.x key — read once on boot for one-shot migration, then deleted.
  legacyUserIdeas: 'ideaminer.user-ideas.v1',
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
    if (lsKey === KEYS.profile)      return 'profile';
    if (lsKey === KEYS.inspirations) return 'inspirations';
    if (lsKey === KEYS.links)        return 'links';
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

  // ---- Migration ----
  /**
   * One-shot migration from v0.5.x storage.
   * If `ideaminer.user-ideas.v1` exists and
   * `insightrecoder.inspirations.v1` does not, transform and
   * move the data, then delete the old key.
   *
   * Mapping:
   *   { id, question, field, ... } ->
   *     { id, text: question, tags: [field?], source: 'text' }
   *
   * @returns {{ migrated: number, hadOldKey: boolean }}
   */
  migrateLegacyUserIdeas() {
    if (!this._hasLS) {
      // node smoke-test path: in-memory mirror does not have the
      // legacy key (the constructor initializes it absent), so noop.
      return { migrated: 0, hadOldKey: false };
    }
    let oldRaw = null;
    try { oldRaw = window.localStorage.getItem(KEYS.legacyUserIdeas); } catch (_) { /* ignore */ }
    if (!oldRaw) return { migrated: 0, hadOldKey: false };

    let newRaw = null;
    try { newRaw = window.localStorage.getItem(KEYS.inspirations); } catch (_) { /* ignore */ }
    if (newRaw) {
      // New key already exists; do not overwrite. Still delete the
      // old key so we don't keep re-checking.
      try { window.localStorage.removeItem(KEYS.legacyUserIdeas); } catch (_) { /* ignore */ }
      return { migrated: 0, hadOldKey: true };
    }

    let oldList = [];
    try {
      const parsed = JSON.parse(oldRaw);
      // v0.5.x stored either a raw array OR a {ideas: [...]} wrapper
      // (depending on which release). Accept both shapes.
      if (Array.isArray(parsed)) {
        oldList = parsed;
      } else if (parsed && Array.isArray(parsed.ideas)) {
        oldList = parsed.ideas;
      }
    } catch (_) { /* fall through */ }

    const migrated = oldList
      .filter((x) => x && typeof x === 'object' && x.question)
      .map((x) => {
        const field = String(x.field || '').trim().toLowerCase();
        // Rename legacy `user-*` ids to `insp-*` to match the new
        // naming convention used by addInspiration().
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
    }
    try { window.localStorage.removeItem(KEYS.legacyUserIdeas); } catch (_) { /* ignore */ }
    return { migrated: migrated.length, hadOldKey: true };
  }
}
