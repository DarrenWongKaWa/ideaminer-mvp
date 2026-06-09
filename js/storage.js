/**
 * storage.js
 * ------------------------------------------------------------
 * 抽象 Storage 接口 + LocalStorageProvider 实现。
 *
 * 抽象点：
 *  - 替换为后端 API 时（IndexedDB / REST / Supabase 等），
 *    只需 new 一个新的 Storage 子类；app.js 不需要任何改动。
 *  - 统一使用 sync 接口（方法返回普通对象 / 数组），调用方
 *    不需要 await —— 这样在 LocalStorage 和真后端之间切换时
 *    接口签名是稳定的。
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
    // 检测是否真的在浏览器环境
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
    // 始终同步到 in-memory mirror
    const memKey = this._memKey(key);
    this._mem[memKey] = val;
    if (!this._hasLS) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {
      // 配额超限等情况下静默降级
    }
  }

  _memKey(lsKey) {
    // 把 'ideaminer.profile.v1' 还原成 'profile'，方便在 in-memory 镜像里读
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
    // 避免重复（基于 id）
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
    // 限制长度，避免 localStorage 膨胀
    const trimmed = list.slice(-500);
    this._write(KEYS.feedback, trimmed);
  }

  getFeedbackHistory() {
    const v = this._read(KEYS.feedback, []);
    return Array.isArray(v) ? v : [];
  }
}
