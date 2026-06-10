/**
 * app.js
 * ------------------------------------------------------------
 * Router + application bootstrap.
 *
 * Routes:
 *   #/profile   Refine Your Research Profile（form）
 *   #/explore   Explore Ideas (idea card + feedback buttons)
 *   #/saved     Saved (list of saved ideas)
 *   #/my        Profile (profile + feedback history)
 *   #/settings  Settings (LLM provider selection / API config / test)
 *
 * Extension points:
 *   1. createProvider() factory can swap mock / openai
 *   2. Replace LocalStorageProvider with ApiStorageProvider (preserves sync interface)
 *   3. Replace MockReviewer with LLM-as-judge
 * ------------------------------------------------------------
 */

import { createProvider } from './llm-provider.js';
import { LocalStorageProvider } from './storage.js';
import { IdeaGenerator } from './idea-generator.js';
import { VoiceInput } from './voice.js';

// ---------- LLM provider config (persisted) ----------
const PROVIDER_STORAGE_KEY = 'ideaminer.provider.v1';

/**
 * @typedef {Object} ProviderSettings
 * @property {'mock'|'openai'} type
 * @property {string} [endpoint]
 * @property {string} [apiKey]
 * @property {string} [model]
 */

/**
 * Read and clean provider config (drop empty fields, apply default model, etc.).
 * @returns {ProviderSettings}
 */
function loadProviderSettings() {
  try {
    const raw = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (!raw) return { type: 'mock' };
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.type === 'mock' || parsed.type === 'openai')) {
      return {
        type: parsed.type,
        endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        model: typeof parsed.model === 'string' ? parsed.model : '',
      };
    }
  } catch (_) { /* fall through */ }
  return { type: 'mock' };
}

function saveProviderSettings(cfg) {
  try {
    window.localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(cfg));
  } catch (_) { /* ignore quota */ }
}

