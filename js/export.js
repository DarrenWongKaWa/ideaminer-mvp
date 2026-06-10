/**
 * export.js
 * ------------------------------------------------------------
 * Export utilities for the InsightRecoder v0.6 corpus.
 *
 * Every export function returns a `{ blob, filename, mimeType }`
 * triple so the UI can either:
 *   - trigger a download via URL.createObjectURL(blob), or
 *   - read .text() for a textarea preview.
 *
 * All four formats are pure: they take the in-memory shape
 * (inspirations + links + profile) and return a Blob. They do
 * not touch the DOM, the network, or localStorage.
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} Inspiration
 * @property {string} id
 * @property {string} text
 * @property {number} createdAt
 * @property {string[]} [tags]
 * @property {'text'|'voice'} [source]
 */

/**
 * @typedef {Object} Link
 * @property {string} source
 * @property {string} target
 * @property {number} score
 * @property {'inferred'|'pinned'} kind
 * @property {number} createdAt
 */

/**
 * @typedef {Object} ExportPayload
 * @property {Inspiration[]} inspirations
 * @property {Link[]} links
 * @property {object|null} profile
 * @property {string} exportedAt   ISO string
 * @property {string} app          "InsightRecoder"
 * @property {string} version
 */

const APP_NAME = 'InsightRecoder';
const VERSION = '0.6.0';

/**
 * Build the canonical export payload. Sorted newest first.
 * @param {Inspiration[]} inspirations
 * @param {Link[]} links
 * @param {object|null} profile
 * @returns {ExportPayload}
 */
export function buildExportPayload(inspirations, links, profile) {
  return {
    app: APP_NAME,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    profile: profile || null,
    inspirations: (Array.isArray(inspirations) ? inspirations : []).slice(),
    links: (Array.isArray(links) ? links : []).slice(),
  };
}

/* ------------------------------------------------------------------
 * 1) JSON  -- full data dump, re-importable in the future.
 * ------------------------------------------------------------------ */
export function exportJson(payload) {
  const text = JSON.stringify(payload, null, 2);
  return {
    blob: new Blob([text], { type: 'application/json;charset=utf-8' }),
    filename: `insightrecoder-${dateSlug()}.json`,
    mimeType: 'application/json',
  };
}

/* ------------------------------------------------------------------
 * 2) Markdown  -- weekly timeline, grouped by ISO week.
 * ------------------------------------------------------------------ */
export function exportMarkdown(payload) {
  const list = (payload.inspirations || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  const groups = new Map();
  for (const it of list) {
    const wk = isoWeek(new Date(it.createdAt || 0));
    if (!groups.has(wk)) groups.set(wk, []);
    groups.get(wk).push(it);
  }

  const lines = [];
  lines.push(`# InsightRecoder Timeline`);
  lines.push(``);
  lines.push(`> Exported ${payload.exportedAt} from ${APP_NAME} v${VERSION}`);
  lines.push(``);
  lines.push(`Total inspirations: **${list.length}** across **${groups.size}** week${groups.size === 1 ? '' : 's'}.`);
  lines.push(``);

  // Iterate groups in chronological order
  const sortedKeys = Array.from(groups.keys()).sort();
  for (const wk of sortedKeys) {
    const items = groups.get(wk);
    lines.push(`## ${wk}`);
    lines.push(``);
    for (const it of items) {
      const ts = new Date(it.createdAt || 0).toISOString().slice(0, 16).replace('T', ' ');
      const tagStr = (it.tags || []).map((t) => `\`#${t}\``).join(' ');
      const src = it.source === 'voice' ? ' 🎤' : '';
      lines.push(`- **${ts}**${src} — ${escapeMd(it.text || '')}${tagStr ? ' ' + tagStr : ''}`);
    }
    lines.push(``);
  }

  if (list.length === 0) {
    lines.push(`_No inspirations recorded yet._`);
    lines.push(``);
  }

  return {
    blob: new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }),
    filename: `insightrecoder-${dateSlug()}.md`,
    mimeType: 'text/markdown',
  };
}

