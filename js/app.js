/**
 * app.js
 * ------------------------------------------------------------
 * InsightRecoder v0.6 — Router + application bootstrap.
 *
 * Routes:
 *   #/profile   Research profile (field / direction / career stage)
 *   #/capture   Single capture box + 🎤 mic + Save +
 *               top-3 algorithmic suggestions panel
 *   #/graph     vis-network graph view, color by Louvain community
 *   #/timeline  Chronological list grouped by ISO week, with search
 *   #/my        All inspirations with delete + 4 export buttons
 *   #/settings  Provider picker (kept; no-op at runtime in v0.6)
 *
 * Local-first: NO LLM calls at runtime. The only network call
 * is the vis-network CDN load in `index.html`.
 * ------------------------------------------------------------
 */

import { LocalStorageProvider } from './storage.js';
import { VoiceInput } from './voice.js';
import { suggestLinks, buildGraph, detectCommunities, colorizeCommunities } from './insight-connections.js';
import { bestMatch, tokenizeQuery } from './idea-search.js';
import {
  buildExportPayload,
  exportJson, exportMarkdown, exportStandaloneHtml, exportGraphml,
  downloadBlob,
} from './export.js';

const PROVIDER_STORAGE_KEY = 'insightrecoder.provider.v1';

// ---------- Global state ----------
const state = {
  storage: new LocalStorageProvider(),
  voice: new VoiceInput(),
  ready: false,
  network: null,        // vis-network instance, kept across re-renders
};

// ---------- Util: safe HTML string escaping ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Util: toast ----------
let toastTimer = null;
function toast(msg, kind) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  let icon = '';
  let text = msg;
  const m = /^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])\s*/u.exec(msg);
  if (m) {
    icon = m[1];
    text = msg.slice(m[0].length);
  }
  t.innerHTML = icon
    ? `<span class="toast__icon" aria-hidden="true">${esc(icon)}</span><span>${esc(text)}</span>`
    : esc(msg);
  t.classList.remove('toast--success', 'toast--error', 'toast--warn');
  if (kind === 'success') t.classList.add('toast--success');
  else if (kind === 'error') t.classList.add('toast--error');
  else if (kind === 'warn') t.classList.add('toast--warn');
  t.classList.add('toast--show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('toast--show'), 1800);
}

// ---------- Util: bottom nav (4 items: Capture / Graph / My / Settings) ----------
function bottomNav(active) {
  return `
    <nav class="bottom-nav" role="navigation" aria-label="Main navigation">
      <a class="bottom-nav__item ${active === 'capture' ? 'is-active' : ''}" href="#/capture" aria-label="Capture">
        <span class="bottom-nav__icon" aria-hidden="true">✏️</span>
        <span class="bottom-nav__label">Capture</span>
      </a>
      <a class="bottom-nav__item ${active === 'graph' ? 'is-active' : ''}" href="#/graph" aria-label="Graph">
        <span class="bottom-nav__icon" aria-hidden="true">🕸️</span>
        <span class="bottom-nav__label">Graph</span>
      </a>
      <a class="bottom-nav__item ${active === 'timeline' ? 'is-active' : ''}" href="#/timeline" aria-label="Timeline">
        <span class="bottom-nav__icon" aria-hidden="true">📅</span>
        <span class="bottom-nav__label">Timeline</span>
      </a>
      <a class="bottom-nav__item ${active === 'my' ? 'is-active' : ''}" href="#/my" aria-label="My">
        <span class="bottom-nav__icon" aria-hidden="true">📚</span>
        <span class="bottom-nav__label">My</span>
      </a>
    </nav>
  `;
}

// ---------- Util: empty state ----------
function emptyState(icon, title, body, cta) {
  return `
    <div class="empty">
      <div class="empty__icon" aria-hidden="true">${esc(icon)}</div>
      <p class="empty__title">${esc(title)}</p>
      <p class="empty__body">${body}</p>
      ${cta ? `<div class="empty__cta">${cta}</div>` : ''}
    </div>
  `;
}

