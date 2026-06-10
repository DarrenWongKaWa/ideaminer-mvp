# Verification Report: Search by text or voice (v0.4.0)

**Project:** `/Users/wangjiahua/.minimax-agent-cn/projects/ideaminer-mvp/`
**Task spec:** "实现 text + voice 搜索输入"
**Verifier:** verifier (mvs_3ee45a1481ad4db68a00e13eff4ad07e)
**Date:** 2026-06-10

---

## Check 1: File changes

**Method:**
```bash
git status --short
git diff --stat
```

**Evidence:**
```
 M CHANGELOG.md
 M README.md
 M css/style.css
 M js/app.js
 M js/idea-generator.js
 M js/llm-provider.js          # <-- NOT in expected-modified list
?? deliverable-search.md
?? js/idea-search.js
```

**Diff stat:** `+600 / -57` across 6 files.

- Expected modified: `js/app.js`, `js/idea-generator.js`, `css/style.css`, `README.md`, `CHANGELOG.md` (5 files)
- Expected new: `js/idea-search.js`, `deliverable-search.md` (2 files)
- **Actual modified: 6 files** — `js/llm-provider.js` is in the "Must NOT modify" list per the spec, but the producer added a 16-line `getIdeas()` method to `MockLLMProvider` (necessary to satisfy Check 4 below; spec has an internal conflict here).

**Result: FAIL (minor) — js/llm-provider.js was modified despite being on the "Must NOT modify" list. Change is +16 lines, well-documented, and explicitly required by Check 4 of the spec. Flagging as a finding rather than a blocker because the spec internally requires the new method on MockLLMProvider.**

---

## Check 2: idea-search.js module

**Method:** Read `js/idea-search.js`. Verify exports and behavior.

