/**
 * app.js
 * ------------------------------------------------------------
 * IdeaMiner v0.8 — 4-step flow + voice/text input + 3-dim review + library.
 *
 * Steps:
 *   1. Discipline (primary + sub)
 *   2. Generate (text or voice hook -> LLMProvider -> 4-part idea)
 *   3. Review (3-dim stars + like/dislike/unrelated)
 *   4. Library (saved + history; iterate from any prior idea)
 *
 * Architecture:
 *   const app = new IdeaMinerApp({ root, provider, storage });
 *   app.mount();
 *
 * All UI is rendered into #app. State lives in app.state and is
 * re-rendered on every meaningful change. No framework.
 */

import { LLMProvider, MockLLMProvider, OpenAIProvider } from './llm-provider.js';
import { VoiceInput } from './voice.js';
import { Storage } from './storage.js';
import SEED_IDEAS from '../data/seed-ideas.json' with { type: 'json' };

const SUB_DISCIPLINES = {
  physics:  ['condensed-matter', 'quantum-information', 'high-energy', 'gravitation', 'optics'],
  biology:  ['neuroscience', 'cell-biology', 'genomics', 'evolution', 'ecology'],
  cs:       ['machine-learning', 'systems', 'theory', 'hci', 'security'],
};

const DIMS = [
  { key: 'innovation',  label: 'Innovation'  },
  { key: 'feasibility', label: 'Feasibility' },
  { key: 'importance',  label: 'Importance'  },
];

export class IdeaMinerApp {
  constructor({ root, provider, storage } = {}) {
    this.root    = root    || document.getElementById('app');
    this.storage = storage || new Storage();
    this.provider = provider || new MockLLMProvider({ ideas: SEED_IDEAS });
    this.voice   = null;            // lazily created on first mic press
    this.state = {
      step: 1,
      field: '',
      sub: '',
      prompt: '',
      isListening: false,
      currentIdea: null,            // { ...idea, review }
      savedView: 'history',         // 'history' | 'saved'
      history: this.storage.getAllIdeas(),
    };
  }

  setProvider(p) { this.provider = p; }

  mount() { this.render(); }

  // -- top-level render ------------------------------------------------
  render() {
    this.root.innerHTML = '';
    this.root.append(this._renderNav());
    if (this.state.step === 1) this.root.append(this._renderStep1());
    if (this.state.step === 2) this.root.append(this._renderStep2());
    if (this.state.step === 3) this.root.append(this._renderStep3());
    if (this.state.step === 4) this.root.append(this._renderStep4());
  }
  _renderNav() {
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.setAttribute('aria-label', 'Workflow steps');
    const items = [
      { step: 1, label: 'Field',    icon: '🎯' },
      { step: 2, label: 'Generate', icon: '🧪' },
      { step: 3, label: 'Review',   icon: '⭐' },
      { step: 4, label: 'Library',  icon: '📚' },
    ];
    for (const it of items) {
      const btn = document.createElement('button');
      btn.className = 'bottom-nav__item' + (this.state.step === it.step ? ' is-active' : '');
      btn.type = 'button';
      btn.innerHTML = `<span class="bottom-nav__icon">${it.icon}</span><span>${it.label}</span>`;
      btn.addEventListener('click', () => { this.state.step = it.step; this.render(); });
      nav.append(btn);
    }
    return nav;
  }

