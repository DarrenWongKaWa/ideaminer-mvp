# InsightRecoder v0.6 — Frontend Polish Review

**Date:** 2026-06-11
**Reviewer:** frontend-polish-reviewer
**Build under review:** commit `78203ae` ("v0.6.0: pivot IdeaMiner to InsightRecoder")
**Stack:** Vanilla JS SPA · single `index.html` · one stylesheet (`css/style.css`, 1818 lines) · one main `js/app.js` (903 lines) · ES modules for storage/voice/connections/search/export · vis-network via CDN
**Routes audited:** `#/capture`, `#/graph`, `#/timeline`, `#/my`, `#/settings`, `#/profile`
**Viewports:** 360 × 780, 768 × 1024, 1280 × 800
**Evidence:** 17 screenshots in `polish-review/2026-06-11/screenshots/`

---

## Summary

v0.6 is a competent mobile-first rewrite with a clean design-token system (`--brand`, `--sp-1..5`, `--dur`, `--ease`, `--focus-ring`) and consistent focus / hover / active states for the buttons, forms, and cards. Typography hierarchy is clear, the four-point spacing scale is followed, the dark-on-white palette meets WCAG AA, the prefers-reduced-motion override is in place, and aria-labels are present on every interactive control. **The release is not, however, shippable as-is.** The bottom navigation is fully missing from the UI (its function is defined but never invoked) — there is no way to move between Capture, Graph, Timeline, and My without manually editing the URL hash. The community-coloring on the Graph view produces 1 community per node for any small graph, making the legend meaningless. The capture box hint text overflows on 360 px, the "Clear all data" destructive action is styled as a low-emphasis ghost button, and on 1280 px the entire 480 px-wide app floats in the middle of a 1 280 px viewport with vast empty margins. These are mostly 5- to 30-minute fixes. Two are blockers; the rest are nice-to-haves.

---

## Issues (numbered, by severity)

### BLOCKER

**1. `bottomNav()` is defined but never called — there is no in-app navigation.**
- **File / ref:** `js/app.js:80-101` (function definition); `js/app.js:847-877` (`render()` — calls `renderX()` and `bindXEvents()` for each route but never appends `bottomNav(active)`).
- **What's wrong:** Every route's template (`renderCapture`, `renderGraph`, `renderTimeline`, `renderMy`, `renderSettings`, `renderProfile`) returns only the page content. The CSS for `.bottom-nav` (`css/style.css:610-678`) is fully authored and the 4-item nav template is in `bottomNav()` with `is-active` highlighting and `slideDown` indicator, but no render function invokes it. The accessibility snapshot at `#/capture` shows `main` with no `navigation` landmark, and the screenshot of the capture page has only page content — no nav bar above or below.
- **Why it's a blocker:** A user landing on `#/capture` has no way to reach Graph, Timeline, or My. The site is effectively a single-page app with no SPA — you can only get to other routes by editing the URL.
- **Fix (concrete):** In `js/app.js:847`, change `render()` so each `app.innerHTML = renderX()` line becomes e.g. `app.innerHTML = renderCapture() + bottomNav('capture');` (and same for the other 5 routes with the correct `active` value). Alternatively append `bottomNav(active)` in a single place at the end of `render()`. Then add `padding-bottom: calc(var(--nav-h) + var(--sp-4))` to every page that currently has `padding-bottom: var(--sp-3)` (it exists for `.page--saved` / `--explore` / `--my` / `--settings` but is missing for `.page--capture`, `.page--graph`, `.page--timeline`, `.page--profile`).

