/**
 * storage.js
 * ------------------------------------------------------------
 * IdeaMiner v0.8 — local-first storage layer.
 *
 * Two stable data shapes:
 *   GeneratedIdea:
 *     { id, ts, field, sub,
 *       title, question, background, significance, pathway,
 *       review:  { innovation, feasibility, importance },
 *       feedback: 'like' | 'dislike' | 'unrelated' | null,
 *       saved:   boolean,
 *       prompt:  string  // what the user actually typed / said
 *     }
 *
 *   Settings:
 *     { providerKind: 'mock' | 'openai',
 *       openai: { apiKey, baseUrl, model } }
 *
 * Public methods (extension point — do not break):
 *   getAllIdeas() / addIdea() / updateIdea() / deleteIdea() / getIdea(id)
 *   getSettings() / setSettings()
 */

const KEYS = {
  ideas:    'ideaminer.v08.ideas.v1',
  settings: 'ideaminer.v08.settings.v1',
};

export class Storage {
  constructor(provider) {
    this._provider = provider || window.localStorage;
  }

  // -- generated ideas ------------------------------------------------
  getAllIdeas() {
    try {
      const raw = this._provider.getItem(KEYS.ideas);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  addIdea(idea) {
    const list = this.getAllIdeas();
    const full = {
      id: idea.id || cryptoId(),
      ts: idea.ts || Date.now(),
      feedback: null,
      saved: false,
      ...idea,
    };
    list.unshift(full);
    this._write(KEYS.ideas, list);
    return full;
  }
  updateIdea(id, patch) {
    const list = this.getAllIdeas();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...patch };
    this._write(KEYS.ideas, list);
    return list[idx];
  }
  deleteIdea(id) {
    const list = this.getAllIdeas().filter((x) => x.id !== id);
    this._write(KEYS.ideas, list);
    return true;
  }
  getIdea(id) {
    return this.getAllIdeas().find((x) => x.id === id) || null;
  }

  // -- settings -------------------------------------------------------
  getSettings() {
    try {
      const raw = this._provider.getItem(KEYS.settings);
      return raw ? JSON.parse(raw) : defaultSettings();
    } catch {
      return defaultSettings();
    }
  }
  setSettings(patch) {
    const cur = this.getSettings();
    const next = { ...cur, ...patch };
    if (patch.openai) next.openai = { ...cur.openai, ...patch.openai };
    this._write(KEYS.settings, next);
    return next;
  }

  // -- internals ------------------------------------------------------
  _write(key, value) {
    try {
      this._provider.setItem(key, JSON.stringify(value));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        throw new Error('Browser storage is full. Delete some saved ideas in your Library to free space.');
      }
      throw e;
    }
  }
}

function defaultSettings() {
  return {
    providerKind: 'mock',
    openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  };
}

function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
