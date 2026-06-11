# InsightRecoder v0.6 + v0.7 — Frontend Polish Review (Cycle 2)

**Date:** 2026-06-11
**Reviewer:** frontend-polish-reviewer
**Build under review:** current `HEAD` (commit `3d39a94`, on top of `78203ae` "v0.6.0: pivot IdeaMiner to InsightRecoder"). The build includes v0.6.1 ("fix data-loss + nav + graph quality"), v0.6.2 ("complete legacy migration"), and v0.7.0 ("Insight Pool").
**Prior review:** `polish-review-2026-06-11.md` (Cycle 1, 09:50 CST) was on commit `78203ae` (v0.6.0 only) and reported 2 BLOCKERs. Both have been fixed in v0.6.1; this cycle audits the post-fix state and the v0.7.0 additions.
**Stack:** Vanilla JS SPA · single `index.html` · one stylesheet `css/style.css` (now 2061 lines) · `js/app.js` (1513 lines) + 8 module files · vis-network via CDN · no server-side logic
**Routes audited:** `#/capture`, `#/graph`, `#/timeline`, `#/my`, `#/settings`, `#/profile`, `#/pool` (new in v0.7)
**Viewports:** 360 × 800, 768 × 1024, 1280 × 800
**Evidence:** 23 PNGs in `polish-review/2026-06-11/screenshots/`

---

## Summary

The v0.6.0 BLOCKERs are resolved: the bottom navigation is now rendered on every route (5 items in v0.7: Capture / Graph / Timeline / Pool / My), the "Clear all data" destructive action uses `.btn--danger`, and Louvain singleton communities are recolored to neutral gray + sentinel `-1` so the legend only lists the clusters of size ≥ 2. The v0.7 Insight Pool addition is clean — `aria-labels` on every input, `type="password"` for the PAT, an empty-state with a clear CTA, and a 5th nav item that fits at 360px without truncation. **The build is not, however, shippable as-is.** The graph toolbar's "8 communities" stat no longer agrees with the legend (which shows 6) — the counter is computed pre-filter, so the user sees two inconsistent numbers. The `--fg-faint` token is used widely for body-size (11–13 px) text and produces 2.80:1 contrast — it fails WCAG AA. The voice / mic button gets a CSS `is-recording` class but never sets `aria-pressed` or any other state attribute, so a screen-reader user has no way to tell when recording is active. The graph side panel is rendered as `<aside>` with no `aria-modal` and no focus management — keyboard focus stays on the canvas behind it. The desktop layout still constrains the entire app to a 480 px column on a 1280 px viewport, leaving the graph squished into the middle; v0.6.1 added a `@media (min-width: 900px)` rule to widen `#/graph` to 1080 px but did not extend it to `#/timeline`, `#/my`, or the capture box, all of which feel cramped at 1280 px. A handful of magic colors and one undefined `--brand-bg` token (v0.7) round out the small NITs.

---

## Issues (numbered, by severity)

### BLOCKER

**1. Graph stats counter says "8 communities" but the legend shows only 6 — the two numbers do not agree.**
- **File / ref:** `js/app.js:587-589` (the `k` counter, used at `:706` to populate `#graph-stats`); `js/app.js:655-684` (the legend loop, which filters `if (members.length < 2) continue;` at `:663`).
- **What's wrong:** Reproducible with the seeded 14-node / 8-edge fixture: `#graph-stats` reads `"8 communities"` but `#graph-legend` contains 6 `<span class="graph-legend__item">` entries. The user sees two different counts in the same toolbar. This regression was introduced in v0.6.1 when the legend was changed to skip singleton communities (`communityMap` values with only one member) — the stats counter was not updated in lockstep, so the counter is still `max(communityMap.values()) + 1` (raw Louvain output).
- **Why it's a blocker:** The stats line is the *first* place the user looks to gauge graph structure. A self-inconsistent number ("8 communities · 6 colors in the legend") erodes trust in the whole view.
- **Fix (concrete):** Compute the displayed `k` from the *same* filtered set the legend uses. In `js/app.js:587-589` (the `let k = 0;` block) replace with:
  ```js
  let k = 0;
  for (const [cId, members] of communityMembers.entries()) {
    if (members.length < 2) continue;
    if (cId + 1 > k) k = cId + 1;
  }
  // Also subtract the singletons from k so the count reflects what's drawn.
  ```
  This requires the `communityMembers` map to be built *before* the stats assignment (swap the order in `mountGraph` so `communityMembers` is populated at `:595-601` and the `k` calc happens at `:706` after that block).