// ============================================================
// Page: #/profile
// ============================================================
function renderProfile() {
  const profile = state.storage.getProfile();
  const fieldOptions = [
    'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Mathematics',
    'Materials Science', 'Earth Science', 'Psychology', 'Economics', 'Other',
  ];
  const ageOptions = ['Undergraduate', "Master's", 'PhD', 'Postdoc', 'Professor', 'Other'];

  const opts = (arr, sel) => arr.map((x) =>
    `<option value="${esc(x)}" ${x === sel ? 'selected' : ''}>${esc(x)}</option>`
  ).join('');

  const placeholder = profile ? '' : 'placeholder="e.g. machine learning, quantum computing"';
  const val = profile ? esc(profile.direction || '') : '';
  const voiceSupported = state.voice.isSupported();

  return `
    <section class="page page--profile">
      <header class="page__header">
        <h1 class="page__title">Research Profile</h1>
        <p class="page__subtitle">Used to tag and color your inspirations. Optional.</p>
      </header>

      <form id="profile-form" class="form" novalidate>
        <label class="form__field">
          <span class="form__label">Field</span>
          <select class="form__input" name="field">
            <option value="" ${profile ? '' : 'selected'}>Select your field</option>
            ${opts(fieldOptions, profile && profile.field)}
          </select>
        </label>

        <label class="form__field">
          <span class="form__label">Research direction</span>
          <div class="form__input-wrap">
            <input class="form__input" name="direction" type="text" ${placeholder} value="${val}" />
            ${voiceSupported ? `
              <button type="button" class="form__mic" data-voice-target="direction" aria-label="Voice input for research direction">
                <span aria-hidden="true">🎤</span>
              </button>
            ` : ''}
          </div>
        </label>

        <label class="form__field">
          <span class="form__label">Career stage</span>
          <select class="form__input" name="age">
            <option value="" ${profile && profile.age ? '' : 'selected'}>Please choose a career stage</option>
            ${opts(ageOptions, profile && profile.age)}
          </select>
        </label>

        <button type="submit" class="btn btn--primary">Save</button>
        <a class="link" href="#/capture">Skip for now</a>
      </form>
    </section>
  `;
}

function bindProfileEvents() {
  const form = document.getElementById('profile-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const profile = {
      field: String(fd.get('field') || '').trim(),
      direction: String(fd.get('direction') || '').trim(),
      age: String(fd.get('age') || '').trim(),
    };
    state.storage.setProfile(profile);
    toast('✅ Profile saved', 'success');
    location.hash = '#/capture';
  });
  form.querySelectorAll('[data-voice-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetName = btn.getAttribute('data-voice-target');
      const input = form.querySelector(`[name="${targetName}"]`);
      if (!input) return;
      if (state.voice.isRecording() && state.voice._currentTarget === targetName) {
        state.voice.stop();
        btn.classList.remove('is-recording');
        return;
      }
      state.voice._currentTarget = targetName;
      btn.classList.add('is-recording');
      state.voice.start(
        (text, isFinal) => { input.value = text; if (isFinal) { btn.classList.remove('is-recording'); state.voice._currentTarget = null; } },
        (err) => {
          btn.classList.remove('is-recording');
          state.voice._currentTarget = null;
          if (err === 'not-allowed' || err === 'service-not-allowed') toast('⚠️ Please allow microphone access', 'warn');
          else if (err !== 'aborted') toast('⚠️ Voice input failed: ' + err, 'error');
        }
      );
    });
  });
}

// ============================================================
// Page: #/capture
// ============================================================
function renderCapture() {
  const all = state.storage.getInspirations();
  const voiceSupported = state.voice.isSupported();
  return `
    <section class="page page--capture">
      <header class="page__header">
        <h1 class="page__title">Capture</h1>
        <p class="page__subtitle">${all.length} inspiration${all.length === 1 ? '' : 's'} recorded</p>
      </header>

      <div class="capture-box" role="region" aria-label="Capture an inspiration">
        <textarea
          id="capture-textarea"
          class="capture-box__textarea"
          rows="3"
          placeholder="What's on your mind? A half-sentence, a phrase, a question…"
          aria-label="Inspiration text"
        ></textarea>
        <div class="capture-box__actions">
          ${voiceSupported ? `
            <button type="button" id="capture-mic" class="capture-box__mic" aria-label="Voice input for capture">
              <span aria-hidden="true">🎤</span>
            </button>
          ` : ''}
          <span class="capture-box__hint">⌘/Ctrl + Enter to save</span>
          <button type="button" id="capture-save" class="btn btn--primary capture-box__save" disabled>Save</button>
        </div>
      </div>

      <div id="capture-suggestions" class="capture-suggestions" aria-live="polite"></div>

      <div class="capture-recent">
        <h2 class="capture-recent__title">Recent</h2>
        ${renderRecent(all.slice(0, 5))}
      </div>
    </section>
  `;
}

