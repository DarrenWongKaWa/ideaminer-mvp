# InsightRecoder · Inspiration Graph

> *A local-first fragmented-inspiration recorder with automatic short- and
> long-range connection detection, in-browser graph view, optional
> multi-user GitHub-Issues-backed "Insight Pool", and standalone export.*

InsightRecoder is a small tool for capturing the things that pop into
your head — a half-sentence, a phrase, a question — and seeing how
they connect. Every save surfaces **3 algorithmic suggestions** of
similar past inspirations. The **graph view** clusters them by an
in-browser Louvain community detection, so the structure of your
thinking emerges visually.

This is a **pure-frontend, no-build** app — every line of code runs
in the browser. All data stays in your `localStorage`. The only
network calls are the vis-network CDN load and (optionally) the
GitHub REST API for the v0.7 Insight Pool.

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
- 🌐 **Insight Pool (v0.7, opt-in)** — connect a GitHub Issues
  repo to share inspirations with a community. Read is free for
  public repos; publish + reactions need a fine-grained PAT with
  `issues: write`. See "Connecting a pool" below.
- 📅 **Timeline view** — chronological list grouped by ISO week
  (`2026-W23`), with inline search using the v0.4.0 keyword scorer.
- 📚 **My view** — all inspirations with delete + 4 export buttons:
  - **JSON** — full data dump (now includes pool config + cache)
  - **Markdown** — weekly timeline
  - **Standalone HTML** — single inlined file with vis-network + data
  - **GraphML** — importable into Gephi / yEd
- 🔒 **Local-first** — no LLM calls at runtime, no tracking, no
  account. Your data lives in your browser's `localStorage`.
  The pool is an *opt-in* layer on top.

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
│  │          │   │  + cross-pool)    │          │
│  │          │   └──────────────────┘          │
│  │          │                                  │
│  │          │   ┌────────────┐   ┌──────────┐ │
│  │          │──>│ storage.js │   │ voice.js │ │
│  │          │   │ (LocalStorage│  │ (WebSpeech)│
│  │          │   │  + pool)    │   │          │ │
│  │          │   └────────────┘   └──────────┘ │
│  │          │   ┌────────────┐   ┌──────────┐ │
│  │          │──>│ pool.js    │   │ export.js│ │
│  │          │   │ (GitHub    │   │ (JSON/MD/│ │
│  │          │   │  Issues    │   │  HTML/GML)│ │
│  │          │   │  client)   │   └──────────┘ │
│  └──────────┘   └────────────┘                │
│                                                 │
│  Network calls: vis-network CDN, api.github.com (opt-in pool) │
└────────────────────────────────────────────────┘
```

| Module                      | Role                                        |
|----------------------------|---------------------------------------------|
| `app.js`                   | Hash router, 7 pages (`#/profile, #/capture, #/graph, #/timeline, #/pool, #/my, #/settings`) + 5-item bottom nav |
| `insight-connections.js`   | TF-IDF cosine, `suggestLinks`, `buildGraph` (with optional `poolInspirations` for cross-community edges), in-browser Louvain `detectCommunities` |
| `storage.js`               | `LocalStorageProvider` with v0.6 surface + 6 v0.7 pool methods (config / cache / reactions / setPoolOrigin) |
| `pool.js`                  | `GitHubIssuePool` client (fetch / publish / react / unreact) + 4 typed error classes |
| `voice.js`                 | Web Speech API wrapper (zh-CN, interim results) |
| `idea-search.js`           | TF-IDF-style keyword scorer (re-used by timeline search) |
| `export.js`                | `exportJson / exportMarkdown / exportStandaloneHtml / exportGraphml`; v0.7 JSON export includes pool config + cache + reactions |
| `llm-provider.js`          | Abstract `LLMProvider` + no-op `MockLLMProvider` (kept for compile compat; not used at runtime) |
| `reviewer.js`              | No-op `MockReviewer` (kept for compile compat) |

---

## 🌐 Insight Pool (v0.7, opt-in)

v0.7 layers an optional **multi-user "Insight Pool"** on top of
v0.6.2's local-first store. The pool is a GitHub Issues repo you
pick — a public one for a quick read-only test, a private one for
a friend group, a class repo for a teacher. Each inspiration you
publish becomes a GitHub issue; each reaction becomes a
`POST /reactions`.

### Connecting a pool

1. Go to `#/settings`. Scroll to the **Insight Pool** section.
2. Fill in `owner / repo` (e.g. `octocat / Hello-World` for a
   public read-only test).
3. *(Optional)* Paste a [fine-grained PAT](https://github.com/settings/tokens?type=beta)
   with **Issues: Read & Write** scoped to that single repo. The
   token is stored in `localStorage` (plaintext — acceptable for
   an MVP; v0.8 may add Web Crypto).
4. Tap **Connect pool**. The first sync runs immediately and
   populates the **Pool** tab.
5. To publish an inspiration, tick the **📤 Also publish to
   <owner>/<repo>** checkbox in `#/capture` before saving. The
   issue number is recorded on your local copy (shown in `#/my`
   under "Published to <repo>").

### How it stays local-first

- **No config → no API calls.** The `/pool` tab shows a "Connect"
  empty state. `pool.publish` throws `PoolNotConfigured` if you
  haven't supplied a token.
- **The cache is local.** `js/storage.js` holds the last-synced
  list of pool issues plus a `myReaction` override map, so
  reactions stay snappy even when GitHub is rate-limited
  (5000/hr authenticated, 60/hr per IP for unauth).
- **Cross-community graph.** Pool nodes appear on `#/graph` with a
  dashed border, connected to your local nodes by a
  `kind: 'cross'` edge at TF-IDF cosine > 0.25. Pinned local
  links stay `kind: 'pinned'`.
- **Token never in URL.** Always `Authorization: token <PAT>`.

### Token security

The PAT is stored in `localStorage` under
`insightrecoder.pool-config.v1`. The token is **never** written
to a URL, a log line, or a query string. If you export a JSON
file, the token is included in the payload — redact it before
sharing the file. v0.8 will add optional Web Crypto encryption
with a user-supplied passphrase.

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
- `insightrecoder.pool-config.v1` — `{owner, repo, token}` or absent
- `insightrecoder.pool-cache.v1` — array of `PoolInspiration`
- `insightrecoder.pool-reactions.v1` — `{issueNumber: '+1'|'-1'|null}` overrides

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

- v0.6 — capture, connections, graph, export (local-first)
- v0.7 — current: optional GitHub-Issues-backed **Insight Pool**
  (read public repos unauthenticated; publish + react with a
  fine-grained PAT). Cross-community graph edges via TF-IDF
  cosine > 0.25.
- v0.8 — semantic embeddings (model loaded from CDN) for richer
  short-range vs long-range distinction; Web Crypto token
  encryption; comments / threaded discussion.

---

## License

MIT. See [LICENSE](LICENSE).
