// test-export-roundtrip.mjs
// Direct Node test of export.js.
// Imports the real storage and export modules and runs:
//   - JSON roundtrip: buildExportPayload → exportJson → re-parse → re-build → equal
//   - Markdown structure: parse headings + list items
//   - GraphML structure: parse with light XML parser, count nodes + edges
//   - Standalone HTML: check no external resources except vis-network CDN

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const ROOT = path.resolve('./');
const STORAGE_URL = pathToFileURL(path.join(ROOT, 'js/storage.js')).href;
const EXPORT_URL = pathToFileURL(path.join(ROOT, 'js/export.js')).href;

const OUT = path.resolve('./local-first-test/2026-06-11/exports');
await mkdir(OUT, { recursive: true });

// Polyfill a localStorage with seeded data
function makeLS(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() { return data.size; },
    clear: () => { data.clear(); },
  };
}

const seed = {
  'insightrecoder.inspirations.v1': JSON.stringify([
    { id: 'insp-1', text: 'Quantum geometry in twisted bilayer graphene', createdAt: 1780000000000, tags: ['physics'], source: 'text' },
    { id: 'insp-2', text: 'Berry curvature drives nonlinear Hall response', createdAt: 1780000010000, tags: ['physics'], source: 'voice' },
    { id: 'insp-3', text: 'Topological magnetoelectric effect in axion insulators', createdAt: 1780000020000, tags: ['physics'], source: 'text' },
    { id: 'insp-4', text: 'Machine learning for tight-binding Hamiltonians', createdAt: 1780000030000, tags: ['ml'], source: 'text' },
  ]),
  'insightrecoder.links.v1': JSON.stringify([
    { source: 'insp-1', target: 'insp-2', score: 0.5, kind: 'inferred', createdAt: 1780000010000 },
    { source: 'insp-2', target: 'insp-3', score: 0.3, kind: 'inferred', createdAt: 1780000020000 },
    { source: 'insp-1', target: 'insp-4', score: 0.1, kind: 'pinned', createdAt: 1780000030000 },
  ]),
  'insightrecoder.profile.v1': JSON.stringify({ field: 'Physics', direction: 'quantum geometry', age: 'PhD' }),
};

globalThis.window = { localStorage: makeLS(seed) };
const storageMod = await import(STORAGE_URL);
const exportMod = await import(EXPORT_URL);
const st = new storageMod.LocalStorageProvider();
const ins = st.getInspirations();
const links = st.getLinks();
const profile = st.getProfile();
const payload1 = exportMod.buildExportPayload(ins, links, profile);

// -------- JSON roundtrip --------
const json1 = exportMod.exportJson(payload1);
const json1Text = await json1.blob.text();
await writeFile(path.join(OUT, 'roundtrip.json'), json1Text);
const reparsed = JSON.parse(json1Text);
const payload2 = exportMod.buildExportPayload(reparsed.inspirations, reparsed.links, reparsed.profile);
const json2 = exportMod.exportJson(payload2);
const json2Text = await json2.blob.text();
// Compare semantic equality (ignoring exportedAt timestamp)
function stripTs(p) { const { exportedAt, ...rest } = p; return rest; }
const jsonEqual = JSON.stringify(stripTs(payload1)) === JSON.stringify(stripTs(payload2));

// Save all four exports
const md = exportMod.exportMarkdown(payload1);
const mdText = await md.blob.text();
await writeFile(path.join(OUT, 'timeline.md'), mdText);

const html = exportMod.exportStandaloneHtml(payload1);
const htmlText = await html.blob.text();
await writeFile(path.join(OUT, 'graph.html'), htmlText);

const gml = exportMod.exportGraphml(payload1);
const gmlText = await gml.blob.text();
await writeFile(path.join(OUT, 'graph.graphml'), gmlText);

// -------- Filename sanitization check --------
// The export functions all use the date-only slug `insightrecoder-YYYYMMDD.<ext>`
// which is hard-coded — no user input flows into the filename. Confirm.
const fnCheck = {
  json: json1.filename,
  md: md.filename,
  html: html.filename,
  gml: gml.filename,
};
function isSafeFilename(s) {
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    !s.includes('..') &&
    !s.includes('/') &&
    !s.includes('\\') &&
    !/[\x00-\x1f<>:"|?*]/.test(s) &&
    /^[A-Za-z0-9._-]+$/.test(s)
  );
}
const allSafe = Object.values(fnCheck).every(isSafeFilename);

