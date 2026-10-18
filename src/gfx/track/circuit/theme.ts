import type { Rng } from '../../../sim/rng';
import { shade } from '../../sprites';

/** The scenery props of the cockpit view (src/gfx/fpv/props.ts). */
export type Prop3d = 'containers' | 'cactus' | 'buildings' | 'pines' | 'stands';

/** The cockpit view's look of a circuit; every field is optional, with a default that fits any track. */
export interface FpvTheme {
  /** Props standing where the top-down view draws `prop` (default: pines). */
  props?: Prop3d;
  /** The distant skyline: tower height (1 = the oval's city), colour and the share of lit windows. */
  skyline?: { h: number; color: string; lit: number };
}

/** Scenery of one circuit. Tarmac, walls and kerbs look the same everywhere, so cars always stand out. */
export interface CircuitTheme {
  outside: string;
  infield: string;
  shoulder: string;
  speckle: string;
  lamp: string;
  /** Props per 100 × 100 px of free ground. */
  density: number;
  prop(g: CanvasRenderingContext2D, x: number, y: number, rng: Rng): void;
  /** Size of the area a prop needs, so it keeps off the track. */
  propR: number;
  /** Glow drawn after the night tint (windows, neon, lanterns). */
  glow?(g: CanvasRenderingContext2D, x: number, y: number, rng: Rng): void;
  /** Ground far from the track (water, dunes) and how wide the strip of `outside` ground along the track is. */
  far?: string;
  nearW: number;
  farDetail?(g: CanvasRenderingContext2D, w: number, h: number, rng: Rng): void;
  fpv?: FpvTheme;
}

function waves(g: CanvasRenderingContext2D, w: number, h: number, rng: Rng): void {
  for (let i = 0; i < (w * h) / 2500; i++) {
    const x = rng() * w;
    const y = rng() * h;
    g.fillStyle = rng() < 0.5 ? 'rgba(120,170,220,0.18)' : 'rgba(80,120,170,0.25)';
    g.fillRect(x, y, 6 + rng() * 14, 1);
  }
}

function dunes(g: CanvasRenderingContext2D, w: number, h: number, rng: Rng): void {
  g.strokeStyle = 'rgba(120,90,60,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < (w * h) / 40000; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = 40 + rng() * 90;
    g.beginPath();
    g.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  }
}

export const CONTAINERS = ['#B8442E', '#2E6AB8', '#D9A21E', '#3C8C5A', '#8A8A96', '#C8582E'];

function container(g: CanvasRenderingContext2D, x: number, y: number, rng: Rng): void {
  const rows = 1 + ((rng() * 3) | 0);
  const vertical = rng() < 0.3;
  for (let r = 0; r < rows; r++) {
    const c = CONTAINERS[(rng() * CONTAINERS.length) | 0]!;
    const w = vertical ? 12 : 38;
    const h = vertical ? 38 : 12;
    const ox = vertical ? r * 14 : 0;
    const oy = vertical ? 0 : r * 14;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x + ox + 3, y + oy + 3, w, h);
    g.fillStyle = c;
    g.fillRect(x + ox, y + oy, w, h);
    g.fillStyle = shade(c, -0.3);
    for (let k = 3; k < (vertical ? h : w); k += 4) {
      if (vertical) g.fillRect(x + ox, y + oy + k, w, 1);
      else g.fillRect(x + ox + k, y + oy, 1, h);
    }
  }
}

