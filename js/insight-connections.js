/**
 * insight-connections.js
 * ------------------------------------------------------------
 * TF-IDF cosine similarity, vis-network graph builder, and an
 * in-browser Louvain community-detection implementation.
 *
 * The "connection" concept: every saved inspiration is a node;
 * an edge exists between two inspirations A and B if the
 * TF-IDF cosine similarity of their tokenized text exceeds
 * a small threshold (default 0.05). Pinned links (kind='pinned')
 * are added on top, regardless of score.
 *
 * All functions are pure (no DOM, no async). `buildGraph` and
 * `detectCommunities` operate on the in-memory shape returned
 * by `getInspirations()` / `getLinks()`, so the smoke test can
 * run in node.
 * ------------------------------------------------------------
 */

// English stop-words (copied from js/idea-search.js so the
// behavior of the timeline search and the connection engine is
// consistent).
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'if', 'so', 'yet', 'for', 'nor',
  'of', 'in', 'on', 'at', 'to', 'by', 'with', 'from', 'as', 'into',
  'about', 'up', 'out', 'off', 'over', 'under', 'via', 'per',
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'she', 'it',
  'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing', 'done',
  'will', 'would', 'shall', 'should',
  'can', 'could', 'may', 'might', 'must',
  'no', 'not', 'yes', 'nor',
  'here', 'there', 'where', 'when', 'why', 'how',
  'all', 'any', 'some', 'more', 'most', 'few', 'many', 'much',
  'such', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
  'also', 'then', 'now', 'even', 'still', 'ever', 'never',
  'what', 'which', 'who', 'whom', 'whose',
  'match', 'find', 'want', 'need', 'look', 'search', 'show', 'give',
  'get', 'see', 'use', 'using', 'used',
]);

/**
 * Tokenize a string for the connection engine.
 * - Lowercase
 * - Split on non-word (Unicode-aware) characters
 * - Drop tokens with length < 2
 * - Drop English stop-words
 * - Dedupe (preserve order)
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeInspiration(text) {
  const out = [];
  const seen = new Set();
  const src = String(text == null ? '' : text).toLowerCase();
  for (const tok of src.split(/[^\p{L}\p{N}]+/u)) {
    if (!tok || tok.length < 2) continue;
    if (STOP_WORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/**
 * Compute the bag-of-words count for a token list.
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function termFreq(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/**
 * Cosine similarity between two dense numeric vectors.
 * Both vectors must be the same length. Returns 0 for any
 * zero-magnitude input.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Compute TF-IDF vector for one document.
 * @param {string[]} tokens  tokenized document
 * @param {string[]} vocab   vocabulary (sorted for stability)
 * @param {Map<string, number>} idf  precomputed idf map
 * @returns {number[]} dense vector aligned with `vocab`
 */
function tfidfVector(tokens, vocab, idf) {
  const tf = termFreq(tokens);
  const out = new Array(vocab.length).fill(0);
  for (let i = 0; i < vocab.length; i++) {
    const t = vocab[i];
    const f = tf.get(t) || 0;
    if (f > 0) out[i] = f * (idf.get(t) || 0);
  }
  return out;
}

/**
 * Build vocabulary + IDF from a corpus of tokenized documents.
 * @param {string[][]] | string[]|null|undefined} docs  array of token lists
 * @returns {{ vocab: string[], idf: Map<string, number> }}
 */