// ---------- Global state ----------
const state = {
  storage: new LocalStorageProvider(),
  voice: new VoiceInput(),
  llm: null,            // Built by init() via createProvider
  generator: null,      // Built by init() (depends on llm)
  ready: false,         // init() complete
  current: null,        // Currently displayed ReviewedIdea
  currentAbort: null,   // AbortController for the current IdeaGenerator.next()
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
  // Extract emoji icon (if the first char of the message is an emoji, render it as the leading icon)
  let icon = '';
  let text = msg;
  const emojiMatch = /^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])\s*/u.exec(msg);
  if (emojiMatch) {
    icon = emojiMatch[1];
    text = msg.slice(emojiMatch[0].length);
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

// ---------- Util: clipboard ----------
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

// ---------- Render: bottom nav (4 items: Explore / Saved / Profile / Settings) ----------
function bottomNav(active) {
  return `
    <nav class="bottom-nav" role="navigation" aria-label="Main navigation">
      <a class="bottom-nav__item ${active === 'explore' ? 'is-active' : ''}" href="#/explore" aria-label="Explore">
        <span class="bottom-nav__icon" aria-hidden="true">🧭</span>
        <span class="bottom-nav__label">Explore</span>
      </a>
      <a class="bottom-nav__item ${active === 'saved' ? 'is-active' : ''}" href="#/saved" aria-label="Saved">
        <span class="bottom-nav__icon" aria-hidden="true">🗂️</span>
        <span class="bottom-nav__label">Saved</span>
      </a>
      <a class="bottom-nav__item ${active === 'my' ? 'is-active' : ''}" href="#/my" aria-label="Profile">
        <span class="bottom-nav__icon" aria-hidden="true">👤</span>
        <span class="bottom-nav__label">Profile</span>
      </a>
      <a class="bottom-nav__item ${active === 'settings' ? 'is-active' : ''}" href="#/settings" aria-label="Settings">
        <span class="bottom-nav__icon" aria-hidden="true">⚙️</span>
        <span class="bottom-nav__label">Settings</span>
      </a>
    </nav>
  `;
}

// ---------- Generic empty state ----------
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

// ---------- Render: Refine Your Research Profile (#/profile) ----------
function renderProfile() {
  const profile = state.storage.getProfile();
  const fieldOptions = [
    'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Mathematics',
    'Materials Science', 'Earth Science', 'Psychology', 'Economics', 'Other',
  ];
  const ageOptions = ['Undergraduate', 'Master's', 'PhD', 'Postdoc', 'Professor', 'Other'];

  const opts = (arr, sel) => arr.map((x) =>
    `<option value="${esc(x)}" ${x === sel ? 'selected' : ''}>${esc(x)}</option>`
  ).join('');

  const placeholder = profile ? '' : 'placeholder="e.g. machine learning, quantum computing"';
  const val = profile ? esc(profile.direction || '') : '';

  const voiceSupported = state.voice.isSupported();

  return `
    <section class="page page--profile">
      <header class="page__header">
        <h1 class="page__title">Refine Your Research Profile</h1>
        <p class="page__subtitle">Tell us about your research so we can tailor ideas for you</p>
      </header>

      <form id="profile-form" class="form" novalidate>
        <label class="form__field">
          <span class="form__label">Field</span>
          <select class="form__input" name="field" required>
            <option value="" disabled ${profile ? '' : 'selected'}>Select your field</option>
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
              <span class="voice-dots" data-voice-dots hidden aria-hidden="true">
                <span class="voice-dots__dot"></span>
                <span class="voice-dots__dot"></span>
                <span class="voice-dots__dot"></span>
                <span class="voice-dots__dot"></span>
                <span class="voice-dots__dot"></span>
              </span>
            ` : ''}
          </div>
        </label>

        <label class="form__field">
          <span class="form__label">Career stage</span>
          <select class="form__input" name="age" required>
            <option value="" disabled ${profile && profile.age ? '' : 'selected'}>Please choose a career stage</option>
            ${opts(ageOptions, profile && profile.age)}
          </select>
        </label>

        <button type="submit" class="btn btn--primary">Continue</button>
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
    if (!profile.field) { toast('⚠️ Please choose a field', 'warn'); return; }
    if (!profile.direction) { toast('⚠️ Please fill in your research direction', 'warn'); return; }
    if (!profile.age) { toast('⚠️ Please choose a career stage', 'warn'); return; }

    state.storage.setProfile(profile);
    location.hash = '#/explore';
  });

  // Voice input button
  form.querySelectorAll('[data-voice-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetName = btn.getAttribute('data-voice-target');
      const input = form.querySelector(`[name="${targetName}"]`);
      if (!input) return;
      const dots = form.querySelector('[data-voice-dots]');

      if (state.voice.isRecording() && state.voice._currentTarget === targetName) {
        state.voice.stop();
        btn.classList.remove('is-recording');
        if (dots) dots.hidden = true;
        return;
      }
      state.voice._currentTarget = targetName;
      btn.classList.add('is-recording');
      if (dots) dots.hidden = false;
      state.voice.start(
        (text, isFinal) => {
          input.value = text;
          if (isFinal) {
            btn.classList.remove('is-recording');
            if (dots) dots.hidden = true;
            state.voice._currentTarget = null;
          }
        },
        (err) => {
          btn.classList.remove('is-recording');
          if (dots) dots.hidden = true;
          state.voice._currentTarget = null;
          if (err === 'not-allowed' || err === 'service-not-allowed') {
            toast('⚠️ Please allow microphone access (Browser Settings → Site permissions)', 'warn');
          } else if (err === 'no-speech') {
            toast("⚠️ Didn't hear anything, please try again", 'warn');
          } else if (err === 'audio-capture') {
            toast('⚠️ No microphone device found', 'error');
          } else if (err !== 'aborted') {
            toast('⚠️ Voice input failed: ' + err, 'error');
          }
        }
      );
    });
  });
}