function cactus(g: CanvasRenderingContext2D, x: number, y: number, rng: Rng): void {
  if (rng() < 0.45) {
    const r = 4 + rng() * 7;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(x + 3, y + 3, r * 1.2, r * 0.8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rng() < 0.5 ? '#6E5440' : '#5A4636';
    g.beginPath();
    g.ellipse(x, y, r * 1.2, r * 0.8, rng(), 0, Math.PI * 2);
    g.fill();
    return;
  }
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.arc(x + 3, y + 3, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2E6A3A';
  g.beginPath();
  g.arc(x, y, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3E8A4C';
  for (const [dx, dy] of [
    [-10, -3],
    [10, 2],
  ] as const) {
    g.beginPath();
    g.arc(x + dx, y + dy, 4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#5AAA66';
  g.fillRect(x - 1, y - 3, 2, 2);
}

function building(g: CanvasRenderingContext2D, x: number, y: number, rng: Rng): void {
  const w = 40 + ((rng() * 4) | 0) * 10;
  const h = 40 + ((rng() * 4) | 0) * 10;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(x - w / 2 + 5, y - h / 2 + 5, w, h);
  const roof = ['#2A2838', '#33313F', '#252433', '#3A3446'][(rng() * 4) | 0]!;
  g.fillStyle = roof;
  g.fillRect(x - w / 2, y - h / 2, w, h);
  g.fillStyle = shade('#3A3446', 0.15);
  g.fillRect(x - w / 2, y - h / 2, w, 2);
  g.fillStyle = '#1A1822';
  g.fillRect(x - w / 2 + 6, y - h / 2 + 6, 8, 6);
  if (rng() < 0.5) g.fillRect(x + w / 2 - 14, y + h / 2 - 12, 8, 8);
}

function buildingGlow(g: CanvasRenderingContext2D, x: number, y: number, rng: Rng): void {
  const colors = ['#FF4FA3', '#4FE3FF', '#FFC85A', '#9B6BFF'];
  const c = colors[(rng() * colors.length) | 0]!;
  g.save();
  g.shadowColor = c;
  g.shadowBlur = 8;
  g.fillStyle = c;
  g.fillRect(x - 10, y - 2, 20, 2);
  g.restore();
}

function tree(g: CanvasRenderingContext2D, x: number, y: number, rng: Rng): void {
  const r = 8 + rng() * 9;
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath();
  g.arc(x + 4, y + 4, r, 0, Math.PI * 2);
  g.fill();
  const base = rng() < 0.5 ? '#1E4A2A' : '#24563A';
  g.fillStyle = base;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade(base, 0.18);
  g.beginPath();
  g.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, Math.PI * 2);
  g.fill();
}

function stand(g: CanvasRenderingContext2D, x: number, y: number, rng: Rng): void {
  if (rng() < 0.6) {
    tree(g, x, y, rng);
    return;
  }
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(x - 26 + 4, y - 9 + 4, 52, 18);
  g.fillStyle = '#3E3E4C';
  g.fillRect(x - 26, y - 9, 52, 18);
  for (let k = 0; k < 40; k++) {
    g.fillStyle = ['#D8141E', '#FFD200', '#FFF8E8', '#1E5BC6', '#FF8000'][(rng() * 5) | 0]!;
    g.fillRect(x - 24 + ((rng() * 48) | 0), y - 7 + ((rng() * 14) | 0), 2, 2);
  }
  g.fillStyle = '#2633C5';
  g.fillRect(x - 26, y - 11, 52, 3);
}

export const THEMES: Record<string, CircuitTheme> = {
  harbour: {
    outside: '#232A33',
    infield: '#2A313A',
    shoulder: '#30373F',
    speckle: '#3A424C',
    lamp: '255,214,150',
    density: 0.35,
    propR: 30,
    prop: container,
    far: '#0B1E36',
    nearW: 230,
    farDetail: waves,
    fpv: { props: 'containers', skyline: { h: 1.2, color: '#0E1220', lit: 0.5 } },
  },
  desert: {
    outside: '#3A2A1C',
    infield: '#43301F',
    shoulder: '#4E3A28',
    speckle: '#5A4430',
    lamp: '255,190,120',
    density: 0.3,
    propR: 14,
    prop: cactus,
    far: '#33241A',
    nearW: 260,
    farDetail: dunes,
    fpv: { props: 'cactus', skyline: { h: 0.45, color: '#1A1210', lit: 0.05 } },
  },
  city: {
    outside: '#191823',
    infield: '#1F1E2B',
    shoulder: '#2A2936',
    speckle: '#2E2C3A',
    lamp: '200,220,255',
    density: 0.3,
    propR: 40,
    prop: building,
    glow: buildingGlow,
    nearW: 0,
    fpv: { props: 'buildings', skyline: { h: 2.2, color: '#0E0C1C', lit: 0.65 } },
  },
  forest: {
    outside: '#10281A',
    infield: '#14301E',
    shoulder: '#1F3A26',
    speckle: '#1C3A26',
    lamp: '255,220,160',
    density: 0.45,
    propR: 18,
    prop: tree,
    nearW: 0,
    fpv: { props: 'pines', skyline: { h: 0.6, color: '#08140E', lit: 0 } },
  },
  finale: {
    outside: '#163E26',
    infield: '#1E5A34',
    shoulder: '#2A4E36',
    speckle: '#24603A',
    lamp: '255,236,190',
    density: 0.1,
    propR: 30,
    prop: stand,
    nearW: 0,
    fpv: { props: 'stands', skyline: { h: 0.9, color: '#0C1410', lit: 0.3 } },
  },
};
