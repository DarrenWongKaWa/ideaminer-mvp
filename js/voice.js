/**
 * voice.js
 * ------------------------------------------------------------
 * Web Speech API 语音输入助手。
 *
 * 浏览器支持：
 *  - Chrome / Edge：window.webkitSpeechRecognition
 *  - Safari 14.1+：window.SpeechRecognition
 *  - Firefox：不支持（isSupported() 返回 false）
 *
 * 用法：
 *   const v = new VoiceInput();
 *   if (v.isSupported()) {
 *     v.start(
 *       (text, isFinal) => {
 *         // isFinal=false 是 interim 结果（实时填充）
 *         // isFinal=true  表示这句结束，UI 可以做收尾
 *         input.value = text;
 *       },
 *       (err) => {
 *         // err ∈ 'not-allowed' | 'service-not-allowed' | 'no-speech'
 *         //     | 'audio-capture' | 'network' | 'aborted' | 'unsupported' | ...
 *       }
 *     );
 *   }
 *
 * UI 配合（CSS 已有，HTML 由 app.js 渲染）：
 *   - mic 按钮加 .is-recording → 红色脉冲背景
 *   - .voice-dots 显示/隐藏 5 个动画小点
 *   - toast() 显示错误（已在 app.js 中处理）
 * ------------------------------------------------------------
 */

export class VoiceInput {
  constructor() {
    this.recognition = null;
    this._onResult = null;
    this._onError = null;
    this._isRecording = false;
  }

  isSupported() {
    return typeof window !== 'undefined'
      && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  }

  /**
   * @param {(text: string, isFinal: boolean) => void} onResult
   * @param {(error: string) => void} onError
   */
  start(onResult, onError) {
    // 若已在录音，先平稳结束旧的
    if (this._isRecording) {
      this._hardStop();
    }
    if (!this.isSupported()) {
      onError && onError('unsupported');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec;
    try {
      rec = new SR();
    } catch (err) {
      onError && onError((err && err.message) || 'init-failed');
      return;
    }
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last || !last[0]) return;
      const text = last[0].transcript || '';
      const isFinal = !!last.isFinal;
      if (this._onResult) this._onResult(text, isFinal);
    };

    rec.onerror = (e) => {
      const code = (e && e.error) || 'unknown';
      // 'aborted' 是用户主动取消，不算错误
      if (code !== 'aborted') {
        if (this._onError) this._onError(code);
      }
      this._cleanup();
    };

    rec.onend = () => {
      // 正常结束（用户说完、或者超时）：清理本地状态
      // 注意：onerror 先触发时，_cleanup() 已经把 _isRecording 置 false
      this._cleanup();
    };

    try {
      rec.start();
      this.recognition = rec;
      this._onResult = onResult || null;
      this._onError = onError || null;
      this._isRecording = true;
    } catch (err) {
      this._cleanup();
      onError && onError((err && err.message) || 'start-failed');
    }
  }

  /**
   * 用户主动停止（异步：recognition.stop() 之后会触发 onend）。
   * 状态同步置 false 以便 UI 立即恢复。
   */
  stop() {
    if (this.recognition) {
      try { this.recognition.stop(); } catch (_) { /* ignore */ }
    }
    this._isRecording = false;
  }

  /**
   * 内部强制停止（用于 start() 内重新发起时，避免与上次 recognition 冲突）。
   */
  _hardStop() {
    if (this.recognition) {
      try { this.recognition.abort && this.recognition.abort(); } catch (_) { /* ignore */ }
      try { this.recognition.stop(); } catch (_) { /* ignore */ }
    }
    this._cleanup();
  }

  _cleanup() {
    this.recognition = null;
    this._isRecording = false;
    this._onResult = null;
    this._onError = null;
  }

  isRecording() {
    return this._isRecording;
  }
}