  // -- step 1 ---------------------------------------------------------
  _renderStep1() {
    const sec = document.createElement('section');
    sec.className = 'step';
    sec.innerHTML = `
      <h2 class="step__title">Step 1 — Choose your field</h2>
      <p class="step__hint">Pick a primary discipline and a sub-area. The system will filter all generated ideas to be relevant to your niche.</p>
      <label class="field">
        <span class="field__label">Primary field</span>
        <select class="field__input" id="primary">
          <option value="">— select —</option>
          ${Object.keys(SUB_DISCIPLINES).map((k) => `<option value="${k}" ${k===this.state.field?'selected':''}>${capitalize(k)}</option>`).join('')}
        </select>
      </label>
      <label class="field" id="subWrap" ${this.state.field ? '' : 'hidden'}>
        <span class="field__label">Sub-discipline</span>
        <select class="field__input" id="sub">
          <option value="">— select —</option>
          ${(SUB_DISCIPLINES[this.state.field] || []).map((s) => `<option value="${s}" ${s===this.state.sub?'selected':''}>${s}</option>`).join('')}
        </select>
      </label>
      <div class="actions">
        <button class="btn btn--primary" id="toStep2" ${(this.state.field && this.state.sub) ? '' : 'disabled'}>Next: Generate ideas →</button>
      </div>
    `;
    sec.querySelector('#primary').addEventListener('change', (e) => {
      this.state.field = e.target.value;
      this.state.sub = '';
      this.render();
    });
    const subEl = sec.querySelector('#sub');
    if (subEl) subEl.addEventListener('change', (e) => { this.state.sub = e.target.value; this.render(); });
    sec.querySelector('#toStep2').addEventListener('click', () => { this.state.step = 2; this.render(); });
    return sec;
  }

  // -- step 2 ---------------------------------------------------------
  _renderStep2() {
    const sec = document.createElement('section');
    sec.className = 'step';
    sec.innerHTML = `
      <h2 class="step__title">Step 2 — Generate an idea</h2>
      <p class="step__hint">Type or speak a hook. The hook is woven into a 4-part research plan tailored to <strong>${escape(this.state.field)} / ${escape(this.state.sub)}</strong>.</p>
      <div class="input-row">
        <label class="field">
          <span class="field__label">Your hook (text or voice)</span>
          <textarea class="field__textarea" id="prompt" placeholder="e.g. combine non-Hermitian dissipation with quantum metric drag">${escape(this.state.prompt)}</textarea>
          <span class="field__hint">Voice uses your browser's Web Speech API. Nothing is uploaded.</span>
        </label>
      </div>
      <div class="actions">
        <button class="btn btn--icon" id="mic" type="button" aria-pressed="${this.state.isListening}">
          🎙 ${this.state.isListening ? 'Listening… click to stop' : 'Voice input'}
        </button>
        <button class="btn btn--primary" id="generate" ${this.state.isListening ? 'disabled' : ''}>🧪 Generate</button>
        <button class="btn btn--ghost" id="back">← Back</button>
      </div>
      <div id="genStatus" aria-live="polite"></div>
    `;
    sec.querySelector('#prompt').addEventListener('input', (e) => { this.state.prompt = e.target.value; });
    const mic = sec.querySelector('#mic');
    mic.addEventListener('click', () => this._toggleVoice(mic));
    sec.querySelector('#generate').addEventListener('click', () => this._generate());
    sec.querySelector('#back').addEventListener('click', () => { this.state.step = 1; this.render(); });
    return sec;
  }

  async _toggleVoice(micBtn) {
    if (!this.voice) this.voice = new VoiceInput({
      onResult: (text, isFinal) => {
        this.state.prompt = text;
        this.render();
      },
      onError: (e) => { toast(`Mic: ${e.message}`); this.state.isListening = false; this.render(); },
      onEnd:   () => { this.state.isListening = false; this.render(); },
    });
    if (this.state.isListening) {
      await this.voice.stop();
      this.state.isListening = false;
    } else {
      const ok = await this.voice.start();
      if (ok) { this.state.isListening = true; this.render(); }
    }
  }

  async _generate() {
    const status = document.getElementById('genStatus');
    if (status) status.innerHTML = '<span class="spinner"></span> Generating…';
    try {
      const hook = this.state.prompt;
      const partial = await this.provider.generateIdea(hook, { field: this.state.field, sub: this.state.sub });
      const review  = await this.provider.reviewIdea(partial);
      this.state.currentIdea = {
        ...partial,
        field: this.state.field,
        sub:   this.state.sub,
        prompt: hook,
        review,
      };
      this.state.step = 3;
      this.render();
    } catch (e) {
      if (status) status.innerHTML = '';
      toast(`Generation failed: ${e.message}`);
    }
  }

