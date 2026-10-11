export type EngineStyle = 'v8' | 'turbine' | 'chip' | 'rc';

export const ENGINE_STYLES: { id: EngineStyle; label: string }[] = [
  { id: 'v8', label: 'V8 MUSCLE' },
  { id: 'turbine', label: 'JET TURBINE' },
  { id: 'chip', label: '8-BIT ARCADE' },
  { id: 'rc', label: 'RC TOY' },
];

export interface EngineVoice {
  set(mph: number, vol: number, bright: boolean, pan?: number, pitch?: number, doppler?: number): void;
  dispose(): void;
}

function disposeVoice(ctx: AudioContext, gain: GainNode, nodes: AudioScheduledSourceNode[]): void {
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setTargetAtTime(0, t, 0.03);
  for (const n of nodes) n.stop(t + 0.2);
  setTimeout(() => gain.disconnect(), 300);
}

function panner(ctx: AudioContext, gain: GainNode, dest: AudioNode): StereoPannerNode {
  const p = ctx.createStereoPanner();
  gain.connect(p);
  p.connect(dest);
  return p;
}

const clampPan = (p: number) => Math.max(-1, Math.min(1, p));

class V8Engine implements EngineVoice {
  private readonly saw1: OscillatorNode;
  private readonly saw2: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly lump: OscillatorNode;
  private readonly lumpDepth: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly nodes: OscillatorNode[];

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    private readonly variant: number,
  ) {
    this.saw1 = ctx.createOscillator();
    this.saw1.type = 'sawtooth';
    this.saw2 = ctx.createOscillator();
    this.saw2.type = 'sawtooth';
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    this.lump = ctx.createOscillator();
    this.lump.type = 'triangle';
    this.lumpDepth = ctx.createGain();
    const body = ctx.createGain();
    body.gain.value = 0.7;
    this.lump.connect(this.lumpDepth);
    this.lumpDepth.connect(body.gain);
    const subGain = ctx.createGain();
    subGain.gain.value = 0.6;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    shaper.curve = curve;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 2.2;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.saw1.connect(body);
    this.saw2.connect(body);
    this.sub.connect(subGain);
    subGain.connect(body);
    body.connect(shaper);
    shaper.connect(this.tone);
    this.tone.connect(this.gain);
    this.pan = panner(ctx, this.gain, dest);
    this.nodes = [this.saw1, this.saw2, this.sub, this.lump];
    for (const n of this.nodes) n.start();
  }

  set(mph: number, vol: number, bright: boolean, pan = 0, pitch = 1, doppler = 1): void {
    const t = this.ctx.currentTime;
    const v = Math.min(1, Math.abs(mph) / 180);
    const edges = [0, 0.25, 0.47, 0.72, 1];
    let g = 0;
    while (g < 3 && v > edges[g + 1]!) g++;
    const frac = (v - edges[g]!) / (edges[g + 1]! - edges[g]!);
    const rpm = Math.abs(mph) < 1 ? 0.18 : 0.3 + 0.7 * frac;
    const f = (34 + 92 * rpm) * pitch * doppler * (1 + this.variant * 0.03);
    this.saw1.frequency.setTargetAtTime(f, t, 0.04);
    this.saw2.frequency.setTargetAtTime(f * 1.012, t, 0.04);
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.04);
    this.lump.frequency.setTargetAtTime(f / 4, t, 0.04);
    this.lumpDepth.gain.setTargetAtTime(0.5 - rpm * 0.35, t, 0.05);
    this.tone.frequency.setTargetAtTime((220 + 1100 * rpm) * (bright ? 1.5 : 1), t, 0.05);
    this.gain.gain.setTargetAtTime(vol * 1.1, t, 0.06);
    this.pan.pan.setTargetAtTime(clampPan(pan), t, 0.05);
  }

  dispose(): void {
    disposeVoice(this.ctx, this.gain, this.nodes);
  }
}

class TurbineEngine implements EngineVoice {
  private readonly whistle: OscillatorNode;
  private readonly whistle2: OscillatorNode;
  private readonly air: BiquadFilterNode;
  private readonly airGain: GainNode;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly nodes: AudioScheduledSourceNode[];

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    private readonly variant: number,
  ) {
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistle2 = ctx.createOscillator();
    this.whistle2.type = 'triangle';
    const w2 = ctx.createGain();
    w2.gain.value = 0.25;
    const wGain = ctx.createGain();
    wGain.gain.value = 0.55;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.air = ctx.createBiquadFilter();
    this.air.type = 'bandpass';
    this.air.Q.value = 1.3;
    this.airGain = ctx.createGain();
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.whistle.connect(wGain);
    this.whistle2.connect(w2);
    w2.connect(wGain);
    wGain.connect(this.gain);
    src.connect(this.air);
    this.air.connect(this.airGain);
    this.airGain.connect(this.gain);
    this.pan = panner(ctx, this.gain, dest);
    this.nodes = [this.whistle, this.whistle2, src];
    this.whistle.start();
    this.whistle2.start();
    src.start(0, Math.random() * 1.5);
  }

  set(mph: number, vol: number, bright: boolean, pan = 0, pitch = 1, doppler = 1): void {
    const t = this.ctx.currentTime;
    const v = Math.min(1, Math.abs(mph) / 180);
    const spool = v ** 0.7;
    const f = (700 + 2300 * spool) * pitch * doppler * (1 + this.variant * 0.025);
    this.whistle.frequency.setTargetAtTime(f, t, 0.35);
    this.whistle2.frequency.setTargetAtTime(f * 1.51, t, 0.35);
    this.air.frequency.setTargetAtTime((350 + 2600 * spool) * doppler, t, 0.3);
    this.airGain.gain.setTargetAtTime((0.5 + spool * 1.4) * (bright ? 1.4 : 1), t, 0.2);
    this.gain.gain.setTargetAtTime(vol * 2, t, 0.08);
    this.pan.pan.setTargetAtTime(clampPan(pan), t, 0.05);
  }

  dispose(): void {
    disposeVoice(this.ctx, this.gain, this.nodes);
  }
}

