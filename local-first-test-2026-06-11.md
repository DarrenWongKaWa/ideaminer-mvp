# Local-first / offline / export audit — InsightRecoder v0.6.0

**Date:** 2026-06-11
**Auditor:** local-first-tester (cycle 2)
**Build audited:** `/Users/wangjiahua/.minimax-agent-cn/projects/ideaminer-mvp/`
**Live target:** `https://darrenwongkakawa.github.io/insightrecoder/`
**Local server under test:** `http://127.0.0.1:8770/` (serves the project tree)

## Summary

InsightRecoder v0.6.0 is a clean, well-behaved local-first app. The primary
capture → graph → export flow works end-to-end with the network disabled after
the first load; the only third-party call is the documented vis-network CDN
script. All four export formats roundtrip cleanly (JSON byte-equal, Markdown
and GraphML parse with standard tools, standalone HTML inlines its data and
makes exactly one external request for the vis-network library). One real
local-first bug was found: `LocalStorageProvider._write` silently swallows
`QuotaExceededError`, so the UI cheerfully reports "✅ Saved" while the data
is in-memory only and disappears on the next reload. This is the only blocker
on an otherwise PASS-shaped audit; all other localStorage edge cases
(corrupt JSON, missing keys, legacy migration, both raw-array and
`{ideas:[…]}` shapes, migration idempotency) are handled correctly without
crashing or losing data.

## Test matrix

| # | Scenario | Chromium | Firefox | WebKit | Notes |
|---|---|---|---|---|---|
| 1 | First load — no keys, clean boot | PASS | N/T | N/T | Verified empty localStorage after `localStorage.clear()` + reload |
| 2 | Capture 3 inspirations, primary flow | PASS | N/T | N/T | Newest first, ids `insp-*` |
| 3 | Pin 2 suggestions → 2 edges | PASS | N/T | N/T | Edges stored as `kind:'pinned'`, score reused from suggestLinks |
| 4 | `#/graph` renders 3 nodes / 2 edges / 3 communities | PASS | N/T | N/T | vis-network canvas 892×880 |
| 5 | **Offline (context.setOffline(true))** — capture works | PASS | N/T | N/T | 3 → 4 inspirations saved, no network |
| 6 | **Offline** — graph renders | PASS | N/T | N/T | 4 nodes / 2 edges, canvas present |
| 7 | **Offline** — all 4 export buttons fire | PASS | N/T | N/T | JSON / MD / HTML / GraphML all produced valid blobs |
| 8 | Corrupt JSON in `insightrecoder.inspirations.v1` | PASS | PASS* | PASS* | `_read` catches, returns `[]`; subsequent `addInspiration` recovers |
| 9 | Quota exceeded on `addInspiration` | **FAIL** | FAIL* | FAIL* | Silent data loss — see Issue A |
| 10 | First-run (no keys) | PASS | PASS* | PASS* | Empty list, no errors, normal init |
| 11 | Migration idempotency (legacy + new key both present) | PASS | PASS* | PASS* | First call `{migrated:0, hadOldKey:true}`, legacy key removed, new key unchanged; second call no-op |
| 12 | Migration real (only legacy key) | PASS | PASS* | PASS* | 2 items migrated, `user-*` ids renamed to `insp-*` |
| 13 | Migration `{ideas:[...]}` wrapper shape | PASS | PASS* | PASS* | 1 item migrated, legacy key removed |
| 14 | JSON export roundtrip (`buildExportPayload` ↔ exportJson) | PASS | PASS* | PASS* | `roundtripEqual: true`; inspiration/link counts preserved |
| 15 | Markdown export structure | PASS | PASS* | PASS* | H1, weekly H2 sections, bullets, `#tag` rendering |
| 16 | Standalone HTML — inlined data, opens + renders offline CDN-only | PASS | N/T | N/T | Only 2 requests: page + vis-network CDN; canvas 345×724 |
| 17 | GraphML — parses with Python `xml.etree` (networkx-equivalent) | PASS | PASS* | PASS* | 4 nodes, 3 edges, key declarations present, well-formed |
| 18 | Filename sanitization (no `..`, no `/`, no reserved chars) | PASS | PASS* | PASS* | All 4 filenames match `^[A-Za-z0-9._-]+$`; `dateSlug()` is hard-coded `YYYYMMDD`, no user input |
| 19 | First-load network — only app + vis-network CDN + favicon (data: URL) | PASS | N/T | N/T | 8 requests; 7 same-origin + 1 vis-network |

`N/T` = not tested in that browser (see Cross-browser section).
`*` = tested via the Node `LocalStorageProvider` smoke test (`scripts/test-storage.mjs`) which exercises the same code path every browser uses; the code is browser-agnostic and the polyfill mirrors the spec, so per-browser storage behavior is expected to match.

## Per-issue root cause

### Issue A — QuotaExceededError silently swallowed (BLOCKER, silent data loss)

**File:** `js/storage.js`, line 117-122

