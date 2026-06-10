/**
 * openai-llm-provider.js
 * ------------------------------------------------------------
 * LLM provider speaking the OpenAI-compatible protocol.
 *
 * Compatible endpoints (set any one of these in `endpoint`):
 *   - OpenAI:    https://api.openai.com/v1/chat/completions
 *   - DeepSeek:  https://api.deepseek.com/v1/chat/completions
 *   - Moonshot:  https://api.moonshot.cn/v1/chat/completions
 *   - Zhipu:     https://open.bigmodel.cn/api/paas/v4/chat/completions  (Note: Zhipu does not support json_object mode; auto-fallback)
 *   - Ollama:    http://localhost:11434/v1/chat/completions
 *   - LM Studio: http://localhost:1234/v1/chat/completions
 *   - any other service that follows the OpenAI Chat Completions protocol
 *
 * Usage:
 *   const p = new OpenAILLMProvider({
 *     endpoint: 'https://api.openai.com/v1/chat/completions',
 *     apiKey:   'sk-...',
 *     model:    'gpt-4o-mini',
 *     temperature: 0.7,
 *   });
 *   const draft = await p.generateIdea(profile, signal);
 *
 * Returned draft has the same shape as MockLLMProvider:
 *   { question, background, significance, methods: string[] }
 *
 * Error handling:
 *   - HTTP non-2xx → throw an Error whose message includes the status code and the server message
 *   - JSON parse failure (```json fence / prose-wrapped / partial) → throw an Error
 *   - Missing fields → fill with fallback strings to avoid null pointers downstream
 * ------------------------------------------------------------
 */

import { LLMProvider } from './llm-provider.js';

/**
 * @typedef {import('./llm-provider.js').ResearchProfile} ResearchProfile
 * @typedef {import('./llm-provider.js').IdeaDraft} IdeaDraft
 */

/**
 * @typedef {Object} OpenAIConfig
 * @property {string} endpoint      Full chat/completions URL
 * @property {string} apiKey        API Key（Bearer Token）
 * @property {string} model         Model name, e.g. gpt-4o-mini / deepseek-chat
 * @property {number} [temperature} Between 0 and 2, default 0.7
 * @property {number} [timeoutMs]   Request timeout in milliseconds, default 30000
 */

/** System prompt (English, requires strict JSON output) */
const SYSTEM_PROMPT = `You are a research idea assistant. Based on the user's research profile (field, direction, career stage), propose a novel, feasible, and meaningful research question.

Output must be a strict JSON object with these fields:
- question: the core scientific question (one-sentence statement)
- background: current research progress and knowledge gap (2-4 sentences)
- significance: why solving this matters (1-2 sentences)
- methods: research method steps (3-5 items, each one sentence)

Output ONLY the JSON. No prose, no markdown fences, no commentary.`;

/**
 * Extract a JSON substring. Handles three cases:
 *   1. ```json ... ``` fence
 *   2. ``` ... ``` fence (no language tag)
 *   3. substring from the first { to the last }
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
  // 3) first { to last }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

/**
 * Normalize any object returned by the LLM into an IdeaDraft, filling missing fields with fallbacks.
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
    question:     String(o.question     || '(no question generated)').trim(),
    background:   String(o.background   || '(no background generated)').trim(),
    significance: String(o.significance || '(no significance generated)').trim(),
    methods:      methods.length > 0 ? methods : ['(no methods generated)'],
  };
}

/** Default endpoint (OpenAI official) */
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

    // Endpoints known to not support response_format=json_object (heuristic: Zhipu)
    this._supportsJsonMode = !/bigmodel\.cn|zhipu|zhipuai/.test(endpoint);
  }

  /**
   * @param {ResearchProfile} profile
   * @param {AbortSignal} [signal]
   * @returns {Promise<IdeaDraft>}
   */
  async generateIdea(profile, signal) {
    // 30s timeout (fires if either the caller's signal or this timeout triggers)
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
        { role: 'user',   content: `Research profile:\n${userMsg}` },
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
        // Caller cancelled OR timed out → throw AbortError so the caller can distinguish
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      throw new Error(`OpenAILLMProvider: network error \u2014 ${err && err.message ? err.message : String(err)}`);
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
      throw new Error(`OpenAILLMProvider: could not parse JSON response \u2014 ${err && err.message}`);
    }

    // Extract content
    const content = json && json.choices && json.choices[0]
      && json.choices[0].message
      && json.choices[0].message.content;
    if (!content || typeof content !== 'string') {
      throw new Error('OpenAILLMProvider: response missing choices[0].message.content');
    }

    // Parse JSON content
    const text = extractJson(content);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `OpenAILLMProvider: could not parse model output as JSON \u2014 ${err && err.message} | raw: ${text.slice(0, 200)}`
      );
    }

    return normalizeDraft(parsed);
  }

  /**
   * Combine the caller's signal with the internal timeout signal into a single observable.
   * Either one firing will set combined.signal.aborted = true.
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
    // Cleanup: unbind the other side once either signal fires
    ctrl.signal.addEventListener('abort', () => {
      a_.removeEventListener('abort', onA);
      b_.removeEventListener('abort', onB);
    }, { once: true });
    return { signal: ctrl.signal };
  }
}