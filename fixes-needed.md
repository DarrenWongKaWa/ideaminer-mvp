# InsightRecoder v0.6.1 — Follow-up Fix Plan

Two reports from `plan_d6f9c063`:

- `polish-review-2026-06-11.md` (frontend-polish-reviewer, FAIL, 2 BLOCKER + 6 SHOULD-FIX + 9 NIT)
- `local-first-test-2026-06-11.md` (local-first-tester, PASS with 1 P1)

Scope: implement P0 + P1 items. Skip NITs unless trivial. Total estimated diff: ~200 lines (JS + CSS).

---

## P0 — Data loss on quota exceeded (local-first P1)

### Fix 1: `LocalStorageProvider._write` should propagate QuotaExceededError
- **File:** `js/storage.js`
- **What:** When `localStorage.setItem` throws `QuotaExceededError`, the current `_write` catches it silently and returns `false`. The caller (`addInspiration`, `addLink`, etc.) sees `false` but already mutated the in-memory mirror. The UI shows "Saved" but on reload the data is gone.
- **Fix:**
  1. In `_write` / `_writeJson` helpers, re-throw `QuotaExceededError` (or wrap as a new `StorageFullError`) instead of swallowing it.
  2. In the public methods (`addInspiration`, `addLink`, `removeLink`, `deleteInspiration`, `setProfile`), wrap `_write` in `try/catch`:
     - On `QuotaExceededError`: roll back the in-memory mirror, surface a `StorageFullError` to the caller. The UI catches this and shows a toast "Storage full — clear some data in Settings".
     - On other errors: keep silent fall-through (current behavior).
  3. In `js/app.js` `addInspiration` save handler, catch the new error and call `toast('Storage full — clear some data in Settings', 'error')` (the toast helper already exists).
- **Effort:** ~30 lines (storage.js: 20, app.js: 10)

---

## P0 — Bottom navigation never called (polish BLOCKER 1)

### Fix 2: Wire `bottomNav(active)` into the render path
- **File:** `js/app.js`
- **What:** `bottomNav(active)` is defined at `js/app.js:80-101` but no render path calls it. The user has no in-app navigation between `#/capture`, `#/graph`, `#/timeline`, `#/my`.
- **Fix:** Refactor `render()` so each `app.innerHTML = renderX()` becomes
  ```js
  app.innerHTML = renderX() + bottomNav(activeRoute);
  ```
  where `activeRoute` is derived from the hash. Then add `padding-bottom: calc(var(--nav-h, 56px) + var(--sp-4))` to `.page--capture`, `.page--graph`, `.page--timeline`, `.page--profile` in `css/style.css` (the other routes already have it).
- **Effort:** ~15 lines (app.js: 10, style.css: 5)

---

## P0 — Graph community useless on small graphs (polish BLOCKER 2)

### Fix 3: Treat singleton communities as unclustered
- **File:** `js/insight-connections.js` + `js/app.js`
- **What:** With the current 4-edge / 5-node fixture, Louvain returns 5 singletons. The legend says "5 communities" with 1 dot per community — useless.
- **Fix:** In the graph coloring loop at `js/app.js:453-458` (the `for (const n of graph.nodes)` block), count members per community first; for any community of size 1, override the color to `var(--fg-faint)` (#9a9a9f, neutral gray) and set `n.community = -1` so the legend loop at `js/app.js:485-491` skips it. Communities of size ≥ 2 keep the palette.
- **Effort:** ~15 lines (app.js: 15)

---

## P1 — Cheap wins (polish SHOULD-FIX 1-6, selected high-value subset)

### Fix 4: "Clear all data" should be `btn--danger`, not `btn--ghost`
- **File:** `js/app.js:756`
- **Change:** `class="btn btn--ghost"` → `class="btn btn--danger"`
- **Effort:** 1 line

### Fix 5: `⌘/Ctrl + Enter to save` hint truncates on 360px
- **File:** `css/style.css:1494`
- **Change:** Add `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to `.capture-box__hint`
- **Effort:** 3 lines

### Fix 6: Graph container squished on 1280px (480px column)
- **File:** `css/style.css`
- **Change:** Add `@media (min-width: 900px) { .page--graph { max-width: 1080px; } .page--graph .graph-container { height: 70vh; min-height: 520px; } }`
- **Effort:** ~5 lines

### Fix 7: Graph node labels truncated, no tooltip
- **File:** `js/app.js:453-458`
- **Change:** In the node-coloring loop, add `n.title = n.label;` so vis-network shows the full text on hover (the existing `interaction.tooltipDelay: 100` will then surface it).
- **Effort:** 1 line

### Fix 8: Graph community legend says "community 1..5" with no semantic meaning
- **File:** `js/app.js:485-491`
- **Change:** Pair with Fix 3 — only show legend entries for communities of size ≥ 2. For size ≥ 2, label with the most-common tag: append `#${topTag}` (e.g. "community 2 · #physics"). Singletons get suppressed.
- **Effort:** ~10 lines

### Fix 9: Profile "Skip →" should be a de-emphasized text link, not a ghost button
- **File:** `js/app.js:171`
- **Change:** `class="btn btn--ghost"` → `class="link"`; text stays the same.
- **Effort:** 1 line

---

## Deferred (NITs)

- `.card__section-body` hard-coded `#333` → use `var(--fg)`. (5-min fix, but low impact.)
- `.my-ideas-item:hover` magic color, `.badge--yours` hard-coded, `.explore__add-button:hover` magic color. (Token drift, cosmetic.)
- `.feedback__btn--like:hover` magic color. (Cosmetic.)
- `.capture-box` `backdrop-filter` no fallback. (Affects older Firefox only; P3.)
- Empty state position inconsistency between `/my` and `/timeline`. (Cosmetic.)
- Pinned / inferred link symbol inconsistency. (Cosmetic.)
- "See all" link on Recent list. (Adds /timeline discoverability; can be v0.6.2.)

---

## Summary

- **P0 (data + nav blockers):** 3 fixes, ~60 lines
- **P1 (cheap wins):** 6 fixes, ~21 lines
- **Total:** 9 fixes, ~80 lines
- **Skipped (NITs):** 9
- **Files touched:** `js/storage.js`, `js/app.js`, `js/insight-connections.js`, `css/style.css`

## Test plan

1. `node --check` on all modified JS files
2. `node .mavis/plans/v5/e2e-v06.mjs` — must still pass 41/41
3. Local quota test: pre-fill localStorage to 5MB, call `addInspiration`, expect the toast "Storage full — clear some data in Settings" and the in-memory mirror to NOT have the new entry
4. Visual: load live site, click through Capture → Graph → Timeline → My, verify bottom nav appears and active state highlights correctly
5. Visual: on `/graph`, with 5 inspirations and 4 edges, verify the legend shows fewer entries (singletons suppressed) and at least 2 nodes share a color
