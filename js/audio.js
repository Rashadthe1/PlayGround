// Tiny procedural audio engine (WebAudio, no assets).
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.ambient = null;
    this.stage = 'creature';
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise(2);
    this.startAmbient();
  }

  makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  startAmbient() {
    if (!this.ctx) return;
    this.stopAmbient();
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    g.connect(this.master);
    // wind: filtered noise
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    src.connect(filter);
    filter.connect(g);
    src.start();
    lfo.start();
    // drone
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 58;
    const og = this.ctx.createGain();
    og.gain.value = 0.018;
    osc.connect(og);
    og.connect(this.master);
    osc.start();
    this.ambient = { src, lfo, osc, g, filter };
  }

  stopAmbient() {
    if (!this.ambient) return;
    try { this.ambient.src.stop(); this.ambient.lfo.stop(); this.ambient.osc.stop(); } catch {}
    this.ambient = null;
  }

  setStage(stage) {
    this.stage = stage;
    if (this.ambient) {
      this.ambient.filter.frequency.value = stage === 'cell' ? 220 : 420;
      this.ambient.g.frequency = 0;
    }
  }

  setMuted(v) {
    this.muted = v;
    if (this.master) this.master.gain.value = v ? 0 : 0.55;
  }

  tone(freq, dur, type = 'sine', gain = 0.2, slides = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slides) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slides), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  noise(dur, freq = 1000, gain = 0.2, type = 'bandpass') {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'step': this.noise(0.09, 220, 0.09); break;
      case 'stepBig': this.noise(0.16, 120, 0.18); this.tone(55, 0.14, 'sine', 0.12, -15); break;
      case 'eat': this.noise(0.18, 600, 0.12); this.tone(220, 0.1, 'triangle', 0.08, 40); break;
      case 'bite': this.noise(0.12, 1500, 0.18); this.tone(140, 0.12, 'square', 0.08, -60); break;
      case 'roar': this.tone(110, 0.7, 'sawtooth', 0.16, -60); this.tone(74, 0.8, 'square', 0.08, -30); this.noise(0.6, 300, 0.08); break;
      case 'hit': this.noise(0.1, 900, 0.22); this.tone(90, 0.15, 'triangle', 0.1, -40); break;
      case 'hurt': this.tone(180, 0.3, 'sawtooth', 0.12, -90); this.noise(0.2, 500, 0.1); break;
      case 'drink': this.tone(300, 0.12, 'sine', 0.08, 120); this.noise(0.2, 1200, 0.04); break;
      case 'ui': this.tone(660, 0.06, 'sine', 0.05, 40); break;
      case 'open': this.tone(330, 0.08, 'triangle', 0.06, 110); break;
      case 'evolve': [0, 0.12, 0.24, 0.42].forEach((d, i) => setTimeout(() => this.tone([330, 440, 554, 660][i], 0.5, 'sine', 0.12, 20), d * 1000)); break;
      case 'death': this.tone(180, 1.3, 'sawtooth', 0.16, -140); this.tone(90, 1.5, 'sine', 0.14, -60); break;
      case 'spawn': this.tone(520, 0.22, 'sine', 0.06, 220); break;
      case 'era': [0, 0.18, 0.36].forEach((d, i) => setTimeout(() => this.tone([196, 262, 392][i], 1.4, 'sine', 0.1, 5), d * 1000)); break;
      case 'click': this.tone(880, 0.04, 'square', 0.03, -120); break;
      case 'cellEat': this.tone(420, 0.12, 'sine', 0.08, 180); break;
      default: break;
    }
  }
}