  // -- step 3 ---------------------------------------------------------
  _renderStep3() {
    const idea = this.state.currentIdea;
    if (!idea) { this.state.step = 4; return this._renderStep4(); }

    const sec = document.createElement('section');
    sec.className = 'step';
    sec.innerHTML = `
      <h2 class="step__title">Step 3 — Review the idea</h2>
      <p class="step__hint">Score each dimension 1-5. Your scores feed the feedback loop. Like / dislike / unrelated feed the next generation.</p>
    `;
    sec.append(this._renderIdeaCard(idea, { editable: true }));

    const fb = document.createElement('div');
    fb.className = 'feedback';
    fb.innerHTML = `
      <button class="btn" data-fb="like"     aria-pressed="${idea.feedback==='like'}">👍 Like</button>
      <button class="btn" data-fb="dislike"  aria-pressed="${idea.feedback==='dislike'}">👎 Dislike</button>
      <button class="btn" data-fb="unrelated" aria-pressed="${idea.feedback==='unrelated'}">↩ Unrelated</button>
    `;
    fb.addEventListener('click', (e) => {
      const k = e.target.dataset && e.target.dataset.fb;
      if (!k) return;
      this.state.currentIdea.feedback = (this.state.currentIdea.feedback === k) ? null : k;
      this.render();
    });
    sec.append(fb);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML = `
      <button class="btn btn--primary" id="save">💾 Save to library</button>
      <button class="btn" id="regen">🔄 Regenerate</button>
      <button class="btn btn--ghost" id="toLib">Skip → Library</button>
    `;
    sec.append(actions);

    sec.querySelector('#save').addEventListener('click',  () => this._saveCurrent());
    sec.querySelector('#regen').addEventListener('click', () => this._generate());
    sec.querySelector('#toLib').addEventListener('click',  () => { this.state.step = 4; this.render(); });
    return sec;
  }

  _renderIdeaCard(idea, { editable = false } = {}) {
    const card = document.createElement('article');
    card.className = 'idea-card';
    card.innerHTML = `
      <h3 class="idea-card__title">${escape(idea.title)}</h3>
      <div>
        <span class="tag">${escape(idea.field || '')}</span>
        <span class="tag">${escape(idea.sub   || '')}</span>
        ${idea.saved    ? '<span class="tag tag--saved">Saved</span>' : ''}
        ${idea.feedback ? `<span class="tag tag--yours">${escape(idea.feedback)}</span>` : ''}
      </div>
      <div class="idea-card__sec">
        <div class="idea-card__sec-label">Question</div>
        <p class="idea-card__sec-body">${escape(idea.question)}</p>
      </div>
      <div class="idea-card__sec">
        <div class="idea-card__sec-label">Background</div>
        <p class="idea-card__sec-body">${escape(idea.background)}</p>
      </div>
      <div class="idea-card__sec">
        <div class="idea-card__sec-label">Significance</div>
        <p class="idea-card__sec-body">${escape(idea.significance)}</p>
      </div>
      <div class="idea-card__sec">
        <div class="idea-card__sec-label">Pathway</div>
        <p class="idea-card__sec-body">${escape(idea.pathway)}</p>
      </div>
    `;
    if (editable && idea.review) {
      const review = document.createElement('div');
      review.className = 'review';
      for (const dim of DIMS) {
        const row = document.createElement('div');
        row.className = 'review__dim';
        const score = idea.review[dim.key] || 0;
        row.innerHTML = `
          <div class="review__dim-label">${dim.label}</div>
          <div class="review__stars" role="radiogroup" aria-label="${dim.label} score">
            ${[1,2,3,4,5].map((n) => `<button class="review__star ${n<=score?'is-on':''}" data-dim="${dim.key}" data-n="${n}" type="button" role="radio" aria-checked="${n===score}" aria-pressed="${n<=score}">★</button>`).join('')}
          </div>
          <span class="review__dim-score" id="score-${dim.key}">${score}/5</span>
        `;
        review.append(row);
      }
      review.addEventListener('click', (e) => {
        const t = e.target.closest('.review__star');
        if (!t) return;
        const dim = t.dataset.dim;
        const n   = Number(t.dataset.n);
        this.state.currentIdea.review = { ...this.state.currentIdea.review, [dim]: n };
        this.render();
      });
      card.append(review);
    }
    return card;
  }