function renderRecent(items) {
  if (!items.length) {
    return `<p class="empty__body">No inspirations yet. Write something above and tap Save.</p>`;
  }
  return `<ol class="capture-recent__list">${items.map((it) => `
    <li class="inspiration-card inspiration-card--mini" data-id="${esc(it.id)}">
      <div class="inspiration-card__text">${esc(it.text)}</div>
      <div class="inspiration-card__meta">${formatDate(it.createdAt)}${(it.tags || []).length ? ' · ' + (it.tags || []).map((t) => '#' + esc(t)).join(' ') : ''}</div>
    </li>
  `).join('')}</ol>`;
}

function bindCaptureEvents() {
  const textarea = document.getElementById('capture-textarea');
  const saveBtn = document.getElementById('capture-save');
  const micBtn = document.getElementById('capture-mic');
  if (!textarea || !saveBtn) return;

  const refreshSaveEnabled = () => {
    saveBtn.disabled = String(textarea.value || '').trim().length === 0;
  };
  textarea.addEventListener('input', refreshSaveEnabled);
  refreshSaveEnabled();

  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveBtn.click();
    }
  });

  saveBtn.addEventListener('click', () => onSave());

  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (state.voice.isRecording() && state.voice._currentTarget === 'capture') {
        state.voice.stop();
        micBtn.classList.remove('is-recording');
        return;
      }
      state.voice._currentTarget = 'capture';
      micBtn.classList.add('is-recording');
      state.voice.start(
        (text, isFinal) => { textarea.value = text; refreshSaveEnabled(); if (isFinal) { micBtn.classList.remove('is-recording'); state.voice._currentTarget = null; } },
        (err) => {
          micBtn.classList.remove('is-recording');
          state.voice._currentTarget = null;
          if (err === 'not-allowed' || err === 'service-not-allowed') toast('⚠️ Please allow microphone access', 'warn');
          else if (err === 'no-speech') toast("⚠️ Didn't hear anything", 'warn');
          else if (err === 'audio-capture') toast('⚠️ No microphone found', 'error');
          else if (err === 'unsupported') toast('⚠️ This browser does not support voice input', 'warn');
          else if (err !== 'aborted') toast('⚠️ Voice input failed: ' + err, 'error');
        }
      );
    });
  }

  function onSave() {
    const text = String(textarea.value || '').trim();
    if (!text) { toast('⚠️ Inspiration is empty', 'warn'); return; }
    const source = (state.voice._currentTarget === 'capture') ? 'voice' : 'text';
    const profile = state.storage.getProfile();
    const tags = [];
    if (profile && profile.field) tags.push(String(profile.field).toLowerCase());
    let record;
    try {
      record = state.storage.addInspiration({ text, tags, source });
    } catch (err) {
      if (err && err.name === 'StorageFullError') {
        toast('💾 Storage full — clear some data in Settings', 'error');
        return;
      }
      throw err;
    }
    toast('✅ Saved', 'success');
    textarea.value = '';
    refreshSaveEnabled();
    showSuggestions(record);
    // Refresh the recent list in place
    const recent = document.querySelector('.capture-recent');
    if (recent) {
      const list = state.storage.getInspirations();
      recent.innerHTML = `<h2 class="capture-recent__title">Recent</h2>${renderRecent(list.slice(0, 5))}`;
      const subtitle = document.querySelector('.page--capture .page__subtitle');
      if (subtitle) subtitle.textContent = `${list.length} inspiration${list.length === 1 ? '' : 's'} recorded`;
    }
  }
}

function showSuggestions(record) {
  const container = document.getElementById('capture-suggestions');
  if (!container) return;
  const all = state.storage.getInspirations();
  const suggestions = suggestLinks(record, all, 3);
  if (suggestions.length === 0) {
    container.innerHTML = `<p class="capture-suggestions__empty">No similar past inspirations yet — this is your first one in this neighborhood.</p>`;
    return;
  }
  container.innerHTML = `
    <h2 class="capture-suggestions__title">Possible links</h2>
    <div class="capture-suggestions__list">
      ${suggestions.map((s, i) => `
        <div class="suggestion-card" data-id="${esc(s.inspiration.id)}">
          <div class="suggestion-card__rank">#${i + 1}</div>
          <div class="suggestion-card__body">
            <div class="suggestion-card__text">${esc(s.inspiration.text)}</div>
            <div class="suggestion-card__meta">score ${s.score.toFixed(2)} · ${formatDate(s.inspiration.createdAt)}</div>
          </div>
          <button type="button" class="btn btn--ghost suggestion-card__pin" data-pin="${esc(record.id)}::${esc(s.inspiration.id)}">🔗 Pin</button>
        </div>
      `).join('')}
    </div>
  `;
  container.querySelectorAll('[data-pin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [src, tgt] = btn.getAttribute('data-pin').split('::');
      if (!src || !tgt) return;
      // Compute score: re-run suggestLinks for stable score
      const target = state.storage.getInspiration(tgt);
      if (!target) return;
      const score = suggestLinks({ id: src, text: state.storage.getInspiration(src)?.text || '' }, [target], 1)[0]?.score || 0;
      state.storage.addLink(src, tgt, score, 'pinned');
      toast('🔗 Pinned', 'success');
      btn.disabled = true;
      btn.textContent = '✓ Pinned';
    });
  });
}

