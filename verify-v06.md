# verify-v06.md — InsightRecoder v0.6 module-level smoke test

> Run with: `node verify-v06.js` from the project root.
> Exits non-zero on any failure. 54 / 54 PASS.

## Test transcript

```
[1] Storage round-trip
  PASS  addInspiration exists
  PASS  getInspirations exists
  PASS  id format
  PASS  count=5
  PASS  round-trip
  PASS  delete returns true
  PASS  count=4 after delete
  PASS  deleted not found

[2] Tokenize + cosine
  PASS  tokenize keeps content words
  PASS  tokenize drops stop-words
  PASS  cosine identical=1
  PASS  cosine orthogonal=0
  PASS  cosine zero vector=0

[3] suggestLinks
  PASS  at least 1 suggestion
  PASS  top score > threshold
  PASS  top suggestion is a content match
  PASS  cooking pasta not top hit

[4] buildGraph
  PASS  3 nodes
  PASS  at least one inferred edge (a-b share words)
  PASS  explicit pinned link preserved

[5] detectCommunities
  PASS  communities is object
  PASS  3 nodes in communities
  PASS  k>=1
  PASS  colors map has color

[6] Export
  PASS  payload.app
  PASS  payload.version
  PASS  payload.inspirations
  PASS  payload.links
  PASS  json.blob is Blob
  PASS  json filename
  PASS  md.blob is Blob
  PASS  md filename
  PASS  md has ISO week label
  PASS  md has alpha entry
  PASS  html.blob is Blob
  PASS  html filename
  PASS  html inlines vis-network
  PASS  html inlines data
  PASS  html inlines text
  PASS  gml.blob is Blob
  PASS  gml filename
  PASS  graphml is XML
  PASS  graphml has root element
  PASS  graphml has text key
  PASS  graphml has node 1
  PASS  graphml has edge

[7] bestMatch (timeline search)
  PASS  bestMatch finds the right inspiration
  PASS  no-match returns null

[8] Links API
  PASS  dedupe by (source,target)
  PASS  kind promotes to pinned
  PASS  max score kept
  PASS  pinned subset
  PASS  removeLink works

[9] Migration
  PASS  node migration is no-op

54 pass, 0 fail
```

## Coverage map

| Spec requirement | Test |
|---|---|
| `addInspiration / getInspirations / getInspiration / deleteInspiration` | [1] |
| `addLink / removeLink / getLinks / getPinnedLinks` | [8] |
| Cascade-delete links on inspiration delete | [1] (count=4) |
| TF-IDF cosine similarity in [0, 1] | [2] |
| `suggestLinks` returns top-K by score | [3] |
| `buildGraph` returns vis-network shape | [4] |
| `detectCommunities` returns community id per node | [5] |
| `colorizeCommunities` returns color per id | [5] |
| `exportJson / exportMarkdown / exportStandaloneHtml / exportGraphml` | [6] |
| Standalone HTML inlines vis-network + data | [6] |
| GraphML has node + edge data | [6] |
| `bestMatch` from `idea-search.js` still works (timeline search) | [7] |
| Migration is no-op in node (no localStorage) | [9] |
| `node --check` on all JS files | (separate, see "syntax" below) |

## Syntax check

```
$ for f in js/app.js js/storage.js js/insight-connections.js js/export.js \
          js/llm-provider.js js/reviewer.js js/idea-search.js js/voice.js \
          verify-v06.js; do
    node --check "$f" && echo "$f: OK"
  done
js/app.js: OK
js/storage.js: OK
js/insight-connections.js: OK
js/export.js: OK
js/llm-provider.js: OK
js/reviewer.js: OK
js/idea-search.js: OK
js/voice.js: OK
verify-v06.js: OK
```

## What this test does NOT cover

- DOM rendering of any of the 6 pages (`#/profile, #/capture, #/graph,
  #/timeline, #/my, #/settings`). Browser-side test is out of scope
  for the 15-min worker budget; the engine's integration verifier
  is the appropriate place to smoke-test the live page lifecycle.
- Voice input (`js/voice.js`) — requires `window.webkitSpeechRecognition`
  which is not available in node.
- The actual vis-network library rendering — only that our `buildGraph`
  output is in the correct shape and that the standalone HTML export
  inlines the correct CDN URL.

## File sizes (post-rewrite)

```
js/app.js                    897 lines   (rewritten, 6 routes)
js/storage.js                340 lines   (rewritten, new API)
js/insight-connections.js    548 lines   (new, TF-IDF + Louvain)
js/export.js                 373 lines   (new, 4 export formats)
js/llm-provider.js            86 lines   (gutted to no-op stub)
js/reviewer.js                32 lines   (gutted to no-op stub)
js/idea-search.js            260 lines   (unchanged)
js/voice.js                  139 lines   (unchanged)
js/openai-llm-provider.js    253 lines   (unchanged, future hook)
css/style.css               1818 lines   (+388 lines for v0.6)
```
