/**
 * reviewer.js
 * ------------------------------------------------------------
 * v0.6: Kept as a no-op stub for compile-compat with any orphan
 * imports. v0.6 does not score inspirations at capture time;
 * the connection-detection engine (`insight-connections.js`)
 * is the only "scoring" path, and it runs over the live
 * corpus without persisting a numeric review.
 *
 * If a future release wants to re-introduce LLM-as-judge
 * scoring, replace the body of `MockReviewer.review` with
 * the real implementation; the public shape is unchanged.
 * ------------------------------------------------------------
 */

export class Reviewer {
  async review(_idea) {
    throw new Error('Reviewer.review() not implemented — override in subclass');
  }
}

export class MockReviewer extends Reviewer {
  constructor() { super(); }
  async review(_idea) {
    return {
      innovation: 0,
      feasibility: 0,
      importance: 0,
      summary: 'No review provided (v0.6 does not score inspirations at capture time).',
    };
  }
}
