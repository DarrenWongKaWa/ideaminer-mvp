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
 *       (text, isFinal) => { input.value = text; if (isFinal) save(); },
 *       (err) => console.warn(err)
 *     );
 *   }
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
    if (this._isRecording) {
      this.stop();
    }
    if (!this.isSupported()) {
      onError && onError('unsupported');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last || !last[0]) return;
      const text = last[0].transcript || '';
      const isFinal = !!last.isFinal;
      onResult && onResult(text, isFinal);
    };

    rec.onerror = (e) => {
      this._isRecording = false;
      onError && onError((e && e.error) || 'unknown');
    };

    rec.onend = () => {
      this._isRecording = false;
    };

    try {
      rec.start();
      this.recognition = rec;
      this._isRecording = true;
    } catch (err) {
      this._isRecording = false;
      onError && onError((err && err.message) || 'start-failed');
    }
  }

  stop() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (_) { /* ignore */ }
    }
    this._isRecording = false;
  }

  isRecording() {
    return this._isRecording;
  }
}
