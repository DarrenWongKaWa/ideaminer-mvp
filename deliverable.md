# Deliverable — IdeaMiner MVP (build-mvp)

## VERDICT: PASS — task complete.

## Summary

Built a working "丐版" IdeaMiner web SPA at `/Users/wangjiahua/.minimax-agent-cn/projects/ideaminer-mvp/`.
All 11 required files exist with real content; module-level smoke tests pass (28/28);
end-to-end Playwright test (form → explore → like → /saved → /my) confirmed every page
renders correctly with a real idea from `data/mock-ideas.json` and the 4 feedback buttons
are wired to `Storage.recordFeedback()` / `saveIdea()` / clipboard copy.

## Changed files

```
./.gitignore                          8 lines
./README.md                         138 lines
./css/style.css                     529 lines
./data/mock-ideas.json              160 lines  (12 ideas, 6 fields: 物理学×3, 化学×2, 生物学×2, 计算机科学×2, 数学×2, 材料科学×1)
./index.html                         21 lines
./js/app.js                         565 lines
./js/idea-generator.js               79 lines
./js/llm-provider.js                115 lines
./js/reviewer.js                     75 lines
./js/storage.js                     153 lines
./js/voice.js                        93 lines
```

Total: **1,936 lines** across 11 files. No node_modules, no build step.

## How to run locally

```bash
cd /Users/wangjiahua/.minimax-agent-cn/projects/ideaminer-mvp
python3 -m http.server 8080
# then open http://localhost:8080
```

## Verification done

1. `node --check` on all 6 JS modules — all parse clean.
2. `node /tmp/ideaminer-smoke.mjs` — 28/28 assertions pass:
   - MockLLMProvider latency ∈ [400ms, 1200ms], returns idea with question/background/significance/methods, no id/field leakage.
   - MockReviewer deterministic (same input → same scores), all 3 dims in [0,100], summary non-empty.
   - IdeaGenerator.next returns full ReviewedIdea with id prefix `rv-`, numeric generatedAt.
   - AbortSignal cancellation throws DOMException('aborted').
   - LocalStorageProvider round-trip works in both window and node environments (after in-memory mirror fix).
   - Unknown field falls back to all; empty profile still works.
3. `python3 -m http.server 8765` + `curl` — every static path returns HTTP 200.
4. Playwright headless run: filled profile form (物理学 / 量子几何与非线性输运 / 博士) →
   clicked 继续 → explore page rendered a real 物理学 idea (Haldane 模型冷原子光晶格) with
   创新 66 / 可行 45 / 重要 92, all 4 feedback buttons visible, bottom nav present → clicked
   喜欢 → toast "已收藏" appeared → /saved showed the saved card → /my showed profile + 喜欢 1.

## Architecture decisions

- **Pure vanilla JS, ES modules** — no React, no npm, no build step. `index.html` loads `js/app.js` with `type=module`.
- **Hash router** — `#/profile`, `#/explore`, `#/saved`, `#/my`. Listens to `hashchange`; re-render is single-pass via `innerHTML`.
- **AbortController wired through IdeaGenerator → LLMProvider** — switching pages cancels in-flight requests cleanly.
- **Stable `id` for ReviewedIdea** — `rv-<base36 timestamp>-<random>` to allow dedup in `Storage.saveIdea`.
- **Mock data includes the Rydberg-blockade idea** (idea-001) rewritten in the same Chinese style as the user's reference screenshot.
- **In-memory mirror in LocalStorageProvider** — keeps Storage working in SSR / node tests (verified in smoke test). Real users get localStorage; tests get the mirror.
- **Voice input is feature-detected** — 🎤 button is hidden if `webkitSpeechRecognition` is missing (no error shown to user).
- **MockReviewer uses FNV-1a hash on the question** — same idea → same scores across reloads (deterministic UX).
- **Drag-state for mic button** — clicking mic again while recording stops it; on interim results the field updates live; on final result the mic returns to idle.

## Known limitations (MVP-acceptable)

- All 12 ideas are hand-written; with many users you'll see repeats before LLM ships.
- Voice input requires Chrome / Edge / Safari 14.1+; Firefox users simply won't see the mic button.
- No backend; refreshing browser keeps data, clearing site data nukes it.
- No i18n; all UI text is Chinese.

## Future extension roadmap

See `README.md` §5 — top 6: real LLM, real backend storage, feedback-aware ranking, retrieval-augmented idea recall, community feedback aggregation, multimodal input. Each one is a single-class swap (`OpenAILLMProvider`, `ApiStorageProvider`, `LLMReviewer`).

## Key interface contracts (for extension)

- `LLMProvider.generateIdea(profile, signal) → Promise<{question, background, significance, methods[]}>`
- `Storage` — sync API: `getProfile / setProfile / saveIdea / removeIdea / getSavedIdeas / recordFeedback / getFeedbackHistory`
- `Reviewer.review(ideaDraft) → Promise<{innovation, feasibility, importance, summary}>`
- `VoiceInput.start(onResult, onError) / stop() / isSupported()`

## VERDICT: PASS — task complete