class ChipEngine implements EngineVoice {
  private readonly pulse: OscillatorNode;
  private readonly arp: OscillatorNode;
  private readonly arpDepth: GainNode;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly nodes: OscillatorNode[];

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    private readonly variant: number,
  ) {
    this.pulse = ctx.createOscillator();
    const n = 16;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
    this.pulse.setPeriodicWave(ctx.createPeriodicWave(re, im));
    this.arp = ctx.createOscillator();
    this.arp.type = 'square';
    this.arpDepth = ctx.createGain();
    this.arp.connect(this.arpDepth);
    this.arpDepth.connect(this.pulse.detune);
    const crush = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.round(x * 4) / 4;
    }
    crush.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pulse.connect(crush);
    crush.connect(lp);
    lp.connect(this.gain);
    this.pan = panner(ctx, this.gain, dest);
    this.nodes = [this.pulse, this.arp];
    this.pulse.start();
    this.arp.start();
  }

  set(mph: number, vol: number, bright: boolean, pan = 0, pitch = 1, doppler = 1): void {
    const t = this.ctx.currentTime;
    const v = Math.min(1, Math.abs(mph) / 180);
    const semis = Math.round(v * 24);
    const f = 110 * 2 ** (semis / 12) * pitch * doppler * (1 + this.variant * 0.02);
    this.pulse.frequency.setValueAtTime(f, t);
    this.arp.frequency.setValueAtTime(bright ? 18 : 12, t);
    this.arpDepth.gain.setValueAtTime(Math.abs(mph) < 1 ? 0 : 250, t);
    this.gain.gain.setTargetAtTime(vol * 2.4, t, 0.03);
    this.pan.pan.setTargetAtTime(clampPan(pan), t, 0.05);
  }

  dispose(): void {
    disposeVoice(this.ctx, this.gain, this.nodes);
  }
}

class ToyEngine implements EngineVoice {
  private readonly buzz: OscillatorNode;
  private readonly whine: OscillatorNode;
  private readonly vibDepth: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    variant: number,
  ) {
    const vibRate = [23, 17, 20, 26][variant % 4]!;
    this.buzz = ctx.createOscillator();
    this.buzz.type = 'square';
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    const vib = ctx.createOscillator();
    vib.frequency.value = vibRate;
    this.vibDepth = ctx.createGain();
    vib.connect(this.vibDepth);
    this.vibDepth.connect(this.buzz.frequency);
    this.vibDepth.connect(this.whine.frequency);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 4;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.35;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.buzz.connect(hp);
    this.whine.connect(whineGain);
    whineGain.connect(hp);
    hp.connect(this.tone);
    this.tone.connect(this.gain);
    this.gain.connect(this.pan);
    this.pan.connect(dest);
    this.buzz.start();
    this.whine.start();
    vib.start();
    this.nodes = [this.buzz, this.whine, vib];
  }

  private readonly nodes: OscillatorNode[];

  dispose(): void {
    disposeVoice(this.ctx, this.gain, this.nodes);
  }

  set(mph: number, vol: number, bright: boolean, pan = 0, pitch = 1, doppler = 1): void {
    const t = this.ctx.currentTime;
    const v = Math.min(1, Math.abs(mph) / 180);
    const f = (150 + 640 * v ** 0.85) * (bright ? 1.06 : 1) * pitch * doppler;
    this.buzz.frequency.setTargetAtTime(f, t, 0.05);
    this.whine.frequency.setTargetAtTime(f * 3.01, t, 0.05);
    this.vibDepth.gain.setTargetAtTime(f * (0.025 + (bright ? 0.015 : 0)), t, 0.05);
    this.tone.frequency.setTargetAtTime(f * (bright ? 5 : 3), t, 0.06);
    this.gain.gain.setTargetAtTime(vol, t, 0.07);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
  }
}

export function makeEngine(style: EngineStyle, ctx: AudioContext, dest: AudioNode, noise: AudioBuffer, variant: number): EngineVoice {
  switch (style) {
    case 'v8':
      return new V8Engine(ctx, dest, variant);
    case 'turbine':
      return new TurbineEngine(ctx, dest, noise, variant);
    case 'chip':
      return new ChipEngine(ctx, dest, variant);
    default:
      return new ToyEngine(ctx, dest, variant);
  }
}

const STYLE_KEY = 'petrolrush.engine';

export function loadEngineStyle(): EngineStyle {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    if (ENGINE_STYLES.some((s) => s.id === v)) return v as EngineStyle;
  } catch {}
  return 'v8';
}

export function saveEngineStyle(style: EngineStyle): void {
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {}
}
