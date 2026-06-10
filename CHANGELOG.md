# Changelog

All notable changes to InsightRecoder (formerly IdeaMiner MVP).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-06-11

> **Project pivot**: IdeaMiner (a research-idea generator) is now
> InsightRecoder (a fragmented-inspiration recorder with graph
> view). v0.5.x is preserved below as a historical release.

### Added
- **Capture box (`#/capture`, default route)** — single textarea +
  🎤 voice button + Save (`⌘/Ctrl + Enter`). Always visible at the
  top. Auto-saves to localStorage; suggests the top-3 most similar
  past inspirations on every save.
- **Top-3 suggestions panel** — TF-IDF cosine similarity over the
  current corpus. Each suggestion card shows the matching
  inspiration's text, score, and a `🔗 Pin` button. Pinning
  promotes the link to `kind='pinned'` and persists it.
- **Graph view (`#/graph`)** — vis-network 9.1.6 (loaded from
  unpkg). Nodes colored by in-browser Louvain community detection
  (5-7 community palette). Edge thickness = score. Click a node to
  see its full text, metadata, and connected inspirations in a side
  panel. A "Recompute graph" button rebuilds the entire layout
  against the current vocabulary.
- **Timeline view (`#/timeline`)** — chronological list grouped by
  ISO week (`2026-W23`). Inline search reuses the v0.4.0
  keyword scorer (`bestMatch` from `idea-search.js`).
- **My view (`#/my`)** — all inspirations with delete + 4 export
  buttons:
  - **JSON** — full data dump (re-importable in a future release)
  - **Markdown** — weekly timeline
  - **Standalone HTML** — single inlined file with vis-network + data
  - **GraphML** — Gephi / yEd compatible
- **`js/insight-connections.js`** — TF-IDF cosine, `suggestLinks`,
  `buildGraph`, in-browser Louvain `detectCommunities`, and
  `colorizeCommunities`. ~3 KB Louvain port; no external
  dependencies beyond vis-network.
- **`js/export.js`** — `buildExportPayload` plus the four
  `exportXxx` functions, each returning a `{blob, filename,
  mimeType}` triple. Pure functions; no DOM access.
- **Storage API** — `addInspiration / getInspirations /
  getInspiration / deleteInspiration / updateInspiration /
  addLink / removeLink / getLinks / getPinnedLinks`. The
  `deleteInspiration` cascade-deletes any links touching the
  removed id.
- **Migration on boot** — one-shot read of
  `ideaminer.user-ideas.v1`; if present and the new key absent,
  transform and move entries; delete the legacy key. Idempotent.
- **Settings page (`#/settings`)** — kept, simplified. Provider
  picker is preserved as a future hook (v0.6 is local-first; no
  LLM call at runtime). A "Clear all data" button wipes every
  `insightrecoder.*` key.
- **Louvain fallback** — if the Louvain result degenerates to a
  single community and the graph has multiple connected
  components, we fall back to a connected-components label so the
  user still sees distinct colors per cluster. Documented in
  `deliverable.md`.

### Changed
- **Project name**: `IdeaMiner` → `InsightRecoder`. Title bar,
  meta description, README, CHANGELOG.
- **Default route**: `#/profile` (v0.5.x) → `#/capture` (v0.6).
  The profile page is still reachable; it is no longer a gate.
- **`js/llm-provider.js`**: `MockLLMProvider` is now a no-op stub
  (kept for compile-compat with the settings page). Calling
  `generateIdea()` on it rejects with a clear "no idea generation
  in v0.6" message.
- **`js/reviewer.js`**: `MockReviewer` is a no-op stub. v0.6 does
  not score inspirations at capture time; connection detection
  is the only scoring path and it runs over the live corpus.
- **Bottom nav**: 4 icons (Explore / Saved / Profile / Settings) →
  4 icons (Capture / Graph / Timeline / My). The explore / saved
  flows are removed.
- **Storage keys**: `ideaminer.user-ideas.v1` →
  `insightrecoder.inspirations.v1`. The `ideaminer.saved.v1` and
  `ideaminer.feedback.v1` keys are no longer used.
- **CSS**: added `.capture-box`, `.capture-suggestions`,
  `.suggestion-card`, `.graph-container`, `.graph-sidepanel`,
  `.graph-legend`, `.timeline-week`, `.timeline-week__title`,
  `.inspiration-card`, `.my-export`, `.my-list`. Mobile-friendly
  (graph goes full-screen with side panel at <600px; capture box
  sticks to top).

### Removed
- **Structured idea form** — field / question / background /
  significance / methods are gone. v0.6 captures a single
  `text` field.
- **Random idea flow (`#/explore`)** — no more random idea
  generation, no "Surprise me" button, no "✨ Your idea" badge.
- **3-dim review scores on capture** — no Innovation /
  Feasibility / Importance badges.
- **Like / Dislike / Unrelated feedback** — no feedback loop; v0.6
  has a graph, not a feedback flow.
- **`/saved` route** — there is no separate "saved ideas" list;
  "pin" is the only saved gesture in v0.6.
- **`data/mock-ideas.json`** — the 34-entry research pool is
  gone.
- **`js/idea-generator.js`** — the IdeaGenerator class is gone.

### Fixed
- **First-render flicker on `#/graph`**: vis-network is loaded
  with `defer`; the loader message renders before the script is
  ready so the container is never empty.

---

## [0.5.1] - 2026-06-10  (historical: IdeaMiner MVP)

> Last release of the IdeaMiner research-idea generator. v0.6
> replaces the project with InsightRecoder.

### Fixed
- **Critical regression on first random pick after page load** —
  the v0.5.0 refactor that introduced `_mergedPool()` in
  `MockLLMProvider.generateIdea` removed the `await this._load()`
  that v0.4.0 had. On a fresh page, `this._cache` is `null` so
  the merged pool was `[...userIdeas, ...null]` = just user
  ideas, and clicking "Next idea" with no user ideas yet threw
  `MockLLMProvider: no ideas available (mock-ideas.json empty
  and no user ideas)`. Fix: restore the `await this._load()`
  before computing the merged pool.

## [0.5.0] - 2026-06-10  (historical: IdeaMiner MVP)

### Added
- **Add your own idea**: a new `#/new` page lets the user fill a form
  (field, question, background, significance, methods) with text or
  voice input.
- "✨ Your idea" badge on user-submitted cards.
- "My Ideas" section on `#/my`.
- "+ Add your own idea" pill button on the Explore Ideas page.
- `Storage.addUserIdea(draft, reviewer)` — generates a `user-…` id,
  runs `MockReviewer` for 3-dim scores, persists under
  `ideaminer.user-ideas.v1`.

(See git history for v0.4.x and earlier releases.)
