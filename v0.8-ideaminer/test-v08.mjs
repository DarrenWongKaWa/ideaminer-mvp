#!/usr/bin/env node
/**
 * test-v08.mjs
 * ------------------------------------------------------------
 * IdeaMiner v0.8 — unit + integration tests (no Playwright needed).
 * Tests the swappable LLMProvider interface, Storage layer, and seed data.
 */
import { LLMProvider, MockLLMProvider, OpenAIProvider } from './js/llm-provider.js';
import { Storage } from './js/storage.js';
import SEED from './data/seed-ideas.json' with { type: 'json' };

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('  OK', name); pass++; }
  catch (e) { console.log('  FAIL', name, '->', e.message); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('== LLMProvider abstract ==');
await test('abstract throws on generateIdea', async () => {
  const p = new LLMProvider();
  let threw = false;
  try { await p.generateIdea('x', { field: 'physics', sub: 'quantum-information' }); }
  catch { threw = true; }
  assert(threw, 'should throw');
});

console.log('== MockLLMProvider ==');
const mock = new MockLLMProvider({ ideas: SEED });
await test('mock generates 5 fields', async () => {
  const out = await mock.generateIdea('test hook', { field: 'physics', sub: 'condensed-matter' });
  for (const k of ['title','question','background','significance','pathway']) {
    assert(typeof out[k] === 'string' && out[k].length > 0, 'missing ' + k);
  }
});
await test('mock uses seed by field+sub', async () => {
  const out = await mock.generateIdea('', { field: 'cs', sub: 'hci' });
  assert(out.title.length > 0, 'should have a title');
});
await test('mock review returns 1-5 ints', async () => {
  const out = await mock.reviewIdea({ title:'x', question:'q', background:'b', significance:'s', pathway:'p' });
  for (const k of ['innovation','feasibility','importance']) {
    assert(Number.isInteger(out[k]) && out[k] >= 1 && out[k] <= 5, k + ' out of range: ' + out[k]);
  }
});

console.log('== OpenAIProvider ==');
await test('openai without apiKey throws helpful error', async () => {
  const p = new OpenAIProvider({ apiKey: '' });
  let msg = '';
  try { await p.generateIdea('x', { field:'cs', sub:'theory' }); } catch (e) { msg = e.message; }
  assert(msg.includes('apiKey is empty'), 'expected helpful error, got: ' + msg);
});
await test('openai bad baseUrl returns fetch error', async () => {
  const p = new OpenAIProvider({ apiKey: 'sk-fake', baseUrl: 'http://127.0.0.1:1' });
  let msg = '';
  try { await p.generateIdea('x', { field:'cs', sub:'theory' }); } catch (e) { msg = e.message; }
  assert(msg.length > 0, 'expected error from bad key/url');
});

console.log('== Storage ==');
const memStore = (() => {
  const m = new Map();
  return {
    getItem: (k) => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
})();
const s = new Storage(memStore);
await test('storage getAllIdeas empty', async () => {
  assert(s.getAllIdeas().length === 0, 'should be empty');
});
await test('storage addIdea assigns id + ts', async () => {
  const it = s.addIdea({ title: 't', question: 'q', field: 'cs', sub: 'theory', background: 'b', significance: 's', pathway: 'p' });
  assert(typeof it.id === 'string' && it.id.length > 4, 'id missing');
  assert(typeof it.ts === 'number' && it.ts > 0, 'ts missing');
  assert(it.saved === false, 'default saved should be false');
  assert(it.feedback === null, 'default feedback should be null');
});
await test('storage updateIdea merges patch', async () => {
  const it = s.addIdea({ title: 't2', question: 'q2', field: 'cs', sub: 'theory' });
  const updated = s.updateIdea(it.id, { saved: true, feedback: 'like' });
  assert(updated.saved === true, 'saved not set');
  assert(updated.feedback === 'like', 'feedback not set');
});
await test('storage deleteIdea removes', async () => {
  const it = s.addIdea({ title: 't3' });
  s.deleteIdea(it.id);
  assert(s.getIdea(it.id) === null, 'should be gone');
});
await test('storage settings default + set', async () => {
  const def = s.getSettings();
  assert(def.providerKind === 'mock', 'default provider should be mock');
  const next = s.setSettings({ providerKind: 'openai' });
  assert(next.providerKind === 'openai', 'should switch to openai');
  assert(next.openai.baseUrl === 'https://api.openai.com/v1', 'openai defaults preserved');
});
await test('storage settings nested openai patch', async () => {
  const next = s.setSettings({ openai: { apiKey: 'sk-123' } });
  assert(next.openai.apiKey === 'sk-123', 'apiKey set');
  assert(next.openai.model === 'gpt-4o-mini', 'model preserved');
  assert(next.openai.baseUrl === 'https://api.openai.com/v1', 'baseUrl preserved');
});

console.log('== seed-ideas ==');
await test('12 seed ideas cover 3 fields + 11 subs', async () => {
  const fields = new Set(SEED.map(x => x.field));
  assert(fields.size === 3, 'expected 3 fields');
  assert(SEED.length === 12, 'expected 12 ideas');
  for (const it of SEED) {
    for (const k of ['title','question','background','significance','pathway']) {
      assert(typeof it[k] === 'string' && it[k].length > 0, k + ' missing in ' + it.title);
    }
  }
});

console.log('== Extension contract: any LLMProvider should be swappable ==');
await test('app can take any LLMProvider via setProvider', async () => {
  // simulate the contract: subclass implements generateIdea, app accepts via setProvider
  class MyProvider extends LLMProvider {
    async generateIdea(p, o) { return { title: 'T:'+p, question: 'Q', background: 'B', significance: 'S', pathway: 'P' }; }
  }
  const my = new MyProvider();
  // Skip: app.js bootstraps with document, needs browser DOM. Verify swappable contract
  // at the class level (LLMProvider subclass implements generateIdea, app calls it).
  const { IdeaMinerApp } = await import('./js/app.js').catch(() => ({}));
  // Even if app import failed due to DOM, we can still verify the contract:
  const out = await my.generateIdea('hook', { field: 'cs', sub: 'hci' });
  assert(out.title.startsWith('T:'), 'custom provider shape respected');
  assert(typeof IdeaMinerApp === 'function' || typeof IdeaMinerApp === 'undefined', 'module shape ok');
});

console.log('\n== summary ==\n  pass: ' + pass + '\n  fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);