**2. The mic / voice button has `aria-label` but no recording state — a screen reader cannot tell when recording is active.**
- **File / ref:** `js/app.js:228-243` (capture mic render), `js/app.js:464-471` (capture mic voice-bind), `js/app.js:300-312` (profile mic voice-bind). The CSS at `css/style.css:284-300` (`.form__mic.is-recording`) and `css/style.css:1485-1493` (`.capture-box__mic.is-recording`) only swap visuals, no ARIA. A search across both `form__mic` and `capture-box__mic` shows `aria-pressed` is `null` and no `aria-live` region is created.
- **What's wrong:** When the user taps 🎤, the `is-recording` class is added and the pulse animation starts, but the button's accessible state stays the same. VoiceOver / NVDA reads "Voice input for capture, button" both before and during recording, and there is no live-region announcement to say "recording" or "stopped". A blind user cannot know if their tap registered, if recording is in progress, or when to tap again to stop.
- **Why it's a blocker:** Voice is one of the two primary capture paths (the only non-text input). The accessibility gap is total for that path.
- **Fix (concrete):** In `js/app.js`, the capture mic at `:300` does `micBtn.classList.add('is-recording');` — pair that with `micBtn.setAttribute('aria-pressed', 'true');` and add a visually-hidden `<span class="sr-only" aria-live="polite">` next to the button (or use a `.sr-only` utility class) that reads "Recording" when pressed and "Stopped" when released. Same for `js/app.js:204` (profile mic) and any other `data-voice-target` mics. Add `.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }` to the `:root` token block in `css/style.css`.

### SHOULD-FIX

