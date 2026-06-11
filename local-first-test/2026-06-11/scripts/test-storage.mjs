// test-storage.mjs
// Direct smoke test of storage.js logic (no browser).
// We use a JS localStorage polyfill + minimal global window to exercise
// the LocalStorageProvider class.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const STORAGE_PATH = path.resolve('./js/storage.js');
const STORAGE_URL = pathToFileURL(STORAGE_PATH).href;

// Build a minimal localStorage polyfill that mimics the browser API surface used
// in storage.js: getItem, setItem, removeItem, key, length, clear.
function makeLS({ quotaBytes = null, throwOnSet = false } = {}) {
  const data = new Map();
  let bytes = 0;
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (throwOnSet) throw new DOMException('QuotaExceeded', 'QuotaExceededError');
      if (quotaBytes != null) {
        const next = bytes + k.length + v.length;
        if (next > quotaBytes) throw new DOMException('QuotaExceeded', 'QuotaExceededError');
        bytes = next;
      }
      data.set(k, String(v));
    },
    removeItem: (k) => { data.delete(k); },
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() { return data.size; },
    clear: () => { data.clear(); },
  };
}

// Minimal window for the LS detection probe.
function buildWindow(ls) {
  return { localStorage: ls };
}

// We have to load storage.js as a module. Easiest: dynamically import it after
// stubbing `window` and `localStorage` in globalThis.
async function loadStorageWithLS(ls) {
  globalThis.window = buildWindow(ls);
  const mod = await import(STORAGE_URL);
  return mod;
}