// ---------- Render: Explore Ideas (#/explore) ----------
function renderExploreSkeleton() {
  return `
    <section class="page page--explore">
      <header class="page__header">
        <h1 class="page__title">Explore Ideas</h1>
        <p class="page__subtitle">Discover research questions that interest you</p>
      </header>
      <div class="card card--loading" aria-busy="true">
        <div class="card__skeleton">
          <span class="skeleton-bar skeleton-bar--lg"></span>
          <span class="skeleton-bar skeleton-bar--md"></span>
          <span class="skeleton-bar skeleton-bar--md"></span>
          <span class="skeleton-bar skeleton-bar--sm"></span>
        </div>
        <p class="card__loading-text">Generating an idea for you…</p>
      </div>
      ${bottomNav('explore')}
    </section>
  `;
}

function renderExploreIdea(idea) {
  const review = idea.review || { innovation: 0, feasibility: 0, importance: 0 };
  const methods = (idea.methods || []).map((m) =>
    `<li class="methods__item">${esc(m)}</li>`
  ).join('');

  return `
    <section class="page page--explore">
      <header class="page__header">
        <h1 class="page__title">Explore Ideas</h1>
        <p class="page__subtitle">Discover research questions that interest you</p>
      </header>

      <article class="card" data-idea-id="${esc(idea.id)}">
        <h2 class="card__question">${esc(idea.question)}</h2>

        <div class="card__badges" aria-label="Review scores">
          <span class="badge badge--innovation" title="Innovation">Innovation ${review.innovation}</span>
          <span class="badge badge--feasibility" title="Feasibility">Feasibility ${review.feasibility}</span>
          <span class="badge badge--importance" title="Importance">Importance ${review.importance}</span>
        </div>

        <section class="card__section">
          <h3 class="card__section-title">📋 Background</h3>
          <p class="card__section-body">${esc(idea.background)}</p>
        </section>

        <section class="card__section">
          <h3 class="card__section-title">💡 Why it matters</h3>
          <p class="card__section-body">${esc(idea.significance)}</p>
        </section>

        <section class="card__section">
          <h3 class="card__section-title">🔬 Methods</h3>
          <ol class="methods">${methods}</ol>
        </section>

        <div class="feedback" role="group" aria-label="Feedback">
          <button type="button" class="feedback__btn" data-fb="dislike">👎 Dislike</button>
          <button type="button" class="feedback__btn" data-fb="unrelated">🚫 Unrelated</button>
          <button type="button" class="feedback__btn feedback__btn--like" data-fb="like">❤️ Like</button>
          <button type="button" class="feedback__btn" data-fb="copy">📋 Copy</button>
        </div>
      </article>

      ${bottomNav('explore')}
    </section>
  `;
}

function renderExploreEmpty(profile) {
  return `
    <section class="page page--explore">
      <header class="page__header">
        <h1 class="page__title">Explore Ideas</h1>
        <p class="page__subtitle">Discover research questions that interest you</p>
      </header>
      ${emptyState(
        '🔭',
        'No research profile yet',
        `Please <a class="link" href="#/profile">set up your research profile</a> first. We will generate ideas based on your field and direction.`,
        `<a class="btn btn--primary" href="#/profile">Set up now</a>`
      )}
      ${bottomNav('explore')}
    </section>
  `;
}

function bindExploreIdeaEvents() {
  const card = document.querySelector('.card[data-idea-id]');
  if (!card) return;
  const ideaId = card.getAttribute('data-idea-id');

  card.querySelectorAll('.feedback__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fb = btn.getAttribute('data-fb');
      if (fb === 'copy') {
        const text = collectIdeaText(card);
        copyText(text).then((ok) => toast(ok ? '✅ Copied' : '❌ Copy failed', ok ? 'success' : 'error'));
        return;
      }
      if (fb === 'like') {
        const idea = state.current;
        if (idea) state.storage.saveIdea(idea);
        state.storage.recordFeedback(ideaId, 'like');
        toast('✅ Saved', 'success');
        fetchNext();
        return;
      }
      // dislike / unrelated
      state.storage.recordFeedback(ideaId, fb);
      fetchNext();
    });
  });
}