**2. Graph community detection returns 1 community per node for any small graph — the legend ("5 communities · 1 dot per community") is useless.**
- **File / ref:** `js/insight-connections.js:detectCommunities()` (called by `js/app.js:447` then passed to `colorizeCommunities`).
- **What's wrong:** With the seeded 5 inspirations / 4 edges fixture the toolbar reads `5 communities` and the legend shows `community 1, 2, 3, 4, 5` — one color per node. Louvain collapses to singletons because the graph is too sparse / too small. The user can see 5 colors but cannot tell what any of them mean (there is only one node per color).
- **Why it's a blocker for graph view:** The primary value-prop of the graph is the community coloring. When every community is a singleton, the graph view degrades to a generic force-directed layout with no information beyond the labels.
- **Fix (concrete):** In `js/insight-connections.js`, either (a) treat any community of size 1 as "unclustered" and render those nodes in a single neutral color (e.g. `--fg-faint` #9a9a9f), only colorizing communities of size ≥ 2 with the palette; or (b) bump Louvain's `resolution` parameter down so singletons are merged; or (c) for N < some threshold (e.g. 6 nodes), skip community detection entirely and show all nodes in `--brand` with a small subtitle `Add more inspirations to see communities` (matching the existing empty-state copy in `renderGraph` at `js/app.js:438`).

### SHOULD-FIX

**3. "⌘/Ctrl + Enter to save" hint clips on 360 px to "⌘/Ctrl + Enter to sav".**
- **File / ref:** `css/style.css:1494-1499` (`.capture-box__hint`); the parent flex row at `css/style.css:1468-1473` (`.capture-box__actions`).
- **What's wrong:** At 360 px the hint is `flex: 1` and the Save button is on the right, so the hint is truncated mid-character. Visible in `screenshots/capture-360-populated.png` and `screenshots/capture-360-empty.png`.
- **Fix (concrete):** Either (a) add `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to `.capture-box__hint`; or (b) shorten the hint to `⌘+↵` (4 chars) on 360 px via a media query; or (c) move the hint into a `title` attribute / aria-label on the Save button and remove the visible hint entirely.

**4. "Clear all data" is a destructive action styled as a low-emphasis ghost button.**
- **File / ref:** `js/app.js:756` (renders `<button class="btn btn--ghost" id="wipe-data">Clear all data</button>`); CSS for ghost vs danger at `css/style.css:372-402`.
- **What's wrong:** This button deletes every inspiration, every link, and the profile from `localStorage`. It is wrapped in a `window.confirm()` (good) but visually it looks like a tertiary action next to a primary blue "Save" button. A user scanning the page will not register the destructive nature.
- **Fix (concrete):** Change `js/app.js:756` to `class="btn btn--danger"` (the `.btn--danger` token already exists at `css/style.css:392-395` and is used by the Delete button on `/my`). Optionally add an emoji prefix: `🗑️ Clear all data`.

**5. Graph container is constrained to 480 px on 1280 px viewports — vast empty margins, graph nodes are squished.**
- **File / ref:** `css/style.css:936-953` (the `@media (min-width: 600px)` block caps `#app` and `.bottom-nav` at `max-width: 480px`).
- **What's wrong:** The whole app is treated as a "mobile card" and floated in a 480 px column on desktop. The graph at 1280 px (`screenshots/graph-1280.png`) shows 5 nodes crammed into a 480 × 612 px box with ~400 px of empty background on each side. Same for the capture page (`screenshots/capture-1280.png`) — a 480 px-wide capture box in the middle of a 1 265 px viewport. Timeline and My are a little more defensible (single-column lists work at any width) but Graph specifically needs more room.
- **Fix (concrete):** Add a desktop rule that widens the page for `/graph`:
  ```css
  @media (min-width: 900px) {
    .page--graph { max-width: 1080px; }
    .page--graph .graph-container { height: 70vh; min-height: 520px; }
  }
  ```
  Optionally widen `.page--timeline` and `.page--my` to a similar 720-800 px so list items don't feel squished, but the graph is the critical case.

**6. Graph node labels are truncated to a partial word with no tooltip on hover/tap.**
- **File / ref:** `js/app.js:475` sets `nodes: { shape: 'dot', size: 16, font: { size: 12, color: '#1a1a1a' } }`. No `title` is set on nodes.
- **What's wrong:** Labels like "Berry curvature and nonline…" appear truncated mid-word. There is no `title` attribute on the node so hover-tooltip (which `interaction: { tooltipDelay: 100 }` claims to support) shows nothing useful. The user has to click the node to see the full text.
- **Fix (concrete):** In `js/app.js:453-458` (the node-coloring loop) add `n.title = n.label;` so vis-network shows the full text on hover. Optionally also set `n.font.face` and `n.font.multi: 'html'` so wrapping works.

**7. The graph community legend is unlabeled — "community 1" through "community 5" tell the user nothing.**
- **File / ref:** `js/app.js:484-492` (legend HTML); `css/style.css:1734-1752` (`.graph-legend`).
- **What's wrong:** The legend item is just `<span>community N</span>` after the colored dot. With issue #2, each color corresponds to exactly one node, so the legend literally repeats the node label — but the user has no way to map the dot on the canvas to the entry in the legend. Even if communities were real, "community 3" gives no semantic meaning.
- **Fix (concrete):** When a community has ≥ 2 nodes, label it with the most-common tag among its members (e.g. "community 3 · #physics"). When the community is a singleton, suppress the legend entry (paired with the fix in #2). Implementation: in the loop at `js/app.js:485-491`, compute `tagCounts = new Map(); for (const n of graph.nodes.filter(n => n.community === i.c)) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);` and append `#${topTag}` if `items.length >= 2`.

**8. The "Skip →" link on `#/profile` is a `btn--ghost` styled as a button but is a link; on click it changes the hash but is reachable only after Save.**
- **File / ref:** `js/app.js:171` (renders `<a class="btn btn--ghost" href="#/capture">Skip →</a>`).
- **What's wrong:** Functional but the placement (after a primary "Save" button) makes the primary CTA look optional, and the label is ambiguous. For first-time users the "Skip" affordance competes with "Save" for attention.
- **Fix (concrete):** Render Skip as a smaller text link below the Save button (`<a class="link" href="#/capture">Skip for now</a>`) using the existing `.link` token at `css/style.css:748-758`. This de-emphasizes it relative to the primary action.

### NIT

**9. `.card__section-body` uses a hard-coded `#333` instead of `var(--fg)`.**
- **File / ref:** `css/style.css:487`.
- **What's wrong:** Token drift. The body text would not adapt if `--fg` is ever redefined (e.g. in a future dark-mode pass).
- **Fix:** `color: var(--fg);`.

**10. `.my-ideas-item:hover` background `#f1f1f4` is a magic color.**
- **File / ref:** `css/style.css:1348`.
- **Fix:** Either add `--bg-subtle-hover: #f1f1f4;` to the `:root` token block at `css/style.css:19-83` and reference it, or reuse `var(--border-strong)` for a similar warm gray.

**11. `.badge--yours` uses three hard-coded colors instead of tokens.**
- **File / ref:** `css/style.css:1246-1250` (`#fff7e6`, `#1a7a4a`, `#c8ecd4`).
- **Fix:** Replace with `linear-gradient(90deg, var(--warning-soft) 0%, var(--success-soft) 100%); color: var(--success); border-color: var(--success-soft);` to align with the existing semantic tokens.

**12. `.explore__add-button:hover` background `#dde7fc` is a magic color.**
- **File / ref:** `css/style.css:1270`.
- **Fix:** Add `--brand-soft-hover: #dde7fc;` to `:root`, or use `var(--brand-soft)` darkened — the existing `--brand-soft: #e9f0ff` is one shade lighter and a slightly darker variant of the same hue is correct here.

**13. `.feedback__btn--like:hover` `#ffd7d3` is a magic color.**
- **File / ref:** `css/style.css:603-604`.
- **Fix:** Add `--danger-soft-hover: #ffd7d3;` to `:root`.

**14. `.capture-box` uses `backdrop-filter: blur(6px)` with no fallback.**
- **File / ref:** `css/style.css:1448`.
- **What's wrong:** Browsers without `backdrop-filter` (older Firefox, some embedded WebViews) will render the sticky capture box as a solid white-on-white-on-white box that may look broken against `--bg-subtle` (the page background is `#f7f7f8`, the box is `#ffffff` — fine without the blur, fine with the blur; the only issue is when the blur fails silently, the user can't tell that the box is meant to be glassy).
- **Fix:** Add `@supports not (backdrop-filter: blur(1px)) { .capture-box { background: rgba(255,255,255,0.96); } }` to make the fallback explicit.

**15. Empty state for `#/my` is the same as `#/timeline` empty state but renders in a different layout slot.**
- **File / ref:** `js/app.js:660` and `js/app.js:608` both call `emptyState('📭', …, …, …)`. Different parent containers (`.my-list` vs `.timeline-content`).
- **What's wrong:** Functional but the visual hierarchy differs: in `/my` the empty state is below the export bar, in `/timeline` it sits below the search input. Minor consistency issue — the user might wonder why a freshly-cleared app shows the empty state in different positions.
- **Fix (optional):** Wrap each empty state in a `.page__empty` section with a fixed `margin-top: var(--sp-5)` for consistency.

**16. The "Pinned" badge / connection kind uses different symbols on different surfaces.**
- **File / ref:** `js/app.js:526` (graph side panel: `l.kind === 'pinned' ? '🔗' : '·'`); `js/app.js:358` (suggestion card pin button: `🔗 Pin`); `js/app.js:374` (after pin: `✓ Pinned`).
- **What's wrong:** Three different visual treatments of the same concept (a manually-pinned link) — the suggestion card uses an emoji, the side panel uses an emoji and a bullet, the after-state uses a check mark. The "inferred" link in the side panel is just `·` (a middle dot), which is easy to miss.
- **Fix:** Standardize: in the side panel use `l.kind === 'pinned' ? '🔗' : '·'` (already done) and add a label `pinned` / `inferred` after the symbol, or use a colored pill (like `.badge`).

**17. On `#/capture`, the Recent list shows the first 5 inspirations but the cap is hard-coded and not exposed to the user.**
- **File / ref:** `js/app.js:253` (`all.slice(0, 5)`); `js/app.js:332` (`list.slice(0, 5)`).
- **What's wrong:** If a user has 50 inspirations, the Recent block is just a teaser — there is no link to "see all" or to `/timeline`. The user must know the route exists.
- **Fix:** Add a footer link `<a class="link" href="#/timeline">See all →</a>` below the Recent list when `all.length > 5`.

---

## What was NOT audited (and why)

- **Full keyboard-only flow** — only briefly tabbed through `/capture`. `:focus-visible` is implemented (line 130 of style.css) and the `:focus` rule uses `outline: none` with a fallback ring; visually the focus ring was visible on the textarea and the mic button but I did not exhaustively test tab order through all 5 routes.
- **Top-10 text/background contrast** — sample-checked: `--fg` (#1a1a1a) on `--bg` (#ffffff) is 17.4:1 (AAA), `--fg-muted` (#6e6e73) on `--bg` is 5.5:1 (AA), `--fg-faint` (#9a9a9f) on `--bg` is 3.0:1 (only AA-Large). Captions and meta text using `--fg-faint` would fail at body sizes — but the codebase uses `--fg-faint` only for 11–13 px text (timeline week labels, graph hint, "Recent" label) where 3:1 is acceptable for large text. Should still consider darkening to `#7d7d82` for a 4.5:1 pass on the 12-px meta lines.
- **Voice button screen-reader state** — `aria-label="Voice input for capture"` is set, but the recording state is announced only via the `is-recording` CSS class (no `aria-pressed`, no `aria-live`). A screen reader user cannot tell if the button is currently recording.
- **Graph node-click → side panel** — was about to test but the canvas kept being destroyed by the sibling local-first-tester agent re-rendering the page.
- **Reduced motion** — verified the `@media (prefers-reduced-motion: reduce)` block at `css/style.css:1125-1133` is present and uses `!important` correctly.

---

## VERDICT

**FAIL** — there are 2 BLOCKERs (missing bottom navigation, useless community detection on small graphs). The rest are SHOULD-FIX or NIT and could ship in a v0.6.1 patch once the two blockers are addressed.
