/**
 * llm-provider.js
 * ------------------------------------------------------------
 * IdeaMiner v0.8 — extension-point LLM provider.
 *
 * Public interface (stable — do not break without bumping major):
 *   class LLMProvider {
 *     async generateIdea(prompt, opts)   -> Idea       // 4-part
 *     async reviewIdea(idea)             -> ReviewScores // 3-dim 1-5
 *   }
 *
 * Idea shape:
 *   { id, title, question, background, significance, pathway, field, sub, ts }
 *
 * ReviewScores shape:
 *   { innovation: 1-5, feasibility: 1-5, importance: 1-5 }
 *
 * Two built-in implementations:
 *   - MockLLMProvider (default; offline, deterministic-ish)
 *   - OpenAIProvider  (real API; needs apiKey + baseUrl + model)
 *
 * To add a custom provider (Anthropic, local LLM, etc.):
 *   class MyProvider extends LLMProvider { ... }
 *   const provider = new MyProvider({...});
 *   app.setProvider(provider);
 */

export class LLMProvider {
  /**
   * Generate a 4-part research idea from a prompt and discipline context.
   * Subclasses MUST implement.
   * @param {string} prompt - free-form text or voice transcript
   * @param {object} opts   - { field, sub }
   * @returns {Promise<{title:string, question:string, background:string, significance:string, pathway:string}>}
   */
  async generateIdea(prompt, opts) {
    throw new Error('LLMProvider.generateIdea: not implemented');
  }

  /**
   * Score a generated idea on innovation / feasibility / importance.
   * Subclasses MAY override. Default: heuristic scoring on text length + signal words.
   * @param {object} idea - the same shape as generateIdea returns
   * @returns {Promise<{innovation:number, feasibility:number, importance:number}>}
   */
  async reviewIdea(idea) {
    const text = [idea.question, idea.background, idea.significance, idea.pathway].join(' ');
    const innovation = scoreHeuristic(text, ['novel', 'new', 'unprecedented', 'first', 'unique', 'mechanism', 'propose']);
    const feasibility = scoreHeuristic(text, ['feasible', 'current', 'available', 'method', 'protocol', 'standard', 'established']);
    const importance = scoreHeuristic(text, ['impact', 'significant', 'transform', 'field', 'clinical', 'application', 'broad']);
    return {
      innovation: clamp(innovation + 2, 1, 5),
      feasibility: clamp(feasibility + 3, 1, 5),
      importance: clamp(importance + 2, 1, 5),
    };
  }
}

function scoreHeuristic(text, keywords) {
  const lower = (text || '').toLowerCase();
  let hits = 0;
  for (const k of keywords) if (lower.includes(k)) hits++;
  return hits;
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }


// ------------------------------------------------------------
// MockLLMProvider — offline, deterministic-ish, no network.
// Picks a template from data/seed-ideas.json by (field, sub) and
// adapts the prompt into title/question/sections via simple rules.
// ------------------------------------------------------------
export class MockLLMProvider extends LLMProvider {
  /**
   * @param {object} opts
   * @param {Array}  opts.ideas - the seed-ideas.json array
   */
  constructor(opts = {}) {
    super();
    this.ideas = opts.ideas || [];
    this.ideasByKey = indexByKey(this.ideas);
  }

