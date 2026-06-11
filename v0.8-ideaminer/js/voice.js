/**
 * voice.js
 * ------------------------------------------------------------
 * IdeaMiner v0.8 — Web Speech API input wrapper.
 *
 * Browser support: Chrome / Edge / Safari (limited). Falls back to text input
 * gracefully if the API is missing or denied.
 *
 * Usage:
 *   const mic = new VoiceInput();
 *   const ok  = await mic.start();          // ask permission, start listening
 *   mic.onResult = (transcript, isFinal) => ...;
 *   await mic.stop();                        // commit final transcript
 */

export class VoiceInput {
  constructor(opts = {}) {
    this.lang = opts.lang || 'en-US';
    this.continuous = opts.continuous ?? false;
    this.interimResults = opts.interimResults ?? true;
    this.recognition = null;
    this.listening = false;
    this.onResult = opts.onResult || (() => {});
    this.onError  = opts.onError  || (() => {});
    this.onEnd    = opts.onEnd    || (() => {});
    this._transcript = '';
  }

  /** Is the Web Speech API available in this browser? */
  static isAvailable() {
    return typeof window !== 'undefined' &&
      (Boolean(window.SpeechRecognition) || Boolean(window.webkitSpeechRecognition));
  }

  /** Request permission and start listening. Returns true on success. */
  async start() {
    if (this.listening) return true;
    if (!VoiceInput.isAvailable()) {
      this.onError(new Error('Web Speech API not available in this browser.'));
      return false;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new Ctor();
    this.recognition.lang = this.lang;
    this.recognition.continuous = this.continuous;
    this.recognition.interimResults = this.interimResults;

    this.recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else          interim += r[0].transcript;
      }
      this._transcript = (this._transcript + final + interim).trim();
      this.onResult(this._transcript, final !== '');
    };
    this.recognition.onerror = (e) => {
      this.listening = false;
      this.onError(new Error(`Speech recognition error: ${e.error || 'unknown'}`));
    };
    this.recognition.onend = () => {
      this.listening = false;
      this.onEnd(this._transcript);
    };
    try {
      this.recognition.start();
      this.listening = true;
      this._transcript = '';
      return true;
    } catch (e) {
      this.onError(e);
      return false;
    }
  }

  /** Stop listening; resolves with the final transcript. */
  async stop() {
    if (!this.listening || !this.recognition) return this._transcript;
    return new Promise((resolve) => {
      const prevEnd = this.recognition.onend;
      this.recognition.onend = (e) => {
        if (prevEnd) prevEnd(e);
        resolve(this._transcript);
      };
      try { this.recognition.stop(); } catch { /* already stopped */ }
    });
  }
}
