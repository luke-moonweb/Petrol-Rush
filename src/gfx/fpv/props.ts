import { createRng, type Rng } from '../../sim/rng';
import type { Track } from '../../track/common';
import { CONTAINERS, type Prop3d } from '../track/circuit/theme';
import { type P3, upright } from './geom';
import { box, night, type Parts } from './kit';
import { crowd } from './paddock3d';
import { lazyCanvas, type TexQuad, texQuad } from './texture';

// A circuit's scenery props in 3D, standing where the top-down view draws them: billboards (trees,
// cacti) or boxes (containers, buildings, small grandstands).

const pine = lazyCanvas(64, 128, (g) => {
  g.fillStyle = '#3A2A1C';
  g.fillRect(29, 100, 6, 28);
  for (let i = 0; i < 4; i++) {
    const top = 4 + i * 22;
    const half = 12 + i * 6;
    g.fillStyle = i % 2 ? '#1E4A2A' : '#24563A';
    g.beginPath();
    g.moveTo(32, top);
    g.lineTo(32 + half, top + 40);
    g.lineTo(32 - half, top + 40);
    g.closePath();
    g.fill();
  }
});

const roundTree = lazyCanvas(64, 96, (g) => {
  g.fillStyle = '#3A2A1C';
  g.fillRect(29, 60, 6, 36);
  for (const [x, y, r, c] of [
    [32, 38, 26, '#1E4A2A'],
    [22, 30, 14, '#24563A'],
    [40, 26, 12, '#2E6A44'],
  ] as const) {
    g.fillStyle = c;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
});

const cactusTex = lazyCanvas(48, 96, (g) => {
  g.fillStyle = '#2E6A3A';
  g.fillRect(19, 8, 10, 88);
  g.fillRect(6, 34, 8, 30);
  g.fillRect(6, 56, 16, 8);
  g.fillRect(34, 24, 8, 28);
  g.fillRect(26, 44, 16, 8);
  g.fillStyle = '#3E8A4C';
  g.fillRect(21, 8, 3, 88);
});

const officeWindows = lazyCanvas(48, 48, (g) => {
  const rng = createRng(902);
  g.fillStyle = '#1C1A28';
  g.fillRect(0, 0, 48, 48);
  for (let y = 4; y < 44; y += 10) {
    for (let x = 4; x < 44; x += 10) {
      const r = rng();
      g.fillStyle = r < 0.45 ? '#FFD27A' : r < 0.55 ? '#BFEFFF' : '#2A2838';
      g.fillRect(x, y, 6, 6);
    }
  }
});

const NEON = ['255,79,163', '79,227,255', '255,200,90', '155,107,255'];
const ROOFS = ['#2A2838', '#33313F', '#252433', '#3A3446'];

/** An upright quad just in front of the face of the box (x0, y0)–(x1, y1) that looks most towards (tx, ty). */
function facing(x0: number, y0: number, x1: number, y1: number, tx: number, ty: number, z0: number, z1: number): [P3, P3, P3, P3] {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const dx = (tx - cx) / (x1 - x0);
  const dy = (ty - cy) / (y1 - y0);
  const o = 0.4;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? upright(x1 + o, y1, x1 + o, y0, z0, z1) : upright(x0 - o, y0, x0 - o, y1, z0, z1);
  }
  return dy > 0 ? upright(x0, y1 + o, x1, y1 + o, z0, z1) : upright(x1, y0 - o, x0, y0 - o, z0, z1);
}

interface Spot {
  x: number;
  y: number;
  /** The nearest point of the track, which signs face. */
  tx: number;
  ty: number;
}

function containers(P: Parts, p: Spot, rng: Rng): void {
  const rows = 1 + ((rng() * 3) | 0);
  const vertical = rng() < 0.3;
  for (let r = 0; r < rows; r++) {
    const c = CONTAINERS[(rng() * CONTAINERS.length) | 0]!;
    const w = vertical ? 12 : 38;
    const h = vertical ? 38 : 12;
    const x = p.x + (vertical ? r * 14 : 0);
    const y = p.y + (vertical ? 0 : r * 14);
    const layers = rng() < 0.3 ? 2 : 1;
    for (let l = 0; l < layers; l++) box(P.solids, x, y, x + w, y + h, l * 12, l * 12 + 12, night(c), night(c, 0.75));
  }
}

function cactus(P: Parts, p: Spot, rng: Rng): void {
  if (rng() < 0.45) {
    const r = 4 + rng() * 7;
    box(P.solids, p.x - r, p.y - r * 0.7, p.x + r, p.y + r * 0.7, 0, 2 + r * 0.4, night('#6E5440'), night('#5A4636'));
    return;
  }
  const s = 0.8 + rng() * 0.5;
  P.billboards.push({ x: p.x, y: p.y, z: 0, w: 14 * s, h: 28 * s, tex: cactusTex });
}

function building(P: Parts, p: Spot, rng: Rng, signs: TexQuad[]): void {
  const w = 40 + ((rng() * 4) | 0) * 10;
  const d = 40 + ((rng() * 4) | 0) * 10;
  const h = 30 + rng() * 70;
  const roof = ROOFS[(rng() * ROOFS.length) | 0]!;
  const x0 = p.x - w / 2;
  const y0 = p.y - d / 2;
  box(P.solids, x0, y0, x0 + w, y0 + d, 0, h, night(roof, 1.3), night(roof));
  signs.push(texQuad(facing(x0, y0, x0 + w, y0 + d, p.tx, p.ty, 4, h - 4), officeWindows, { tile: true, far: 900 }));
  if (rng() < 0.5) P.glows.push({ x: p.x, y: p.y, z: h + 2, r: 10, color: NEON[(rng() * NEON.length) | 0]! });
}

function pines(P: Parts, p: Spot, rng: Rng): void {
  const w = 20 + rng() * 14;
  P.billboards.push({ x: p.x, y: p.y, z: 0, w, h: w * 2, tex: pine });
}

function stands(P: Parts, p: Spot, rng: Rng, signs: TexQuad[]): void {
  if (rng() < 0.6) {
    const w = 22 + rng() * 14;
    P.billboards.push({ x: p.x, y: p.y, z: 0, w, h: w * 1.5, tex: roundTree });
    return;
  }
  const x0 = p.x - 26;
  const y0 = p.y - 9;
  box(P.solids, x0, y0, x0 + 52, y0 + 18, 0, 12, night('#3E3E4C'), night('#2633C5'));
  signs.push(texQuad(facing(x0, y0, x0 + 52, y0 + 18, p.tx, p.ty, 0.5, 11.5), crowd, { tile: true }));
}

const PLACE: Record<Prop3d, (P: Parts, p: Spot, rng: Rng, signs: TexQuad[]) => void> = {
  containers,
  cactus,
  buildings: building,
  pines,
  stands,
};

export function props(P: Parts, track: Track, kind: Prop3d, spots: readonly (readonly [number, number])[]): void {
  const rng = createRng(31 + (track.len | 0));
  const place = PLACE[kind];
  for (const [x, y] of spots) {
    const t = track.pointAt(track.project(x, y).s, 0);
    place(P, { x, y, tx: t.x, ty: t.y }, rng, P.signs);
  }
}
