/**
 * llm-provider.js
 * ------------------------------------------------------------
 * Abstract LLMProvider interface + a no-op `MockLLMProvider`
 * stub kept for compile-compat with the legacy settings page.
 *
 * v0.6 does NOT call any LLM at runtime (it is a local-first
 * fragmented-inspiration recorder; the only network call is
 * the vis-network CDN load). The settings page can still
 * pick `mock` as the default, but `MockLLMProvider.generateIdea`
 * always rejects with a clear "no idea generation in v0.6"
 * message so accidental use is loud, not silent.
 *
 * The `OpenAILLMProvider` and `MockReviewer` classes are kept
 * as future hooks — they are not used by v0.6 at runtime, but
 * the file structure is preserved so a future release can
 * re-enable them without breaking imports.
 * ------------------------------------------------------------
 */

export class LLMProvider {
  /**
   * @param {object} _profile
   * @param {AbortSignal} [_signal]
   * @returns {Promise<object>}
   */
  async generateIdea(_profile, _signal) {
    throw new Error('LLMProvider.generateIdea() not implemented — override in subclass');
  }
  getLastPick() { return null; }
}

/**
 * v0.6: no idea generation. Kept as a stub for compile compat.
 * The settings page can still pick 'mock'; it will simply throw
 * if anything tries to call generateIdea on it.
 */
export class MockLLMProvider extends LLMProvider {
  constructor(_ideasPath) {
    super();
    this.ideasPath = _ideasPath || '';
    this._lastPick = null;
  }
  async generateIdea(_profile, _signal) {
    throw new Error(
      'MockLLMProvider: no idea generation in v0.6 — InsightRecoder is a local-first inspiration recorder. ' +
      'Use the capture box to add inspirations manually.'
    );
  }
  setUserIdeas() { /* no-op in v0.6 */ }
  getUserIdeas() { return []; }
  async getIdeas() { return []; }
  getLastPick() { return null; }
}

/**
 * Construct a provider from a config object. In v0.6 the only
 * meaningful return is a no-op `MockLLMProvider` instance; the
 * 'openai' branch is kept for forward-compat.
 *
 * @param {{type?: 'mock'|'openai', ideasPath?: string}} config
 * @returns {Promise<LLMProvider>}
 */
export function createProvider(config) {
  const type = (config && config.type) || 'mock';
  if (type === 'mock') {
    const ideasPath = (config && config.ideasPath) || '';
    return Promise.resolve(new MockLLMProvider(ideasPath));
  }
  if (type === 'openai') {
    // Defer to the optional openai-llm-provider.js. We try to
    // dynamic-import so a v0.6 build that does not include the
    // file does not blow up at startup.
    try {
      return import('./openai-llm-provider.js').then((m) => {
        if (!config.openai || !config.openai.apiKey || !config.openai.model) {
          throw new Error('createProvider: openai provider requires openai.apiKey and openai.model');
        }
        return new m.OpenAILLMProvider(config.openai);
      });
    } catch (err) {
      return Promise.reject(new Error('createProvider: openai provider module not available (' + (err && err.message) + ')'));
    }
  }
  return Promise.reject(new Error(`createProvider: unknown provider type "${type}"`));
}
