# IdeaMiner · 科研灵感探索 MVP

**复现ideaminer并添加输入功能**

> *An open-source playground that turns your research profile into a steady stream of
> questions worth chasing.* — 把科研画像变成持续可探索的研究问题。

IdeaMiner 是一个面向科研工作者的灵感发现工具：在「**完善科研画像 → 灵感探索 →
3 维评审 → 互动反馈**」的闭环中，帮你从自己学科的视角持续看到值得研究的问题。

这是一份**纯前端、无构建步骤**的「丐版」MVP —— 所有代码都跑在浏览器里。
`MockLLMProvider` 从 `data/mock-ideas.json`（34 条手写 idea，覆盖 7 个学科）随机挑选
并以 400-800ms 的延迟返回；`LocalStorageProvider` 保存画像、收藏与反馈；所有模块都
通过 JSDoc 类型契约暴露，未来可以零成本切换成真实后端。

---

## ✨ Features

- 🔄 **4-step workflow** — 完善科研画像 → 灵感探索 → 3 维评审 → 互动反馈
- 🎤 **Voice input (中文)** + text input, 自带识别脉冲动画和错误提示
- 📊 **3-dimension review** — 创新 / 可行 / 重要，每条 idea 都给出 0-10 分
- 👍 **Like / 👎 dislike / 🚫 unrelated** 反馈按钮，下一条 idea 自动适配偏好
- ⭐ **Save to favorites**, view profile & feedback stats
- 🧩 **Pluggable LLM provider** — Mock today, OpenAI-compatible tomorrow
  （`js/openai-llm-provider.js`，Settings 页面一键切换）
- 🚀 **One-click deploy** — GitHub Pages workflow 开箱即用

---

## 🎬 Live Demo

> https://&lt;your-org&gt;.github.io/ideaminer-mvp/

Will go live once GitHub Pages is enabled — see [Deployment](#-deployment) below.

---

## 🚀 Quick Start

无任何依赖。打开一个本地静态服务器即可：

```bash
git clone https://github.com/<your-org>/ideaminer-mvp.git
cd ideaminer-mvp
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

> 直接双击 `index.html` 也能渲染，但**语音输入**、**fetch mock JSON**
> 在某些浏览器下需要 http(s) 协议。

首次进入会跳到「完善科研画像」；填好 3 个字段后点「继续」即进入灵感探索页。

---

## 📐 Architecture

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
│     (Mock / OAI) (hash-based) (localStorage)  │
└────────────────────────────────────────────────┘
```

模块对应文件：

| 文件 | 角色 | 可替换为 |
| --- | --- | --- |
| `js/llm-provider.js` | `LLMProvider` 接口 + `MockLLMProvider` + `createProvider()` 工厂 | 真实 OpenAI / Claude / 国产大模型 |
| `js/openai-llm-provider.js` | `OpenAILLMProvider`，OpenAI 兼容接口实现 | 其他兼容服务（DeepSeek / Qwen / Moonshot） |
| `js/storage.js` | `Storage` 接口 + `LocalStorageProvider`（带 in-memory mirror） | IndexedDB / Supabase / 自建 API |
| `js/reviewer.js` | `Reviewer` 接口 + `MockReviewer`（FNV-1a hash） | LLM-as-judge / 规则评分 |
| `js/idea-generator.js` | 串联 LLM + Reviewer + Storage 偏好的调度器 | 增加 ranking / A/B 逻辑 |
| `js/voice.js` | Web Speech API 包装（zh-CN，feature-detected） | 第三方语音 SDK（讯飞 / 阿里云） |
| `js/app.js` | Hash 路由 + 页面渲染 | 任意前端框架（React / Vue） |

`AbortController` 在路由切换时被传播到 `LLMProvider.generateIdea`，避免泄漏。

---

## 🧪 How to use a real LLM

最简单的方式：在 **⚙️ 设置** 页面把 provider 切换到 `OpenAI`，填入 API key，保存后
立即生效 —— 无需改代码、无需重启。

如果想直接修改源码，`js/app.js` 顶部：

```js
import { MockLLMProvider } from './llm-provider.js';
//  ↓ 改成 ↓
import { OpenAILLMProvider } from './openai-llm-provider.js';
```

新类只要实现同样的接口（参见 `js/llm-provider.js` 顶部的 JSDoc）：

```js
// js/openai-llm-provider.js（节选）
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
    return j;  // 字段必须和 IdeaDraft 一致
  }
}
```

`Storage` 和 `Reviewer` 的替换方式完全相同 —— 只要保持接口签名，调度器
`IdeaGenerator` 内部一行都不需要改。

---

## 🛣️ Roadmap

按价值 / 实现成本排序：

1. ✅ **真实 LLM Provider** — OpenAI-compatible，v0.2.0 已交付
   （`js/openai-llm-provider.js`，可在 ⚙️ 设置切换）
2. **后端 API Storage** — Supabase / PocketBase / 自建 Go/Python；接口签名不变
3. **基于反馈历史的学习** — `IdeaGenerator._preferredField()` 现在是空 stub；下一步把
   feedback history join 到 idea 元数据，做轻量协同过滤
4. **检索式 idea 召回** — 不再固定 34 条 mock，而是从 arXiv / OpenAlex 拉候选，让 LLM
   在候选中重组、引用
5. **科研社区版** — 多人共享反馈（去重 + 隐私保护），按"专业读者平均打分"给 idea 排序
6. **多模态输入** — 截图论文 / 公式照片 / 录音 → 走多模态 LLM 抽取研究方向，再进入选题循环

---

## 🚢 Deployment

**GitHub Pages（推荐）**：

1. Push 仓库到 GitHub。
2. 进入仓库 Settings → Pages → Source 选择 **GitHub Actions**。
3. 之后每次推送到 `main` 分支都会触发 `.github/workflows/deploy.yml`，自动构建并部署。
4. 部署完成的 URL 会在 Actions 运行的 summary 里显示，格式：
   `https://<org>.github.io/ideaminer-mvp/`

`.nojekyll` 文件告诉 GitHub Pages 跳过 Jekyll 处理（我们的仓库里可能有
`_` 开头的元数据目录，不想被 Jekyll 当成特殊目录处理）。

**其它静态托管**：

仓库是纯静态资源，可直接部署到任何静态服务器：

- **Vercel / Netlify / Cloudflare Pages**：连接 GitHub 仓库，build command 留空，
  output directory 设为 `.`，自动部署。
- **自己的 Nginx**：`rsync -av --delete ./ user@host:/var/www/ideaminer/`。

---

## 📝 Changelog

详见 [CHANGELOG.md](./CHANGELOG.md)。当前版本：**v0.2.0**（Polish release）。

---

## ⚠️ Known Limitations

- 真实部署到生产时，`localStorage` 应替换成后端 KV / 用户账户，避免数据被浏览器清空
  时丢失。
- Web Speech API 在 Firefox 上**不支持**；检测到不支持时会自动隐藏 🎤 按钮。
- `MockLLMProvider` 用「同领域优先 + 随机」选 idea，长时间使用会感觉重复；切到真实
  LLM 后自然消失。
- 没有完整的无障碍（a11y）审计；M4 Air 浏览器测试覆盖 Chrome / Safari，Edge /
  Firefox 仅做了理论兼容性检查。
- 所有文案（提示、toast、占位符）都是中文，国际化是后续任务。

---

## 📄 License

MIT — see [LICENSE](./LICENSE).