// ============================================================
// Page: #/graph
// ============================================================
function renderGraph() {
  return `
    <section class="page page--graph">
      <header class="page__header">
        <h1 class="page__title">Graph</h1>
        <p class="page__subtitle" id="graph-subtitle">Loading…</p>
      </header>

      <div class="graph-toolbar">
        <button type="button" class="btn btn--ghost" id="recompute-graph">Recompute graph</button>
        <span class="graph-toolbar__hint" id="graph-stats"></span>
      </div>

      <div id="graph-container" class="graph-container"></div>

      <aside id="graph-sidepanel" class="graph-sidepanel" hidden>
        <button type="button" class="graph-sidepanel__close" id="graph-sidepanel-close" aria-label="Close">×</button>
        <h2 class="graph-sidepanel__title">Inspiration</h2>
        <div class="graph-sidepanel__text" id="graph-sidepanel-text"></div>
        <div class="graph-sidepanel__meta" id="graph-sidepanel-meta"></div>
        <h3 class="graph-sidepanel__sub">Connected to</h3>
        <ul class="graph-sidepanel__edges" id="graph-sidepanel-edges"></ul>
        <div class="graph-sidepanel__actions">
          <button type="button" class="btn btn--ghost" id="graph-sidepanel-delete">Delete</button>
        </div>
      </aside>

      <div class="graph-legend" id="graph-legend"></div>
    </section>
  `;
}

let _graphClickListener = null;
let _graphSelectListener = null;

function bindGraphEvents() {
  const recompute = document.getElementById('recompute-graph');
  if (recompute) recompute.addEventListener('click', () => mountGraph());
  const close = document.getElementById('graph-sidepanel-close');
  if (close) close.addEventListener('click', () => {
    const panel = document.getElementById('graph-sidepanel');
    if (panel) panel.hidden = true;
  });
  mountGraph();
}