function buildVocabIdf(docs) {
  const list = Array.isArray(docs) ? docs : [];
  const df = new Map();
  for (const doc of list) {
    if (!Array.isArray(doc)) continue;
    const seen = new Set(doc);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  // Sort vocab for stable vectors (helps debugging + tests)
  const vocab = Array.from(df.keys()).sort();
  const N = list.length || 1;
  const idf = new Map();
  for (const t of vocab) {
    const d = df.get(t) || 1;
    idf.set(t, Math.log(1 + N / d));  // smoothed IDF (always > 0)
  }
  return { vocab, idf };
}

/**
 * Compute TF-IDF vectors for the entire corpus.
 * @param {Array<{ id: string, text: string }>} inspirations
 * @returns {{ vocab: string[], idf: Map<string, number>, vectors: Map<string, number[]> }}
 */
function buildCorpus(inspirations) {
  const docs = [];
  const idOrder = [];
  for (const it of inspirations) {
    if (!it) continue;
    idOrder.push(it.id);
    docs.push(tokenizeInspiration((it && it.text) || ''));
  }
  const { vocab, idf } = buildVocabIdf(docs);
  const vectors = new Map();
  for (let i = 0; i < idOrder.length; i++) {
    vectors.set(idOrder[i], tfidfVector(docs[i], vocab, idf));
  }
  return { vocab, idf, vectors };
}

/**
 * Return the top-K most similar past inspirations to a new one.
 * Pinned-only is NOT enforced here (the caller decides which
 * kind= links to add).
 *
 * @param {{ id: string, text: string }} newInspiration
 * @param {Array<{ id: string, text: string }>} allInspirations
 * @param {number} [topK=3]
 * @param {number} [minScore=0.05]
 * @returns {Array<{ inspiration: object, score: number }>}
 *   sorted by score desc, dropping entries with score < minScore
 */
export function suggestLinks(newInspiration, allInspirations, topK = 3, minScore = 0.05) {
  if (!newInspiration || !newInspiration.text) return [];
  if (!Array.isArray(allInspirations) || allInspirations.length === 0) return [];
  const newId = newInspiration.id;

  // Build corpus = [new] + all (excluding new). If new has no id,
  // synthesize one.
  const synthId = newId || '__new__';
  const corpus = [{ id: synthId, text: newInspiration.text }]
    .concat(allInspirations.filter((x) => x && x.id && x.id !== newId));

  const { vectors } = buildCorpus(corpus);
  const vNew = vectors.get(synthId);
  if (!vNew) return [];

  const scored = [];
  for (const it of allInspirations) {
    if (!it || !it.id || it.id === newId) continue;
    const v = vectors.get(it.id);
    if (!v) continue;
    const s = cosine(vNew, v);
    if (s >= minScore) scored.push({ inspiration: it, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, topK));
}

/**
 * Build a vis-network graph from inspirations + links.
 * If `links` is empty, infer edges from the corpus using the same
 * TF-IDF cosine threshold as `suggestLinks` (0.05), and mark them
 * kind='inferred'.
 *
 * @param {Array<{ id: string, text: string, createdAt?: number, tags?: string[], source?: string }>} inspirations
 * @param {Array<{ source: string, target: string, score: number, kind: string }>} links
 * @param {{ inferIfEmpty?: boolean, inferThreshold?: number }} [opts]
 * @returns {{ nodes: Array<object>, edges: Array<object> }}
 */
export function buildGraph(inspirations, links, opts) {
  const inferIfEmpty = !opts || opts.inferIfEmpty !== false;
  const threshold = (opts && Number(opts.inferThreshold)) || 0.05;

  const list = Array.isArray(inspirations) ? inspirations : [];
  const userLinks = Array.isArray(links) ? links : [];

  // Decide which edge set to use
  let edges;
  if (userLinks.length > 0) {
    edges = userLinks.map((l) => ({
      from: l.source,
      to: l.target,
      score: l.score,
      kind: l.kind || 'inferred',
      arrows: { to: { enabled: false } },
      smooth: { enabled: true, type: 'continuous' },
    }));
  } else if (inferIfEmpty && list.length >= 2) {
    edges = inferEdges(list, threshold);
  } else {
    edges = [];
  }

  const nodes = list.map((it) => ({
    id: it.id,
    label: truncateLabel(it.text || '(empty)'),
    title: it.text || '',
    text: it.text,
    createdAt: it.createdAt || 0,
    tags: Array.isArray(it.tags) ? it.tags : [],
    source: it.source || 'text',
    font: { size: 12, color: '#1a1a1a' },
    shape: 'dot',
    size: 14,
  }));

  return { nodes, edges };
}

function truncateLabel(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 28) return t;
  return t.slice(0, 27) + '…';
}

/**
 * Build the symmetric edge set by enumerating all pairs and
 * applying the cosine threshold.
 * @param {Array<{ id: string, text: string }>} inspirations
 * @param {number} threshold
 * @returns {Array<{ from: string, to: string, score: number, kind: string }>}
 */
function inferEdges(inspirations, threshold) {
  const { vectors } = buildCorpus(inspirations);
  const ids = inspirations.map((x) => x.id).filter(Boolean);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = vectors.get(ids[i]);
      const b = vectors.get(ids[j]);
      if (!a || !b) continue;
      const s = cosine(a, b);
      if (s >= threshold) {
        out.push({ from: ids[i], to: ids[j], score: s, kind: 'inferred' });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------
 * Louvain community detection (in-browser, ~3 KB).
 *
 * Implementation follows the standard Louvain algorithm
 * (Blondel et al. 2008): iterate a local-moving phase and a
 * graph-aggregation phase until modularity stops improving.
 *
 * For small graphs (<200 nodes) the implementation runs in
 * well under 100ms on a 2020 MacBook; for the v0.6 typical
 * case of 50 nodes it is essentially instant.
 *
 * Public API:
 *   detectCommunities(graph) -> { nodeId: number } per node
 *
 * Returns a plain object mapping node id -> integer community id
 * (0..K-1, contiguously renumbered in first-seen node order).
 * The caller can compute K as `Math.max(0, ...Object.values(out)) + 1`
 * (or 0 for an empty graph).
 *
 * Modularity-gain formula (standard Louvain, Blondel et al. 2008):
 *   ΔQ = (kI,in / m) − (Σtot · ki / (2m²))
 * where
 *   kI,in  total weight of edges from node i to nodes in the
 *          target community
 *   Σtot   sum of weights of all edges incident to nodes in the
 *          target community
 *   ki     sum of weights of all edges incident to node i
 *          (degree of i in the weighted graph)
 *   m      total weight of all edges in the graph (counted once
 *          per undirected edge)
 * ------------------------------------------------------------------ */

const COMMUNITY_PALETTE = [
  '#5b8def', // brand blue
  '#1aa260', // success green
  '#b8851a', // warning amber
  '#c63b94', // magenta
  '#8b5cf6', // violet
  '#0ea5e9', // sky
  '#ef4444', // red
];

/**
 * Return a community id for every node in the graph. The id
 * is assigned contiguously (0..K-1) and stable across runs
 * for the same graph (sorted by first-seen node order).
 *
 * For very small or fully-disconnected graphs where Louvain
 * degenerates to one community, we fall back to a simple
 * connected-components label (each connected component gets
 * its own id). Isolated nodes (no edges) get a unique id each.
 *
 * @param {{ nodes: Array<{id: string}>, edges: Array<{from: string, to: string, score: number}> }} graph
 * @returns {Record<string, number>}  nodeId -> communityId
 */
export function detectCommunities(graph) {
  const nodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
  const edges = (graph && Array.isArray(graph.edges)) ? graph.edges : [];
  const out = {};
  if (nodes.length === 0) return out;

  // Build adjacency: id -> [{ neighborId, weight }]
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (!e || !e.from || !e.to) continue;
    const w = Math.max(0, Math.min(1, Number(e.score) || 0));
    if (adj.has(e.from)) adj.get(e.from).push({ neighbor: e.to, weight: w });
    if (adj.has(e.to))   adj.get(e.to).push({ neighbor: e.from, weight: w });
  }

  // If no edges at all, every node is its own community
  // (connected-components fallback, with adjacency empty so each
  // node becomes its own component).
  if (edges.length === 0) {
    return connectedComponentsFallback(nodes, adj);
  }

  // ----- Louvain main loop -----
  // Phase 1: each node starts in its own community.
  const community = new Map();
  for (const n of nodes) community.set(n.id, n.id);

  // m = total weight of all edges (counted once per undirected edge).
  const m = totalWeight(adj);
  if (m <= 0) {
    // Degenerate: zero-weight graph. Use connected components.
    return connectedComponentsFallback(nodes, adj);
  }

  // Σtot[c] = sum of weights of all edges incident to nodes in c.
  const sumTot = new Map();
  for (const n of nodes) {
    const c = community.get(n.id);
    let s = 0;
    for (const e of (adj.get(n.id) || [])) s += e.weight;
    sumTot.set(c, (sumTot.get(c) || 0) + s);
  }

  let improved = true;
  let iterations = 0;
  const MAX_ITER = 20;
  while (improved && iterations < MAX_ITER) {
    improved = false;
    iterations++;
    for (const n of nodes) {
      const i = n.id;
      const ci = community.get(i);
      const ki = nodeDegree(adj, i);  // degree of i

      // Gather candidate communities (every neighbor's community,
      // skipping the one i is currently in).
      const candidates = new Map();
      for (const e of (adj.get(i) || [])) {
        const cj = community.get(e.neighbor);
        if (cj === ci) continue;
        candidates.set(cj, (candidates.get(cj) || 0) + e.weight);
      }

      // Pick the best target community by ΔQ.
      // ΔQ = (kI,in / m) − (Σtot · ki / (2m²))
      // No-move baseline is 0 (staying in ci has no modularity change).
      let bestC = ci;
      let bestGain = 0;
      for (const [c, kIIn] of candidates) {
        const sumTotC = sumTot.get(c) || 0;
        const gain = (kIIn / m) - (sumTotC * ki / (2 * m * m));
        if (gain > bestGain) {
          bestGain = gain;
          bestC = c;
        }
      }

      if (bestC !== ci) {
        // Update Σtot for source and target communities
        const sumInCi = neighborWeightsInCommunity(adj, i, ci, community);
        sumTot.set(ci, (sumTot.get(ci) || 0) - 2 * sumInCi);
        const sumInBest = neighborWeightsInCommunity(adj, i, bestC, community);
        sumTot.set(bestC, (sumTot.get(bestC) || 0) + 2 * sumInBest);

        community.set(i, bestC);
        improved = true;
      }
    }
  }

  // Renumber communities contiguously 0..K-1, preserving first-seen
  // node order (so the colors are stable across runs).
  const labelMap = new Map();
  for (const n of nodes) {
    const c = community.get(n.id);
    if (!labelMap.has(c)) labelMap.set(c, labelMap.size);
    out[n.id] = labelMap.get(c);
  }

  // Fallback: if Louvain produced a single community and the graph
  // has multiple connected components, give each component its own id.
  if (labelMap.size === 1 && countConnectedComponents(nodes, adj) > 1) {
    return connectedComponentsFallback(nodes, adj);
  }

  return out;
}

function totalWeight(adj) {
  let s = 0;
  for (const [, list] of adj) for (const e of list) s += e.weight;
  return s / 2;  // m (counted once per undirected edge)
}

function nodeDegree(adj, node) {
  const list = adj.get(node) || [];
  let s = 0;
  for (const e of list) s += e.weight;
  return s;
}

function neighborWeightsInCommunity(adj, node, c, community) {
  const list = adj.get(node) || [];
  let s = 0;
  for (const e of list) {
    if (community.get(e.neighbor) === c) s += e.weight;
  }
  return s;
}

function countConnectedComponents(nodes, adj) {
  const seen = new Set();
  let k = 0;
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    k++;
    const stack = [n.id];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      const list = adj.get(cur) || [];
      for (const e of list) if (!seen.has(e.neighbor)) stack.push(e.neighbor);
    }
  }
  return k;
}

function connectedComponentsFallback(nodes, adj) {
  // Each connected component gets its own id. Within a component,
  // nodes are assigned ids in first-seen order.
  const out = {};
  const seen = new Set();
  let nextId = 0;
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const id = nextId++;
    const stack = [n.id];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      out[cur] = id;
      const list = adj.get(cur) || [];
      for (const e of list) if (!seen.has(e.neighbor)) stack.push(e.neighbor);
    }
  }
  return out;
}

/**
 * Assign a color to each community, cycling through the palette.
 * @param {Record<string, number>} communities  nodeId -> communityId
 * @returns {Record<string, { color: string, group: number }>}
 */
export function colorizeCommunities(communities) {
  const out = {};
  for (const id of Object.keys(communities)) {
    const g = communities[id] || 0;
    out[id] = {
      group: g,
      color: COMMUNITY_PALETTE[g % COMMUNITY_PALETTE.length],
    };
  }
  return out;
}