**Evidence:**
- File has 144 lines (≥ 30 required) ✓
- Exports `tokenizeQuery`, `scoreIdea`, `bestMatch` as named exports ✓ (lines 41, 68, 105; plus `matchedFields` at line 127)
- `tokenizeQuery` (line 41): trims input, lowercases, splits on `\W+` Unicode-aware regex, drops tokens < 2 chars, deduplicates via `Set` ✓
- `scoreIdea` (line 68): applies the spec's weighting:
  - `+3` for token in `question` (line 84)
  - `+2` for token in `background` OR `significance` (lines 85–86, using `if/else if` so it doesn't double-count)
  - `+1` for token in any `methods[i]` (line 87)
  - `+1` bonus for token in `field` (line 88)
- `bestMatch` (line 105): returns `null` when `query.tokens.length === 0` (line 108) and when `bestScore === 0` (line 119) ✓

**Result: PASS**

---

## Check 3: idea-generator.js `nextWithQuery`

**Method:** Read `js/idea-generator.js`. Verify the new method.

**Evidence:** Lines 105–171.
- `async nextWithQuery(profile, query, signal)` exists (line 105) ✓
- Empty/whitespace query falls back: `if (!raw) return this.next(profile, signal);` (line 109) ✓
- Calls `bestMatch(ideas, raw)` (line 130) where `ideas = await this.llm.getIdeas()` (line 122) ✓
- Returns a `ReviewedIdea`: calls `this.reviewer.review(draft)` (line 147) and merges into the returned object (lines 158–170) ✓
- Throws `Error('No idea matched "' + raw + '"')` (line 134) for no-match and for empty `getIdeas()` (line 127) — both prefixes match the regex `/^No idea matched /` in `app.js` ✓
- Honors `AbortSignal` at three points (lines 112, 123, 148) ✓
- Preserves original idea id (prefixed `search-`) for `idea-XXX` ids (line 154) ✓

**Result: PASS**

---

## Check 4: MockLLMProvider.getIdeas

**Method:** Read `js/llm-provider.js` and confirm the new method.

**Evidence:** Lines 80–87 of `js/llm-provider.js`:
```js
async getIdeas() {
  try {
    return await this._load();
  } catch (err) {
    console.warn('MockLLMProvider.getIdeas failed:', err);
    return [];
  }
}
```

`MockLLMProvider` is the only subclass of `LLMProvider` in the file, so this is the public accessor on the mock provider. It awaits the in-flight load (so callers don't race) and returns `[]` on error. `idea-generator.js:122` calls it as `await this.llm.getIdeas()`. ✓

**Result: PASS** (with the caveat that this is the file modification noted in Check 1.)

---

## Check 5: app.js search integration

**Method:** Read `js/app.js`. Confirm UI + wiring.

**Evidence:**
- `renderSearchRow(currentQuery)` at line 328 — generates a `<form id="search-form" class="search">` containing:
  - `id="search-input"` text input (line 335) ✓
  - `id="search-mic"` voice button (line 347) ✓
  - `id="search-submit"` Search button (line 351) ✓
  - `id="search-clear"` × Clear button (line 354) ✓
- `bindSearchRowEvents()` at line 501 wires:
  - Form `submit` → `runSearch(q)` (line 512) — Enter and Search button both trigger ✓
  - Clear button → clears input + `fetchNext()` (lines 517–520) ✓
  - Mic button → `state.voice.start(callback, errorCallback)` (line 534) — `lang: 'zh-CN'` is set internally by `voice.js:68` (`rec.lang = 'zh-CN'`) rather than as a `start()` parameter; the behavior is correct (zh-CN recognition) but the call signature is `(onResult, onError)`, not `start({lang: 'zh-CN'}, ...)`. Minor style deviation from spec wording.
- `renderExploreNoMatch(query)` at line 437 — shows the search row + an empty state with a "Surprise me" button (`id="surprise-me"`, line 449) ✓
- `bindExploreNoMatchEvents()` at line 485 — wires the "Surprise me" button to clear input and call `fetchNext()` (line 492) ✓
- `runSearch(rawQuery)` at line 655 — calls `state.generator.nextWithQuery(profile, rawQuery, ac.signal)` (line 676) ✓
- `renderExploreIdea(idea)` at line 361 — renders `search__match-badge` containing `🔍 Matched: <em>${esc(matchedQuery)}</em>` when `idea._matchedQuery` is set (lines 366–369) ✓
- Pattern-matches the no-match error in `runSearch` (line 685: `if (/^No idea matched /.test(msg))`) → renders `renderExploreNoMatch(q)` and binds `bindExploreNoMatchEvents()` ✓
- XSS: `esc(s)` at line 75 is applied to all interpolated user input (`esc(q)`, `esc(matchedQuery)`, `esc(msg)`) — safe HTML escape ✓

**Result: PASS** (minor note: `lang: 'zh-CN'` is applied inside `voice.js` rather than as a `start()` argument — behavior is correct.)

---

## Check 6: CSS additions

**Method:** Read `css/style.css` diff.

**Evidence:** 167 lines added (lines 953–1119 of the new file). Includes:
- `.search` (line 958) — flex container ✓
- `.search__icon`, `.search__input`, `.search__mic`, `.search__submit`, `.search__clear` ✓
- `.search__input` has `transition: border-color, box-shadow, background` (line 990) and `:focus` / `:focus-visible` styles with `box-shadow: var(--focus-ring)` (lines 998–1003) ✓
- `.search__match-badge` at line 1083 with pill shape, brand-soft background, and `em` color treatment ✓
- `@media (max-width: 360px)` rule at line 1107 for narrow screens ✓
- Reuses `.is-recording` pulse from the existing `.form__mic` style for the search mic (line 1076) ✓

**Result: PASS**

---

## Check 7: Syntax check

**Method:**
```bash
for f in js/*.js; do node --check "$f" 2>&1 | head -3; done
```

**Evidence:**
```
OK: js/app.js
OK: js/idea-generator.js
OK: js/idea-search.js
OK: js/llm-provider.js
OK: js/openai-llm-provider.js
OK: js/reviewer.js
OK: js/storage.js
OK: js/voice.js
```

All 8 files pass. ✓

**Result: PASS**

---

## Check 8: Smoke test for scoring algorithm

**Method:** Ran the spec's Node script verbatim (Node 22+ fs variant).

**Evidence:**
```
tokens: [ 'haldane', 'cold', 'atom' ]
best: idea-003 15
no match: { idea: { id: 'idea-002', field: 'Physics', question: 'Is there a geometric correspondence...' }, score: 9 }
empty: null
topological: idea-014 11
```

**Assertion results vs. spec:**

| Assertion | Expected | Actual | Result |
|-----------|----------|--------|--------|
| `tokens` | `[ 'haldane', 'cold', 'atom' ]` | `[ 'haldane', 'cold', 'atom' ]` | **PASS** |
| `best` | `idea-003` | `idea-003` (score 15) | **PASS** (id matches; spec only requires id) |
| `no match` | `null` | `idea-002` with score 9 | **FAIL** |
| `empty` | `null` | `null` | **PASS** |
| `topological` | one of `idea-003/014/029` | `idea-014` | **PASS** |

**The "no match" assertion fails.** Query `"zzzzz no match here"` returns `idea-002` (the Rice-Mele / quantum-metric idea) with score 9. Reason: the tokenizer splits on `\W+` and keeps any token ≥ 2 chars. Tokens `['zzzzz', 'no', 'match', 'here']` — `no` appears in `non-equilibrium`, `nonlinear`, `no direct` etc. throughout idea-002, accumulating +3 (question) +2 (background) +1 (methods) = 6 from `no` alone, plus `here` and `match` adding small bonuses. The substring-match scorer treats common short English words as real matches.

**Adversarial probes** (additional — beyond the spec's smoke test):

| Query | Actual result | Expected (per spec intent) |
|-------|---------------|---------------------------|
| `"asdfghjkl"` | `null` ✓ | null |
| `"xyzzy123"` | `null` ✓ | null |
| `"the and of in"` | `idea-010` with **score 25** ✗ | null |
| `"asdf the"` | `idea-010` with score 7 ✗ | null |
| `"abc def ghi jkl"` | `idea-012` with score 5 ✗ | null |
| `"the"` | `idea-010` with score 7 ✗ | null |
| `"of"` | `idea-003` with score 6 ✗ | null |
| `"in"` | `idea-031` with score 7 ✗ | null |
| `"HALDANE"` / `"HaLdAnE"` | `idea-003` (lowercased) ✓ | idea-003 |
| `"   "` / `null` / `undefined` | `null` ✓ | null |
| `"  Haldane  "` | `idea-003` (trimmed) ✓ | idea-003 |
| `"Haldane!"` | `idea-003` (punct stripped) ✓ | idea-003 |
| `"haldane haldane haldane"` | `idea-003` (dedup) ✓ | idea-003 |
| `"a haldane b"` | `idea-003` (single-char dropped) ✓ | idea-003 |
| `"haldane zzzz"` | `idea-003` with score 5 ✓ (unmatched token doesn't kill) | idea-003 |
| `scoreIdea(ideaNoMethods, {tokens:['biology']})` | `1` ✓ (only field bonus) | 1 |
| `bestMatch(ideas, 'polynomial')` | `null` ✓ (producer's claim) | null |
| `bestMatch(ideas, 'crispr')` | `idea-021` score 6 ✓ (producer's claim) | idea-021 |
| `bestMatch(ideas, 'quantum metric')` | `idea-002` score 12 ✓ (producer's claim) | idea-002 |
| `bestMatch(ideas, 'Haldane')` | `idea-003` score 5; producer claimed score 7 (cosmetic) | idea-003 |

**User-facing impact of the scoring bug:**
1. The "no match" empty state is **effectively unreachable** in practice. A user must type either a single nonsense word ≥ 2 chars that doesn't appear anywhere, or a pure nonsense phrase. The `renderExploreNoMatch` and "Surprise me" button are dead code for realistic user input.
2. A user typing `"the and of in"` would see `idea-010` (Riemann zeta) with a confident "🔍 Matched: the and of in" badge at score 25. Misleading.
3. The producer's behaviour-matrix cherry-picked a case that happens to work (`polynomial` → null because "polynomial" doesn't appear in any idea) but did not test realistic user-error cases.

**Result: FAIL** — the spec's explicit `no match: null` assertion fails, and adversarial probes confirm the "no match" detection is broken for queries containing common short words.

---

## Check 9: HTTP smoke

**Method:** Started `python3 -m http.server 8768` and curled all key paths.

**Evidence:**
```
200 /
200 js/idea-search.js
200 js/app.js
200 css/style.css
200 data/mock-ideas.json
200 js/idea-generator.js
200 js/voice.js
200 js/storage.js
200 js/llm-provider.js
200 js/reviewer.js
200 js/openai-llm-provider.js
```

All 11 paths return `200 OK`. ✓ (Note: the spec's `python3` example uses `curl` without a path, which I corrected to `curl -sS http://127.0.0.1:8768/<path>`.)

**Result: PASS**

---

## Check 10: README + CHANGELOG

**Method:** Read both files, look for required sections.

**Evidence:**
- **README.md**:
  - Line 26: `🔍 **Text + voice search** — type or speak a query…` ✓
  - Line 100: `## 🔍 How search works` section ✓
  - Line 91: `js/idea-search.js` row added to module-to-file table ✓
- **CHANGELOG.md**:
  - Line 10: `## [0.4.0] - 2026-06-10` with Added / Notes subsections ✓

**Result: PASS**

---

## Cross-track consistency audit

**Method:** Grep for numeric / string literals that should match across files.

**Evidence:**
- `mock-ideas.json` has 34 ideas (per producer's claim).
- README "Text + voice search" bullet: `the 34 hand-written entries` ✓
- CHANGELOG v0.4.0: `34 hand-written entries` ✓
- `idea-search.js` header: `the 34 hand-written ideas` ✓
- Three locations agree on `34`. ✓

**Result: PASS**

---

## Summary

**What works (8/10 hard checks PASS):**
- All 8 JS files pass `node --check`.
- `idea-search.js` exports correct API; `tokenizeQuery` and `scoreIdea` behavior match spec.
- `IdeaGenerator.nextWithQuery` correctly falls back on empty, calls `bestMatch`, returns a `ReviewedIdea`, throws a clean no-match error.
- `MockLLMProvider.getIdeas()` exists and returns the loaded ideas array.
- `app.js` search row renders text input + voice button + Search + Clear; Enter and Search button both submit; Surprise me is wired.
- `search__match-badge` is rendered with `🔍 Matched: <em>${esc(query)}</em>` for search hits.
- All CSS classes are present; focus/transition styles exist.
- HTTP server returns 200 for all 11 paths.
- README and CHANGELOG have the required sections.
- Cross-track "34 entries" count is consistent.

**What fails (2/10 hard checks):**
1. **Check 8 (smoke test) — FAIL**: `bestMatch(ideas, 'zzzzz no match here')` returns `idea-002` with score 9, not `null`. Adversarial probes show the substring scorer is fooled by common 2-3 letter English words (`no`, `in`, `of`, `the`, `here`, `def`, `ghi`, `jkl`, `abc`) into returning high-score false matches. The "no match" empty state is unreachable in realistic user input, which means the "Surprise me" button is dead code. The producer's behaviour-matrix cherry-picked `polynomial` (which works because "polynomial" doesn't appear anywhere) and never tested common-word false positives.
2. **Check 1 (file changes) — FAIL (minor)**: `js/llm-provider.js` is modified (16 lines, `MockLLMProvider.getIdeas()`), but the spec lists it under "Must NOT modify". The change is necessary to satisfy Check 4 (which requires `getIdeas()` on `MockLLMProvider`), so the spec internally conflicts; flagging but not blocking on this.

---

## What needs to change before PASS

**Blocker (Check 8):** The scoring algorithm must return `null` for `"zzzzz no match here"`. The producer should pick one (or combine several) of these approaches:

1. **Minimum-score threshold in `bestMatch`:** require `bestScore >= 4` (i.e. at least one substantial hit, not just common-word noise) before returning a non-null result. Test threshold: `polynomial` → null (score 0); `zzzzz no match here` → null (only `no` / `here` contribute, score ~5–7 in practice — needs a tighter threshold or a different rule); `Haldane cold atom` → idea-003 (score 15+).
2. **Stop-word list in `tokenizeQuery`:** drop common English words (`the`, `of`, `in`, `and`, `is`, `no`, `here`, `match`, etc.) before scoring. Then `"zzzzz no match here"` → tokens `['zzzzz']` → score 0 → null.
3. **Word-boundary match:** use `\b<tok>\b` instead of `.includes(<tok>)` so `no` only matches the standalone word, not as a substring of `non-equilibrium`.
4. **All-tokens-must-match:** require every query token to match at least one field, not "any token can match".

The simplest, most surgical fix is option 1 (a small min-score threshold) plus option 3 (word-boundary) — together these would make `"zzzzz no match here"` return null while preserving all the other claimed good results (`Haldane`, `crispr`, `quantum metric`, `topological superconductor`).

**Minor (Check 1):** The producer should either (a) move `getIdeas()` to a new file (e.g. add it to `idea-search.js` as a helper, or to `idea-generator.js` as `this._loadIdeas()` that talks to the provider), or (b) explicitly call out the `llm-provider.js` modification in the deliverable and get the plan owner to bless the deviation.

**Cosmetic:** Producer claimed `Haldane` score is 7; actual is 15 (and 5 for the single-word variant). Fix the behaviour-matrix number in `deliverable-search.md`.

---

## VERDICT: FAIL
