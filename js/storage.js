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

  _write(key, val) {
    const memKey = this._memKey(key);
    if (memKey) this._mem[memKey] = val;
    if (!this._hasLS) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {
      // Silently degrade on quota-exceeded etc.
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
    const list = this.getInspirations();
    list.unshift(record);
    this._write(KEYS.inspirations, list);
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
    this._write(KEYS.inspirations, next);
    // Cascade-delete links touching this id
    const links = this.getLinks();
    const nextLinks = links.filter((l) => l.source !== id && l.target !== id);
    if (nextLinks.length !== links.length) this._write(KEYS.links, nextLinks);
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
    this._write(KEYS.links, list);
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
    this._write(KEYS.links, next);
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
