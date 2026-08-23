// Lightweight voice-activity detection used to drive the Discord-style
// "who's talking" ring around a participant's avatar. One tracker per
// audio stream (local mic, or a peer's remote stream); callers poll
// isSpeaking() on an animation frame instead of getting push events, so
// the UI can update just a CSS class without going through a full render.
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let sharedCtx = null;

function getAudioContext() {
  if (!sharedCtx) sharedCtx = new AudioCtx();
  if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

const SPEAKING_THRESHOLD = 14; // 0-255 average frequency amplitude
const RELEASE_MS = 250; // keep the ring on briefly through short pauses

export class SpeakingTracker {
  constructor(stream) {
    this._analyser = null;
    this._data = null;
    this._source = null;
    this._speaking = false;
    this._lastAbove = 0;
    if (!stream || stream.getAudioTracks().length === 0) return;
    try {
      const ctx = getAudioContext();
      this._source = ctx.createMediaStreamSource(stream);
      this._analyser = ctx.createAnalyser();
      this._analyser.fftSize = 512;
      this._analyser.smoothingTimeConstant = 0.6;
      this._source.connect(this._analyser);
      this._data = new Uint8Array(this._analyser.frequencyBinCount);
    } catch {
      this._analyser = null;
    }
  }

  isSpeaking(now = performance.now()) {
    if (!this._analyser) return false;
    this._analyser.getByteFrequencyData(this._data);
    let sum = 0;
    for (let i = 0; i < this._data.length; i++) sum += this._data[i];
    const level = sum / this._data.length;
    if (level > SPEAKING_THRESHOLD) {
      this._lastAbove = now;
      this._speaking = true;
    } else if (now - this._lastAbove > RELEASE_MS) {
      this._speaking = false;
    }
    return this._speaking;
  }

  stop() {
    try { this._source && this._source.disconnect(); } catch { /* already gone */ }
    try { this._analyser && this._analyser.disconnect(); } catch { /* already gone */ }
    this._analyser = null;
  }
}
