# Changelog
All notable changes to InsightRecoder (formerly IdeaMiner MVP).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.0] - 2026-06-11

> **Insight Pool** — an optional, opt-in multi-user layer on
> top of the v0.6.2 local-first store. v0.6.2's migration logic
> and storage surface are unchanged. Pool is a user-configured
> GitHub Issues repo: read is unauthenticated for public repos;
> publish + reactions need a fine-grained PAT with
> `issues: write`. No server of our own; the only network
> calls are to `api.github.com`.

### Added
- **`js/pool.js`** — `GitHubIssuePool` class plus 4 typed
  error classes (`PoolAuthError`, `PoolRateLimit`,
  `PoolNotConfigured`, `PoolNetworkError`). Methods:
  `fetchAll` (with the squirrel-girl reactions preview header
  so the issues call returns reaction counts in one round
  trip; pull-requests filtered out), `publish` (issue create
  with title = text slice, labels = tags slice 0..5, body =
  full text + attribution footer), `react` / `unreact`
  (`unreact` lists then DELETEs by id, since the GitHub API
  requires the reaction id), `getCache` / `setCache` /
  `isStale` / `lastSync` / `getConfig` / `setConfig`.
- **`js/storage.js`** — 6 new methods on `LocalStorageProvider`:
  `getPoolConfig`, `setPoolConfig`, `getPoolCache`,
  `setPoolCache` (dedupes by id), `getReactions`,
  `setReaction` (supports `null` to clear), and
  `setPoolOrigin` (tags a local copy as "published to
  <repo>"). New localStorage keys: `insightrecoder.pool-config.v1`,
  `insightrecoder.pool-cache.v1`, `insightrecoder.pool-reactions.v1`.
- **`js/insight-connections.js`** — `buildGraph` accepts a new
  `opts.poolInspirations` argument. Pool nodes are appended
  to the node list with `isPool: true`. A new
  `inferCrossEdges` helper builds a union corpus of
  local + pool nodes and adds cross-community edges at
  cosine > 0.25 (kind='cross'). The existing 2-arg form is
  unchanged for callers that don't pass `poolInspirations`.
- **`js/app.js`** — new `/pool` route, 5th bottom-nav item
  (Capture / Graph / Timeline / Pool / My), `renderPool` +
  `bindPoolEvents` + `syncPool` + `togglePoolReaction` +
  `savePoolToMy` + `formatRelative` helpers. Settings page
  now has an "Insight Pool" sub-section with a connect form
  / sync now / disconnect flow. Capture page shows a "Also
  publish to <owner>/<repo>" checkbox when a pool is
  configured. Graph view passes the pool cache to
  `buildGraph`, renders pool nodes with a dashed border +
  `borderWidth: 4`, and shows cross edges in dashed blue
  with a legend entry. `/my` splits into "Local only" and
  "Published to <repo>" sections. The graph side panel
  handles pool ids (no delete button, shows author + repo).
- **`js/export.js`** — `buildExportPayload` accepts a 4th
  `{poolConfig, poolCache, poolReactions}` argument so the
  JSON export carries the full pool state. Version bumped
  to 0.7.0. The 4 `exportXxx` functions are unchanged in
  behavior; they consume the same payload shape.
- **`css/style.css`** — pool card, pool reaction buttons,
  pool tag chips, capture-pool toggle, my-section split,
  settings field + section-tag, graph legend "pool" +
  "cross" dots, side-panel cross-edge kind.
- **`README.md`** — new "Insight Pool" section + "Connecting
  a pool" how-to + updated bottom-nav diagram (5 items).
- **`e2e-v06.mjs`** — unchanged. **41/41 PASS.**
- **`e2e-pool.mjs`** — new. **45/45 PASS.**

### Edge cases handled
- **No pool config**: `/pool` shows the "Connect" empty
  state. No `api.github.com` calls until configured.
- **Invalid PAT**: friendly toast + cache-preserving
  fallback. `PoolAuthError` carries the GitHub message.
- **Rate limit**: `PoolRateLimit.retryAfterSec` is read from
  `x-ratelimit-reset`; UI shows "try again in N min".
- **CORS / network**: `PoolNetworkError` surfaces as a
  toast; local data is never lost.
- **Empty pool**: "No pool inspirations yet" empty state.
- **Token in URL**: never. Always `Authorization: token <PAT>`.

### Out of scope (deferred to v0.8)
- Comments / threaded discussion per inspiration
- Pool-to-pool cross-posts
- Web Crypto token encryption
- Real-time updates (websockets / SSE)

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
