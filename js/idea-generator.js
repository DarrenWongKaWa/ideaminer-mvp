/**
 * idea-generator.js
 * ------------------------------------------------------------
 * 把 LLMProvider + Reviewer + Storage 串起来：
 *   1. 看 storage.getFeedbackHistory() 推断偏好领域
 *   2. 调 llmProvider.generateIdea(profile, signal)
 *   3. 调 reviewer.review(draft)
 *   4. 合并为 ReviewedIdea，注入稳定的 id 和 generatedAt
 *
 * 抽象点：
 *  - 调度逻辑与具体 LLM / Reviewer / Storage 解耦，扩展时
 *    只需在 app.js 里换实现，IdeaGenerator 内部不需要改。
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
   * 推断用户最喜爱的领域（基于 feedback history）。
   * 丐版策略：找到所有 type='like' 的 ideaId，然后在历史里
   * 找 'idea-' 前缀 ID 关联的 field（mock 数据用 idea-XXX 编号）。
   * 真实现成可以从数据库 join。
   * @returns {string|null}
   */
  _preferredField() {
    const history = this.storage.getFeedbackHistory();
    const likes = history.filter((f) => f.type === 'like');
    if (likes.length === 0) return null;
    // 丐版 heuristic：取最近一个 like 的 ideaId，从 -1、-2、-3 ... 中
    // 提取领域（mock 数据已知编号在 idea-001..idea-012，对应 6 个领域）
    // 真实场景这里应该 join 数据库
    return null; // 让 MockLLMProvider 自己做均匀随机就够了
  }

  /**
   * 生成下一条 idea 草稿并完成评审。
   * @param {ResearchProfile} profile
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('./storage.js').ReviewedIdea>}
   */
  async next(profile, signal) {
    // 1. LLM 生成
    const draft = await this.llm.generateIdea(profile, signal);

    // 2. 评审
    const review = await this.reviewer.review(draft);

    // 3. 合并
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
