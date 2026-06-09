/**
 * reviewer.js
 * ------------------------------------------------------------
 * 3 维度评审（创新 / 可行 / 重要）。
 *
 * 抽象点：
 *  - MVP 用稳定哈希 + 长度启发式打分（deterministic），保证
 *    同一条 idea 在不同 session 中得到的分数相同。
 *  - 真实现成可换成 LLM-as-judge（OpenAILLMReviewer 等），
 *    只要满足 .review(ideaDraft): Promise<Review> 即可。
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} Review
 * @property {number} innovation    0-100
 * @property {number} feasibility   0-100
 * @property {number} importance    0-100
 * @property {string} summary       一句话点评
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
   * 用 FNV-1a 32-bit 哈希生成稳定伪随机分数。
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
    // 模拟评审耗时（不要让用户感觉瞬时）
    await new Promise((r) => setTimeout(r, 80 + Math.random() * 120));

    const key = (ideaDraft && ideaDraft.question) || '';
    const h = this._hash(key);

    // 三维各自独立的稳定分桶
    const innovation = 55 + (h % 40);          // 55-94
    const feasibility = 45 + ((h >>> 7) % 45); // 45-89
    const importance = 60 + ((h >>> 14) % 35);  // 60-94

    // 一句话点评：基于 hash 取一个固定的尾句
    const tags = [
      '选题切口清晰，可执行。',
      '创新度突出，建议进一步收窄。',
      '可行性受限于方法门槛。',
      '对领域发展有重要参考价值。',
      '可与现有工作形成差异化竞争。',
      '需要补充对照实验或理论框架。',
    ];
    const summary = tags[h % tags.length];

    return { innovation, feasibility, importance, summary };
  }
}
