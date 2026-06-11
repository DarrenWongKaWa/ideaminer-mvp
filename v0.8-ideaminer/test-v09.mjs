#!/usr/bin/env node
/**
 * test-v09.mjs
 * ------------------------------------------------------------
 * IdeaMiner v0.9 — extends v0.8 tests with graph view + export integration.
 */
import { LLMProvider, MockLLMProvider, OpenAIProvider } from './js/llm-provider.js';
import { Storage } from './js/storage.js';
import { buildGraph, detectCommunities, colorizeCommunities } from '../js/insight-connections.js';
import { buildExportPayload, exportJson, exportMarkdown, exportStandaloneHtml, exportGraphml, downloadBlob } from '../js/export.js';
import SEED from './data/seed-ideas.json' with { type: 'json' };

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('  OK', name); pass++; }
  catch (e) { console.log('  FAIL', name, '->', e.message); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('== v0.8 baseline (still passing) ==');
await test('LLMProvider abstract throws on generateIdea', async () => {
  const p = new LLMProvider();
  let threw = false;
  try { await p.generateIdea('x', { field: 'physics', sub: 'quantum-information' }); } catch { threw = true; }
  assert(threw, 'should throw');
});
await test('mock generates 5 fields', async () => {
  const m = new MockLLMProvider({ ideas: SEED });
  const out = await m.generateIdea('test', { field: 'physics', sub: 'condensed-matter' });
  for (const k of ['title','question','background','significance','pathway']) {
    assert(typeof out[k] === 'string' && out[k].length > 0, 'missing ' + k);
  }
});
await test('mock review returns 1-5 ints', async () => {
  const m = new MockLLMProvider({ ideas: SEED });
  const out = await m.reviewIdea({ title:'x', question:'q', background:'b', significance:'s', pathway:'p' });
  for (const k of ['innovation','feasibility','importance']) {
    assert(Number.isInteger(out[k]) && out[k] >= 1 && out[k] <= 5, k + ' out of range');
  }
});
await test('storage addIdea assigns id + ts', async () => {
  const mem = (() => { const m = new Map(); return { getItem:(k)=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,v), removeItem:(k)=>m.delete(k) }; })();
  const s = new Storage(mem);
  const it = s.addIdea({ title: 't', question: 'q', field: 'cs', sub: 'theory', background: 'b', significance: 's', pathway: 'p' });
  assert(typeof it.id === 'string' && it.id.length > 4, 'id missing');
});

console.log('== v0.9 graph integration ==');
const sampleOverlapping = [
  { id: '1', text: 'quantum metric drag non-Hermitian dissipative chain', createdAt: 1, title: 'A', field: 'physics', sub: 'condensed-matter' },
  { id: '2', text: 'non-Hermitian quantum dissipation in dissipative chain',  createdAt: 2, title: 'B', field: 'physics', sub: 'condensed-matter' },
  { id: '3', text: 'topological edge states in twisted bilayer graphene',   createdAt: 3, title: 'C', field: 'physics', sub: 'condensed-matter' },
  { id: '4', text: 'louvain community detection on quantum metric graph',   createdAt: 4, title: 'D', field: 'physics', sub: 'quantum-information' },
];
await test('buildGraph produces edges for overlapping content', async () => {
  const g = buildGraph(sampleOverlapping, [], { minScore: 0.05 });
  assert(g.nodes.length === 4, 'expected 4 nodes, got ' + g.nodes.length);
  assert(g.edges.length >= 2, 'expected ≥2 edges, got ' + g.edges.length);
});
await test('detectCommunities finds non-trivial groups', async () => {
  const g = buildGraph(sampleOverlapping, [], { minScore: 0.05 });
  const c = detectCommunities(g);
  const counts = {};
  for (const v of Object.values(c)) counts[v] = (counts[v] || 0) + 1;
  const nonTrivial = Object.values(counts).filter((x) => x > 1).length;
  assert(nonTrivial >= 1, 'expected ≥1 non-trivial community');
});
await test('colorizeCommunities assigns palette colors', async () => {
  const g = buildGraph(sampleOverlapping, [], { minScore: 0.05 });
  const c = detectCommunities(g);
  const colors = colorizeCommunities(c);
  for (const id of Object.keys(c)) {
    assert(colors[id] && typeof colors[id].color === 'string' && colors[id].color.length > 0, 'color missing for ' + id);
  }
});

console.log('== v0.9 export integration ==');
await test('buildExportPayload with v0.9 inspiration shape', async () => {
  const payload = buildExportPayload(sampleOverlapping, [], null, null);
  assert(payload.inspirations && payload.inspirations.length === 4, 'inspirations missing');
  assert(payload.exportedAt, 'exportedAt missing');
});
await test('exportJson produces valid JSON', async () => {
  const payload = buildExportPayload(sampleOverlapping, [], null, null);
  const triple = exportJson(payload);
  assert(triple.blob.size > 0, 'empty JSON blob');
  const text = await triple.blob.text();
  JSON.parse(text); // throws if invalid
});
await test('exportMarkdown has title and ideas', async () => {
  const payload = buildExportPayload(sampleOverlapping, [], null, null);
  const triple = exportMarkdown(payload);
  const text = await triple.blob.text();
  assert(text.includes('quantum'), 'MD missing content keywords');
});
await test('exportStandaloneHtml is a real HTML doc', async () => {
  const payload = buildExportPayload(sampleOverlapping, [], null, null);
  const triple = exportStandaloneHtml(payload);
  const text = await triple.blob.text();
  assert(text.startsWith('<!doctype') || text.startsWith('<!DOCTYPE'), 'not an HTML doc');
  assert(text.includes('quantum'), 'HTML missing content');
});
await test('exportGraphml has graphml namespace', async () => {
  const payload = buildExportPayload(sampleOverlapping, [], null, null);
  const triple = exportGraphml(payload);
  const text = await triple.blob.text();
  assert(text.includes('<graphml'), 'GraphML missing root');
  assert(text.includes('xmlns="http://graphml.graphdrawing.org/xmlns"'), 'GraphML missing namespace');
});
await test('4 export formats return different mime types', async () => {
  const payload = buildExportPayload(sampleOverlapping, [], null, null);
  const j = exportJson(payload);
  const m = exportMarkdown(payload);
  const h = exportStandaloneHtml(payload);
  const g = exportGraphml(payload);
  const types = new Set([j.mimeType, m.mimeType, h.mimeType, g.mimeType]);
  assert(types.size === 4, 'expected 4 distinct mime types, got ' + types.size);
});

console.log('\n== summary ==\n  pass: ' + pass + '\n  fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);
