/**
 * storage.js
 * ------------------------------------------------------------
 * Abstract Storage interface + LocalStorageProvider implementation.
 *
 * Extension points:
 *  - To replace with a backend API (IndexedDB / REST / Supabase etc.),
 *    just instantiate a new Storage subclass; app.js needs no changes.
 *  - All methods use a sync interface (return plain objects/arrays), so callers
 *    do not need to await -- this keeps the interface stable when
 *    swapping LocalStorage for a real backend.
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} ResearchProfile
 * @property {string} field
 * @property {string} direction
 * @property {string} age
 */

/**
 * @typedef {Object} Review
 * @property {number} innovation
 * @property {number} feasibility
 * @property {number} importance
 * @property {string} summary
 */

/**
 * @typedef {IdeaDraft & { id: string, review: Review, generatedAt: number }} ReviewedIdea
 */

const KEYS = {
  profile: 'ideaminer.profile.v1',
  saved: 'ideaminer.saved.v1',
  feedback: 'ideaminer.feedback.v1',
};

export class Storage {
  getProfile() { throw new Error('not implemented'); }
  setProfile(_p) { throw new Error('not implemented'); }
  saveIdea(_i) { throw new Error('not implemented'); }
  removeIdea(_id) { throw new Error('not implemented'); }
  getSavedIdeas() { throw new Error('not implemented'); }
  recordFeedback(_ideaId, _type) { throw new Error('not implemented'); }
  getFeedbackHistory() { throw new Error('not implemented'); }
}

export class LocalStorageProvider extends Storage {
  constructor() {
    super();
    // Detect whether we are actually in a browser environment
    this._hasLS = (() => {
      try {
        const t = '__ideaminer_test__';
        window.localStorage.setItem(t, '1');
        window.localStorage.removeItem(t);
        return true;
      } catch (_) {
        return false;
      }
    })();
    this._mem = {
      profile: null,
      saved: [],
      feedback: [],
    };
  }

  _read(key, fallback) {
    if (!this._hasLS) {
      // node / SSR fallback: try to read from in-memory mirror by key
      const memKey = this._memKey(key);
      if (memKey in this._mem) return this._mem[memKey];
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

  _write(key, val) {
    // Always mirror to the in-memory copy
    const memKey = this._memKey(key);
    this._mem[memKey] = val;
    if (!this._hasLS) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {
      // Silently degrade on quota-exceeded etc.
    }
  }

  _memKey(lsKey) {
    // Map 'ideaminer.profile.v1' back to 'profile' for the in-memory mirror
    if (lsKey === KEYS.profile) return 'profile';
    if (lsKey === KEYS.saved) return 'saved';
    if (lsKey === KEYS.feedback) return 'feedback';
    return null;
  }

  getProfile() {
    const v = this._read(KEYS.profile, null);
    return v && typeof v === 'object' ? v : null;
  }

  setProfile(profile) {
    this._write(KEYS.profile, profile);
  }

  saveIdea(idea) {
    const list = this.getSavedIdeas();
    // Deduplicate (by id)
    const idx = list.findIndex((x) => x.id === idea.id);
    if (idx >= 0) list[idx] = idea;
    else list.unshift(idea);
    this._write(KEYS.saved, list);
  }

  removeIdea(id) {
    const list = this.getSavedIdeas().filter((x) => x.id !== id);
    this._write(KEYS.saved, list);
  }

  getSavedIdeas() {
    const v = this._read(KEYS.saved, []);
    return Array.isArray(v) ? v : [];
  }

  /**
   * @param {string} ideaId
   * @param {'like'|'dislike'|'unrelated'} type
   */
  recordFeedback(ideaId, type) {
    if (!ideaId) return;
    if (!['like', 'dislike', 'unrelated'].includes(type)) return;
    const list = this.getFeedbackHistory();
    list.push({ ideaId, type, ts: Date.now() });
    // Trim length to avoid bloating localStorage
    const trimmed = list.slice(-500);
    this._write(KEYS.feedback, trimmed);
  }

  getFeedbackHistory() {
    const v = this._read(KEYS.feedback, []);
    return Array.isArray(v) ? v : [];
  }
}
