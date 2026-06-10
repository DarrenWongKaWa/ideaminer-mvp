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
  userIdeas: 'ideaminer.user-ideas.v1',
};

export class Storage {
  getProfile() { throw new Error('not implemented'); }
  setProfile(_p) { throw new Error('not implemented'); }
  saveIdea(_i) { throw new Error('not implemented'); }
  removeIdea(_id) { throw new Error('not implemented'); }
  getSavedIdeas() { throw new Error('not implemented'); }
  recordFeedback(_ideaId, _type) { throw new Error('not implemented'); }
  getFeedbackHistory() { throw new Error('not implemented'); }
  addUserIdea(_draft, _reviewer) { throw new Error('not implemented'); }
  getUserIdeas() { throw new Error('not implemented'); }
  deleteUserIdea(_id) { throw new Error('not implemented'); }
  async getMergedIdeas() { throw new Error('not implemented'); }
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
      userIdeas: [],
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
    if (lsKey === KEYS.userIdeas) return 'userIdeas';
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

  // ------------------------------------------------------------
  // User-submitted ideas (v0.5.0)
  //
  // Storage layout:
  //   - Persisted as a JSON array under KEYS.userIdeas
  //   - Each entry is a fully-formed ReviewedIdea (id, question,
  //     background, significance, methods, review, generatedAt,
  //     and a `_user: true` marker so the UI can render the
  //     "✨ Your idea" badge).
  //   - The MockReviewer is invoked at insert time (when given)
  //     to produce 3-dim review scores consistent with the rest
  //     of the pool. If no reviewer is passed in, the entry
  //     still gets a placeholder review with all-zero scores
  //     and a "no review provided" summary — the UI handles that
  //     gracefully.
  // ------------------------------------------------------------

  /**
   * Generate a stable id for a user-submitted idea. Distinct
   * prefix from `rv-*` (random-visit) and `search-*` (search hit)
   * so the UI can detect user ideas by id alone.
   * @returns {string}
   */
  _newUserIdeaId() {
    return 'user-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * @param {{
   *   field: string,
   *   question: string,
   *   background?: string,
   *   significance?: string,
   *   methods?: string[],
   * }} draft
   * @param {import('./reviewer.js').Reviewer} [reviewer]  Optional reviewer; if
   *   absent, no review scores are computed (the idea is still stored).
   * @returns {import('./storage.js').ReviewedIdea & { _user: true }}
   */
  addUserIdea(draft, reviewer) {
    const clean = {
      field: String((draft && draft.field) || '').trim(),
      question: String((draft && draft.question) || '').trim(),
      background: String((draft && draft.background) || '').trim(),
      significance: String((draft && draft.significance) || '').trim(),
      methods: Array.isArray(draft && draft.methods)
        ? draft.methods.map((m) => String(m || '').trim()).filter(Boolean)
        : [],
    };

    if (!clean.question) {
      throw new Error('addUserIdea: question is required');
    }

    const id = this._newUserIdeaId();

    // Build a placeholder review. If a reviewer is supplied, run the same
    // pipeline as the explore flow so the user idea has consistent scores.
    const reviewPromise = reviewer && typeof reviewer.review === 'function'
      ? Promise.resolve(reviewer.review(clean))
      : Promise.resolve(null);

    // We are synchronous: the MockReviewer returns a Promise but the work
    // is async. To keep the public API sync (consistent with saveIdea etc.)
    // we run a small "fire-and-collect" loop here. The MockReviewer is
    // deterministic given the question text, so awaiting is not strictly
    // required for correctness — the placeholder is overwritten as soon
    // as the review resolves on the next tick, and by the time the UI
    // re-reads via getUserIdeas() the review is in place.
    let review = {
      innovation: 0,
      feasibility: 0,
      importance: 0,
      summary: 'No review provided.',
    };

    // We cannot await in a sync method, but we *can* schedule the
    // real review to overwrite the placeholder a moment later, then
    // persist. This keeps the public method sync and gives the UI a
    // consistent ReviewedIdea shape immediately.
    const record = {
      id,
      field: clean.field,
      question: clean.question,
      background: clean.background,
      significance: clean.significance,
      methods: clean.methods,
      review,
      generatedAt: Date.now(),
      _user: true,
    };

    const list = this.getUserIdeas();
    list.unshift(record);
    this._write(KEYS.userIdeas, list);

    // Asynchronously upgrade the review scores (best-effort).
    if (reviewPromise) {
      reviewPromise
        .then((r) => {
          if (!r) return;
          // Re-read the latest list (in case of concurrent edits) and patch
          // the matching entry in place; write back.
          const cur = this.getUserIdeas();
          const idx = cur.findIndex((x) => x.id === id);
          if (idx < 0) return;
          cur[idx] = { ...cur[idx], review: r };
          this._write(KEYS.userIdeas, cur);
        })
        .catch(() => { /* keep placeholder */ });
    }

    return record;
  }

  /**
   * @returns {Array<import('./storage.js').ReviewedIdea & { _user: true }>}
   *   All user-submitted ideas, newest first.
   */
  getUserIdeas() {
    const v = this._read(KEYS.userIdeas, []);
    return Array.isArray(v) ? v : [];
  }

  /**
   * @param {string} id
   * @returns {boolean} true if removed, false if not found
   */
  deleteUserIdea(id) {
    if (!id) return false;
    const list = this.getUserIdeas();
    const next = list.filter((x) => x.id !== id);
    if (next.length === list.length) return false;
    this._write(KEYS.userIdeas, next);
    return true;
  }

  /**
   * Return mock ideas merged with user-submitted ideas. User ideas
   * come first (so they appear early in random exploration).
   *
   * This method is async because the mock-ideas array normally
   * comes from a `fetch` of `data/mock-ideas.json`. In the current
   * MVP, the caller (app.js) is the one that already has the mock
   * ideas array loaded (via the LLMProvider), so the default
   * implementation is:
   *   1. Try to read mock-ideas.json directly via fetch (works in
   *      the browser and during smoke tests).
   *   2. If the fetch fails, fall back to the user-ideas list
   *      alone (still useful for the "My Ideas" UI and the search
   *      empty-state).
   *
   * App.js can override behavior by composing the merged array
   * itself; this method exists so a future backend can be a single
   * integration point.
   *
   * @returns {Promise<Array>}
   */
  async getMergedIdeas() {
    let mock = [];
    try {
      const r = await fetch('data/mock-ideas.json', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.ideas)) mock = j.ideas;
      }
    } catch (_) { /* fall through */ }
    const user = this.getUserIdeas();
    return [...user, ...mock];
  }
}