function mountGraph() {
  const container = document.getElementById('graph-container');
  if (!container) return;
  if (typeof window === 'undefined' || !window.vis || !window.vis.Network) {
    container.innerHTML = `<p class="empty__body">Loading graph library… (vis-network CDN)</p>`;
    return;
  }
  const inspirations = state.storage.getInspirations();
  const userLinks = state.storage.getLinks();
  if (inspirations.length === 0) {
    container.innerHTML = emptyState('🕸️', 'No inspirations yet', 'Capture a few in #/capture and they will appear here.',
      `<a class="btn btn--primary" href="#/capture">Go to capture</a>`);
    const sub = document.getElementById('graph-subtitle');
    if (sub) sub.textContent = '0 nodes · 0 edges';
    const legend = document.getElementById('graph-legend');
    if (legend) legend.innerHTML = '';
    return;
  }
  const graph = buildGraph(inspirations, userLinks);
  const communityMap = detectCommunities(graph);  // { nodeId: communityId }
  const colors = colorizeCommunities(communityMap);
  // Compute K (number of distinct communities) for the stats line
  let k = 0;
  for (const v of Object.values(communityMap)) if (typeof v === 'number' && v >= k) k = v + 1;
  // Apply colors to nodes. Singletons (communities with only one
  // member) get a neutral gray + a sentinel `community` of -1 so the
  // legend loop can skip them — singletons carry no grouping signal,
  // so coloring them all the same keeps the palette meaningful for
  // the communities that actually have multiple members.
  const communityMembers = new Map();
  for (const n of graph.nodes) {
    const c = communityMap[n.id];
    if (c == null) continue;
    if (!communityMembers.has(c)) communityMembers.set(c, []);
    communityMembers.get(c).push(n);
  }
  for (const n of graph.nodes) {
    const cId = communityMap[n.id];
    const size = (communityMembers.get(cId) || []).length;
    const isSingleton = size < 2;
    if (isSingleton) {
      n.color = { background: '#9a9a9f', border: '#1a1a1a', highlight: { background: '#9a9a9f', border: '#1a1a1a' } };
      n.community = -1;
    } else {
      const c = colors[n.id] || { color: '#5b8def' };
      n.color = { background: c.color, border: '#1a1a1a', highlight: { background: c.color, border: '#1a1a1a' } };
      n.community = cId;
    }
    n.title = n.label || '';  // hover tooltip
  }
  // Edge styling
  for (const e of graph.edges) {
    e.width = Math.max(1, Math.min(6, (e.score || 0) * 5));
    e.color = { color: e.kind === 'pinned' ? '#1a1a1a' : '#9a9a9f', highlight: '#1a1a1a' };
  }
  // Wipe previous instance
  if (state.network) {
    try { state.network.destroy(); } catch (_) {}
    state.network = null;
  }
  container.innerHTML = '';
  const nodes = new window.vis.DataSet(graph.nodes);
  const edges = new window.vis.DataSet(graph.edges);
  state.network = new window.vis.Network(container, { nodes, edges }, {
    physics: { stabilization: { iterations: 200 } },
    interaction: { hover: true, tooltipDelay: 100 },
    nodes: { shape: 'dot', size: 16, font: { size: 12, color: '#1a1a1a' } },
  });
  // Subtitle + stats
  const sub = document.getElementById('graph-subtitle');
  if (sub) sub.textContent = `${graph.nodes.length} nodes · ${graph.edges.length} edges`;
  const stats = document.getElementById('graph-stats');
  if (stats) stats.textContent = `${k} communit${k === 1 ? 'y' : 'ies'}`;
  // Legend — only communities of size >= 2 (singletons are gray +
  // uninformative, so we suppress them). For each multi-member
  // community, label with its most-common tag so the user has a
  // semantic handle ("#physics" beats "community 2").
  const legend = document.getElementById('graph-legend');
  if (legend) {
    const items = [];
    for (const [cId, members] of communityMembers.entries()) {
      if (members.length < 2) continue;
      const tagCounts = new Map();
      for (const n of members) {
        for (const t of (n.tags || [])) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      }
      let topTag = null;
      let topCount = 0;
      for (const [t, c] of tagCounts.entries()) {
        if (c > topCount) { topCount = c; topTag = t; }
      }
      const firstColor = (colors[members[0].id] || {}).color || '#5b8def';
      items.push({ cId, color: firstColor, topTag });
    }
    legend.innerHTML = items.map((i) => {
      const tagSuffix = i.topTag ? ` <span class="graph-legend__tag">#${esc(i.topTag)}</span>` : '';
      return `<span class="graph-legend__item"><span class="graph-legend__dot" style="background:${i.color}"></span>community ${i.cId + 1}${tagSuffix}</span>`;
    }).join('');
  }
  // Click handler
  if (_graphClickListener) state.network.off('click', _graphClickListener);
  _graphClickListener = (params) => {
    if (!params.nodes || params.nodes.length === 0) return;
    const id = params.nodes[0];
    openGraphSidePanel(id);
  };
  state.network.on('click', _graphClickListener);
}

function openGraphSidePanel(id) {
  const panel = document.getElementById('graph-sidepanel');
  const textEl = document.getElementById('graph-sidepanel-text');
  const metaEl = document.getElementById('graph-sidepanel-meta');
  const edgesEl = document.getElementById('graph-sidepanel-edges');
  const delBtn = document.getElementById('graph-sidepanel-delete');
  if (!panel) return;
  const ins = state.storage.getInspiration(id);
  if (!ins) { panel.hidden = true; return; }
  panel.hidden = false;
  textEl.textContent = ins.text;
  const tags = (ins.tags || []).map((t) => '#' + t).join(' ');
  metaEl.textContent = `${formatDate(ins.createdAt)}${ins.source === 'voice' ? ' · 🎤 voice' : ''}${tags ? ' · ' + tags : ''}`;
  // Connected inspirations
  const links = state.storage.getLinks().filter((l) => l.source === id || l.target === id);
  if (links.length === 0) {
    edgesEl.innerHTML = '<li class="empty__body">No connections yet.</li>';
  } else {
    edgesEl.innerHTML = links.map((l) => {
      const otherId = l.source === id ? l.target : l.source;
      const other = state.storage.getInspiration(otherId);
      const text = other ? esc((other.text || '').slice(0, 60) + ((other.text || '').length > 60 ? '…' : '')) : '(deleted)';
      return `<li><span class="graph-sidepanel__edge-kind graph-sidepanel__edge-kind--${l.kind === 'pinned' ? 'pinned' : 'inferred'}">${l.kind === 'pinned' ? '🔗' : '·'}</span> ${text} <span class="graph-sidepanel__edge-score">${(l.score || 0).toFixed(2)}</span></li>`;
    }).join('');
  }
  if (delBtn) {
    delBtn.onclick = () => {
      if (!window.confirm('Delete this inspiration? This cannot be undone.')) return;
      state.storage.deleteInspiration(id);
      panel.hidden = true;
      toast('✅ Removed', 'success');
      mountGraph();
    };
  }
}

