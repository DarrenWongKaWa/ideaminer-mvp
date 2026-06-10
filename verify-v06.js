// verify-v06.js  --  module-level smoke test for InsightRecoder v0.6
// Runs in node (no DOM). Exits non-zero on failure.

import { LocalStorageProvider } from './js/storage.js';
import {
  tokenizeInspiration, suggestLinks, buildGraph,
  detectCommunities, colorizeCommunities, cosine,
} from './js/insight-connections.js';
import {
  buildExportPayload, exportJson, exportMarkdown,
  exportStandaloneHtml, exportGraphml,
} from './js/export.js';
import { bestMatch } from './js/idea-search.js';

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ': ' + extra : ''}`); }
}

// ---------- 1. Storage round-trip ----------
console.log('\n[1] Storage round-trip');
const s = new LocalStorageProvider();
ok(typeof s.addInspiration === 'function', 'addInspiration exists');
ok(typeof s.getInspirations === 'function', 'getInspirations exists');
const a = s.addInspiration({ text: 'topological edge states encode qubits', source: 'text' });
const b = s.addInspiration({ text: 'quantum geometry of moiré bands', source: 'text' });
const c = s.addInspiration({ text: 'rice-mele model dissipative conductivity', source: 'text' });
const d = s.addInspiration({ text: 'berry connection and quantum metric', source: 'text' });
const e = s.addInspiration({ text: 'unrelated text about cooking pasta', source: 'text' });
ok(a.id && a.id.startsWith('insp-'), 'id format');
ok(s.getInspirations().length === 5, 'count=5');
ok(s.getInspiration(a.id) === a, 'round-trip');
ok(s.deleteInspiration(a.id) === true, 'delete returns true');
ok(s.getInspirations().length === 4, 'count=4 after delete');
ok(s.getInspiration(a.id) === null, 'deleted not found');

// ---------- 2. Tokenize + cosine ----------
console.log('\n[2] Tokenize + cosine');
const toks = tokenizeInspiration('Quantum metric and Berry connection: a deep look at the geometry.');
ok(toks.includes('quantum') && toks.includes('metric') && toks.includes('berry') && toks.includes('connection'), 'tokenize keeps content words');
ok(!toks.includes('and') && !toks.includes('a') && !toks.includes('the'), 'tokenize drops stop-words');
ok(cosine([1, 0, 0], [1, 0, 0]) === 1, 'cosine identical=1');
ok(Math.abs(cosine([1, 0, 0], [0, 1, 0])) < 1e-9, 'cosine orthogonal=0');
ok(Math.abs(cosine([0, 0, 0], [1, 1, 1])) === 0, 'cosine zero vector=0');

// ---------- 3. suggestLinks ----------
console.log('\n[3] suggestLinks');
const corpus = [
  { id: '1', text: 'topological edge states for fault-tolerant qubits' },
  { id: '2', text: 'berry connection and quantum metric of moiré bands' },
  { id: '3', text: 'unrelated text about cooking pasta' },
];
const newInsp = { id: '99', text: 'topological qubits using edge states' };
const sugs = suggestLinks(newInsp, corpus, 3, 0.05);
ok(sugs.length >= 1, 'at least 1 suggestion');
ok(sugs[0].score > 0.05, 'top score > threshold');
ok(sugs[0].inspiration.id === '1' || sugs[0].inspiration.id === '2', 'top suggestion is a content match');
// Cooking pasta should NOT be the top hit
ok(sugs[0].inspiration.id !== '3', 'cooking pasta not top hit');

// ---------- 4. buildGraph ----------
console.log('\n[4] buildGraph');
const insps = [
  { id: 'a', text: 'quantum geometry and topology' },
  { id: 'b', text: 'quantum metric berry connection' },
  { id: 'c', text: 'cooking pasta with tomato sauce' },
];
const g = buildGraph(insps, []);
ok(g.nodes.length === 3, '3 nodes');
ok(g.edges.length >= 1, 'at least one inferred edge (a-b share words)');
// Test explicit links
const explicitLinks = [
  { source: 'a', target: 'c', score: 0.1, kind: 'pinned' },
];
const g2 = buildGraph(insps, explicitLinks);
ok(g2.edges.length === 1 && g2.edges[0].kind === 'pinned', 'explicit pinned link preserved');

// ---------- 5. detectCommunities ----------
console.log('\n[5] detectCommunities');
const g3 = {
  nodes: [
    { id: 'a' }, { id: 'b' }, { id: 'c' },
  ],
  edges: [
    { from: 'a', to: 'b', score: 0.9 },
    { from: 'a', to: 'c', score: 0.1 },
  ],
};
const comm = detectCommunities(g3);
ok(typeof comm === 'object' && !Array.isArray(comm), 'detectCommunities returns object');
ok(Object.keys(comm).length === 3, '3 nodes in communities');
ok(Object.values(comm).every((v) => typeof v === 'number'), 'community ids are numbers');
const colors = colorizeCommunities(comm);
ok(colors['a'] && colors['a'].color, 'colors map has color');

// ---------- 6. Export ----------
console.log('\n[6] Export');
const payload = buildExportPayload(
  [
    { id: '1', text: 'alpha', createdAt: Date.UTC(2026, 5, 1), tags: ['physics'], source: 'text' },
    { id: '2', text: 'beta',  createdAt: Date.UTC(2026, 5, 3), tags: [],          source: 'voice' },
  ],
  [{ source: '1', target: '2', score: 0.42, kind: 'pinned', createdAt: Date.now() }],
  { field: 'Physics', direction: 'quantum geometry', age: 'PhD' }
);
ok(payload.app === 'InsightRecoder', 'payload.app');
ok(payload.version === '0.6.0', 'payload.version');
ok(payload.inspirations.length === 2, 'payload.inspirations');
ok(payload.links.length === 1, 'payload.links');

const json = exportJson(payload);
ok(json.blob instanceof Blob, 'json.blob is Blob');
ok(json.filename.endsWith('.json'), 'json filename');

const md = exportMarkdown(payload);
ok(md.blob instanceof Blob, 'md.blob is Blob');
ok(md.filename.endsWith('.md'), 'md filename');
const mdText = await md.blob.text();
ok(mdText.includes('2026-W'), 'md has ISO week label');
ok(mdText.includes('alpha'), 'md has alpha entry');

const html = exportStandaloneHtml(payload);
ok(html.blob instanceof Blob, 'html.blob is Blob');
ok(html.filename.endsWith('.html'), 'html filename');
const htmlText = await html.blob.text();
ok(htmlText.includes('vis-network'), 'html inlines vis-network');
ok(htmlText.includes('__INSIGHT_DATA'), 'html inlines data');
ok(htmlText.includes('alpha'), 'html inlines text');

const gml = exportGraphml(payload);
ok(gml.blob instanceof Blob, 'gml.blob is Blob');
ok(gml.filename.endsWith('.graphml'), 'gml filename');
const gmlText = await gml.blob.text();
ok(gmlText.startsWith('<?xml'), 'graphml is XML');
ok(gmlText.includes('<graphml'), 'graphml has root element');
ok(gmlText.includes('key id="text"'), 'graphml has text key');
ok(gmlText.includes('<node id="1">'), 'graphml has node 1');
ok(gmlText.includes('<edge'), 'graphml has edge');

// ---------- 7. bestMatch (from idea-search.js, used by timeline) ----------
console.log('\n[7] bestMatch (timeline search)');
const match = bestMatch(
  [{ id: '1', field: 'physics', question: 'topological qubits', methods: [] }],
  'topological'
);
ok(match && match.idea.id === '1', 'bestMatch finds the right inspiration');

const noMatch = bestMatch(
  [{ id: '1', field: 'physics', question: 'topological qubits', methods: [] }],
  'zzzzz no match here'
);
ok(noMatch === null, 'no-match returns null');

// ---------- 8. Links API ----------
console.log('\n[8] Links API');
const s2 = new LocalStorageProvider();
s2.addInspiration({ text: 'a' });
s2.addInspiration({ text: 'b' });
const insps2 = s2.getInspirations();
s2.addLink(insps2[0].id, insps2[1].id, 0.5, 'inferred');
s2.addLink(insps2[0].id, insps2[1].id, 0.6, 'pinned');  // promote
ok(s2.getLinks().length === 1, 'dedupe by (source,target)');
ok(s2.getLinks()[0].kind === 'pinned', 'kind promotes to pinned');
ok(Math.abs(s2.getLinks()[0].score - 0.6) < 1e-9, 'max score kept');
ok(s2.getPinnedLinks().length === 1, 'pinned subset');
s2.removeLink(insps2[0].id, insps2[1].id);
ok(s2.getLinks().length === 0, 'removeLink works');

// ---------- 9. Migration ----------
console.log('\n[9] Migration');
// In node, _hasLS=false so the migration is a no-op (returns 0, false).
const s3 = new LocalStorageProvider();
const mig = s3.migrateLegacyUserIdeas();
ok(mig && mig.migrated === 0, 'node migration is no-op');

// ---------- Summary ----------
console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