  _saveCurrent() {
    if (!this.state.currentIdea) return;
    const idea = { ...this.state.currentIdea, saved: true };
    const stored = this.storage.addIdea(idea);
    this.state.history = this.storage.getAllIdeas();
    this.state.currentIdea = stored;
    toast('Saved to library');
    this.state.step = 4; this.render();
  }

  // -- step 4 ---------------------------------------------------------
  _renderStep4() {
    const sec = document.createElement('section');
    sec.className = 'step';
    const showSaved = this.state.savedView === 'saved';
    const list = showSaved
      ? this.state.history.filter((x) => x.saved)
      : this.state.history;
    sec.innerHTML = `
      <h2 class="step__title">Step 4 — Library</h2>
      <p class="step__hint">Saved ideas are persistent in localStorage. History shows everything you've reviewed this session, including unsaved ones.</p>
      <div class="actions">
        <button class="btn" data-view="history" ${showSaved ? '' : 'aria-pressed="true"'}>📜 History (${this.state.history.length})</button>
        <button class="btn" data-view="saved"   ${showSaved ? 'aria-pressed="true"' : ''}>💾 Saved (${this.state.history.filter(x=>x.saved).length})</button>
        <button class="btn btn--primary" id="newIdea">+ New idea</button>
      </div>
      <div id="libList"></div>
    `;
    sec.addEventListener('click', (e) => {
      const v = e.target.dataset && e.target.dataset.view;
      if (v) { this.state.savedView = v; this.render(); }
    });
    sec.querySelector('#newIdea').addEventListener('click', () => {
      this.state.currentIdea = null;
      this.state.prompt = '';
      this.state.step = 1;
      this.render();
    });
    const listEl = sec.querySelector('#libList');
    if (list.length === 0) {
      listEl.innerHTML = `<p class="empty">No ideas yet. Hit “+ New idea” to start.</p>`;
    } else {
      for (const it of list) {
        listEl.append(this._renderLibraryItem(it));
      }
    }
    return sec;
  }

  _renderLibraryItem(it) {
    const item = document.createElement('div');
    item.className = 'idea-card';
    item.innerHTML = `
      <h3 class="idea-card__title">${escape(it.title)}</h3>
      <div>
        <span class="tag">${escape(it.field || '')}</span>
        <span class="tag">${escape(it.sub   || '')}</span>
        ${it.saved    ? '<span class="tag tag--saved">Saved</span>' : ''}
        ${it.feedback ? `<span class="tag tag--yours">${escape(it.feedback)}</span>` : ''}
      </div>
      <p class="idea-card__sec-body" style="margin-top:8px"><strong>Q:</strong> ${escape(it.question)}</p>
    `;
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML = `
      <button class="btn btn--icon" data-act="view">View</button>
      ${it.saved ? '' : '<button class="btn btn--icon" data-act="save">💾 Save</button>'}
      <button class="btn btn--icon" data-act="fork">🔀 Fork (regen from hook)</button>
      <button class="btn btn--icon btn--danger" data-act="del">🗑 Delete</button>
    `;
    actions.addEventListener('click', (e) => {
      const a = e.target.dataset && e.target.dataset.act;
      if (!a) return;
      if (a === 'view')  { this.state.currentIdea = it; this.state.step = 3; this.render(); }
      if (a === 'save')  { this.storage.updateIdea(it.id, { saved: true });  this.state.history = this.storage.getAllIdeas(); this.render(); }
      if (a === 'del')   { this.storage.deleteIdea(it.id);                   this.state.history = this.storage.getAllIdeas(); this.render(); }
      if (a === 'fork')  { this.state.prompt = it.prompt || it.question; this.state.step = 2; this.render(); }
    });
    item.append(actions);
    return item;
  }
}

// -- helpers ---------------------------------------------------------------
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
let _toastTimer = null;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.append(el); }
  el.textContent = msg;
  el.classList.add('is-on');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('is-on'), 1800);
}

// -- bootstrap --------------------------------------------------------------
const app = new IdeaMinerApp();
window.IdeaMiner = app;                  // expose for console / tests
app.mount();
