/**
 * llm-provider.js
 * ------------------------------------------------------------
 * 抽象 LLMProvider 接口 + MockLLMProvider 实现 + createProvider 工厂。
 *
 * 抽象点：
 *  - 替换为真实 LLM 时，只需 new 一个新的 LLMProvider 子类
 *    （例如 OpenAILLMProvider、ClaudeLLMProvider），传入 app.js 即可。
 *  - 真实 LLM 应当支持 AbortSignal（signal.aborted === true 时立刻抛错），
 *    以便页面切换时能取消正在进行的请求。
 *  - 返回的 IdeaDraft 中不应包含 id / field —— 这些是数据库/档案
 *    元数据，调用方（IdeaGenerator）会负责注入。
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} ResearchProfile
 * @property {string} field       学科领域，例如 "物理学"
 * @property {string} direction   具体研究方向，例如 "量子几何"
 * @property {string} age         研究年龄，例如 "博士"
 */

/**
 * @typedef {Object} IdeaDraft
 * @property {string} question     核心科学问题
 * @property {string} background   研究背景与知识缺口
 * @property {string} significance 选题意义
 * @property {string[]} methods   步骤化研究方案
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
   * @param {string} ideasPath 相对路径，例如 "data/mock-ideas.json"
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
   * @param {ResearchProfile} profile
   * @param {AbortSignal} [signal]
   * @returns {Promise<IdeaDraft>}
   */
  async generateIdea(profile, signal) {
    // 1. 模拟 400-800ms 的 LLM 推理延迟
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

    // 2. 加载 mock ideas
    const all = await this._load();
    if (all.length === 0) {
      throw new Error('MockLLMProvider: no ideas available in mock-ideas.json');
    }

    // 3. 按 profile.field 过滤；若没有匹配则退回到全集
    const field = (profile && profile.field) || '';
    let pool = all.filter((i) => i.field === field);
    if (pool.length === 0) pool = all;

    // 4. 随机选一条
    const pick = pool[Math.floor(Math.random() * pool.length)];

    // 5. 剥掉 id / field（这些是数据档案元数据，调用方注入）
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
 * @property {string} [ideasPath]       mock 时使用，默认 'data/mock-ideas.json'
 * @property {{endpoint: string, apiKey: string, model: string, temperature?: number, timeoutMs?: number}} [openai]  openai 时必填
 */

/**
 * 根据配置构造 provider。当前支持 mock / openai。
 *
 * 注意：返回 Promise<LLMProvider>（openai 分支用 dynamic import，
 * 这样 mock-only 用户不会下载 openai-llm-provider.js 的代码）。
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