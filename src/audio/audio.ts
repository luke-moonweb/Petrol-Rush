import { type EngineStyle, type EngineVoice, loadEngineStyle, makeEngine, saveEngineStyle } from './engines';

export type UiSound = 'move' | 'ok' | 'back' | 'error';

export interface RivalSound {
  mph: number;
  pan: number;
  vol: number;
  doppler: number;
  pitch: number;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private engine: EngineVoice | null = null;
  private rivals: EngineVoice[] = [];
  private preview: EngineVoice | null = null;
  private previewTimer = 0;
  engineStyle: EngineStyle = loadEngineStyle();
  private packGain: GainNode | null = null;
  private packFilter: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;
  private scrapeGain: GainNode | null = null;
  private scrapeFilter: BiquadFilterNode | null = null;
  private refuelGain: GainNode | null = null;
  muted = false;
  private speechPrimed = false;

  unlock(): void {
    this.primeSpeech();
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.buildEngines();

    this.packFilter = ctx.createBiquadFilter();
    this.packFilter.type = 'bandpass';
    this.packFilter.frequency.value = 220;
    this.packFilter.Q.value = 0.9;
    this.packGain = ctx.createGain();
    this.packGain.gain.value = 0;
    this.loopNoise().connect(this.packFilter);
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 96;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.25;
    hum.connect(humGain);
    humGain.connect(this.packFilter);
    hum.start();
    this.packFilter.connect(this.packGain);
    this.packGain.connect(this.master);

    this.screechFilter = ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.value = 2600;
    this.screechFilter.Q.value = 9;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain);
    lfoGain.connect(this.screechFilter.frequency);
    lfo.start();
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    this.loopNoise().connect(this.screechFilter);
    this.screechFilter.connect(this.screechGain);
    this.screechGain.connect(this.master);

    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'bandpass';
    this.scrapeFilter.frequency.value = 1400;
    this.scrapeFilter.Q.value = 1.4;
    const grit = ctx.createOscillator();
    grit.type = 'square';
    grit.frequency.value = 31;
    const gritGain = ctx.createGain();
    gritGain.gain.value = 500;
    grit.connect(gritGain);
    gritGain.connect(this.scrapeFilter.frequency);
    grit.start();
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.loopNoise().connect(this.scrapeFilter);
    this.scrapeFilter.connect(this.scrapeGain);
    this.scrapeGain.connect(this.master);

