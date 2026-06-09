/**
 * app.js
 * ------------------------------------------------------------
 * 路由器 + 应用引导。
 *
 * 路由：
 *   #/profile   完善科研画像（form）
 *   #/explore   灵感探索（idea card + 反馈按钮）
 *   #/saved     收藏（已保存的 idea 列表）
 *   #/my        我的（profile + 反馈历史）
 *   #/settings  设置（LLM provider 选择 / API 配置 / 测试）
 *
 * 扩展点：
 *   1. createProvider() 工厂可换 mock / openai
 *   2. LocalStorageProvider 换成 ApiStorageProvider（保持 sync 接口）
 *   3. MockReviewer 换成 LLM-as-judge
 * ------------------------------------------------------------
 */

import { createProvider } from './llm-provider.js';
import { LocalStorageProvider } from './storage.js';
import { IdeaGenerator } from './idea-generator.js';
import { VoiceInput } from './voice.js';

// ---------- LLM provider 配置（持久化） ----------
const PROVIDER_STORAGE_KEY = 'ideaminer.provider.v1';

/**
 * @typedef {Object} ProviderSettings
 * @property {'mock'|'openai'} type
 * @property {string} [endpoint]
 * @property {string} [apiKey]
 * @property {string} [model]
 */

/**
 * 读取并清理 provider 配置（丢掉空字段、默认 model 等）。
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

// ---------- 全局状态 ----------
const state = {
  storage: new LocalStorageProvider(),
  voice: new VoiceInput(),
  llm: null,            // 由 init() 通过 createProvider 构造
  generator: null,      // 由 init() 构造（依赖 llm）
  ready: false,         // init() 完成
  current: null,        // 当前展示的 ReviewedIdea
  currentAbort: null,   // 当前 IdeaGenerator.next() 的 AbortController
};

// ---------- 工具：安全 HTML 字符串转义 ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- 工具：toast ----------
let toastTimer = null;
function toast(msg, kind) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  // 提取 emoji 图标（消息首字符若是 emoji，作为图标单独渲染）
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

// ---------- 工具：剪贴板 ----------
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

// ---------- 渲染：底部 nav（4 个 item：探索 / 收藏 / 我的 / 设置） ----------
function bottomNav(active) {
  return `
    <nav class="bottom-nav" role="navigation" aria-label="主导航">
      <a class="bottom-nav__item ${active === 'explore' ? 'is-active' : ''}" href="#/explore" aria-label="探索">
        <span class="bottom-nav__icon" aria-hidden="true">🧭</span>
        <span class="bottom-nav__label">探索</span>
      </a>
      <a class="bottom-nav__item ${active === 'saved' ? 'is-active' : ''}" href="#/saved" aria-label="收藏">
        <span class="bottom-nav__icon" aria-hidden="true">🗂️</span>
        <span class="bottom-nav__label">收藏</span>
      </a>
      <a class="bottom-nav__item ${active === 'my' ? 'is-active' : ''}" href="#/my" aria-label="我的">
        <span class="bottom-nav__icon" aria-hidden="true">👤</span>
        <span class="bottom-nav__label">我的</span>
      </a>
      <a class="bottom-nav__item ${active === 'settings' ? 'is-active' : ''}" href="#/settings" aria-label="设置">
        <span class="bottom-nav__icon" aria-hidden="true">⚙️</span>
        <span class="bottom-nav__label">设置</span>
      </a>
    </nav>
  `;
}

// ---------- 通用空状态 ----------
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

// ---------- 渲染：完善科研画像 (#/profile) ----------
function renderProfile() {
  const profile = state.storage.getProfile();
  const fieldOptions = [
    '物理学', '化学', '生物学', '计算机科学', '数学',
    '材料科学', '地球科学', '心理学', '经济学', '其他',
  ];
  const ageOptions = ['本科', '硕士', '博士', '博士后', '教授', '其他'];

  const opts = (arr, sel) => arr.map((x) =>
    `<option value="${esc(x)}" ${x === sel ? 'selected' : ''}>${esc(x)}</option>`
  ).join('');

  const placeholder = profile ? '' : 'placeholder="例如：机器学习、量子计算"';
  const val = profile ? esc(profile.direction || '') : '';

  const voiceSupported = state.voice.isSupported();

  return `
    <section class="page page--profile">
      <header class="page__header">
        <h1 class="page__title">完善科研画像</h1>
        <p class="page__subtitle">让我们更懂你的研究方向</p>
      </header>

      <form id="profile-form" class="form" novalidate>
        <label class="form__field">
          <span class="form__label">领域</span>
          <select class="form__input" name="field" required>
            <option value="" disabled ${profile ? '' : 'selected'}>选择您的学科</option>
            ${opts(fieldOptions, profile && profile.field)}
          </select>
        </label>

        <label class="form__field">
          <span class="form__label">具体研究方向</span>
          <div class="form__input-wrap">
            <input class="form__input" name="direction" type="text" ${placeholder} value="${val}" />
            ${voiceSupported ? `
              <button type="button" class="form__mic" data-voice-target="direction" aria-label="语音输入研究方向">
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
          <span class="form__label">研究年龄</span>
          <select class="form__input" name="age" required>
            <option value="" disabled ${profile && profile.age ? '' : 'selected'}>请选择研究年龄</option>
            ${opts(ageOptions, profile && profile.age)}
          </select>
        </label>

        <button type="submit" class="btn btn--primary">继续</button>
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
    if (!profile.field) { toast('⚠️ 请选择学科领域', 'warn'); return; }
    if (!profile.direction) { toast('⚠️ 请填写研究方向', 'warn'); return; }
    if (!profile.age) { toast('⚠️ 请选择研究年龄', 'warn'); return; }

    state.storage.setProfile(profile);
    location.hash = '#/explore';
  });

  // 语音输入按钮
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
            toast('⚠️ 请允许使用麦克风（浏览器设置 → 网站权限）', 'warn');
          } else if (err === 'no-speech') {
            toast('⚠️ 没听到声音，请重试', 'warn');
          } else if (err === 'audio-capture') {
            toast('⚠️ 未找到麦克风设备', 'error');
          } else if (err !== 'aborted') {
            toast('⚠️ 语音输入失败：' + err, 'error');
          }
        }
      );
    });
  });
}

// ---------- 渲染：灵感探索 (#/explore) ----------
function renderExploreSkeleton() {
  return `
    <section class="page page--explore">
      <header class="page__header">
        <h1 class="page__title">灵感探索</h1>
        <p class="page__subtitle">发现感兴趣的科研问题</p>
      </header>
      <div class="card card--loading" aria-busy="true">
        <div class="card__skeleton">
          <span class="skeleton-bar skeleton-bar--lg"></span>
          <span class="skeleton-bar skeleton-bar--md"></span>
          <span class="skeleton-bar skeleton-bar--md"></span>
          <span class="skeleton-bar skeleton-bar--sm"></span>
        </div>
        <p class="card__loading-text">正在为你生成灵感…</p>
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
        <h1 class="page__title">灵感探索</h1>
        <p class="page__subtitle">发现感兴趣的科研问题</p>
      </header>

      <article class="card" data-idea-id="${esc(idea.id)}">
        <h2 class="card__question">${esc(idea.question)}</h2>

        <div class="card__badges" aria-label="评审分数">
          <span class="badge badge--innovation" title="创新">创新 ${review.innovation}</span>
          <span class="badge badge--feasibility" title="可行">可行 ${review.feasibility}</span>
          <span class="badge badge--importance" title="重要">重要 ${review.importance}</span>
        </div>

        <section class="card__section">
          <h3 class="card__section-title">📋 问题背景</h3>
          <p class="card__section-body">${esc(idea.background)}</p>
        </section>

        <section class="card__section">
          <h3 class="card__section-title">💡 问题意义</h3>
          <p class="card__section-body">${esc(idea.significance)}</p>
        </section>

        <section class="card__section">
          <h3 class="card__section-title">🔬 研究方法</h3>
          <ol class="methods">${methods}</ol>
        </section>

        <div class="feedback" role="group" aria-label="反馈">
          <button type="button" class="feedback__btn" data-fb="dislike">👎 不喜欢</button>
          <button type="button" class="feedback__btn" data-fb="unrelated">🚫 不相关</button>
          <button type="button" class="feedback__btn feedback__btn--like" data-fb="like">❤️ 喜欢</button>
          <button type="button" class="feedback__btn" data-fb="copy">📋 复制</button>
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
        <h1 class="page__title">灵感探索</h1>
        <p class="page__subtitle">发现感兴趣的科研问题</p>
      </header>
      ${emptyState(
        '🔭',
        '尚未设置研究画像',
        `请先<a class="link" href="#/profile">完善科研画像</a>，我们会基于你的领域与方向生成灵感。`,
        `<a class="btn btn--primary" href="#/profile">去设置</a>`
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
        copyText(text).then((ok) => toast(ok ? '✅ 已复制' : '❌ 复制失败', ok ? 'success' : 'error'));
        return;
      }
      if (fb === 'like') {
        const idea = state.current;
        if (idea) state.storage.saveIdea(idea);
        state.storage.recordFeedback(ideaId, 'like');
        toast('✅ 已收藏', 'success');
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
  return `问题：${q}\n\n背景：${bg}\n\n意义：${sig}\n\n研究方法：\n${methods}`;
}

async function fetchNext() {
  if (!state.ready || !state.generator) {
    render();
    return;
  }
  // 中断上次请求
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

  // 先渲染 skeleton
  document.getElementById('app').innerHTML = renderExploreSkeleton();

  try {
    const idea = await state.generator.next(profile, ac.signal);
    if (ac.signal.aborted) return;  // 用户已离开本页
    state.current = idea;
    document.getElementById('app').innerHTML = renderExploreIdea(idea);
    bindExploreIdeaEvents();
  } catch (err) {
    if (ac.signal.aborted) return;
    console.error(err);
    const isAbort = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message)));
    const errMsg = isAbort ? '已取消' : (err.message || String(err));
    document.getElementById('app').innerHTML = `
      <section class="page page--explore">
        <header class="page__header">
          <h1 class="page__title">灵感探索</h1>
          <p class="page__subtitle">发现感兴趣的科研问题</p>
        </header>
        ${emptyState(
          '😕',
          '生成灵感时出错',
          esc(errMsg),
          `<button class="btn btn--primary" id="retry">重试</button>`
        )}
        ${bottomNav('explore')}
      </section>
    `;
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', fetchNext);
  }
}

// ---------- 渲染：收藏 (#/saved) ----------
function renderSaved() {
  const list = state.storage.getSavedIdeas();
  if (list.length === 0) {
    return `
      <section class="page page--saved">
        <header class="page__header">
          <h1 class="page__title">收藏</h1>
          <p class="page__subtitle">你保存的灵感</p>
        </header>
        ${emptyState(
          '🗂️',
          '还没有收藏的灵感',
          '在灵感探索页遇到喜欢的选题，点 ❤️ 即可收藏。',
          `<a class="btn btn--primary" href="#/explore">去探索</a>`
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
        ${it.review ? `<span class="badge badge--innovation">创新 ${it.review.innovation}</span>
        <span class="badge badge--feasibility">可行 ${it.review.feasibility}</span>
        <span class="badge badge--importance">重要 ${it.review.importance}</span>` : ''}
        <button type="button" class="btn btn--ghost" data-remove="${esc(it.id)}">删除</button>
      </div>
    </article>
  `).join('');

  return `
    <section class="page page--saved">
      <header class="page__header">
        <h1 class="page__title">收藏</h1>
        <p class="page__subtitle">共 ${list.length} 条</p>
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
      toast('✅ 已删除', 'success');
    });
  });
}

// ---------- 渲染：我的 (#/my) ----------
function renderMy() {
  const profile = state.storage.getProfile();
  const history = state.storage.getFeedbackHistory();
  const summary = { like: 0, dislike: 0, unrelated: 0 };
  history.forEach((f) => { summary[f.type] = (summary[f.type] || 0) + 1; });

  const settings = loadProviderSettings();
  const providerLabel = settings.type === 'openai'
    ? `OpenAI 兼容 · ${esc(settings.model || '?')}`
    : 'Mock（内置 34 条）';

  return `
    <section class="page page--my">
      <header class="page__header">
        <h1 class="page__title">我的</h1>
        <p class="page__subtitle">个人资料与反馈历史</p>
      </header>

      <section class="card card--profile">
        <h2 class="card__section-title">🪪 科研画像</h2>
        ${profile ? `
          <dl class="kv">
            <dt>领域</dt><dd>${esc(profile.field)}</dd>
            <dt>方向</dt><dd>${esc(profile.direction)}</dd>
            <dt>研究年龄</dt><dd>${esc(profile.age)}</dd>
          </dl>
        ` : `
          <p class="empty__body">尚未设置</p>
        `}
        <a class="btn btn--primary" href="#/profile">${profile ? '重新设置画像' : '去设置'}</a>
      </section>

      <section class="card card--history">
        <h2 class="card__section-title">📊 反馈统计</h2>
        <dl class="kv">
          <dt>❤️ 喜欢</dt><dd>${summary.like || 0}</dd>
          <dt>👎 不喜欢</dt><dd>${summary.dislike || 0}</dd>
          <dt>🚫 不相关</dt><dd>${summary.unrelated || 0}</dd>
          <dt>总计</dt><dd>${history.length}</dd>
        </dl>
      </section>

      <section class="card card--provider">
        <h2 class="card__section-title">🤖 当前 LLM</h2>
        <p class="empty__body">${providerLabel}</p>
        <a class="btn btn--ghost" href="#/settings">前往设置</a>
      </section>

      <section class="card card--saved-list">
        <h2 class="card__section-title">🗂️ 收藏夹</h2>
        <p class="empty__body">共 ${state.storage.getSavedIdeas().length} 条 · <a class="link" href="#/saved">查看</a></p>
      </section>

      ${bottomNav('my')}
    </section>
  `;
}

// ---------- 渲染：设置 (#/settings) ----------
function renderSettings() {
  const cfg = loadProviderSettings();
  const type = cfg.type || 'mock';
  const endpoint = cfg.endpoint || 'https://api.openai.com/v1/chat/completions';
  const apiKey = cfg.apiKey || '';
  const model = cfg.model || 'gpt-4o-mini';

  return `
    <section class="page page--settings">
      <header class="page__header">
        <h1 class="page__title">设置</h1>
        <p class="page__subtitle">选择 LLM 提供方</p>
      </header>

      <div class="settings__section">
        <h2 class="settings__section-title">LLM Provider</h2>
        <form id="settings-form" class="settings__group" novalidate>
          <label class="settings__option ${type === 'mock' ? 'is-selected' : ''}" data-option="mock">
            <input type="radio" name="provider" value="mock" ${type === 'mock' ? 'checked' : ''} />
            <div>
              <span class="settings__option-label">Mock（内置 34 条）</span>
              <span class="settings__option-desc">离线可用，无 API key，基于 data/mock-ideas.json。</span>
            </div>
          </label>
          <label class="settings__option ${type === 'openai' ? 'is-selected' : ''}" data-option="openai">
            <input type="radio" name="provider" value="openai" ${type === 'openai' ? 'checked' : ''} />
            <div>
              <span class="settings__option-label">OpenAI 兼容（你的 API）</span>
              <span class="settings__option-desc">支持 OpenAI / DeepSeek / Moonshot / Ollama / LM Studio 等 /v1/chat/completions 端点。</span>
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
            <p class="settings__hint">API Key 仅保存在本机 localStorage，不会上传到任何服务端。</p>
          </div>

          <div class="settings__row">
            <button type="submit" class="btn btn--primary">保存</button>
            <button type="button" class="btn btn--ghost" id="test-connection">测试连接</button>
          </div>
        </form>
      </div>

      <div class="settings__section">
        <h2 class="settings__section-title">关于</h2>
        <p class="empty__body">IdeaMiner MVP · 纯前端 · 数据保存在你的浏览器。</p>
      </div>

      ${bottomNav('settings')}
    </section>
  `;
}

function bindSettingsEvents() {
  const form = document.getElementById('settings-form');
  if (!form) return;

  // 切换 provider 时展开/收起 openai 字段
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

  // 保存
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
      if (!next.endpoint) { toast('⚠️ 请填写 Endpoint URL', 'warn'); return; }
      if (!next.apiKey)   { toast('⚠️ 请填写 API Key', 'warn'); return; }
      if (!next.model)    { toast('⚠️ 请填写 Model', 'warn'); return; }
    }
    saveProviderSettings(next);
    toast('✅ 已保存', 'success');
    // 重新构造 generator（llm 替换）
    await rebuildProvider(next);
  });

  // 测试连接
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
          toast('⚠️ 请先填写完整 OpenAI 配置', 'warn');
          return;
        }
      }
      testBtn.disabled = true;
      const originalLabel = testBtn.textContent;
      testBtn.textContent = '测试中…';
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 35000);
      try {
        const profile = state.storage.getProfile() || { field: '物理学', direction: '量子几何', age: '博士' };
        const provider = await createProvider(cfg);
        const draft = await provider.generateIdea(profile, ac.signal);
        clearTimeout(timer);
        toast(`✅ 连接成功：${esc(draft.question.slice(0, 18))}…`, 'success');
      } catch (err) {
        clearTimeout(timer);
        const msg = (err && err.message) || String(err);
        if (err && (err.name === 'AbortError' || /aborted/i.test(msg))) {
          toast('⚠️ 测试超时已取消', 'warn');
        } else {
          toast('❌ 连接失败：' + esc(msg.slice(0, 80)), 'error');
        }
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = originalLabel;
      }
    });
  }
}

// ---------- 重建 provider（设置保存 / 启动时） ----------
async function rebuildProvider(cfg) {
  try {
    const provider = await createProvider(cfg);
    state.llm = provider;
    state.generator = new IdeaGenerator(state.llm, undefined, state.storage);
  } catch (err) {
    console.error('rebuildProvider failed:', err);
    toast('❌ ' + (err.message || 'provider 初始化失败'), 'error');
  }
}

// ---------- 应用初始化 ----------
async function init() {
  const cfg = loadProviderSettings();
  await rebuildProvider(cfg);
  state.ready = true;
}

// ---------- 路由器 ----------
function render() {
  // 中断进行中的请求
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
      // 等 init 完成再 fetch
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
                  <h1 class="page__title">灵感探索</h1>
                  <p class="page__subtitle">发现感兴趣的科研问题</p>
                </header>
                ${emptyState('😕', '生成灵感时出错', esc(err.message || String(err)))}
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
                <h1 class="page__title">灵感探索</h1>
                <p class="page__subtitle">发现感兴趣的科研问题</p>
              </header>
              ${emptyState('😕', '生成灵感时出错', esc(err.message || String(err)))}
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

// ---------- 启动 ----------
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  // 启动初始化（异步构造 provider）
  init();

  // 如果用户没有 profile 也没有 hash，引导到 profile 页
  if (!state.storage.getProfile() && !(location.hash && location.hash.length > 1)) {
    location.hash = '#/profile';
  } else if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = '#/profile';
  }
  render();
});