  async generateIdea(prompt, opts = {}) {
    const key = `${opts.field || ''}::${opts.sub || ''}`;
    const pool = this.ideasByKey.get(key) || this.ideas;
    if (pool.length === 0) {
      return {
        title: prompt ? `Research direction: ${prompt.slice(0, 40)}` : 'Research direction',
        question: prompt ? `Can we ${prompt.toLowerCase().replace(/[.?]+$/, '')} in ${opts.sub || opts.field}?` : '',
        background: 'Background synthesis pending — extend the seed template.',
        significance: 'Significance reasoning pending.',
        pathway: 'Pathway outline pending.',
      };
    }
    // Pick a seed, but if we have multiple, prefer one not used in the recent regen chain.
    // For simplicity: random pick. (Real LLM would be deterministic for same input.)
    const seed = pool[Math.floor(Math.random() * pool.length)];

    // If the user gave us a real prompt, weave it into the title + question.
    const userHook = (prompt || '').trim();
    const title = userHook
      ? `${seed.title || 'A research direction'}: ${truncate(userHook, 40)}`
      : (seed.title || 'Untitled direction');
    const question = userHook
      ? `Can we ${userHook.toLowerCase().replace(/[.?]+$/, '')} to advance ${seed.field || opts.field} in ${seed.sub || opts.sub}?`
      : (seed.question || 'What is the central question here?');
    return {
      title,
      question,
      background: seed.background || 'Background synthesis pending — extend the seed template.',
      significance: seed.significance || 'Significance reasoning pending.',
      pathway: seed.pathway || 'Pathway outline pending.',
    };
  }
}

function indexByKey(ideas) {
  const m = new Map();
  for (const it of ideas) {
    const k = `${it.field || ''}::${it.sub || ''}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }


// ------------------------------------------------------------
// OpenAIProvider — wire to any OpenAI-compatible /chat/completions endpoint.
// Works for: openai.com, Azure OpenAI, Together, Groq, OpenRouter, local llama.cpp.
// Just needs { apiKey, baseUrl, model }.
// ------------------------------------------------------------
export class OpenAIProvider extends LLMProvider {
  constructor(opts = {}) {
    super();
    this.apiKey  = opts.apiKey  || '';
    this.baseUrl = (opts.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model   = opts.model   || 'gpt-4o-mini';
  }

  async generateIdea(prompt, opts = {}) {
    const system = `You are IdeaMiner — a researcher-specific scientific inspiration engine.
Produce a 4-part research idea tailored to the chosen discipline.
Output STRICT JSON: {title, question, background, significance, pathway}.
- title: short, declarative, ≤ 80 chars
- question: one sentence, testable, contains a mechanism
- background: 2-3 sentences on current state and the gap
- significance: 2-3 sentences on theoretical or practical impact
- pathway: 2-3 sentences on a feasible technical method`;
    const user = JSON.stringify({
      field: opts.field, sub: opts.sub,
      hook: prompt || '(no specific hook from user — generate a canonical direction)',
    });
    const json = await this._chat(system, user, { json: true });
    return sanitizeIdea(JSON.parse(json));
  }

  async reviewIdea(idea) {
    const system = `You are a 3-dim peer reviewer for research ideas.
Score the idea on innovation, feasibility, importance. Each is an integer 1-5 (5 best).
Output STRICT JSON: {innovation, feasibility, importance} with a one-line reasoning per dim.`;
    const user = JSON.stringify(idea);
    const json = await this._chat(system, user, { json: true });
    return sanitizeReview(JSON.parse(json));
  }

  async _chat(system, user, { json = false } = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAIProvider: apiKey is empty. Set it in Settings or use MockLLMProvider.');
    }
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
      temperature: 0.7,
      max_tokens:  600,
    };
    if (json) body.response_format = { type: 'json_object' };

    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`OpenAI ${r.status}: ${truncate(text, 200)}`);
    }
    const data = await r.json();
    return data?.choices?.[0]?.message?.content || '{}';
  }
}

function sanitizeIdea(o) {
  return {
    title:        String(o.title        || 'Untitled'),
    question:     String(o.question     || ''),
    background:   String(o.background   || ''),
    significance: String(o.significance || ''),
    pathway:      String(o.pathway      || ''),
  };
}
function sanitizeReview(o) {
  return {
    innovation:  clamp(Math.round(Number(o.innovation  || 3)), 1, 5),
    feasibility: clamp(Math.round(Number(o.feasibility || 3)), 1, 5),
    importance:  clamp(Math.round(Number(o.importance  || 3)), 1, 5),
  };
}