function collectIdeaText(cardEl) {
  const q = cardEl.querySelector('.card__question')?.textContent || '';
  const bg = cardEl.querySelectorAll('.card__section-body')[0]?.textContent || '';
  const sig = cardEl.querySelectorAll('.card__section-body')[1]?.textContent || '';
  const methods = Array.from(cardEl.querySelectorAll('.methods__item'))
    .map((li, i) => `${i + 1}. ${li.textContent}`)
    .join('\n');
  return `Question: ${q}\n\nBackground: ${bg}\n\nSignificance: ${sig}\n\nMethods:\n${methods}`;
}

async function fetchNext() {
  if (!state.ready || !state.generator) {
    render();
    return;
  }
  // Cancel the previous request
  if (state.currentAbort) {
    try { state.currentAbort.abort(); } catch (_) {}
  }
  const ac = new AbortController();
  state.currentAbort = ac;

  const profile = state.storage.getProfile();
  if (!profile) {
    render();
    return;
  }

  // Render the skeleton first
  document.getElementById('app').innerHTML = renderExploreSkeleton();

  try {
    const idea = await state.generator.next(profile, ac.signal);
    if (ac.signal.aborted) return;  // User has left this page
    state.current = idea;
    document.getElementById('app').innerHTML = renderExploreIdea(idea);
    bindExploreIdeaEvents();
  } catch (err) {
    if (ac.signal.aborted) return;
    console.error(err);
    const isAbort = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message)));
    const errMsg = isAbort ? 'Cancelled' : (err.message || String(err));
    document.getElementById('app').innerHTML = `
      <section class="page page--explore">
        <header class="page__header">
          <h1 class="page__title">Explore Ideas</h1>
          <p class="page__subtitle">Discover research questions that interest you</p>
        </header>
        ${emptyState(
          '😕',
          'Failed to generate idea',
          esc(errMsg),
          `<button class="btn btn--primary" id="retry">Retry</button>`
        )}
        ${bottomNav('explore')}
      </section>
    `;
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', fetchNext);
  }
}

// ---------- Render: Saved (#/saved) ----------
function renderSaved() {
  const list = state.storage.getSavedIdeas();
  if (list.length === 0) {
    return `
      <section class="page page--saved">
        <header class="page__header">
          <h1 class="page__title">Saved</h1>
          <p class="page__subtitle">Ideas you have saved</p>
        </header>
        ${emptyState(
          '🗂️',
          'No saved ideas yet',
          "Find an idea you like on the Explore Ideas page and tap \u2764\ufe0f to save it.",
          `<a class="btn btn--primary" href="#/explore">Start exploring</a>`
        )}
        ${bottomNav('saved')}
      </section>
    `;
  }

  const cards = list.map((it) => `
    <article class="card card--saved" data-saved-id="${esc(it.id)}">
      <h2 class="card__question">${esc(it.question)}</h2>
      <p class="card__excerpt">${esc((it.background || '').slice(0, 80))}${(it.background || '').length > 80 ? '…' : ''}</p>
      <div class="card__meta">
        ${it.review ? `<span class="badge badge--innovation">Innovation ${it.review.innovation}</span>
        <span class="badge badge--feasibility">Feasibility ${it.review.feasibility}</span>
        <span class="badge badge--importance">Importance ${it.review.importance}</span>` : ''}
        <button type="button" class="btn btn--ghost" data-remove="${esc(it.id)}">Remove</button>
      </div>
    </article>
  `).join('');

  return `
    <section class="page page--saved">
      <header class="page__header">
        <h1 class="page__title">Saved</h1>
        <p class="page__subtitle">${list.length} total</p>
      </header>
      <div class="cards">${cards}</div>
      ${bottomNav('saved')}
    </section>
  `;
}

function bindSavedEvents() {
  document.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-remove');
      state.storage.removeIdea(id);
      render();
      toast('✅ Removed', 'success');
    });
  });
}