function escapeMd(s) {
  return String(s == null ? '' : s).replace(/([\\`*_{}\[\]()#+\-.!|])/g, '\\$1');
}

/* ------------------------------------------------------------------
 * 3) Standalone HTML  -- inlined data + vis-network + auto-render.
 * ------------------------------------------------------------------ */
export function exportStandaloneHtml(payload) {
  const data = JSON.stringify({
    inspirations: payload.inspirations || [],
    links: payload.links || [],
  });
  // Use a CSP-friendly approach: an inline <script> that sets
  // window.__INSIGHT_DATA = {...} then calls Network(...). The
  // vis-network library is loaded from the same CDN the live app
  // uses; opening the file with file:// works in modern browsers
  // (no fetch needed because data is inlined).
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>InsightRecoder Export — ${escapeHtml((payload.exportedAt || '').slice(0, 10))}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #f7f7f8; font-family: system-ui, -apple-system, "Helvetica Neue", sans-serif; color: #1a1a1a; }
  header { padding: 12px 24px; background: #fff; border-bottom: 1px solid #e5e5ea; }
  h1 { margin: 0; font-size: 16px; font-weight: 600; }
  #graph { width: 100%; height: calc(100vh - 56px); }
  .empty { padding: 48px; text-align: center; color: #6e6e73; }
</style>
<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"><\/script>
</head>
<body>
  <header><h1>InsightRecoder Graph Export — ${escapeHtml((payload.exportedAt || '').slice(0, 10))}</h1></header>
  <div id="graph"></div>
  <script>
    window.__INSIGHT_DATA = ${data};
    (function () {
      var data = window.__INSIGHT_DATA || { inspirations: [], links: [] };
      var container = document.getElementById('graph');
      if (!data.inspirations || data.inspirations.length === 0) {
        container.innerHTML = '<div class="empty">No inspirations to render.</div>';
        return;
      }
      // Simple deterministic community assignment: round-robin color
      var palette = ['#5b8def', '#1aa260', '#b8851a', '#c63b94', '#8b5cf6', '#0ea5e9', '#ef4444'];
      function truncate(t) {
        t = String(t || '').replace(/\\s+/g, ' ').trim();
        return t.length <= 28 ? t : t.slice(0, 27) + '…';
      }
      function cosine(a, b) {
        if (!a.length || !b.length || a.length !== b.length) return 0;
        var dot = 0, na = 0, nb = 0;
        for (var i = 0; i < a.length; i++) { var x = a[i] || 0, y = b[i] || 0; dot += x*y; na += x*x; nb += y*y; }
        return (na && nb) ? dot / Math.sqrt(na * nb) : 0;
      }
      function tokenize(t) {
        var out = [], seen = {};
        String(t || '').toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) {
          if (!w || w.length < 2 || seen[w]) return;
          seen[w] = 1; out.push(w);
        });
        return out;
      }
      // Build vocab + idf
      var docs = data.inspirations.map(function (it) { return tokenize(it.text); });
      var df = {};
      docs.forEach(function (d) { d.forEach(function (t) { df[t] = (df[t] || 0) + 1; }); });
      var vocab = Object.keys(df).sort();
      var N = docs.length || 1;
      var idf = {};
      vocab.forEach(function (t) { idf[t] = Math.log(1 + N / df[t]); });
      function vec(toks) {
        var tf = {};
        toks.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
        return vocab.map(function (t) { return (tf[t] || 0) * (idf[t] || 0); });
      }
      var vectors = docs.map(vec);
      // Simple greedy community: assign each node to the most
      // similar existing community, else start a new one.
      var c = new Array(data.inspirations.length).fill(0);
      var k = 1;
      for (var i = 1; i < data.inspirations.length; i++) {
        var best = 0, bestS = -1;
        for (var j = 0; j < i; j++) {
          var s = cosine(vectors[i], vectors[j]);
          if (s > bestS) { bestS = s; best = c[j]; }
        }
        c[i] = bestS > 0.05 ? best : (k++);
      }
      var nodes = data.inspirations.map(function (it, i) {
        return {
          id: it.id,
          label: truncate(it.text),
          title: it.text,
          color: { background: palette[c[i] % palette.length], border: '#1a1a1a' },
          font: { color: '#1a1a1a' }
        };
      });
      var edges = [];
      var userEdges = data.links || [];
      if (userEdges.length > 0) {
        userEdges.forEach(function (e) {
          edges.push({ from: e.source, to: e.target, width: Math.max(1, e.score * 5), color: { color: e.kind === 'pinned' ? '#1a1a1a' : '#9a9a9f' } });
        });
      } else {
        for (var a = 0; a < data.inspirations.length; a++) {
          for (var b = a + 1; b < data.inspirations.length; b++) {
            var sc = cosine(vectors[a], vectors[b]);
            if (sc > 0.05) edges.push({ from: data.inspirations[a].id, to: data.inspirations[b].id, width: Math.max(1, sc * 5), color: { color: '#9a9a9f' } });
          }
        }
      }
      new vis.Network(container, { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) }, {
        physics: { stabilization: { iterations: 200 } },
        interaction: { hover: true, tooltipDelay: 100 }
      });
    })();
  <\/script>
</body>
</html>`;
  return {
    blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
    filename: `insightrecoder-${dateSlug()}.html`,
    mimeType: 'text/html',
  };
}

/* ------------------------------------------------------------------
 * 4) GraphML  -- Gephi / yEd import.
 *    We emit the attribute-rich variant: each node carries the
 *    inspiration text/tags/timestamp as <data> children, and
 *    each edge carries its score + kind.
 * ------------------------------------------------------------------ */
export function exportGraphml(payload) {
  const list = payload.inspirations || [];
  const links = payload.links || [];
  const escape = escapeXml;
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<graphml xmlns="http://graphml.graphdrawing.org/xmlns"`);
  lines.push(`         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`);
  lines.push(`         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">`);
  // Key declarations
  const keys = [
    ['text',      'node', 'string'],
    ['tags',      'node', 'string'],
    ['createdAt', 'node', 'long'],
    ['source',    'node', 'string'],
    ['score',     'edge', 'double'],
    ['kind',      'edge', 'string'],
    ['createdAt', 'edge', 'long'],
  ];
  for (const [id, ftype, dtype] of keys) {
    lines.push(`  <key id="${id}" for="${ftype}" attr.name="${id}" attr.type="${dtype}"/>`);
  }
  lines.push(`  <graph id="insightrecoder" edgedefault="undirected">`);
  for (const it of list) {
    lines.push(`    <node id="${escape(it.id)}">`);
    lines.push(`      <data key="text">${escape(it.text || '')}</data>`);
    lines.push(`      <data key="tags">${escape((it.tags || []).join(','))}</data>`);
    lines.push(`      <data key="createdAt">${Number(it.createdAt) || 0}</data>`);
    lines.push(`      <data key="source">${escape(it.source || 'text')}</data>`);
    lines.push(`    </node>`);
  }
  for (const e of links) {
    const edgeId = `${e.source}__${e.target}`;
    lines.push(`    <edge id="${escape(edgeId)}" source="${escape(e.source)}" target="${escape(e.target)}">`);
    lines.push(`      <data key="score">${Number(e.score) || 0}</data>`);
    lines.push(`      <data key="kind">${escape(e.kind || 'inferred')}</data>`);
    lines.push(`      <data key="createdAt">${Number(e.createdAt) || 0}</data>`);
    lines.push(`    </edge>`);
  }
  lines.push(`  </graph>`);
  lines.push(`</graphml>`);
  return {
    blob: new Blob([lines.join('\n')], { type: 'application/graphml+xml;charset=utf-8' }),
    filename: `insightrecoder-${dateSlug()}.graphml`,
    mimeType: 'application/graphml+xml',
  };
}

/* ------------------------------------------------------------------
 * Browser-side helper: trigger a download for a Blob returned by
 * one of the exportXxx functions above. Safe in node (no-op).
 * ------------------------------------------------------------------ */
export function downloadBlob(blob, filename) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------------
 * Internal helpers
 * ------------------------------------------------------------------ */
function dateSlug() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * ISO week label, e.g. "2026-W23". Returns "unknown-week" for
 * invalid dates.
 */
function isoWeek(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return 'unknown-week';
  // Copy date so don't modify original
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday (0) become 7
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
