/**
 * voice.js
 * ------------------------------------------------------------
 * Web Speech API voice input helper.
 *
 * Browser support:
 *  - Chrome / Edge：window.webkitSpeechRecognition
 *  - Safari 14.1+：window.SpeechRecognition
 *  - Firefox: not supported (isSupported() returns false)
 *
 * Usage:
 *   const v = new VoiceInput();
 *   if (v.isSupported()) {
 *     v.start(
 *       (text, isFinal) => {
 *         // isFinal=false is the interim result (live fill)
 *         // isFinal=true means the utterance is final; UI can wrap up
 *         input.value = text;
 *       },
 *       (err) => {
 *         // err ∈ 'not-allowed' | 'service-not-allowed' | 'no-speech'
 *         //     | 'audio-capture' | 'network' | 'aborted' | 'unsupported' | ...
 *       }
 *     );
 *   }
 *
 * UI integration (CSS is in place, HTML is rendered by app.js):
 *   - mic button adds .is-recording -> red pulse background
 *   - .voice-dots shows/hides 5 animated dots
 *   - toast() shows errors (handled in app.js)
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
    // If already recording, gracefully end the previous one first
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
      // 'aborted' is a user-initiated cancel, not an error
      if (code !== 'aborted') {
        if (this._onError) this._onError(code);
      }
      this._cleanup();
    };

    rec.onend = () => {
      // Normal end (utterance finished, or timeout): clean up local state
      // Note: when onerror fires first, _cleanup() has already set _isRecording to false
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
   * User-initiated stop (async: recognition.stop() will fire onend after).
   * State synchronously set to false so the UI can recover immediately.
   */
  stop() {
    if (this.recognition) {
      try { this.recognition.stop(); } catch (_) { /* ignore */ }
    }
    this._isRecording = false;
  }

  /**
   * Internal forced stop (used when start() re-issues, to avoid clashing with the previous recognition).
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