// ---------- Render: Profile (#/my) ----------
function renderMy() {
  const profile = state.storage.getProfile();
  const history = state.storage.getFeedbackHistory();
  const summary = { like: 0, dislike: 0, unrelated: 0 };
  history.forEach((f) => { summary[f.type] = (summary[f.type] || 0) + 1; });

  const settings = loadProviderSettings();
  const providerLabel = settings.type === 'openai'
    ? `OpenAI-compatible \u00b7 ${esc(settings.model || '?')}`
    : 'Mock (34 built-in ideas)';

  return `
    <section class="page page--my">
      <header class="page__header">
        <h1 class="page__title">Profile</h1>
        <p class="page__subtitle">Your profile and feedback history</p>
      </header>

      <section class="card card--profile">
        <h2 class="card__section-title">🪪 Research Profile</h2>
        ${profile ? `
          <dl class="kv">
            <dt>Field</dt><dd>${esc(profile.field)}</dd>
            <dt>Direction</dt><dd>${esc(profile.direction)}</dd>
            <dt>Career stage</dt><dd>${esc(profile.age)}</dd>
          </dl>
        ` : `
          <p class="empty__body">Not set up yet</p>
        `}
        <a class="btn btn--primary" href="#/profile">${profile ? 'Edit profile' : 'Set up now'}</a>
      </section>

      <section class="card card--history">
        <h2 class="card__section-title">📊 Feedback Stats</h2>
        <dl class="kv">
          <dt>❤️ Like</dt><dd>${summary.like || 0}</dd>
          <dt>👎 Dislike</dt><dd>${summary.dislike || 0}</dd>
          <dt>🚫 Unrelated</dt><dd>${summary.unrelated || 0}</dd>
          <dt>Total</dt><dd>${history.length}</dd>
        </dl>
      </section>

      <section class="card card--provider">
        <h2 class="card__section-title">🤖 Current LLM</h2>
        <p class="empty__body">${providerLabel}</p>
        <a class="btn btn--ghost" href="#/settings">Go to settings</a>
      </section>

      <section class="card card--saved-list">
        <h2 class="card__section-title">🗂️ Saved Ideas</h2>
        <p class="empty__body">${state.storage.getSavedIdeas().length} total · <a class="link" href="#/saved">View</a></p>
      </section>

      ${bottomNav('my')}
    </section>
  `;
}

// ---------- Render: Settings (#/settings) ----------
function renderSettings() {
  const cfg = loadProviderSettings();
  const type = cfg.type || 'mock';
  const endpoint = cfg.endpoint || 'https://api.openai.com/v1/chat/completions';
  const apiKey = cfg.apiKey || '';
  const model = cfg.model || 'gpt-4o-mini';

  return `
    <section class="page page--settings">
      <header class="page__header">
        <h1 class="page__title">Settings</h1>
        <p class="page__subtitle">Select your LLM provider</p>
      </header>

      <div class="settings__section">
        <h2 class="settings__section-title">LLM Provider</h2>
        <form id="settings-form" class="settings__group" novalidate>
          <label class="settings__option ${type === 'mock' ? 'is-selected' : ''}" data-option="mock">
            <input type="radio" name="provider" value="mock" ${type === 'mock' ? 'checked' : ''} />
            <div>
              <span class="settings__option-label">Mock (34 built-in ideas)</span>
              <span class="settings__option-desc">Works offline, no API key needed. Uses data/mock-ideas.json.</span>
            </div>
          </label>
          <label class="settings__option ${type === 'openai' ? 'is-selected' : ''}" data-option="openai">
            <input type="radio" name="provider" value="openai" ${type === 'openai' ? 'checked' : ''} />
            <div>
              <span class="settings__option-label">OpenAI-compatible (your own API)</span>
              <span class="settings__option-desc">Supports OpenAI, DeepSeek, Moonshot, Ollama, LM Studio, and any other endpoint that speaks the /v1/chat/completions protocol.</span>
            </div>
          </label>

          <div id="openai-fields" style="display:${type === 'openai' ? 'block' : 'none'};">
            <label class="form__field">
              <span class="form__label">Endpoint URL</span>
              <input class="form__input" name="endpoint" type="url" placeholder="https://api.openai.com/v1/chat/completions" value="${esc(endpoint)}" autocomplete="off" />
            </label>
            <label class="form__field">
              <span class="form__label">API Key</span>
              <input class="form__input" name="apiKey" type="password" placeholder="sk-..." value="${esc(apiKey)}" autocomplete="off" />
            </label>
            <label class="form__field">
              <span class="form__label">Model</span>
              <input class="form__input" name="model" type="text" placeholder="gpt-4o-mini / deepseek-chat / ..." value="${esc(model)}" autocomplete="off" />
            </label>
            <p class="settings__hint">Your API key is stored only in this browser's localStorage and is never uploaded anywhere.</p>
          </div>

          <div class="settings__row">
            <button type="submit" class="btn btn--primary">Save</button>
            <button type="button" class="btn btn--ghost" id="test-connection">Test Connection</button>
          </div>
        </form>
      </div>

      <div class="settings__section">
        <h2 class="settings__section-title">About</h2>
        <p class="empty__body">IdeaMiner MVP \u00b7 pure-frontend \u00b7 your data stays in your browser.</p>
      </div>

      ${bottomNav('settings')}
    </section>
  `;
}