// -------- Markdown structure check --------
// Look for: H1 title, weekly H2 sections, bullet list entries, "no inspirations" branch
const mdChecks = {
  hasH1: /^# InsightRecoder Timeline/m.test(mdText),
  hasMetadata: /Total inspirations: \*\*4\*\*/.test(mdText),
  hasWeeklySections: (mdText.match(/^## \d{4}-W\d{2}$/gm) || []).length,
  hasBullet: mdText.includes('- **'),
  hasTagRender: mdText.includes('`#physics`'),
};

// -------- GraphML structure check (light XML parse) --------
function lightParseGraphml(xml) {
  // Tiny XML parser for the subset we emit: extract <node> + <edge> + their <data>
  const out = { nodes: [], edges: [] };
  const nodeMatches = [...xml.matchAll(/<node\s+id="([^"]+)"\s*>([\s\S]*?)<\/node>/g)];
  for (const m of nodeMatches) {
    const id = m[1];
    const body = m[2];
    const data = {};
    for (const d of body.matchAll(/<data\s+key="([^"]+)">([\s\S]*?)<\/data>/g)) {
      data[d[1]] = d[2];
    }
    out.nodes.push({ id, data });
  }
  const edgeMatches = [...xml.matchAll(/<edge\s+id="([^"]+)"\s+source="([^"]+)"\s+target="([^"]+)"\s*>([\s\S]*?)<\/edge>/g)];
  for (const m of edgeMatches) {
    const data = {};
    for (const d of m[4].matchAll(/<data\s+key="([^"]+)">([\s\S]*?)<\/data>/g)) {
      data[d[1]] = d[2];
    }
    out.edges.push({ id: m[1], source: m[2], target: m[3], data });
  }
  return out;
}
const gmlParsed = lightParseGraphml(gmlText);
const gmlChecks = {
  hasXmlDecl: gmlText.startsWith('<?xml'),
  hasGraphmlRoot: gmlText.includes('xmlns="http://graphml.graphdrawing.org/xmlns"'),
  hasGraphElement: gmlText.includes('<graph id="insightrecoder"'),
  hasKeyDecls: ['text','tags','createdAt','source','score','kind'].every(k => gmlText.includes(`id="${k}"`)),
  nodeCount: gmlParsed.nodes.length,
  edgeCount: gmlParsed.edges.length,
  nodeIds: gmlParsed.nodes.map(n => n.id),
  edgeKinds: gmlParsed.edges.map(e => e.data.kind),
  edgeScores: gmlParsed.edges.map(e => e.data.score),
};

// Try parsing with a real parser (lightweight: pull from networkx-compatible style)
let networkxParse = null;
try {
  // No networkx here, but we can verify it parses as well-formed XML
  // by trying to import a JS XML parser. Fall back to a small regex sanity check.
  const wellFormed =
    (gmlText.match(/<node\b/g) || []).length === (gmlText.match(/<\/node>/g) || []).length &&
    (gmlText.match(/<edge\b/g) || []).length === (gmlText.match(/<\/edge>/g) || []).length &&
    (gmlText.match(/<data\b/g) || []).length === (gmlText.match(/<\/data>/g) || []).length &&
    gmlText.includes('</graphml>');
  networkxParse = { wellFormed, balanced: wellFormed };
} catch (e) {
  networkxParse = { error: e.message };
}

// -------- Standalone HTML sanity --------
const htmlChecks = {
  hasInlineData: htmlText.includes('window.__INSIGHT_DATA'),
  hasInspirationData: htmlText.includes('"inspirations"'),
  hasLinkData: htmlText.includes('"links"'),
  // The only external resource is the vis-network CDN. Count external <script src="https://..."> and <link href="https://...">:
  externalScripts: (htmlText.match(/<script\s+src="https?:\/\/[^"]+"/g) || []),
  externalLinks: (htmlText.match(/<link\s+[^>]*href="https?:\/\/[^"]+"/g) || []),
  externalImages: (htmlText.match(/<img\s+[^>]*src="https?:\/\/[^"]+"/g) || []),
  hasInlineOnlyData: !htmlText.includes('fetch('),
  hasVisCdn: htmlText.includes('vis-network@9.1.6'),
  hasNetwork: htmlText.includes('new vis.Network('),
  hasCommunityLogic: htmlText.includes('palette') && htmlText.includes('c[i]'),
};

const report = {
  json: {
    filename: json1.filename, mime: json1.mimeType, size: json1.blob.size,
    roundtripEqual: jsonEqual,
    inspirationCount: reparsed.inspirations.length,
    linkCount: reparsed.links.length,
    profileField: reparsed.profile && reparsed.profile.field,
  },
  md: {
    filename: md.filename, mime: md.mimeType, size: md.blob.size,
    ...mdChecks,
  },
  html: {
    filename: html.filename, mime: html.mimeType, size: html.blob.size,
    ...htmlChecks,
  },
  gml: {
    filename: gml.filename, mime: gml.mimeType, size: gml.blob.size,
    ...gmlChecks,
    networkxParse,
  },
  filenameSafety: {
    filenames: fnCheck,
    allSafe,
  },
  inspirations: ins.map(i => ({ id: i.id, text: i.text, tags: i.tags })),
  links: links.map(l => ({ source: l.source, target: l.target, kind: l.kind, score: l.score })),
};

await writeFile(path.join(OUT, 'roundtrip-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
