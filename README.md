# IdeaMiner · 科研灵感探索 MVP

**复现ideaminer并添加输入功能**

> IdeaMiner 是一个面向科研工作者的灵感发现工具：在「完善科研画像 → 灵感探索 → 3 维评审 → 互动反馈」的闭环中，帮你从自己学科的视角持续看到值得研究的问题。

这是一份**纯前端、无构建步骤**的「丐版」MVP，所有代码都跑在浏览器里。MockLLMProvider 从
`data/mock-ideas.json` 随机挑选并以 400-800ms 的延迟返回 idea；LocalStorageProvider
保存画像、收藏与反馈；所有模块都通过 JSDoc 类型契约暴露，未来可以零成本切换成真实后端。

---

## 1. 架构

```
┌────────────────────────────────────────────────┐
│  Browser (HTML/CSS/JS SPA)                      │
│  ┌──────────┐   ┌──────────────────┐          │
│  │ app.js   │──>│ IdeaGenerator    │          │
│  │ (router) │   └──────┬───────────┘          │
│  └──────────┘          │                       │
│              ┌─────────┼──────────┐            │
│              ▼         ▼          ▼            │
│     LLMProvider  Reviewer    Storage          │
│     (Mock impl)  (hash-based) (localStorage)  │
└────────────────────────────────────────────────┘
```

模块对应文件：

| 文件 | 角色 | 可替换为 |
| --- | --- | --- |
| `js/llm-provider.js` | LLMProvider 接口 + MockLLMProvider | 真实 OpenAI / Claude / 国产大模型 |
| `js/storage.js` | Storage 接口 + LocalStorageProvider | IndexedDB / Supabase / 自建 API |
| `js/reviewer.js` | Reviewer 接口 + MockReviewer | LLM-as-judge / 规则评分 |
| `js/idea-generator.js` | 串联 LLM + Reviewer + Storage 偏好的调度器 | 增加 ranking / A/B 逻辑 |
| `js/voice.js` | Web Speech API 包装 | 第三方语音 SDK（讯飞 / 阿里云） |
| `js/app.js` | 路由 + 页面渲染 | 任意前端框架（React / Vue） |

---

## 2. 如何运行

无任何依赖。打开一个本地静态服务器即可：

```bash
cd ideaminer-mvp
python3 -m http.server 8080
# 然后浏览器打开 http://localhost:8080
```

> 直接 `file://` 双击 `index.html` 也能渲染，但**语音输入**、**fetch mock JSON** 在某些浏览器下需要 http(s) 协议。

首次进入会跳到「完善科研画像」；填好 3 个字段后点「继续」即进入灵感探索页。

---

## 3. 关键交互行为

- **完善科研画像 (`#/profile`)** — 3 个字段：领域（下拉）/ 研究方向（带 🎤 语音按钮）/ 研究年龄（下拉）。所有字段都校验后才会写入 `localStorage`。
- **灵感探索 (`#/explore`)** — 进入页面会拉一条 idea 并展示：核心问题、3 段背景/意义/方法、3 个评审分数（创新 / 可行 / 重要）、4 个反馈按钮：
  - 👎 不喜欢 → `recordFeedback('dislike')` + 拉下一条
  - 🚫 不相关 → `recordFeedback('unrelated')` + 拉下一条
  - ❤️ 喜欢 → `saveIdea()` + `recordFeedback('like')` + 拉下一条
  - 📋 复制 → 复制 idea 全文到剪贴板
- **收藏 (`#/saved`)** — 列出已保存的 idea，可单条删除。
- **我的 (`#/my`)** — 展示当前画像、反馈统计、收藏数。点「重新设置画像」回到 profile 页。

切换路由会中止正在进行的 LLM 请求（`AbortController`），避免泄漏。

---

## 4. 如何替换为真实 LLM

只改一个 import 即可。`js/app.js` 顶部：

```js
import { MockLLMProvider } from './llm-provider.js';
//  ↓ 改成 ↓
import { OpenAILLMProvider } from './openai-llm-provider.js';
```

新类只要实现同样的接口（参见 `js/llm-provider.js` 顶部的 JSDoc）：

```js
// js/openai-llm-provider.js
export class OpenAILLMProvider extends LLMProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
  }

  async generateIdea(profile, signal) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '你是一个科研选题助手。' },
          { role: 'user', content: JSON.stringify(profile) },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    const j = await res.json();
    // 把 LLM 输出 parse 成 { question, background, significance, methods[] }
    return j;  // <- 返回的字段必须和 IdeaDraft 一致
  }
}
```

`Storage` 和 `Reviewer` 的替换方式完全相同——只要保持接口签名，调度器 `IdeaGenerator` 内部一行都不需要改。

---

## 5. 后续路线图

按价值 / 实现成本排序：

1. **真实 LLM Provider** — OpenAI / Claude / DeepSeek / Qwen；保留 AbortSignal 即可优雅取消。
2. **后端 API Storage** — Supabase / PocketBase / 自建 Go/Python；同步接口签名不变。
3. **基于反馈历史的学习** — `IdeaGenerator._preferredField()` 现在是个空 stub；下一步把 feedback history join 到 idea 元数据，做轻量协同过滤。
4. **检索式 idea 召回** — 不再固定 12 条 mock，而是从 arXiv / OpenAlex 拉候选，让 LLM 在候选中重组、引用。
5. **科研社区版** — 多人共享反馈（去重 + 隐私保护），按「专业读者平均打分」给 idea 排序。
6. **多模态输入** — 截图论文 / 公式照片 / 录音 → 走多模态 LLM 抽取研究方向，再进入选题循环。

---

## 6. 已知限制

- 真实部署到生产时，`localStorage` 应替换成后端 KV / 用户账户，避免数据被浏览器清空时丢失。
- Web Speech API 在 Firefox 上**不支持**；当前会在检测到不支持时隐藏 🎤 按钮而不是报错，但生产环境应做更友好的引导。
- MockLLMProvider 用「同领域优先 + 随机」选 idea，长时间使用会感觉重复；真实 LLM 上线后这个问题自然消失。
- 没有无障碍（a11y）审计；M4 Air 浏览器测试覆盖 Chrome / Safari，Edge / Firefox 仅做了理论兼容性检查。
- 所有文案（提示、toast、占位符）都是中文，国际化是后续任务。