function bindSettingsEvents() {
  const form = document.getElementById('settings-form');
  if (!form) return;

  // Show/hide OpenAI fields when switching provider
  const openaiFields = document.getElementById('openai-fields');
  const updateOptionStyles = () => {
    form.querySelectorAll('.settings__option').forEach((opt) => {
      const radio = opt.querySelector('input[type="radio"]');
      opt.classList.toggle('is-selected', radio && radio.checked);
    });
    const openaiChecked = form.querySelector('input[name="provider"][value="openai"]').checked;
    if (openaiFields) openaiFields.style.display = openaiChecked ? 'block' : 'none';
  };
  form.querySelectorAll('input[name="provider"]').forEach((r) => {
    r.addEventListener('change', updateOptionStyles);
  });

  // Save
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const type = String(fd.get('provider') || 'mock');
    const next = {
      type,
      endpoint: String(fd.get('endpoint') || '').trim(),
      apiKey:   String(fd.get('apiKey')   || '').trim(),
      model:    String(fd.get('model')    || '').trim(),
    };
    if (type === 'openai') {
      if (!next.endpoint) { toast('⚠️ Please fill in Endpoint URL', 'warn'); return; }
      if (!next.apiKey)   { toast('⚠️ Please fill in API Key', 'warn'); return; }
      if (!next.model)    { toast('⚠️ Please fill in Model', 'warn'); return; }
    }
    saveProviderSettings(next);
    toast('✅ Saved', 'success');
    // Rebuild the generator (llm was swapped)
    await rebuildProvider(next);
  });

  // Test Connection
  const testBtn = document.getElementById('test-connection');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const fd = new FormData(form);
      const type = String(fd.get('provider') || 'mock');
      const cfg = {
        type,
        endpoint: String(fd.get('endpoint') || '').trim(),
        apiKey:   String(fd.get('apiKey')   || '').trim(),
        model:    String(fd.get('model')    || '').trim(),
      };
      if (type === 'openai') {
        if (!cfg.endpoint || !cfg.apiKey || !cfg.model) {
          toast('⚠️ Please fill in the full OpenAI config first', 'warn');
          return;
        }
      }
      testBtn.disabled = true;
      const originalLabel = testBtn.textContent;
      testBtn.textContent = 'Testing\u2026';
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 35000);
      try {
        const profile = state.storage.getProfile() || { field: 'Physics', direction: 'quantum geometry', age: 'PhD' };
        const provider = await createProvider(cfg);
        const draft = await provider.generateIdea(profile, ac.signal);
        clearTimeout(timer);
        toast(`✅ Connection successful：${esc(draft.question.slice(0, 18))}…`, 'success');
      } catch (err) {
        clearTimeout(timer);
        const msg = (err && err.message) || String(err);
        if (err && (err.name === 'AbortError' || /aborted/i.test(msg))) {
          toast('⚠️ Test timed out and was cancelled', 'warn');
        } else {
          toast('❌ Connection failed：' + esc(msg.slice(0, 80)), 'error');
        }
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = originalLabel;
      }
    });
  }
}