**3. `--fg-faint` (#9a9a9f) is used for body-size (11–13 px) text and yields 2.80:1 contrast — fails WCAG AA.**
- **File / ref:** `css/style.css:34` (token definition); 22 usage sites including `css/style.css:1660-1662` (`.graph-sidepanel__edge-kind--inferred` 13 px, used as a kind-label), `css/style.css:1998` (`.my-section__count` 11 px), `css/style.css:1517-1525` (`.capture-suggestions__empty` 13 px), `css/style.css:1668-1670` (`.inspiration-card__meta` 12 px — used on every `/my` and `/timeline` card).
- **What's wrong:** Measured contrast pairs (computed via `getLuminance` + WCAG formula on a Playwright snapshot):
  - `--fg-faint` on `--bg` (#fff) = **2.80:1** (needs 4.5:1 for AA normal-text, 3.0:1 for AA-Large ≥ 18 pt)
  - `--fg-faint` on `--bg-subtle` (#f7f7f8) = **2.62:1**
  - `--success` on `--success-soft` = **2.97:1**
  - `--danger` on `--danger-soft` = **2.88:1**
  - `--brand` (#5b8def) on white = **3.23:1** (only passes AA-Large for >18 pt text)
  The `--fg-faint` token is the worst offender because it's used for 11–13 px meta lines on every page.
- **Why it's a should-fix (not blocker):** The lines that use it are decorative metadata (dates, source icons, scores), not primary content. A user can still read all inspiration text and form labels. But the AA bar is 4.5:1, and 2.80:1 is visibly low.
- **Fix (concrete):** Darken `--fg-faint` from `#9a9a9f` to `#737380` (or whatever 4.5:1+ on white requires — `#7a7a82` is ~4.55:1). Alternatively, narrow the token to `--fg-faint-AA: #737380` and migrate the body-size usages, leaving `--fg-faint` only for ≥ 18 pt decorative labels. The other failing pairs (success/danger on their `-soft` backgrounds) should be darkened by ~10% each.

**4. Desktop layout still constrains `/timeline`, `/my`, and `/capture` to a 480 px column on 1280 px viewports — wasted space, squished lists.**
- **File / ref:** `css/style.css:938-955` (`@media (min-width: 600px)` sets `#app` and `.bottom-nav` to `max-width: 480px`); `css/style.css:961-969` (a v0.6.1 follow-up widens `.page--graph` to 1080 px ≥ 900 px).
- **What's wrong:** `#/graph` is the only route that gets a desktop-specific `max-width`. On a 1280 px viewport (`screenshots/timeline-1280.png`, `my-1280.png`, `capture-1280.png`), the entire app is a 480 px column in the middle with ~400 px of empty background on each side. For `/my` this means the 4 export buttons wrap to two rows of two (`.my-export` is `flex-wrap: wrap`). For `/capture` the single capture box floats in 800 px of empty space. For `/timeline` and `/pool` it just looks lonely.
- **Why it's a should-fix:** The site is designed mobile-first but explicitly markets itself as a desktop tool too (GitHub Issues pool config, GraphML export, JSON / Markdown export). On a 1280 px monitor the user experience is "a phone in the middle of my screen."
- **Fix (concrete):** In `css/style.css:961-969`, extend the desktop rule:
  ```css
  @media (min-width: 900px) {
    .page--graph,
    .page--timeline,
    .page--my,
    .page--capture,
    .page--pool,
    .page--settings,
    .page--profile { max-width: 1080px; }
    .page--graph .graph-container { height: 70vh; min-height: 520px; }
    .my-export { flex-wrap: nowrap; }   /* keep all 4 export buttons in one row */
  }
  ```
  The `#app` `max-width: 480px` at `css/style.css:944` should also be lifted to ~1100 px on ≥ 900 px, otherwise the page rule above has no effect.

**5. The graph side panel is rendered as `<aside>` with no `aria-modal`, no focus management, and no focus restoration.**
- **File / ref:** `js/app.js:533-543` (side panel template); `js/app.js:695-756` (`openGraphSidePanel`); `css/style.css:1672-1684` (`.graph-sidepanel` styles).
- **What's wrong:** When `openGraphSidePanel(id)` runs, it sets `panel.hidden = false` and writes text to the inner divs, but it does not:
  1. Move keyboard focus to the close button (or to the panel itself)
  2. Trap focus inside the panel so Tab cycles between the close button and the Delete button
  3. Set `aria-modal="true"` so screen readers announce it as a dialog
  4. Restore focus to the clicked node when the panel closes
  Combined with the `position: fixed` overlay on a 100 vw mobile (`.graph-sidepanel { width: 100vw }` at `css/style.css:1815-1817`), the panel is *visually* modal but *behaviorally* not — Tab will move focus to the nav and to the recompute button behind it.
- **Why it's a should-fix:** Visually a modal, behaviorally not. Confusing for keyboard and screen-reader users.
- **Fix (concrete):** In `openGraphSidePanel` at `js/app.js:695`, before setting `panel.hidden = false`, store the previously-focused element (`const prevFocus = document.activeElement;`), then call `panelCloseButton.focus()`. Add `aria-modal="true"` and `role="dialog"` (or `aria-modal="true"` on the existing `<aside>`) at `js/app.js:533`. In the close handler at `:556-559`, call `prevFocus.focus()` after `panel.hidden = true`. For focus trap, add a small keydown handler that intercepts Tab on the last focusable element and wraps to the first.

**6. Save button is at y=245 on a 800 vh viewport — well above the 60% thumb zone. One-handed capture is hard.**
- **File / ref:** `js/app.js:230-247` (capture box template); `css/style.css:1444-1503` (`.capture-box` is `position: sticky; top: 0`).
- **What's wrong:** The capture box is sticky at the top (good — it stays in view as the user scrolls the recent list). But the Save button is at the right of the capture box's first row, so on a 360 × 800 viewport the Save CTA is at ~y=245, which is in the top third of the screen. The `⌘/Ctrl + Enter to save` hint and the textarea's focus-keyboard-up both mitigate this for desktop and external keyboard users, but a one-handed mobile user has to either: (a) keep the keyboard up and use the return key (but return inserts a newline in a textarea), (b) reach up to the Save button, or (c) ignore Save and rely on the keyboard shortcut. The keyboard shortcut doesn't work in iOS Safari's soft keyboard.
- **Why it's a should-fix:** Save is the primary CTA of the page. It should be reachable without stretching.
- **Fix (concrete):** Two options, pick one:
  - **Option A (cheap):** Add a second `Save` button at the bottom of the page, after the Recent list, sticky to the bottom-nav (`position: sticky; bottom: var(--nav-h);`).
  - **Option B (preferred):** Restructure the capture box so the Save button is on its own row, full-width, below the textarea + mic + hint. The hint can move into a `title` attribute on the Save button. This makes Save the bottommost thumb-zone element in the capture box (still in the top half of the page, but bigger and unambiguous).

**7. The capture box hint `⌘/Ctrl + Enter to save` was at risk of clipping on 360 px; verify in the post-fix state.**
- **File / ref:** `css/style.css:1494-1499` (`.capture-box__hint` — `flex: 1; text-align: right`); `js/app.js:240` (the hint is rendered as `<span class="capture-box__hint">⌘/Ctrl + Enter to save</span>`).
- **What's wrong:** The prior cycle's review flagged this. The v0.6.1 code did not change the rule, so the hint can still clip. In my Cycle 2 360 px screenshot, the hint fits (the Save button is `disabled` when the textarea is empty, so the row is narrower), but as soon as the user types a long string, the hint and Save button compete for the right half of the row. I did not reproduce a clean clip in my screenshots, but the CSS is unchanged from v0.6.0.
- **Why it's a should-fix:** Cheap insurance against the issue coming back.
- **Fix (concrete):** In `css/style.css:1494-1499` add `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` so the hint truncates with `…` rather than mid-character.

### NIT

**8. v0.7 introduced a new magic color: `.pool-reaction.is-active { background: var(--brand-bg, #e7f0ff); }`.**
- **File / ref:** `css/style.css:1952`.
- **What's wrong:** The variable `--brand-bg` does not exist in the `:root` token block (`css/style.css:19-83`). The fallback `#e7f0ff` is the active color — but the existing token for that is `--brand-soft: #e9f0ff` (close but not identical: `#e9f0ff` vs `#e7f0ff`).
- **Fix:** Replace with `background: var(--brand-soft);` (or add `--brand-soft-hover: #dde7fc;` if a darker active is intentional — see also Issue #11).

**9. `.card__section-body` and `.methods__item` use hard-coded `#333` instead of `var(--fg)`.**
- **File / ref:** `css/style.css:488`, `css/style.css:539`.
- **Why:** Token drift — both render body text and should follow `--fg` so a future dark-mode swap updates them automatically.
- **Fix:** `color: var(--fg);` at both lines.

**10. `.my-ideas-item:hover` background `#f1f1f4` is a magic color.**
- **File / ref:** `css/style.css:1364`.
- **Fix:** Add `--bg-subtle-hover: #f1f1f4;` to `:root` and reference it, or simply `background: var(--border);` for a similar warm-gray (the `border` token `#e5e5ea` is one shade lighter but conveys the same "I am hovered" signal).

**11. `.badge--yours` uses three hard-coded colors instead of tokens.**
- **File / ref:** `css/style.css:1262-1264` (`#fff7e6`, `#1a7a4a`, `#c8ecd4`).
- **Fix:** `background: linear-gradient(90deg, var(--warning-soft) 0%, var(--success-soft) 100%); color: var(--success); border-color: var(--success-soft);`.

**12. `.explore__add-button:hover` background `#dde7fc` is a magic color.**
- **File / ref:** `css/style.css:1286`.
- **Fix:** Add `--brand-soft-hover: #dde7fc;` to `:root`.

**13. `.feedback__btn--like:hover` `#ffd7d3` is a magic color.**
- **File / ref:** `css/style.css:605-606`.
- **Fix:** Add `--danger-soft-hover: #ffd7d3;` to `:root`.

**14. `.capture-box` uses `backdrop-filter: blur(6px)` with no `@supports` fallback.**
- **File / ref:** `css/style.css:1448`.
- **Why:** Firefox < 103, some WebViews, and some embedded browsers do not support `backdrop-filter`. The capture box is `background: var(--bg-elevated)` which is solid white, so the page reads fine in those browsers — but the box is *intended* to be glassy, and the silent fallback removes that signal.
- **Fix:** Add `@supports not (backdrop-filter: blur(1px)) { .capture-box { background: rgba(255,255,255,0.96); } }` to make the fallback explicit. Or just remove the `backdrop-filter` since the box already has a solid white background — the blur is invisible on the current `#f7f7f8` page bg.

**15. Graph node labels clip mid-word; the prior fix added `n.title = n.label` but only in certain code paths.**
- **File / ref:** `js/app.js:600-630` (the node-coloring loop in v0.7). I did not find a `n.title = n.label` line in the current `app.js`. Need to re-verify, but the Cycle 1 review already flagged this.
- **Fix:** Add `n.title = n.label;` to the node loop at `js/app.js:608` (inside the `for (const n of graph.nodes)` block), and add `n.font = { ...n.font, multi: 'html' }` so multi-word labels wrap instead of clip.

**16. v0.7 graph legend uses dashed/dotted styles but the dot size is inconsistent.**
- **File / ref:** `css/style.css:2039-2056` (`.graph-legend__dot--pool` is 12×12 with 2 px dashed border; `.graph-legend__dot--cross` is 16×2 horizontal bar).
- **Why:** The community dots are 10×10 (`css/style.css:1767-1772` `.graph-legend__dot`), the pool dot is 12×12 dashed, and the cross dot is 16×2. The legend row has three different shapes, but the layout is `inline-flex` so they line up by their top edge. At 360 px this works (the legend has `flex-wrap: wrap`), but at 1280 px the inline row can stretch and look uneven. Minor.
- **Fix:** Either (a) standardize all dots to 12×12 (set `min-width: 12px; min-height: 12px;` on `.graph-legend__dot`), or (b) keep the shape difference but cap `.graph-legend__dot--cross` to 12×12 to match.

**17. The "Pinned" / "Cross-community" / "Inferred" edge kind labels in the side panel use 3 different visual treatments.**
- **File / ref:** `js/app.js:744` (inferred uses `·` middle dot), `js/app.js:753` (cross uses `·` plus class `graph-sidepanel__edge-kind--cross`), `js/app.js:1721-1722` (CSS for the kinds).
- **Why:** A pinned link gets `🔗` and is bold-blue. An inferred link gets `·` and `--fg-faint` (which is failing contrast — see Issue #3). A cross-community link gets `·` and brand-blue. The middle-dot for inferred is easy to miss; combined with the failing contrast, an inferred connection is essentially invisible.
- **Fix:** Add a textual label after the symbol: `pinned` / `inferred` / `cross` (e.g. `<span class="…">🔗 pinned</span> Topological…`). Or replace the middle dot with a more distinctive shape.

**18. The `#app` element at `min-height: 100vh` plus a `.page--*` with `padding-bottom: calc(var(--nav-h) + var(--sp-4))` causes the body to be `100vh + nav-h` tall on routes that don't have the padding-bottom class.**
- **File / ref:** `css/style.css:142-156` (the original `.page` and `.page--saved/explore/my/settings` rules set `padding-bottom`); the new v0.7 routes `#/capture`, `#/graph`, `#/timeline`, `#/pool`, `#/profile` rely on the generic `.page` rule at `css/style.css:144-149` which only sets `padding: var(--sp-4) var(--sp-3) var(--sp-3)` (no bottom padding for the nav).
- **Why:** The capture page uses `position: sticky` on the capture box (top: 0), so the bottom-nav still appears above content. But on `/graph` and `/timeline`, the last content can be hidden behind the fixed bottom-nav because the page does not have `padding-bottom: calc(var(--nav-h) + var(--sp-4))`. Not visible in viewport screenshots because the last item is short, but on a populated `/timeline` with 50+ items, the last week will scroll under the nav.
- **Fix:** Add `padding-bottom: calc(var(--nav-h) + var(--sp-4));` to the base `.page` rule at `css/style.css:144-149` so all routes get it.

**19. `@media (min-width: 600px)` body background is `#ededf0` — a magic color, not a token.**
- **File / ref:** `css/style.css:940`.
- **Fix:** Add `--bg-page: #ededf0;` to `:root` and reference it. (This is the page-level "outside the card" gray; `--bg-subtle` is for *inside* the card.)

**20. The page subtitle copy on the v0.7 Pool empty state contains an `<em>` tag and a `<code>` tag inside the body of `emptyState()` — `esc()` is applied, but the rich HTML is built via the helper.**
- **File / ref:** `js/app.js:1227` (the body argument is `'<p>…</p>'` with `<em>` and `<code>` inline).
- **Why:** Fine in practice (`emptyState` at `js/app.js:104-113` uses `innerHTML` for the body). But the function name `esc` is reused, and a future change to `emptyState` that wraps the body in a `<p>` would break the embedded `<p>`. Minor robustness concern.
- **Fix:** Document in `emptyState` that the body is raw HTML; do not auto-wrap in `<p>`.

---

## What was NOT audited (and why)

- **Voice recording end-to-end** — would require microphone permissions and real audio. The mic button state is verified via the snapshot tree (`aria-label="Voice input for capture"`, no `aria-pressed`).
- **Graph node-click → side panel** — vis-network uses canvas hit detection; synthetic `MouseEvent` doesn't trigger it. Verified the code path at `js/app.js:687-690` (`state.network.on('click', _graphClickListener)` → `openGraphSidePanel(id)`) and verified the panel renders correctly when shown via `panel.hidden = false` (see `screenshots/graph-360-sidepanel.png`).
- **Cross-browser sanity** — Playwright MCP only exposes Chromium. Firefox / Safari not tested.
- **Pool feature end-to-end** — would require a real GitHub repo + PAT. The empty state and connect form are screenshot-verified (`screenshots/pool-360.png`).
- **Voice button aria-pressed on `/profile`** — the same `aria-pressed = null` issue applies, but I only verified the `/capture` and `/profile` instances. All `data-voice-target` mic buttons share the same JS handler and would have the same gap. Issue #2 covers the fix for both.
- **Pure dark mode** — not implemented. The token system is designed for it (`@media (prefers-color-scheme: dark)` is mentioned in the file header at `css/style.css:13`) but no `@media` block exists yet.
- **Print stylesheet** — not in scope.
- **Tab order through all 7 routes end-to-end** — sampled via the accessibility snapshot tree on `/capture` and `/profile`. Tabbing in Playwright is mechanical and would add little signal beyond what the snapshot already reveals.

---

## VERDICT

**FAIL** — 2 BLOCKERs (graph stats / legend count mismatch, mic button has no `aria-pressed` for screen-reader recording state). The 5 SHOULD-FIXes (contrast, desktop layout, side-panel focus, Save thumb-zone, capture hint truncation) and 13 NITs are all small, scoped, and could be fixed in a single 1–2 day polish pass. Once the 2 BLOCKERs are addressed, this build is shippable.
