/**
 * openai-llm-provider.js
 * ------------------------------------------------------------
 * OpenAI 兼容协议的 LLM provider。
 *
 * 兼容以下端点（任选其一填到 endpoint）：
 *   - OpenAI:    https://api.openai.com/v1/chat/completions
 *   - DeepSeek:  https://api.deepseek.com/v1/chat/completions
 *   - Moonshot:  https://api.moonshot.cn/v1/chat/completions
 *   - Zhipu:     https://open.bigmodel.cn/api/paas/v4/chat/completions  (注：Zhipu 不支持 json_object 模式，已自动降级)
 *   - Ollama:    http://localhost:11434/v1/chat/completions
 *   - LM Studio: http://localhost:1234/v1/chat/completions
 *   - 任何其他遵循 OpenAI Chat Completions 协议的服务
 *
 * 用法：
 *   const p = new OpenAILLMProvider({
 *     endpoint: 'https://api.openai.com/v1/chat/completions',
 *     apiKey:   'sk-...',
 *     model:    'gpt-4o-mini',
 *     temperature: 0.7,
 *   });
 *   const draft = await p.generateIdea(profile, signal);
 *
 * 返回的 draft 与 MockLLMProvider 形状一致：
 *   { question, background, significance, methods: string[] }
 *
 * 错误处理：
 *   - HTTP 非 2xx → 抛出 Error，message 包含状态码 + 服务端 message
 *   - JSON 解析失败（```json fence / 散文包裹 / 部分截断） → 抛出 Error
 *   - 字段缺失 → 用 fallback 字符串填充，避免下游空指针
 * ------------------------------------------------------------
 */

import { LLMProvider } from './llm-provider.js';

/**
 * @typedef {import('./llm-provider.js').ResearchProfile} ResearchProfile
 * @typedef {import('./llm-provider.js').IdeaDraft} IdeaDraft
 */

/**
 * @typedef {Object} OpenAIConfig
 * @property {string} endpoint      完整 chat/completions URL
 * @property {string} apiKey        API Key（Bearer Token）
 * @property {string} model         模型名，例如 gpt-4o-mini / deepseek-chat
 * @property {number} [temperature] 0-2 之间，默认 0.7
 * @property {number} [timeoutMs]   请求超时毫秒，默认 30000
 */

/** 系统 prompt（中文，要求严格 JSON 输出） */
const SYSTEM_PROMPT = `你是科研选题助手。基于用户给出的"研究画像"（领域、研究方向、研究年龄），提出一个新颖、可执行、有重要意义的科研问题。
输出必须是严格的 JSON 对象，字段：
- question: 核心科学问题（一句话陈述）
- background: 当前研究背景与知识缺口（2-4 句话）
- significance: 解决问题的意义（1-2 句话）
- methods: 研究方法步骤（3-5 条，每条 1 句话）
不要输出任何其他文字，只输出 JSON。`;

/**
 * 提取 JSON 子串。处理三种情况：
 *   1. ```json ... ``` 围栏
 *   2. ``` ... ``` 围栏（无语言标签）
 *   3. 第一个 { 到最后一个 } 的子串
 * @param {string} text
 * @returns {string}
 */