// ============================================================
// Page: #/timeline
// ============================================================
function renderTimeline() {
  return `
    <section class="page page--timeline">
      <header class="page__header">
        <h1 class="page__title">Timeline</h1>
        <p class="page__subtitle">Chronological, grouped by ISO week</p>
      </header>

      <form id="timeline-search" class="search" role="search" autocomplete="off">
        <span class="search__icon" aria-hidden="true">🔍</span>
        <input
          id="timeline-search-input"
          class="search__input"
          name="q"
          type="text"
          placeholder="Search past inspirations…"
          aria-label="Search inspirations"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
        />
        <button type="button" id="timeline-search-clear" class="search__clear" aria-label="Clear search">×</button>
      </form>

      <div id="timeline-content" class="timeline-content" aria-live="polite"></div>
    </section>
  `;
}

function bindTimelineEvents() {
  const form = document.getElementById('timeline-search');
  const input = document.getElementById('timeline-search-input');
  const clear = document.getElementById('timeline-search-clear');
  if (!form || !input) return;
  const render = () => renderTimelineContent(input.value || '');
  form.addEventListener('submit', (e) => { e.preventDefault(); render(); });
  input.addEventListener('input', render);
  if (clear) clear.addEventListener('click', () => { input.value = ''; render(); });
  render();
}

function renderTimelineContent(rawQuery) {
  const container = document.getElementById('timeline-content');
  if (!container) return;
  const all = state.storage.getInspirations();
  // Use the existing bestMatch scorer for the inline search
  let filtered = all;
  if (String(rawQuery || '').trim()) {
    // Re-purpose the scorer: each "idea" is shaped as { question, field, methods:[tags] }
    const haystack = all.map((it) => ({
      id: it.id,
      field: (it.tags || [])[0] || '',
      question: it.text,
      methods: it.tags || [],
    }));
    const match = bestMatch(haystack, rawQuery);
    if (match) {
      filtered = all.filter((it) => it.id === match.idea.id);
    } else {
      // Soft fallback: substring on text
      const q = String(rawQuery || '').toLowerCase();
      filtered = all.filter((it) => String(it.text || '').toLowerCase().includes(q));
    }
  }
  if (filtered.length === 0) {
    container.innerHTML = emptyState('📭', 'Nothing here yet', 'Add a few inspirations via the capture box.', `<a class="btn btn--primary" href="#/capture">Go to capture</a>`);
    return;
  }
  // Group by ISO week
  const sorted = filtered.slice().sort((a, b) => b.createdAt - a.createdAt);
  const groups = new Map();
  for (const it of sorted) {
    const wk = isoWeekLabel(new Date(it.createdAt || 0));
    if (!groups.has(wk)) groups.set(wk, []);
    groups.get(wk).push(it);
  }
  const sections = Array.from(groups.entries()).map(([wk, items]) => `
    <section class="timeline-week">
      <h2 class="timeline-week__title">${esc(wk)}</h2>
      <ol class="timeline-week__list">
        ${items.map((it) => `
          <li class="inspiration-card" data-id="${esc(it.id)}">
            <div class="inspiration-card__text">${esc(it.text)}</div>
            <div class="inspiration-card__meta">
              <span>${formatDate(it.createdAt)}</span>${it.source === 'voice' ? '<span>· 🎤</span>' : ''}
              ${(it.tags || []).map((t) => `<span class="inspiration-card__tag">#${esc(t)}</span>`).join('')}
            </div>
          </li>
        `).join('')}
      </ol>
    </section>
  `).join('');
  container.innerHTML = sections;
}