    const fuelFilter = ctx.createBiquadFilter();
    fuelFilter.type = 'lowpass';
    fuelFilter.frequency.value = 380;
    const glug = ctx.createOscillator();
    glug.frequency.value = 9;
    const glugGain = ctx.createGain();
    glugGain.gain.value = 160;
    glug.connect(glugGain);
    glugGain.connect(fuelFilter.frequency);
    glug.start();
    this.refuelGain = ctx.createGain();
    this.refuelGain.gain.value = 0;
    this.loopNoise().connect(fuelFilter);
    fuelFilter.connect(this.refuelGain);
    this.refuelGain.connect(this.master);
  }

  private buildEngines(): void {
    const ctx = this.ctx!;
    this.engine?.dispose();
    for (const r of this.rivals) r.dispose();
    this.engine = makeEngine(this.engineStyle, ctx, this.master!, this.noise!, 0);
    this.rivals = [1, 2, 3].map((v) => makeEngine(this.engineStyle, ctx, this.master!, this.noise!, v));
  }

  setEngineStyle(style: EngineStyle): void {
    this.engineStyle = style;
    saveEngineStyle(style);
    if (!this.ctx) return;
    this.buildEngines();
    this.playPreview();
  }

  playPreview(): void {
    if (!this.ctx || !this.master || !this.noise) return;
    this.preview?.dispose();
    window.clearInterval(this.previewTimer);
    const voice = makeEngine(this.engineStyle, this.ctx, this.master, this.noise, 0);
    this.preview = voice;
    const t0 = performance.now();
    this.previewTimer = window.setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      const mph = t < 1.8 ? 180 * Math.min(1, t / 1.8) ** 0.8 : 180 - (t - 1.8) * 90;
      const vol = t < 2.4 ? 0.13 : Math.max(0, 0.13 - (t - 2.4) * 0.3);
      voice.set(mph, vol, t < 1.8);
      if (t > 2.9) {
        window.clearInterval(this.previewTimer);
        voice.dispose();
        if (this.preview === voice) this.preview = null;
      }
    }, 40);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  // iOS Safari only lets speech start from a user gesture; once one utterance has played there,
  // later ones from the game loop work too.
  private primeSpeech(): void {
    const synth = window.speechSynthesis;
    if (this.speechPrimed || !synth || typeof SpeechSynthesisUtterance === 'undefined' || synth.speaking) return;
    if (synth.pending) synth.cancel();
    const u = new SpeechSynthesisUtterance('radio');
    u.volume = 0;
    u.onstart = u.onend = () => {
      this.speechPrimed = true;
    };
    synth.speak(u);
  }

  radio(text: string): void {
    if (!this.ctx || this.muted) return;
    this.squelch();
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    // Chrome on Android can drop an utterance queued right after an unneeded cancel().
    if (synth.speaking || synth.pending) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.12;
    u.pitch = 0.8;
    u.volume = 0.95;
    const voices = synth.getVoices().filter((v) => v.lang.startsWith('en'));
    u.voice = voices.find((v) => /Daniel|Fred|Alex|UK English Male|Male/i.test(v.name)) ?? voices[0] ?? null;
    u.onend = () => this.squelch();
    synth.speak(u);
  }

  private squelch(): void {
    const out = this.out(0.5, 0);
    if (!out || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(out, t, 0.14, 'bandpass', 2200, 1.2, 0.35, 1400);
    this.tone(out, t, 0.05, 'square', 1800, 1600, 0.06);
  }

  private stopSpeech(): void {
    const synth = window.speechSynthesis;
    if (synth?.speaking || synth?.pending) synth.cancel();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.muted) this.stopSpeech();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
  }

  setEngine(mph: number, active: boolean, throttle = false): void {
    if (!this.engine) return;
    const v = Math.min(1, Math.abs(mph) / 180);
    this.engine.set(mph, active ? 0.07 + v * 0.05 + (throttle ? 0.03 : 0) : 0, throttle);
  }

  setRivals(list: RivalSound[]): void {
    this.rivals.forEach((voice, i) => {
      const r = list[i];
      if (!r) voice.set(0, 0, false);
      else voice.set(r.mph, Math.max(0, Math.min(1, r.vol)) * 0.06, false, r.pan, r.pitch, r.doppler);
    });
  }

  setPack(level: number): void {
    if (!this.ctx || !this.packGain || !this.packFilter) return;
    const t = this.ctx.currentTime;
    this.packGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.04, t, 0.25);
    this.packFilter.frequency.setTargetAtTime(180 + level * 160, t, 0.25);
  }

  setScreech(level: number | boolean): void {
    if (!this.ctx || !this.screechGain) return;
    const l = typeof level === 'boolean' ? (level ? 1 : 0) : level;
    this.screechGain.gain.setTargetAtTime(Math.max(0, Math.min(1, l)) * 0.14, this.ctx.currentTime, 0.04);
  }

  setScrape(level: number): void {
    if (!this.ctx || !this.scrapeGain || !this.scrapeFilter) return;
    const t = this.ctx.currentTime;
    const l = Math.max(0, Math.min(1, level));
    this.scrapeGain.gain.setTargetAtTime(l * 0.2, t, l > 0 ? 0.015 : 0.06);
    this.scrapeFilter.frequency.setTargetAtTime(1100 + l * 900, t, 0.05);
  }

  setRefuel(on: boolean): void {
    if (!this.ctx || !this.refuelGain) return;
    this.refuelGain.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 0.08);
  }

  private out(vol: number, pan: number): GainNode | null {
    if (!this.ctx || !this.master || vol <= 0.01) return null;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(this.master);
    return g;
  }

  private burst(
    dest: AudioNode,
    at: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    peak: number,
    freqEnd?: number,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(at, Math.random() * 1.5, dur + 0.05);
  }

  private tone(dest: AudioNode, at: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  wallHit(strength: number, pan = 0, vol = 1): void {
    const k = Math.min(1, strength / 40);
    const d = this.out(vol * (0.35 + 0.65 * k), pan);
    if (!d) return;
    const t = this.ctx!.currentTime;
    this.tone(d, t, 0.22, 'sine', 95, 38, 0.6);
    this.burst(d, t, 0.18, 'lowpass', 900, 0.7, 0.5);
    for (const f of [430, 655, 980]) this.tone(d, t + 0.005, 0.25 + k * 0.2, 'triangle', f, f * 0.97, 0.08 + 0.06 * k);
  }

  carBump(strength: number, pan = 0, vol = 1): void {
    const k = Math.min(1, strength / 30);
    const d = this.out(vol * (0.3 + 0.7 * k), pan);
    if (!d) return;
    const t = this.ctx!.currentTime;
    this.tone(d, t, 0.12, 'square', 210, 90, 0.18);
    this.burst(d, t, 0.07, 'bandpass', 1300, 2, 0.45);
    this.tone(d, t + 0.06, 0.1, 'square', 170, 80, 0.1);
    this.burst(d, t + 0.06, 0.05, 'bandpass', 1700, 2, 0.25);
  }

  crash(strength: number, pan = 0, vol = 1): void {
    const k = Math.min(1, strength / 60);
    const d = this.out(vol * (0.6 + 0.4 * k), pan);
    if (!d) return;
    const t = this.ctx!.currentTime;
    this.tone(d, t, 0.45, 'sine', 70, 28, 0.9);
    this.burst(d, t, 0.6, 'lowpass', 2200, 0.8, 0.8, 250);
    for (let i = 0; i < 6; i++) {
      const at = t + 0.02 + Math.random() * 0.25;
      const f = 300 + Math.random() * 900;
      this.tone(d, at, 0.12, 'sawtooth', f, f * 0.6, 0.06);
    }
    for (let i = 0; i < 10; i++) this.burst(d, t + 0.08 + Math.random() * 0.45, 0.05, 'highpass', 5000 + Math.random() * 3000, 1, 0.12);
  }

  private beep(f: number, dur: number, vol: number, type: OscillatorType = 'square', delay = 0): void {
    const d = this.out(vol, 0);
    if (!d) return;
    const t = this.ctx!.currentTime + delay;
    this.tone(d, t, dur, type, f, f, 0.5);
  }

  lightOn(): void {
    this.beep(440, 0.18, 0.25);
  }

  lightsOut(): void {
    this.beep(880, 0.45, 0.3);
  }

  lapChime(): void {
    this.beep(660, 0.12, 0.18, 'triangle');
    this.beep(990, 0.18, 0.18, 'triangle', 0.1);
  }

  finishFanfare(): void {
    [523, 659, 784, 1047].forEach((f, i) => {
      this.beep(f, i === 3 ? 0.5 : 0.14, 0.22, 'square', i * 0.13);
    });
  }

  lowFuel(): void {
    for (let i = 0; i < 3; i++) this.beep(1200, 0.08, 0.15, 'square', i * 0.16);
  }

  /** The hiss of a tape losing its tracking under a camera switch: `dur` s long, loudest at `peakAt`, with the buzz of the lost sync. */
  tapeStatic(dur: number, peakAt: number): void {
    const d = this.out(0.5, 0);
    if (!d) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2600;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.015);
    g.gain.linearRampToValueAtTime(0.5, t + peakAt);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(d);
    src.start(t, Math.random() * 1.5, dur + 0.05);
    this.tone(d, t, dur * 0.5, 'sawtooth', 60, 60, 0.12);
  }

  ui(kind: UiSound): void {
    switch (kind) {
      case 'move':
        this.beep(720, 0.04, 0.12, 'square');
        break;
      case 'ok':
        this.beep(660, 0.06, 0.15, 'square');
        this.beep(990, 0.09, 0.15, 'square', 0.06);
        break;
      case 'back':
        this.beep(520, 0.06, 0.13, 'square');
        this.beep(390, 0.08, 0.13, 'square', 0.06);
        break;
      case 'error':
        this.beep(160, 0.18, 0.18, 'sawtooth');
        break;
    }
  }

  suspend(): void {
    this.silence();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  silence(): void {
    this.stopSpeech();
    this.setEngine(0, false);
    this.setRivals([]);
    this.setScreech(0);
    this.setScrape(0);
    this.setPack(0);
    this.setRefuel(false);
  }
}
