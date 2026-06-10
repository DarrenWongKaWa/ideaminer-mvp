/**
 * idea-generator.js
 * ------------------------------------------------------------
 * Wires LLMProvider + Reviewer + Storage together:
 *   1. Inspect storage.getFeedbackHistory() to infer the preferred field
 *   2. Call llmProvider.generateIdea(profile, signal)
 *   3. Call reviewer.review(draft)
 *   4. Merge into a ReviewedIdea with a stable id and generatedAt
 *
 * Extension points:
 *  - Scheduling logic is decoupled from concrete LLM / Reviewer / Storage; to extend
 *    you only swap the implementation in app.js, IdeaGenerator internals stay the same.
 *  - nextWithQuery() lets the caller (Explore Ideas search row) pull a specific
 *    idea by free-form text or voice. The keyword search lives in idea-search.js.
 *    When the underlying provider is a real LLM (not Mock), search degrades
 *    gracefully — _loadIdeas() falls back to a direct fetch of
 *    data/mock-ideas.json when the provider does not expose getIdeas().
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} ResearchProfile
 * @property {string} field
 * @property {string} direction
 * @property {string} age
 */

import { MockReviewer } from './reviewer.js';
import { bestMatch } from './idea-search.js';

export class IdeaGenerator {
  /**
   * @param {import('./llm-provider.js').LLMProvider} llmProvider
   * @param {import('./reviewer.js').Reviewer} [reviewer]
   * @param {import('./storage.js').Storage} storage
   */
  constructor(llmProvider, reviewer, storage) {
    this.llm = llmProvider;
    this.reviewer = reviewer || new MockReviewer();
    this.storage = storage;
    // Cache for the search-fallback path (used when llm.getIdeas is missing).
    this._mockIdeasCache = null;
    this._mockIdeasInflight = null;
  }

  /**
   * Infer the user's most-liked field (based on feedback history).
   * MVP strategy: find all ideaIds with type='like', then look up their field
   * in history (mock data uses idea-XXX numbering).
   * A real implementation would join against the database.
   * @returns {string|null}
   */
  _preferredField() {
    const history = this.storage.getFeedbackHistory();
    const likes = history.filter((f) => f.type === 'like');
    if (likes.length === 0) return null;
    // MVP heuristic: take the most recent like's ideaId and extract the field
    // (mock data numbering idea-001..idea-012 maps to 6 fields)
    // A real scenario should join against a database here
    return null; // let MockLLMProvider do uniform random on its own
  }

  /**
   * Load the ideas array used for the search path.
   *
   * Resolution order:
   *   1. If the LLM provider exposes `getIdeas()` (e.g. MockLLMProvider),
   *      prefer it — the provider may have already cached the data.
   *   2. Otherwise fall back to a one-time `fetch('data/mock-ideas.json')`
   *      and cache the result on the instance. This keeps the search
   *      working even with real LLM providers (e.g. OpenAILLMProvider)
   *      that have no local ideas array.
   *
   * @returns {Promise<Array>}
   */
  async _loadIdeas() {
    if (typeof this.llm.getIdeas === 'function') {
      try {
        const ideas = await this.llm.getIdeas();
        if (Array.isArray(ideas) && ideas.length > 0) return ideas;
      } catch (err) {
        // Fall through to the direct-fetch fallback.
        console.warn('IdeaGenerator: llm.getIdeas() failed, falling back to fetch:', err);
      }
    }
    if (this._mockIdeasCache) return this._mockIdeasCache;
    if (this._mockIdeasInflight) return this._mockIdeasInflight;
    this._mockIdeasInflight = fetch('data/mock-ideas.json', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching data/mock-ideas.json`);
        return r.json();
      })
      .then((j) => {
        if (!j || !Array.isArray(j.ideas)) {
          throw new Error('data/mock-ideas.json must contain an "ideas" array');
        }
        this._mockIdeasCache = j.ideas;
        return j.ideas;
      })
      .catch((err) => {
        this._mockIdeasInflight = null;
        throw err;
      });
    return this._mockIdeasInflight;
  }

  /**
   * Generate the next idea draft and complete the review.
   * @param {ResearchProfile} profile
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('./storage.js').ReviewedIdea>}
   */
  async next(profile, signal) {
    // 1. LLM generation
    const draft = await this.llm.generateIdea(profile, signal);

    // 2. Review
    const review = await this.reviewer.review(draft);

    // 3. Merge
    const id = 'rv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    return {
      id,
      question: draft.question,
      background: draft.background,
      significance: draft.significance,
      methods: draft.methods,
      review,
      generatedAt: Date.now(),
    };
  }

  /**
   * Generate the next idea from a free-form search query.
   * - Empty / whitespace query -> falls back to this.next(profile, signal).
   * - Non-empty query -> tokenize and score the local ideas array
   *   (this._loadIdeas()). If no idea matches, throws an Error with a
   *   recognizable message (the app uses this to render the "no match"
   *   empty state). If a match is found, the idea is wrapped into a
   *   ReviewedIdea (same shape as this.next) so the existing feedback /
   *   save code paths work unchanged.
   * - For real LLM providers (no local ideas array), this method
   *   currently falls back to a direct fetch of data/mock-ideas.json
   *   so the search still works over the 34 hand-written ideas. A
   *   future version can pass the query into the LLM prompt and
   *   generate a search-flavored idea instead.
   *
   * @param {ResearchProfile} profile
   * @param {string} query          Raw user query (may be empty)
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('./storage.js').ReviewedIdea>}
   */
  async nextWithQuery(profile, query, signal) {
    const raw = (query == null ? '' : String(query)).trim();

    // Empty query: fall back to the regular random flow.
    if (!raw) return this.next(profile, signal);

    // Honour abort before doing any I/O.
    if (signal && signal.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }

    let ideas;
    try {
      ideas = await this._loadIdeas();
    } catch (err) {
      throw new Error('No idea matched "' + raw + '"');
    }
    if (signal && signal.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    if (!Array.isArray(ideas) || ideas.length === 0) {
      throw new Error('No idea matched "' + raw + '"');
    }

    const hit = bestMatch(ideas, raw);
    if (!hit) {
      // Recognizable error: app.js pattern-matches on the prefix to
      // show the "no match + Surprise me" empty state.
      throw new Error('No idea matched "' + raw + '"');
    }

    // Use the matched raw idea (with id/field) as the draft; the
    // reviewer runs over the question to produce stable scores.
    const pick = hit.idea;
    const draft = {
      question: pick.question,
      background: pick.background,
      significance: pick.significance,
      methods: Array.isArray(pick.methods) ? pick.methods.slice() : [],
    };

    const review = await this.reviewer.review(draft);
    if (signal && signal.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }

    // Preserve the original idea id when present so feedback / save
    // continues to dedupe correctly; otherwise mint a fresh id.
    const id = (pick.id && /^idea-/.test(pick.id))
      ? 'search-' + pick.id
      : 'rv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

    return {
      id,
      question: draft.question,
      background: draft.background,
      significance: draft.significance,
      methods: draft.methods,
      review,
      generatedAt: Date.now(),
      // Surface the matched score for the "Matched: <query>" badge.
      _matchedQuery: raw,
      _score: hit.score,
      _sourceIdeaId: pick.id || null,
    };
  }
}