// ============================================================
// Page: #/my
// ============================================================
function renderMy() {
  const all = state.storage.getInspirations();
  const total = all.length;
  return `
    <section class="page page--my">
      <header class="page__header">
        <h1 class="page__title">My inspirations</h1>
        <p class="page__subtitle">${total} total</p>
      </header>

      <div class="my-export">
        <button type="button" class="btn btn--primary" data-export="json">Download JSON</button>
        <button type="button" class="btn btn--ghost" data-export="md">Download Markdown</button>
        <button type="button" class="btn btn--ghost" data-export="html">Download HTML</button>
        <button type="button" class="btn btn--ghost" data-export="graphml">Download GraphML</button>
      </div>

      <div id="my-list" class="my-list">
        ${total === 0
          ? emptyState('📭', 'No inspirations yet', 'Capture a few in the capture box first.', `<a class="btn btn--primary" href="#/capture">Go to capture</a>`)
          : `<ol class="my-list__items">${all.map((it) => `
            <li class="inspiration-card" data-id="${esc(it.id)}">
              <div class="inspiration-card__text">${esc(it.text)}</div>
              <div class="inspiration-card__meta">
                <span>${formatDate(it.createdAt)}</span>${it.source === 'voice' ? '<span>· 🎤</span>' : ''}
                ${(it.tags || []).map((t) => `<span class="inspiration-card__tag">#${esc(t)}</span>`).join('')}
              </div>
              <div class="inspiration-card__actions">
                <button type="button" class="btn btn--ghost" data-delete="${esc(it.id)}">Delete</button>
              </div>
            </li>
          `).join('')}</ol>`
        }
      </div>
    </section>
  `;
}

function bindMyEvents() {
  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete');
      if (!id) return;
      if (!window.confirm('Delete this inspiration? This cannot be undone.')) return;
      state.storage.deleteInspiration(id);
      toast('✅ Removed', 'success');
      render();
    });
  });
  document.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.getAttribute('data-export');
      const payload = buildExportPayload(
        state.storage.getInspirations(),
        state.storage.getLinks(),
        state.storage.getProfile()
      );
      let res;
      try {
        if (kind === 'json') res = exportJson(payload);
        else if (kind === 'md') res = exportMarkdown(payload);
        else if (kind === 'html') res = exportStandaloneHtml(payload);
        else if (kind === 'graphml') res = exportGraphml(payload);
        else { toast('⚠️ Unknown export kind', 'warn'); return; }
      } catch (err) {
        console.error(err);
        toast('❌ Export failed: ' + (err && err.message), 'error');
        return;
      }
      if (downloadBlob(res.blob, res.filename)) toast('✅ Downloaded ' + res.filename, 'success');
      else toast('❌ Download not available in this environment', 'error');
    });
  });
}

// ============================================================
// Page: #/settings
// ============================================================
function renderSettings() {
  const cfg = loadProviderSettings();
  const type = cfg.type || 'mock';
  return `
    <section class="page page--settings">
      <header class="page__header">
        <h1 class="page__title">Settings</h1>
        <p class="page__subtitle">Local-first · data stays in this browser</p>
      </header>

      <div class="settings__section">
        <h2 class="settings__section-title">LLM Provider</h2>
        <p class="empty__body">v0.6 is local-first and does not call any LLM at runtime. The picker is kept for future releases.</p>
        <form id="settings-form" class="settings__group" novalidate>
          <label class="settings__option ${type === 'mock' ? 'is-selected' : ''}" data-option="mock">
            <input type="radio" name="provider" value="mock" ${type === 'mock' ? 'checked' : ''} />
            <div>
              <span class="settings__option-label">Mock (no-op in v0.6)</span>
              <span class="settings__option-desc">Stub provider; no network calls, no idea generation.</span>
            </div>
          </label>
          <label class="settings__option ${type === 'openai' ? 'is-selected' : ''}" data-option="openai">
            <input type="radio" name="provider" value="openai" ${type === 'openai' ? 'checked' : ''} />
            <div>
              <span class="settings__option-label">OpenAI-compatible (future hook)</span>
              <span class="settings__option-desc">Not used at runtime in v0.6.</span>
            </div>
          </label>
          <div class="settings__row">
            <button type="submit" class="btn btn--primary">Save</button>
          </div>
        </form>
      </div>

      <div class="settings__section">
        <h2 class="settings__section-title">Storage</h2>
        <p class="empty__body">All data is in <code>localStorage</code> under <code>insightrecoder.*</code>. You can clear it from your browser's dev tools if you want a fresh start.</p>
        <button type="button" class="btn btn--danger" id="wipe-data">🗑️ Clear all data</button>
      </div>

      <div class="settings__section">
        <h2 class="settings__section-title">About</h2>
        <p class="empty__body">InsightRecoder v0.6 · pure-frontend · local-first · no tracking.</p>
      </div>
    </section>
  `;
}

function bindSettingsEvents() {
  const form = document.getElementById('settings-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const type = String(fd.get('provider') || 'mock');
      saveProviderSettings({ type });
      toast('✅ Saved', 'success');
    });
    form.querySelectorAll('input[name="provider"]').forEach((r) => {
      r.addEventListener('change', () => {
        form.querySelectorAll('.settings__option').forEach((opt) => {
          const radio = opt.querySelector('input[type="radio"]');
          opt.classList.toggle('is-selected', radio && radio.checked);
        });
      });
    });
  }
  const wipe = document.getElementById('wipe-data');
  if (wipe) {
    wipe.addEventListener('click', () => {
      if (!window.confirm('This will delete ALL inspirations, links, and profile. Continue?')) return;
      try {
        // Only v0.6 keys. Any pre-v0.6 legacy key is already migrated
        // on first boot by Storage.migrateLegacyUserIdeas(), so we
        // don't need to (and shouldn't) reach for it here.
        for (const k of Object.keys(window.localStorage)) {
          if (k.startsWith('insightrecoder.')) {
            window.localStorage.removeItem(k);
          }
        }
      } catch (_) { /* ignore */ }
      toast('✅ Cleared', 'success');
      location.hash = '#/capture';
    });
  }
}

function loadProviderSettings() {
  try {
    const raw = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (!raw) return { type: 'mock' };
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.type === 'mock' || parsed.type === 'openai')) {
      return { type: parsed.type };
    }
  } catch (_) { /* fall through */ }
  return { type: 'mock' };
}
function saveProviderSettings(cfg) {
  try { window.localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(cfg)); } catch (_) {}
}

// ============================================================
// Util: format helpers
// ============================================================
function formatDate(ms) {
  const d = new Date(Number(ms) || 0);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function isoWeekLabel(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return 'unknown-week';
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ============================================================
// Router
// ============================================================
function render() {
  // Stop any in-flight voice
  try { state.voice.stop(); } catch (_) {}

  const hash = (location.hash || '#/capture').replace(/^#/, '');
  const route = hash || '/capture';
  const app = document.getElementById('app');

  if (route === '/profile' || route === '/' || route === '') {
    app.innerHTML = renderProfile() + bottomNav('profile');
    bindProfileEvents();
  } else if (route === '/capture') {
    app.innerHTML = renderCapture() + bottomNav('capture');
    bindCaptureEvents();
  } else if (route === '/graph') {
    app.innerHTML = renderGraph() + bottomNav('graph');
    bindGraphEvents();
  } else if (route === '/timeline') {
    app.innerHTML = renderTimeline() + bottomNav('timeline');
    bindTimelineEvents();
  } else if (route === '/my') {
    app.innerHTML = renderMy() + bottomNav('my');
    bindMyEvents();
  } else if (route === '/settings') {
    app.innerHTML = renderSettings() + bottomNav('settings');
    bindSettingsEvents();
  } else {
    app.innerHTML = renderCapture() + bottomNav('capture');
    bindCaptureEvents();
  }
}

// ============================================================
// Boot
// ============================================================
async function init() {
  // One-shot migration from v0.5.x storage. The migration now
  // covers all four legacy keys (user-ideas, saved, feedback,
  // profile). v0.6.0 only handled user-ideas, which is why users
  // who had saved / favorite ideas saw their data "disappear"
  // after upgrading — the legacy keys were not migrated and the
  // new app had no surface to display them. v0.6.2 migrates
  // everything; if a user already upgraded to v0.6.0 and their
  // legacy data is still in localStorage (which it is, until
  // they clear site data), the migration will run on the next
  // boot of v0.6.2 and bring back saved + profile data.
  try {
    const r = state.storage.migrateLegacyUserIdeas();
    if (r && r.hadAnyLegacy) {
      const parts = [];
      if (r.inspirationsMigrated > 0) parts.push(`${r.inspirationsMigrated} idea${r.inspirationsMigrated === 1 ? '' : 's'}`);
      if (r.savedMigrated > 0) parts.push(`${r.savedMigrated} saved`);
      if (r.feedbackMigrated > 0) parts.push(`${r.feedbackMigrated} feedback`);
      if (r.profileMigrated) parts.push('profile');
      if (parts.length > 0) {
        // Defer toast until after first render
        setTimeout(() => toast(`✅ Migrated from IdeaMiner: ${parts.join(', ')}`, 'success'), 100);
      }
    }
  } catch (err) {
    console.warn('migrateLegacyUserIdeas failed:', err);
  }
  state.ready = true;
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  init();
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = '#/capture';
  }
  render();
});