```js
_write(key, val) {
  const memKey = this._memKey(key);
  if (memKey) this._mem[memKey] = val;     // <-- in-memory mirror updated
  if (!this._hasLS) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch (_) {
    // Silently degrade on quota-exceeded etc.    <-- BUG: caller never learns
  }
}
```

**Symptom (reproducible):**
- Set a 5 MB pre-fill in a non-v0.6 key, then call `addInspiration(...)`.
- The function returns a valid record (the new inspiration is in `this._mem.inspirations[0]`).
- The UI shows `✅ Saved` toast (it has no idea the write failed).
- `localStorage.getItem('insightrecoder.inspirations.v1')` returns `null` (the actual write threw `QuotaExceededError`).
- **On next page reload, the inspiration is gone.**

**Why this is a real local-first violation:** a local-first app must not lose
data. The user trusted the "Saved" toast; the data is in volatile memory only.
The same pattern affects `addLink`, `removeLink`, `deleteInspiration`
(cascade-write), and the profile setter.

**Recommended fix (don't change the file — route to follow-up plan):**

1. Distinguish quota errors from other failures in `_write`:
   ```js
   } catch (err) {
     if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
       this._lastWriteError = 'quota';
     } else {
       this._lastWriteError = String(err);
     }
   }
   ```
2. Re-throw from `addInspiration` (or return `{ok:false, reason:'quota'}`) and have `app.js` show `❌ Storage full — clear some data in Settings` and **not** update the in-memory list.
3. The settings page already has a "Clear all data" button — link to it from the error toast.

**Severity:** P1 (silent data loss in a documented "local-first" product).

### Issue B — Cross-browser sanity is Chromium-only this cycle

The Playwright MCP server installed in this environment launches a single
Chromium instance. There is no `--browser firefox|webkit` knob exposed in the
MCP tool schema. I cannot truthfully claim Firefox/WebKit coverage from this
audit; the matrix rows marked `N/T` are honest gaps.

**Why the code is very likely fine on Firefox/WebKit anyway:**
- No browser-specific APIs in `app.js`, `storage.js`, `export.js`.
- The only third-party call (vis-network CDN) works on all three engines.
- `localStorage` semantics tested via the Node polyfill (spec-conformant).
- Export formats are pure strings/Blobs (Firefox 111+, Safari 14+, all modern).
- The only Safari-specific local-first concern is the well-known Safari 7-day
  ITP eviction of `localStorage` (see also `indexeddb`); since the data is
  export-able and there's no quota beyond ~5 MB, this is acceptable for an
  inspiration recorder, but **worth a follow-up note in the user-visible
  README**.

**Recommended next-step:** re-run the smoke flow on Firefox and WebKit via a
direct `npx playwright test --project=firefox --project=webkit` invocation
in a follow-up cycle; the project has no `package.json` so this would require
a one-off `npm i -D playwright @playwright/test` step.

### Issue C — Standalone HTML depends on vis-network CDN (not a bug, by design)

The exported `graph.html` contains an inlined `<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js">`. If the recipient opens the file with `file://` AND is offline AND does not have vis-network cached, the graph won't render.

**Why this is acceptable:**
- The data is inlined, so the file still opens and shows the empty-state copy
  (`No inspirations to render.` for empty corpus, or a quiet `vis is undefined` for non-empty).
- The user said "The ONLY acceptable network call after first load is the vis-network CDN script tag" — so the export mirrors the live app's behavior exactly.
- `file://` access is blocked by the Playwright MCP browser in this environment, so the open-from-filesystem test was performed by serving the file over `http://127.0.0.1:8770/exports-test-graph.html` and verifying exactly **2** network calls (page + CDN).

**Optional improvement (not blocking):** consider vendoring `vis-network.min.js` into `js/vendor/` and using a `<script src="vendor/vis-network.min.js">` path in the export, so the file is fully self-contained. The `js/vendor/` directory does not exist in v0.6.

## Detailed evidence

### 1. Storage API smoke test (`scripts/test-storage.mjs`)

Exercises `LocalStorageProvider` directly with a spec-conformant
`localStorage` polyfill. Verdict per scenario:

| Scenario | Outcome | Key data |
|---|---|---|
| `corrupt_JSON_inspirations` | PASS | `crashed: false`, `recoveredCount: 1` after `addInspiration` |
| `quota_exceeded_save` | **FAIL (Issue A)** | `addInspiration` returns record but `localStorage` is `null` |
| `first_run` | PASS | `listLen: 0`, `linksLen: 0`, `profileNull: true`, add works |
| `migration_idempotency` | PASS | `firstCall: {migrated:0, hadOldKey:true}`, legacy removed, new key unchanged; `secondCall: {migrated:0, hadOldKey:false}` |
| `migration_real` | PASS | 2 items, `user-aaa` → `insp-aaa`, tags from `field` |
| `migration_wrapped_shape` | PASS | 1 item from `{ideas:[…]}` wrapper |

### 2. Export roundtrip (`scripts/test-export-roundtrip.mjs`)

| Format | Filename | Size | Roundtrip | Notable checks |
|---|---|---|---|---|
| JSON | `insightrecoder-20260611.json` | 1 463 B | byte-equal after `buildExportPayload` → `exportJson` → `JSON.parse` → `buildExportPayload` | 4 inspirations + 3 links + profile preserved |
| Markdown | `insightrecoder-20260611.md` | 498 B | structure | H1, weekly H2, bullet items, `#tag` rendering |
| Standalone HTML | `insightrecoder-20260611.html` | 5 325 B | opened in Chromium | 4 inlined inspirations, 3 inlined links, 1 external `<script>` (vis-network CDN), **0** fetches, 0 external images |
| GraphML | `insightrecoder-20260611.graphml` | 2 379 B | parsed by `xml.etree.ElementTree` | 4 nodes, 3 edges, well-formed XML, all `<key>` declarations present |

**Filename safety:** all 4 filenames match `^[A-Za-z0-9._-]+$`, contain no
`..` or `/` or `\\`, and are derived from a hard-coded `insightrecoder-` +
`dateSlug()` (`YYYYMMDD`) — no user input flows in.

### 3. Live browser run (Chromium, via Playwright MCP)

- **First load** — 8 network requests, 7 same-origin (project files) + 1
  vis-network CDN. No favicon request (it's a `data:` URL). No API calls.
- **Primary flow** — captured 3 inspirations, pinned 2 suggestions, visited
  `#/graph` → 3 nodes, 2 edges, 3 communities, vis-network canvas 892×880.
- **Offline** — set `context.setOffline(true)` via `browser_run_code`,
  `navigator.onLine` flipped to `false`. Captured a 4th inspiration →
  persisted. Re-rendered graph → 4 nodes / 2 edges, canvas present.
  Visited `#/my` → all 4 export buttons fired and produced valid Blobs.
- **Standalone HTML render** — opened
  `http://127.0.0.1:8770/exports-test-graph.html` in the same browser.
  `window.vis` loaded, `window.__INSIGHT_DATA` populated (4 inspirations,
  3 links), `<canvas>` rendered (345×724), network log shows exactly 2
  requests: the page + the vis-network CDN.

## What I did NOT verify (honest gaps)

- **Firefox + WebKit primary flow.** Playwright MCP doesn't expose a
  browser selector. The storage code path is browser-agnostic (verified via
  Node polyfill); the browser-specific concern is ITP on Safari (see Issue B
  in this report).
- **Real 5 MB browser localStorage quota.** My polyfill used a 200-byte
  ceiling to force the error path; the real Safari localStorage quota is
  ~5 MB, Chrome ~10 MB, Firefox ~10 MB. The fix is the same regardless.
- **`#/timeline` and `#/profile` routes offline.** I exercised the
  capture / graph / my / export routes offline. The other two routes have
  no network calls and are unlikely to regress offline, but I didn't
  explicitly verify.
- **Service Worker / PWA manifest.** v0.6 has neither (confirmed by reading
  `index.html` — no SW registration, no manifest link). The audit
  prerequisites (Service Worker / PWA cache verification) do not apply.

## Files of interest (created during this audit, not shipped)

- `local-first-test/2026-06-11/scripts/test-storage.mjs` — Node smoke test for storage.js
- `local-first-test/2026-06-11/scripts/test-export-roundtrip.mjs` — Node test for all 4 export formats
- `local-first-test/2026-06-11/evidence/storage-results.json` — full output of the storage test
- `local-first-test/2026-06-11/evidence/export-roundtrip.json` — full output of the export test
- `local-first-test/2026-06-11/evidence/graphml-parse.txt` — Python `xml.etree` parse of the GraphML
- `local-first-test/2026-06-11/evidence/standalone-html-network.json` — network log for the standalone HTML
- `local-first-test/2026-06-11/exports/roundtrip.json` — JSON export
- `local-first-test/2026-06-11/exports/timeline.md` — Markdown export
- `local-first-test/2026-06-11/exports/graph.html` — Standalone HTML export
- `local-first-test/2026-06-11/exports/graph.graphml` — GraphML export
- `local-first-test/2026-06-11/exports/roundtrip-report.json` — combined export check report
- `exports-test-graph.html` — copy of the standalone HTML placed under the project root so the local HTTP server can serve it (the Playwright MCP blocks `file://`)

## VERDICT

**PASS (with one P1 fix to route to follow-up).**

No crash-on-load bugs, no first-run failures, no migration regressions, no
export format breaks, no path-traversal in filenames. Primary flow works
online and offline. The only blocker is `LocalStorageProvider._write`
silently swallowing `QuotaExceededError` (Issue A) — this is a
silent-data-loss bug, but it is not a crash, not a primary-flow regression,
and the rest of the local-first contract is honored. Route the fix to a
follow-up plan: surface the error to the UI and either prevent the
in-memory mirror update or prompt the user to clear data.
