/**
 * llm-provider.js
 * ------------------------------------------------------------
 * Abstract LLMProvider interface + MockLLMProvider implementation + createProvider factory.
 *
 * Extension points:
 *  - To replace with a real LLM, simply instantiate a new LLMProvider subclass
 *    (e.g. OpenAILLMProvider, ClaudeLLMProvider) and pass it into app.js.
 *  - Real LLMs should support AbortSignal (throw immediately when signal.aborted === true)
 *    so that in-flight requests can be cancelled on page switch.
 *  - The returned IdeaDraft should NOT include id / field -- those are database/archive
 *    metadata; the caller (IdeaGenerator) will inject them.
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} ResearchProfile
 * @property {string} field       Discipline, e.g. "Physics"
 * @property {string} direction   Specific research direction, e.g. "quantum geometry"
 * @property {string} age         Career stage, e.g. "PhD"
 */

/**
 * @typedef {Object} IdeaDraft
 * @property {string} question     Core scientific question
 * @property {string} background   Research background and knowledge gap
 * @property {string} significance Why solving this matters
 * @property {string[]} methods   Step-by-step research plan
 */

export class LLMProvider {
  /**
   * @param {ResearchProfile} _profile
   * @param {AbortSignal} [_signal]
   * @returns {Promise<IdeaDraft>}
   */
  async generateIdea(_profile, _signal) {
    throw new Error('LLMProvider.generateIdea() not implemented — override in subclass');
  }

  /**
   * Optional side-channel: providers that pick from a local pool
   * (e.g. MockLLMProvider) override this to expose the original
   * id / `_user` flag / review of the most recent pick. Real LLM
   * providers do not need to override — the default returns null
   * and IdeaGenerator falls back to a fresh `rv-*` id.
   *
   * @returns {{ id: string|null, field: string|null, isUser: boolean, review: object|null }|null}
   */
  getLastPick() {
    return null;
  }
}

export class MockLLMProvider extends LLMProvider {
  /**
   * @param {string} ideasPath Relative path, e.g. "data/mock-ideas.json"
   */
  constructor(ideasPath) {
    super();
    this.ideasPath = ideasPath;
    this._cache = null;
    this._inflight = null;
    // User-submitted ideas, set via setUserIdeas() on boot. These are
    // merged into the random pool (and the getIdeas() search pool) at
    // pick time. Stored in instance state so setUserIdeas() can be called
    // multiple times without rebuilding the LLM provider.
    this._userIdeas = [];
    // The full original entry from the most recent generateIdea() pick,
    // so the IdeaGenerator can preserve the original id / `_user` flag
    // when wrapping the draft into a ReviewedIdea. Null if no pick has
    // happened yet, or for providers that do not track picks.
    this._lastPick = null;
  }

