# InsightRecoder · Inspiration Graph

> *A local-first fragmented-inspiration recorder with automatic short- and
> long-range connection detection, in-browser graph view, and standalone
> export.*

InsightRecoder is a small tool for capturing the things that pop into
your head — a half-sentence, a phrase, a question — and seeing how
they connect. Every save surfaces **3 algorithmic suggestions** of
similar past inspirations. The **graph view** clusters them by an
in-browser Louvain community detection, so the structure of your
thinking emerges visually.

This is a **pure-frontend, no-build** app — every line of code runs
in the browser. All data stays in your `localStorage`. The only
network call is the vis-network CDN load.

---

## ✨ Features

- 🎤 **Capture box** — type or dictate a single sentence. The box is
  always visible at the top of `#/capture`, with `⌘/Ctrl + Enter` to
  save and 🎤 voice input (zh-CN).
- 🔗 **Auto-suggested links** — every save surfaces the top-3 most
  similar past inspirations (TF-IDF cosine similarity). Pin a
  suggestion with one tap; pinned links persist across sessions.
- 🕸️ **Graph view** — every inspiration is a node, edges connect
  similar pairs. Nodes are colored by Louvain community detection
  (computed in the browser; ~3 KB algorithm). Click a node to see
  its full text and connected inspirations.
- 📅 **Timeline view** — chronological list grouped by ISO week
  (`2026-W23`), with inline search using the v0.4.0 keyword scorer.
- 📚 **My view** — all inspirations with delete + 4 export buttons:
  - **JSON** — full data dump
  - **Markdown** — weekly timeline
  - **Standalone HTML** — single inlined file with vis-network + data
  - **GraphML** — importable into Gephi / yEd
- 🔒 **Local-first** — no LLM calls at runtime, no tracking, no
  account. Your data lives in your browser's `localStorage`.

---

## 🎬 Live Demo

> **https://darrenwongkawa.github.io/insightrecoder/**

The app is automatically redeployed on every push to `main` via
`.github/workflows/deploy.yml`.

---

## 🚀 Quick Start

No dependencies. Spin up a local static server:

```bash
git clone https://github.com/DarrenWongKaWa/insightrecoder.git
cd insightrecoder
python3 -m http.server 8080
# then open http://localhost:8080 in your browser
```

> You can also open `index.html` directly, but **voice input** and
> **CDN scripts** may require `http(s)` in some browsers.

On first visit you are sent to the capture page. The research
profile (`#/profile`) is optional — it lets you tag inspirations
with your field and direction.

---

## 📐 Architecture

```
┌────────────────────────────────────────────────┐
│  Browser (HTML/CSS/JS SPA)                      │
│  ┌──────────┐   ┌──────────────────┐          │
│  │ app.js   │──>│ insight-          │          │
│  │ (router) │   │ connections.js    │          │
│  │          │   │ (TF-IDF + Louvain)│          │
│  │          │   └──────────────────┘          │
│  │          │                                  │
│  │          │   ┌────────────┐   ┌──────────┐ │
│  │          │──>│ storage.js │   │ voice.js │ │
│  │          │   │ (LocalStorage)│  │ (WebSpeech)│
│  │          │   └────────────┘   └──────────┘ │
│  │          │   ┌────────────┐   ┌──────────┐ │
│  │          │──>│ export.js  │   │ idea-    │ │
│  │          │   │ (JSON/MD/  │   │ search.js│ │
│  │          │   │  HTML/GML) │   │ (scorer) │ │
│  └──────────┘   └────────────┘   └──────────┘ │
│                                                 │
│  Only network call: vis-network CDN             │
└────────────────────────────────────────────────┘
```

| Module                      | Role                                        |
|----------------------------|---------------------------------------------|
| `app.js`                   | Hash router, 6 pages (`#/profile, #/capture, #/graph, #/timeline, #/my, #/settings`) |
| `insight-connections.js`   | TF-IDF cosine, `suggestLinks`, `buildGraph`, in-browser Louvain `detectCommunities` |
| `storage.js`               | `LocalStorageProvider` (insync, in-memory mirror for node tests) |
| `voice.js`                 | Web Speech API wrapper (zh-CN, interim results) |
| `idea-search.js`           | TF-IDF-style keyword scorer (re-used by timeline search) |
| `export.js`                | `exportJson / exportMarkdown / exportStandaloneHtml / exportGraphml` |
| `llm-provider.js`          | Abstract `LLMProvider` + no-op `MockLLMProvider` (kept for compile compat; not used at runtime) |
| `reviewer.js`              | No-op `MockReviewer` (kept for compile compat) |

---

## 💾 Data model

```js
// Inspiration
{
  id: 'insp-<timestamp36>-<rand>',
  text: 'string',                     // REQUIRED, single field
  createdAt: <epoch ms>,
  tags: ['tag1', 'tag2'],             // optional, lowercase, deduped
  source: 'text' | 'voice',
}

// Link
{
  source: '<inspirationId>',
  target: '<inspirationId>',
  score: 0.42,                         // TF-IDF cosine, 0..1
  kind: 'inferred' | 'pinned',         // 'inferred' = algorithm, 'pinned' = user-clicked
  createdAt: <epoch ms>,
}
```

localStorage keys:

- `insightrecoder.inspirations.v1` — array, newest first
- `insightrecoder.links.v1` — array of links
- `insightrecoder.profile.v1` — `{field, direction, age}`
- `insightrecoder.provider.v1` — provider picker (kept; not used at runtime)

### Migration from v0.5.x IdeaMiner

On first boot, if `ideaminer.user-ideas.v1` exists in localStorage
and the new key does not, v0.6 will:

1. Read the legacy entries.
2. Transform each `{id, question, field, ...}` into
   `{id, text: question, tags: [field?], source: 'text'}`.
3. Write to `insightrecoder.inspirations.v1`.
4. Delete the legacy key.

The migration is one-shot and never overwrites an existing new key.
If the new key already exists, the legacy key is deleted silently.

---

## 🧪 Development

```bash
# Sanity check
node --check js/app.js
node --check js/storage.js
node --check js/insight-connections.js
node --check js/export.js

# Run the module-level smoke test (no DOM)
node verify-v06.js
```

---

## 🗺️ Roadmap

- v0.6 — current: capture, connections, graph, export (local-first)
- v0.7 — multi-device sync (a self-hosted backend, opt-in)
- v0.8 — semantic embeddings (model loaded from CDN) for richer
  short-range vs long-range distinction

---

## License

MIT. See [LICENSE](LICENSE).