// ---------- Rebuild provider (Settings save / boot) ----------
async function rebuildProvider(cfg) {
  try {
    const provider = await createProvider(cfg);
    state.llm = provider;
    state.generator = new IdeaGenerator(state.llm, undefined, state.storage);
  } catch (err) {
    console.error('rebuildProvider failed:', err);
    toast('❌ ' + (err.message || 'provider initialization failed'), 'error');
  }
}

// ---------- Application initialization ----------
async function init() {
  const cfg = loadProviderSettings();
  await rebuildProvider(cfg);
  state.ready = true;
}

// ---------- Router ----------
function render() {
  // Cancel any in-flight request
  if (state.currentAbort) {
    try { state.currentAbort.abort(); } catch (_) {}
    state.currentAbort = null;
  }
  state.voice.stop();

  const hash = (location.hash || '#/profile').replace(/^#/, '');
  const route = hash || '/profile';

  const app = document.getElementById('app');

  if (route === '/profile' || route === '/' || route === '') {
    app.innerHTML = renderProfile();
    bindProfileEvents();
  } else if (route === '/explore') {
    const profile = state.storage.getProfile();
    if (!profile) {
      app.innerHTML = renderExploreEmpty({ field: '?', direction: '?', age: '?' });
    } else if (!state.ready) {
      app.innerHTML = renderExploreSkeleton();
      // Wait for init to finish before fetching
      init().then(() => {
        if (state.currentAbort && state.currentAbort.signal.aborted) return;
        const ac = new AbortController();
        state.currentAbort = ac;
        state.generator.next(profile, ac.signal)
          .then((idea) => {
            if (ac.signal.aborted) return;
            state.current = idea;
            app.innerHTML = renderExploreIdea(idea);
            bindExploreIdeaEvents();
          })
          .catch((err) => {
            if (ac.signal.aborted) return;
            console.error(err);
            app.innerHTML = `
              <section class="page page--explore">
                <header class="page__header">
                  <h1 class="page__title">Explore Ideas</h1>
                  <p class="page__subtitle">Discover research questions that interest you</p>
                </header>
                ${emptyState('😕', 'Failed to generate idea', esc(err.message || String(err)))}
                ${bottomNav('explore')}
              </section>
            `;
          });
      });
    } else {
      app.innerHTML = renderExploreSkeleton();
      const ac = new AbortController();
      state.currentAbort = ac;
      state.generator.next(profile, ac.signal)
        .then((idea) => {
          if (ac.signal.aborted) return;
          state.current = idea;
          app.innerHTML = renderExploreIdea(idea);
          bindExploreIdeaEvents();
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          console.error(err);
          app.innerHTML = `
            <section class="page page--explore">
              <header class="page__header">
                <h1 class="page__title">Explore Ideas</h1>
                <p class="page__subtitle">Discover research questions that interest you</p>
              </header>
              ${emptyState('😕', 'Failed to generate idea', esc(err.message || String(err)))}
              ${bottomNav('explore')}
            </section>
          `;
        });
    }
  } else if (route === '/saved') {
    app.innerHTML = renderSaved();
    bindSavedEvents();
  } else if (route === '/my') {
    app.innerHTML = renderMy();
  } else if (route === '/settings') {
    app.innerHTML = renderSettings();
    bindSettingsEvents();
  } else {
    app.innerHTML = renderProfile();
    bindProfileEvents();
  }
}

// ---------- Boot ----------
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  // Boot init (async provider construction)
  init();

  // If the user has no profile and no hash, send them to the profile page
  if (!state.storage.getProfile() && !(location.hash && location.hash.length > 1)) {
    location.hash = '#/profile';
  } else if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = '#/profile';
  }
  render();
});