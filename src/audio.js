// Procedural ambience: wind, water, distant birds, a soft pad, and portal cues.
// Everything is synthesized, so there are no audio assets to load.

function pinkNoise(ctx, seconds) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

export class Ambience {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.cfg = null;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    const now = ctx.currentTime;
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(0.85, now + 4);
    this.master.connect(ctx.destination);
    this.noise = pinkNoise(ctx, 6);

    // Wind: filtered noise with a slowly wandering cutoff.
    const wind = this.loop();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.lfo(0.05, 260, this.windFilter.frequency);

    // Water: band-passed noise swelling like waves or lapping.
    const water = this.loop(2.5);
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'bandpass';
    this.waterFilter.frequency.value = 520;
    this.waterFilter.Q.value = 0.7;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    this.waterSwell = ctx.createGain();
    this.waterSwell.gain.value = 0.6;
    water.connect(this.waterFilter).connect(this.waterSwell).connect(this.waterGain).connect(this.master);
    this.waterLfo = this.lfo(0.2, 0.4, this.waterSwell.gain);

    // Pad: a quiet, slowly breathing chord.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    this.padGain.connect(padFilter).connect(this.master);
    this.padOsc = [0, 1, 2, 3].map((i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = 220;
      o.detune.value = (i - 1.5) * 4;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      this.lfo(0.03 + i * 0.017, 0.12, g.gain);
      o.connect(g).connect(this.padGain);
      o.start();
      return o;
    });

    // Portal hum: two soft sines, panned toward the nearest portal.
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humPan = ctx.createStereoPanner();
    this.humGain.connect(this.humPan).connect(this.master);
    this.hum = [196, 293.66].map((f) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(this.humGain);
      o.start();
      return o;
    });

    // Wading: a soft swish of water around the legs, in step rhythm.
    const wade = this.loop(4);
    const wadeFilter = ctx.createBiquadFilter();
    wadeFilter.type = 'bandpass';
    wadeFilter.frequency.value = 750;
    wadeFilter.Q.value = 0.9;
    this.wadeGain = ctx.createGain();
    this.wadeGain.gain.value = 0;
    const stride = ctx.createGain();
    stride.gain.value = 0.55;
    wade.connect(wadeFilter).connect(stride).connect(this.wadeGain).connect(this.master);
    this.lfo(1.5, 0.45, stride.gain);
    this.lfo(0.75, 220, wadeFilter.frequency);

    this.scheduleBirds();
    if (this.cfg) this.setBiome(this.cfg);
  }

  loop(offset = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, offset);
    return src;
  }

  lfo(rate, depth, param) {
    const o = this.ctx.createOscillator();
    o.frequency.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
    return o;
  }

  setBiome(cfg) {
    this.cfg = cfg;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(cfg.wind, t, 1.5);
    this.waterGain.gain.setTargetAtTime(cfg.water, t, 1.5);
    this.waterLfo.frequency.setTargetAtTime(cfg.waterRate, t, 1.5);
    this.padGain.gain.setTargetAtTime(0.045, t, 2);
    this.padOsc.forEach((o, i) => o.frequency.setTargetAtTime(cfg.chord[i], t, 1.2));
  }

  scheduleBirds() {
    const next = 1500 + Math.random() * 5000;
    setTimeout(() => {
      if (this.cfg && Math.random() < this.cfg.birds && this.ctx.state === 'running') this.chirp();
      this.scheduleBirds();
    }, next);
  }

  chirp() {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.master);
    const base = 2400 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 3);
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.1), t);
      o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.018, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.14);
      t += 0.12 + Math.random() * 0.1;
    }
  }

  setPortal(proximity, pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(proximity * 0.05, t, 0.3);
    this.humPan.pan.setTargetAtTime(pan, t, 0.2);
  }

  setWade(depth, speed) {
    if (!this.ctx) return;
    const amount = depth > 0 ? (0.3 + 0.7 * depth) * Math.min(speed / 4, 1) : 0;
    this.wadeGain.gain.setTargetAtTime(amount * 0.3, this.ctx.currentTime, 0.15);
  }

  // A soft swell and bell for portal or respawn transitions.
  transition() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.loop(Math.random() * 3);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.6);
    f.frequency.exponentialRampToValueAtTime(400, t + 1.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    src.connect(f).connect(g).connect(this.master);
    src.stop(t + 1.5);
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.value = freq;
      const s = t + 0.35 + i * 0.09;
      og.gain.setValueAtTime(0, s);
      og.gain.linearRampToValueAtTime(0.035, s + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, s + 2.2);
      o.connect(og).connect(this.master);
      o.start(s);
      o.stop(s + 2.3);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (!this.ctx) return this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.2);
    return this.muted;
  }
}
