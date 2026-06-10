/**
 * reviewer.js
 * ------------------------------------------------------------
 * 3-dimension review (Innovation / Feasibility / Importance).
 *
 * Extension points:
 *  - MVP uses stable hashing + a length heuristic for scoring (deterministic),
 *    so the same idea gets the same scores across sessions.
 *  - The real implementation can swap in LLM-as-judge (OpenAILLMReviewer etc.)
 *    as long as it satisfies .review(ideaDraft): Promise<Review>.
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} Review
 * @property {number} innovation    0-100
 * @property {number} feasibility   0-100
 * @property {number} importance    0-100
 * @property {string} summary       One-sentence assessment
 */

export class Reviewer {
  /**
   * @param {IdeaDraft} _ideaDraft
   * @returns {Promise<Review>}
   */
  async review(_ideaDraft) {
    throw new Error('Reviewer.review() not implemented — override in subclass');
  }
}

export class MockReviewer extends Reviewer {
  /**
   * Generate a stable pseudo-random score with FNV-1a 32-bit hashing.
   * @param {string} s
   */
  _hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * @param {IdeaDraft} ideaDraft
   * @returns {Promise<Review>}
   */
  async review(ideaDraft) {
    // Simulate review latency (so the user does not perceive an instant result)
    await new Promise((r) => setTimeout(r, 80 + Math.random() * 120));

    const key = (ideaDraft && ideaDraft.question) || '';
    const h = this._hash(key);

    // Three independent stable score buckets for the three dimensions
    const innovation = 55 + (h % 40);          // 55-94
    const feasibility = 45 + ((h >>> 7) % 45); // 45-89
    const importance = 60 + ((h >>> 14) % 35);  // 60-94

    // One-sentence assessment: pick a fixed tail sentence based on the hash
    const tags = [
      'Clear angle, executable.',
      'Strong novelty; recommend narrowing further.',
      'Feasibility is gated by methodological overhead.',
      'Important reference value for the field.',
      'Can differentiate from existing work.',
      'Needs additional control experiments or a theoretical framework.',
    ];
    const summary = tags[h % tags.length];

    return { innovation, feasibility, importance, summary };
  }
}
