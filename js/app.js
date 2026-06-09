/**
 * app.js
 * ------------------------------------------------------------
 * 路由器 + 应用引导。
 *
 * 路由：
 *   #/profile  完善科研画像（form）
 *   #/explore  灵感探索（idea card + 反馈按钮）
 *   #/saved    收藏（已保存的 idea 列表）
 *   #/my       我的（profile + 反馈历史）
 *
 * 扩展点（按 README 提示即可替换）：
 *   1. 把 MockLLMProvider 换成 OpenAILLMProvider（保持 .generateIdea 签名）
 *   2. 把 LocalStorageProvider 换成 ApiStorageProvider（保持 sync 接口）
 *   3. 把 MockReviewer 换成 LLM-as-judge
 * ------------------------------------------------------------
 */

import { MockLLMProvider } from './llm-provider.js';
import { LocalStorageProvider } from './storage.js';
import { IdeaGenerator } from './idea-generator.js';
import { VoiceInput } from './voice.js';

// ---------- 全局状态 ----------
const state = {
  llm: new MockLLMProvider('data/mock-ideas.json'),
  storage: new LocalStorageProvider(),
  generator: null,        // 初始化完成后赋值
  voice: new VoiceInput(),
  current: null,          // 当前展示的 ReviewedIdea
  currentAbort: null,     // 当前 IdeaGenerator.next() 的 AbortController
};

state.generator = new IdeaGenerator(state.llm, undefined, state.storage);

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
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('toast--show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('toast--show'), 1600);
}

// ---------- 工具：剪贴板 ----------
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through */ }
  // fallback：临时 textarea + execCommand
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

// ---------- 渲染：底部 nav ----------
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
    </nav>
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
    if (!profile.field) { toast('请选择学科领域'); return; }
    if (!profile.direction) { toast('请填写研究方向'); return; }
    if (!profile.age) { toast('请选择研究年龄'); return; }

    state.storage.setProfile(profile);
    location.hash = '#/explore';
  });

  // 语音输入按钮
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
        (text, isFinal) => {
          input.value = text;
          if (isFinal) {
            btn.classList.remove('is-recording');
            state.voice._currentTarget = null;
          }
        },
        (err) => {
          btn.classList.remove('is-recording');
          state.voice._currentTarget = null;
          if (err === 'not-allowed' || err === 'service-not-allowed') {
            toast('请允许使用麦克风权限');
          } else if (err === 'no-speech') {
            toast('没有检测到语音');
          } else if (err !== 'aborted') {
            toast('语音输入失败：' + err);
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
      <div class="card card--loading">
        <div class="spinner" aria-label="加载中"></div>
        <p class="card__loading-text">正在为你生成灵感…</p>
      </div>
      ${bottomNav('explore')}
    </section>
  `;
}

function renderExploreIdea(idea) {
  const review = idea.review || { innovation: 0, feasibility: 0, importance: 0 };
  const methods = (idea.methods || []).map((m, i) =>
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
      <div class="empty">
        <p>请先 <a class="link" href="#/profile">完善科研画像</a>。</p>
        <p class="empty__sub">已设置：${esc(profile.field)} · ${esc(profile.direction)} · ${esc(profile.age)}</p>
      </div>
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
        copyText(text).then((ok) => toast(ok ? '已复制' : '复制失败'));
        return;
      }
      if (fb === 'like') {
        const idea = state.current;
        if (idea) state.storage.saveIdea(idea);
        state.storage.recordFeedback(ideaId, 'like');
        toast('已收藏');
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
    document.getElementById('app').innerHTML = `
      <section class="page page--explore">
        <header class="page__header">
          <h1 class="page__title">灵感探索</h1>
          <p class="page__subtitle">发现感兴趣的科研问题</p>
        </header>
        <div class="empty">
          <p>生成灵感时出错了：${esc(err.message || String(err))}</p>
          <button class="btn btn--primary" id="retry">重试</button>
        </div>
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
        <div class="empty">
          <p>还没有收藏的灵感</p>
          <a class="link" href="#/explore">去探索</a>
        </div>
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
      toast('已删除');
    });
  });
}

// ---------- 渲染：我的 (#/my) ----------
function renderMy() {
  const profile = state.storage.getProfile();
  const history = state.storage.getFeedbackHistory();
  const summary = { like: 0, dislike: 0, unrelated: 0 };
  history.forEach((f) => { summary[f.type] = (summary[f.type] || 0) + 1; });

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
          <p class="empty">尚未设置</p>
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

      <section class="card card--saved-list">
        <h2 class="card__section-title">🗂️ 收藏夹</h2>
        <p>共 ${state.storage.getSavedIdeas().length} 条 · <a class="link" href="#/saved">查看</a></p>
      </section>

      ${bottomNav('my')}
    </section>
  `;
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
      // 自动跳到 profile（首次进入）
      // 不强制跳转，避免打断老用户
    } else {
      app.innerHTML = renderExploreSkeleton();
      // 异步加载
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
              <div class="empty">
                <p>生成灵感时出错了：${esc(err.message || String(err))}</p>
              </div>
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
  } else {
    app.innerHTML = renderProfile();
    bindProfileEvents();
  }
}

// ---------- 启动 ----------
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  // 如果用户没有 profile 也没有 hash，引导到 profile 页
  if (!state.storage.getProfile() && !(location.hash && location.hash.length > 1)) {
    location.hash = '#/profile';
  } else if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = '#/profile';
  }
  render();
});