function extractJson(text) {
  if (!text || typeof text !== 'string') return '';
  // 1) ```json ... ```
  const m1 = text.match(/```json\s*([\s\S]*?)```/i);
  if (m1) return m1[1].trim();
  // 2) ``` ... ```
  const m2 = text.match(/```\s*([\s\S]*?)```/);
  if (m2) return m2[1].trim();
  // 3) 第一个 { 到最后一个 }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

/**
 * 把 LLM 返回的任意对象规整成 IdeaDraft，缺失字段填 fallback。
 * @param {any} obj
 * @returns {IdeaDraft}
 */
function normalizeDraft(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  const arr = Array.isArray(o.methods) ? o.methods : [];
  const methods = arr
    .map((m) => (m == null ? '' : String(m).trim()))
    .filter((s) => s.length > 0)
    .slice(0, 8);
  return {
    question:     String(o.question     || '（未生成问题）').trim(),
    background:   String(o.background   || '（未生成背景）').trim(),
    significance: String(o.significance || '（未生成意义）').trim(),
    methods:      methods.length > 0 ? methods : ['（未生成方法）'],
  };
}

/** 默认端点（OpenAI 官方） */
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export class OpenAILLMProvider extends LLMProvider {
  /**
   * @param {OpenAIConfig} config
   */
  constructor(config) {
    super();
    if (!config || typeof config !== 'object') {
      throw new Error('OpenAILLMProvider: config is required');
    }
    const endpoint = String(config.endpoint || DEFAULT_ENDPOINT).trim();
    const apiKey   = String(config.apiKey   || '').trim();
    const model    = String(config.model    || '').trim();
    if (!apiKey) throw new Error('OpenAILLMProvider: apiKey is required');
    if (!model)  throw new Error('OpenAILLMProvider: model is required');

    this.endpoint   = endpoint;
    this.apiKey     = apiKey;
    this.model      = model;
    this.temperature = (typeof config.temperature === 'number')
      ? Math.max(0, Math.min(2, config.temperature))
      : 0.7;
    this.timeoutMs  = (typeof config.timeoutMs === 'number' && config.timeoutMs > 0)
      ? config.timeoutMs
      : 30000;

    // 已知不支持 response_format=json_object 的端点（启发式：Zhipu）
    this._supportsJsonMode = !/bigmodel\.cn|zhipu|zhipuai/.test(endpoint);
  }

  /**
   * @param {ResearchProfile} profile
   * @param {AbortSignal} [signal]
   * @returns {Promise<IdeaDraft>}
   */
  async generateIdea(profile, signal) {
    // 30s 超时（与调用方 signal 任一触发即取消）
    const timeoutCtrl = new AbortController();
    const timeoutId = setTimeout(() => timeoutCtrl.abort(new Error('timeout')), this.timeoutMs);
    const combined = this._combineSignals(signal, timeoutCtrl.signal);

    const userMsg = JSON.stringify({
      field:     (profile && profile.field)     || '',
      direction: (profile && profile.direction) || '',
      age:       (profile && profile.age)       || '',
    }, null, 2);

    /** @type {Record<string, any>} */
    const body = {
      model: this.model,
      temperature: this.temperature,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `研究画像：\n${userMsg}` },
      ],
    };
    if (this._supportsJsonMode) {
      body.response_format = { type: 'json_object' };
    }

    let res;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combined.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message)))) {
        // 调用方主动取消 OR 超时 → 抛 AbortError 以便上层区分
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      throw new Error(`OpenAILLMProvider: 网络错误 — ${err && err.message ? err.message : String(err)}`);
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = await res.text();
        detail = errBody.slice(0, 500);
      } catch (_) { /* ignore */ }
      throw new Error(
        `OpenAILLMProvider: HTTP ${res.status} ${res.statusText || ''} — ${detail}`
      );
    }

    let json;
    try {
      json = await res.json();
    } catch (err) {
      throw new Error(`OpenAILLMProvider: 无法解析 JSON 响应 — ${err && err.message}`);
    }

    // 提取 content
    const content = json && json.choices && json.choices[0]
      && json.choices[0].message
      && json.choices[0].message.content;
    if (!content || typeof content !== 'string') {
      throw new Error('OpenAILLMProvider: 响应缺少 choices[0].message.content');
    }

    // 解析 JSON 内容
    const text = extractJson(content);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `OpenAILLMProvider: 无法解析模型输出为 JSON — ${err && err.message} | 原始: ${text.slice(0, 200)}`
      );
    }

    return normalizeDraft(parsed);
  }

  /**
   * 把调用方 signal 与内部超时 signal 合并成单个可监听对象。
   * 任一触发都会让 combined.signal.aborted = true。
   * @param {AbortSignal} [a]
   * @param {AbortSignal} b
   */
  _combineSignals(a, b) {
    const a_ = a || null;
    const b_ = b || null;
    if (!a_) return { signal: b_ };
    if (!b_) return { signal: a_ };
    const ctrl = new AbortController();
    const onA = () => ctrl.abort();
    const onB = () => ctrl.abort();
    if (a_.aborted || b_.aborted) {
      ctrl.abort();
    } else {
      a_.addEventListener('abort', onA, { once: true });
      b_.addEventListener('abort', onB, { once: true });
    }
    // 清理：任一 signal 触发后解绑另一边
    ctrl.signal.addEventListener('abort', () => {
      a_.removeEventListener('abort', onA);
      b_.removeEventListener('abort', onB);
    }, { once: true });
    return { signal: ctrl.signal };
  }
}