  async _load() {
    if (this._cache) return this._cache;
    if (this._inflight) return this._inflight;
    this._inflight = fetch(this.ideasPath, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) {
          throw new Error(`MockLLMProvider: failed to fetch ${this.ideasPath} (HTTP ${r.status})`);
        }
        return r.json();
      })
      .then((j) => {
        if (!j || !Array.isArray(j.ideas)) {
          throw new Error('MockLLMProvider: mock-ideas.json must contain an "ideas" array');
        }
        this._cache = j.ideas;
        return j.ideas;
      });
    return this._inflight;
  }

  /**
   * Set the user-ideas list (synced from Storage).
   * The next .generateIdea() call will include these in the pool.
   * @param {Array} ideas
   */
  setUserIdeas(ideas) {
    this._userIdeas = Array.isArray(ideas) ? ideas.slice() : [];
  }

  /**
   * @returns {Array} Currently loaded user ideas
   */
  getUserIdeas() {
    return Array.isArray(this._userIdeas) ? this._userIdeas.slice() : [];
  }

  /**
   * The merged array: user ideas (newest first) followed by mock ideas.
   * Used by generateIdea() and exposed via getIdeas() so the search
   * pipeline (which calls llm.getIdeas()) also sees user ideas.
   * @returns {Array}
   */
  _mergedPool() {
    const mock = Array.isArray(this._cache) ? this._cache : [];
    return [...this._userIdeas, ...mock];
  }

  /**
   * @returns {{ id: string|null, field: string|null, isUser: boolean, review: object|null }|null}
   *   The original entry from the most recent generateIdea() pick, or
   *   null if none. `isUser` is true if the pick came from the
   *   user-ideas pool. The base LLMProvider returns null; only
   *   MockLLMProvider tracks the last pick.
   */
  getLastPick() {
    if (!this._lastPick) return null;
    return {
      id: this._lastPick.id || null,
      field: this._lastPick.field || null,
      isUser: this._lastPick._user === true || (this._lastPick.id && /^user-/.test(this._lastPick.id)),
      review: this._lastPick.review || null,
    };
  }

  /**
   * Public accessor for the loaded ideas array (mock + user merged).
   * Returns the in-memory cache if already loaded; otherwise awaits
   * the in-flight load so callers do not race the first fetch.
   * Returns an empty array on load error (caller can decide how to handle).
   * @returns {Promise<Array>}
   */
  async getIdeas() {
    let mock = [];
    try {
      mock = await this._load();
    } catch (err) {
      console.warn('MockLLMProvider.getIdeas failed:', err);
    }
    return [...this._userIdeas, ...mock];
  }

  /**
   * @param {ResearchProfile} profile
   * @param {AbortSignal} [signal]
   * @returns {Promise<IdeaDraft>}
   */
  async generateIdea(profile, signal) {
    // 1. Simulate 400-800ms of LLM inference latency
    const latency = 400 + Math.random() * 400;
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, latency);
      if (signal) {
        const onAbort = () => {
          clearTimeout(t);
          reject(new DOMException('aborted', 'AbortError'));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    // 2. Build the merged pool (user + mock). We must await the
    //    underlying mock-ideas load — `_mergedPool()` reads
    //    `this._cache` synchronously, and on the first call to
    //    generateIdea() the cache is still null, so the merged
    //    pool would be `[...userIdeas, ...null]` which is just
    //    userIdeas. Awaiting `_load()` here is the same pattern
    //    v0.4.0 used; the v0.5.0 refactor that introduced
    //    `_mergedPool()` would otherwise regress the random flow
    //    on a fresh page load.
    const mock = await this._load();
    const all = [...this._userIdeas, ...mock];
    if (all.length === 0) {
      throw new Error('MockLLMProvider: no ideas available (mock-ideas.json empty and no user ideas)');
    }

    // 3. Filter by profile.field; fall back to the full set on no match.
    //    The fallback covers the common case where a user idea lives in
    //    a different field than the user's profile, but should still
    //    surface in random exploration.
    const field = (profile && profile.field) || '';
    let pool = all.filter((i) => i.field === field);
    if (pool.length === 0) pool = all;

    // 4. Pick a random one
    const pick = pool[Math.floor(Math.random() * pool.length)];

    // 5. Remember the original pick (for getLastPick() — lets the
    //    IdeaGenerator preserve the user-idea id / `_user` flag).
    this._lastPick = pick;

    // 6. Strip id / field (these are archive metadata; the caller injects them)
    return {
      question: pick.question,
      background: pick.background,
      significance: pick.significance,
      methods: Array.isArray(pick.methods) ? pick.methods.slice() : [],
    };
  }
}

/**
 * @typedef {Object} ProviderConfig
 * @property {'mock'|'openai'} type
 * @property {string} [ideasPath]       Used for the mock provider, default 'data/mock-ideas.json'
 * @property {{endpoint: string, apiKey: string, model: string, temperature?: number, timeoutMs?: number}} [openai]  Required when type is 'openai'
 */

/**
 * Construct a provider from a config object. Currently supports 'mock' and 'openai'.
 *
 * Note: returns Promise<LLMProvider> (the 'openai' branch uses dynamic import,
 * so mock-only users do not download the openai-llm-provider.js source).
 *
 * @param {ProviderConfig} config
 * @returns {Promise<LLMProvider>}
 */
export function createProvider(config) {
  const type = (config && config.type) || 'mock';
  if (type === 'mock') {
    const ideasPath = (config && config.ideasPath) || 'data/mock-ideas.json';
    return Promise.resolve(new MockLLMProvider(ideasPath));
  }
  if (type === 'openai') {
    if (!config.openai || !config.openai.apiKey || !config.openai.model) {
      return Promise.reject(new Error(
        'createProvider: openai provider requires openai.apiKey and openai.model'
      ));
    }
    return import('./openai-llm-provider.js').then((m) =>
      new m.OpenAILLMProvider(config.openai)
    );
  }
  return Promise.reject(new Error(`createProvider: unknown provider type "${type}"`));
}