# IdeaMiner · Research Idea Exploration MVP

> Reproduce IdeaMiner with text and voice input added.

> *An open-source playground that turns your research profile into a steady stream of
> questions worth chasing.*

IdeaMiner is an idea-discovery tool for researchers: in the loop of
**Refine Profile → Explore Ideas → 3-Dimension Review → Interactive Feedback**,
it surfaces research questions worth pursuing from the perspective of your own
discipline.

This is a **pure-frontend, no-build** MVP — every line of code runs in the
browser. `MockLLMProvider` randomly picks from `data/mock-ideas.json`
(34 hand-written ideas across 7 fields) with a 400-800ms simulated delay;
`LocalStorageProvider` persists your profile, favorites, and feedback; every
module is exposed through a JSDoc-typed contract so a real backend can be
dropped in with zero refactoring.

---

## ✨ Features

- 🔄 **4-step workflow** — Refine Profile → Explore Ideas → 3D Review → Feedback
- 🎤 **Voice input (zh-CN)** + text input, with pulse animation and error toasts
- 📊 **3-dimension review** — Innovation / Feasibility / Importance, scored 0-100 per idea
- 👍 **Like / 👎 Dislike / 🚫 Unrelated** feedback buttons, next idea adapts to your preferences
- ⭐ **Save to favorites**, view profile & feedback stats
- 🧩 **Pluggable LLM provider** — Mock today, OpenAI-compatible tomorrow
  (`js/openai-llm-provider.js`, one-click switch in the ⚙️ Settings page)
- 🚀 **One-click deploy** — GitHub Pages workflow out of the box

---

## 🎬 Live Demo

> **https://darrenwongkawa.github.io/ideaminer-mvp/**

The app is automatically redeployed on every push to `main` via
`.github/workflows/deploy.yml`.

---

## 🚀 Quick Start

No dependencies. Spin up a local static server:

```bash
git clone https://github.com/DarrenWongKaWa/ideaminer-mvp.git
cd ideaminer-mvp
python3 -m http.server 8080
# then open http://localhost:8080 in your browser
```

> You can also open `index.html` directly, but **voice input** and
> **fetch mock JSON** require http(s) in some browsers.

On first visit you are sent to the profile form; fill in the 3 fields and click
**Continue** to enter the explore page.

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

Module-to-file mapping:

| File | Role | Replace with |
| --- | --- | --- |
| `js/llm-provider.js` | `LLMProvider` interface + `MockLLMProvider` + `createProvider()` factory | Real OpenAI / Claude / domestic LLMs |
| `js/openai-llm-provider.js` | `OpenAILLMProvider` — OpenAI-compatible implementation | Any other compatible service (DeepSeek / Qwen / Moonshot) |
| `js/storage.js` | `Storage` interface + `LocalStorageProvider` (with in-memory mirror) | IndexedDB / Supabase / your own API |
| `js/reviewer.js` | `Reviewer` interface + `MockReviewer` (FNV-1a hash) | LLM-as-judge / rule-based scoring |
| `js/idea-generator.js` | Orchestrator: chains LLM + Reviewer + Storage preferences | Add ranking / A/B logic |
| `js/voice.js` | Web Speech API wrapper (zh-CN, feature-detected) | Third-party voice SDK (iFlytek / Aliyun) |
| `js/app.js` | Hash router + page rendering | Any frontend framework (React / Vue) |

`AbortController` is propagated from the router into `LLMProvider.generateIdea`
on route changes, preventing in-flight request leaks.

---

## 🧪 How to use a real LLM

The simplest way: open the **⚙️ Settings** page, switch the provider to
`OpenAI`, paste your API key, and save — no code changes, no restart.

If you prefer editing source, the top of `js/app.js`:

```js
import { MockLLMProvider } from './llm-provider.js';
//  ↓ change to ↓
import { OpenAILLMProvider } from './openai-llm-provider.js';
```

The new class just has to implement the same interface (see the JSDoc at the
top of `js/llm-provider.js`):

```js
// js/openai-llm-provider.js (excerpt)
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
          { role: 'system', content: 'You are a research idea assistant.' },
          { role: 'user', content: JSON.stringify(profile) },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    const j = await res.json();
    return j;  // returned fields must match the IdeaDraft shape
  }
}
```

`Storage` and `Reviewer` are swapped the same way — keep the interface
signatures and the `IdeaGenerator` orchestrator needs no internal changes.

---

## 🛣️ Roadmap

Ordered by value / implementation cost:

1. ✅ **Real LLM provider** — OpenAI-compatible, shipped in v0.2.0
   (`js/openai-llm-provider.js`, switchable from ⚙️ Settings)
2. **Backend API storage** — Supabase / PocketBase / your own Go/Python service;
   interface signatures stay the same
3. **Feedback-aware learning** — `IdeaGenerator._preferredField()` is currently a
   stub; next step is to join feedback history with idea metadata for
   lightweight collaborative filtering
4. **Retrieval-augmented idea recall** — instead of being limited to 34 mock
   ideas, pull candidates from arXiv / OpenAlex and have the LLM remix them
   with citations
5. **Research community version** — share feedback across users (with dedup and
   privacy), rank ideas by the average expert-reader score
6. **Multimodal input** — screenshot a paper / photo of an equation / voice
   recording → run a multimodal LLM to extract the research direction, then
   enter the idea loop

---

## 🚢 Deployment

**GitHub Pages (recommended)**:

1. Push the repo to GitHub.
2. Open repo Settings → Pages → Source: **GitHub Actions**.
3. Every push to `main` triggers `.github/workflows/deploy.yml` and
   auto-deploys. The URL appears in the Actions run summary, e.g.
   `https://<org>.github.io/ideaminer-mvp/`

The `.nojekyll` file tells GitHub Pages to skip Jekyll processing
(repositories may contain `_`-prefixed metadata directories that Jekyll would
otherwise treat as special).

**Other static hosts**:

The repo is pure static, deployable to any static server:

- **Vercel / Netlify / Cloudflare Pages**: connect the GitHub repo, leave the
  build command empty, set the output directory to `.`, auto-deploy.
- **Your own Nginx**: `rsync -av --delete ./ user@host:/var/www/ideaminer/`.

---

## 📝 Changelog

See [CHANGELOG.md](./CHANGELOG.md). Current version: **v0.2.0** (English + Polish release).

---

## ⚠️ Known Limitations

- For real production deployment, `localStorage` should be replaced with
  backend KV / user accounts, so data is not lost when the user clears site
  data.
- Web Speech API is **not supported** in Firefox; the 🎤 button is auto-hidden
  when the API is missing.
- `MockLLMProvider` uses "same-field preference + random" to pick ideas, so
  long sessions can feel repetitive. Switching to a real LLM removes this.
- No full accessibility (a11y) audit; tested on Chrome / Safari on M4 Air;
  Edge / Firefox only verified for theoretical compatibility.
- Voice input language is `zh-CN`. Other languages require changing the
  `recognition.lang` value in `js/voice.js`.

---

## 📄 License

MIT — see [LICENSE](./LICENSE).
