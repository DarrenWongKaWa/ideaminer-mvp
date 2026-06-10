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
   * Public accessor for the loaded ideas array.
   * Returns the in-memory cache if already loaded; otherwise awaits
   * the in-flight load so callers do not race the first fetch.
   * Returns an empty array on load error (caller can decide how to handle).
   * @returns {Promise<Array>}
   */
  async getIdeas() {
    try {
      return await this._load();
    } catch (err) {
      console.warn('MockLLMProvider.getIdeas failed:', err);
      return [];
    }
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

    // 2. Load mock ideas
    const all = await this._load();
    if (all.length === 0) {
      throw new Error('MockLLMProvider: no ideas available in mock-ideas.json');
    }

    // 3. Filter by profile.field; fall back to the full set on no match
    const field = (profile && profile.field) || '';
    let pool = all.filter((i) => i.field === field);
    if (pool.length === 0) pool = all;

    // 4. Pick a random one
    const pick = pool[Math.floor(Math.random() * pool.length)];

    // 5. Strip id / field (these are archive metadata; the caller injects them)
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