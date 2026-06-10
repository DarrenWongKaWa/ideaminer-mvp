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
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} ResearchProfile
 * @property {string} field
 * @property {string} direction
 * @property {string} age
 */

import { MockReviewer } from './reviewer.js';

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
}