async function main() {
  const results = [];

  // -------- Test 1: corrupt JSON in inspirations key --------
  {
    const ls = makeLS();
    ls.setItem('insightrecoder.inspirations.v1', '{ unclosed json');
    ls.setItem('insightrecoder.links.v1', '[{"source":"a","target":"b","score":0.5,"kind":"inferred","createdAt":1}]');
    const { LocalStorageProvider } = await loadStorageWithLS(ls);
    const storage = new LocalStorageProvider();
    let crashed = false, err = null;
    let list = [];
    try { list = storage.getInspirations(); } catch (e) { crashed = true; err = e; }
    // Now overwrite through the API
    let saveOk = true, saveErr = null;
    try {
      const r = storage.addInspiration({ text: 'After corrupt' });
      if (!r || !r.id) saveOk = false;
    } catch (e) { saveOk = false; saveErr = e; }
    const recovered = storage.getInspirations();
    results.push({
      name: 'corrupt_JSON_inspirations',
      crashed, err: err && err.message,
      saveOk, saveErr: saveErr && saveErr.message,
      recoveredCount: recovered.length,
      recoveredText: recovered[0] && recovered[0].text,
    });
  }

  // -------- Test 2: quota exceeded on save --------
  {
    // tiny quota + pre-fill so the next setItem throws QuotaExceeded
    const ls = makeLS({ quotaBytes: 200 });
    ls.setItem('__big', 'x'.repeat(150)); // leaves ~50 bytes
    const { LocalStorageProvider } = await loadStorageWithLS(ls);
    const storage = new LocalStorageProvider();
    let crashed = false, err = null;
    let inspiration = null;
    try {
      inspiration = storage.addInspiration({ text: 'Should it fit?' });
    } catch (e) { crashed = true; err = e; }
    // The current code in _write silently swallows QuotaExceeded. So we expect
    // the call to NOT throw, but the in-memory mirror is updated. Then a
    // re-read might or might not return the data. We test the API contract.
    results.push({
      name: 'quota_exceeded_save',
      crashed, err: err && err.message,
      addReturnedInspiration: !!inspiration,
      memInspCount: storage._mem.inspirations.length,
      localStorageInsp: ls.getItem('insightrecoder.inspirations.v1'),
    });
  }

  // -------- Test 3: first-run (no keys) --------
  {
    const ls = makeLS();
    const { LocalStorageProvider } = await loadStorageWithLS(ls);
    const storage = new LocalStorageProvider();
    const list = storage.getInspirations();
    const links = storage.getLinks();
    const profile = storage.getProfile();
    let crashed = false, err = null;
    try {
      const r = storage.addInspiration({ text: 'First one' });
      if (!r || !r.id) crashed = true;
    } catch (e) { crashed = true; err = e; }
    results.push({
      name: 'first_run',
      crashed, err: err && err.message,
      listLen: list.length, linksLen: links.length, profileNull: profile === null,
      addedId: storage._mem.inspirations[0] && storage._mem.inspirations[0].id,
    });
  }

  // -------- Test 4: migration idempotency --------
  {
    const ls = makeLS();
    // Legacy key present
    const legacy = [
      { id: 'user-1', question: 'What is quantum geometry?', field: 'Physics', generatedAt: 1700000000000 },
      { id: 'user-2', question: 'Berry phase', field: 'Physics', generatedAt: 1700000010000 },
    ];
    ls.setItem('ideaminer.user-ideas.v1', JSON.stringify(legacy));
    // New key ALSO present (i.e. user already has new data)
    const existing = [
      { id: 'insp-existing', text: 'Existing idea', createdAt: 1750000000000, tags: [], source: 'text' },
    ];
    ls.setItem('insightrecoder.inspirations.v1', JSON.stringify(existing));
    const { LocalStorageProvider } = await loadStorageWithLS(ls);
    const storage = new LocalStorageProvider();
    let res = null;
    try { res = storage.migrateLegacyUserIdeas(); } catch (e) { res = { err: e.message }; }
    // After migration, the legacy key should be removed, the new key should be
    // UNCHANGED.
    const legacyAfter = ls.getItem('ideaminer.user-ideas.v1');
    const newAfter = ls.getItem('insightrecoder.inspirations.v1');
    const parsedNew = JSON.parse(newAfter);
    // Re-run migration; should now no-op.
    let res2 = null;
    try { res2 = storage.migrateLegacyUserIdeas(); } catch (e) { res2 = { err: e.message }; }
    results.push({
      name: 'migration_idempotency',
      firstCall: res,
      legacyAfterRemoved: legacyAfter === null,
      newKeyUnchanged: parsedNew.length === 1 && parsedNew[0].id === 'insp-existing',
      secondCall: res2,
    });
  }

  // -------- Test 5: missing keys + legacy key present (real migration) --------
  {
    const ls = makeLS();
    const legacy = [
      { id: 'user-aaa', question: 'Hello', field: 'Physics', generatedAt: 1700000000000 },
      { id: 'user-bbb', question: 'World', field: 'Chemistry', generatedAt: 1700000010000 },
      // Also test a wrapped shape
    ];
    ls.setItem('ideaminer.user-ideas.v1', JSON.stringify(legacy));
    const { LocalStorageProvider } = await loadStorageWithLS(ls);
    const storage = new LocalStorageProvider();
    const res = storage.migrateLegacyUserIdeas();
    const list = storage.getInspirations();
    results.push({
      name: 'migration_real',
      res,
      legacyRemoved: ls.getItem('ideaminer.user-ideas.v1') === null,
      ids: list.map(i => i.id),
      tags: list.map(i => i.tags),
    });
  }

  // -------- Test 6: migration with {ideas: [...]} wrapper --------
  {
    const ls = makeLS();
    const wrapped = { ideas: [
      { id: 'user-c1', question: 'Wrapped', field: 'Biology', generatedAt: 1700000000000 },
    ] };
    ls.setItem('ideaminer.user-ideas.v1', JSON.stringify(wrapped));
    const { LocalStorageProvider } = await loadStorageWithLS(ls);
    const storage = new LocalStorageProvider();
    const res = storage.migrateLegacyUserIdeas();
    const list = storage.getInspirations();
    results.push({
      name: 'migration_wrapped_shape',
      res,
      legacyRemoved: ls.getItem('ideaminer.user-ideas.v1') === null,
      listLen: list.length,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
