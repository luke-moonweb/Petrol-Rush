import { CONFIG } from '../config';
import { type Face, quad, renderModel, type Vec3, wheel } from './model3d';
import { makeCanvas } from './sprites';

export interface CarScheme {
  body: string;
  roof: string;
  number: string;
}

export const CAR_SCHEMES: CarScheme[] = [
  { body: '#7a52e0', roof: '#f0d040', number: '#3a1a8a' },
  { body: '#d82020', roof: '#f0a0e0', number: '#8a0a5a' },
  { body: '#20a020', roof: '#48d848', number: '#0a4a0a' },
  { body: '#a050d0', roof: '#f0c0f0', number: '#5a1a8a' },
  { body: '#f0d030', roof: '#40c040', number: '#0a4a0a' },
  { body: '#9a6a3a', roof: '#50d050', number: '#1a4a1a' },
  { body: '#f0a030', roof: '#f0e060', number: '#8a4a0a' },
  { body: '#f0b0e8', roof: '#fbe4fb', number: '#a04090' },
  { body: '#9090f0', roof: '#c0d8f8', number: '#2a2a8a' },
  { body: '#e03030', roof: '#f0e040', number: '#a01010' },
  { body: '#a8a8b0', roof: '#e0e0e8', number: '#404048' },
  { body: '#208040', roof: '#a8e8a8', number: '#104020' },
  { body: '#ececec', roof: '#e04040', number: '#ffffff' },
  { body: '#30c0d0', roof: '#e0f8f8', number: '#106070' },
  { body: '#3a3a3a', roof: '#e0c040', number: '#202020' },
  { body: '#a03030', roof: '#e8e8e8', number: '#a03030' },
  { body: '#3050d0', roof: '#f0f0f0', number: '#3050d0' },
  { body: '#c8a878', roof: '#f0e0c0', number: '#6a4a20' },
  { body: '#a0e040', roof: '#f0f080', number: '#406010' },
  { body: '#5038b0', roof: '#d0c0f0', number: '#2a1870' },
];

export const DRIVERS: { first: string; last: string }[] = [
  { first: 'Kurt', last: 'Harland' },
  { first: 'Marco', last: 'Bellini' },
  { first: 'Jens', last: 'Aalto' },
  { first: 'Dario', last: 'Ferrante' },
  { first: 'Sam', last: 'Calloway' },
  { first: 'Yuki', last: 'Tanabe' },
  { first: 'Luis', last: 'Montero' },
  { first: 'Pierre', last: 'Duval' },
  { first: 'Rick', last: 'Brannigan' },
  { first: 'Otto', last: 'Kessler' },
  { first: 'Tomas', last: 'Novak' },
  { first: 'Brett', last: 'Coltrane' },
  { first: 'Nils', last: 'Hagen' },
  { first: 'Rafael', last: 'Souza' },
  { first: 'Jack', last: 'Mercer' },
  { first: 'Hugo', last: 'Lambert' },
  { first: 'Sergei', last: 'Volkov' },
  { first: 'Ian', last: 'McCready' },
  { first: 'Paolo', last: 'Vitale' },
  { first: 'Dale', last: 'Hollis' },
];

export function driverName(colorIdx: number): string {
  return DRIVERS[colorIdx % DRIVERS.length]!.last.toUpperCase();
}

export const CAR_DIRECTIONS = 32;
/** The player's car turns in finer steps (the nose moves ~1 px per step), so small turns show. */
export const PLAYER_DIRECTIONS = 128;
const FINE_STEP = PLAYER_DIRECTIONS / CAR_DIRECTIONS;
const CAR_SCALE = (CONFIG.CAR_LEN + 4) / 4;
const SPRITE = 60;
export const CAR_ANCHOR_X = SPRITE / 2;
export const CAR_ANCHOR_Y = 36;

const GLASS = '#b8c4d0';
const WHITE = '#f4f4f4';

export type Livery = 'stripes' | 'arrow' | 'flames' | 'band';
export const LIVERIES: Livery[] = ['stripes', 'arrow', 'flames', 'band'];
export const FLAME_OUT = '#FFC21A';
export const FLAME_IN = '#E63B2E';

function topDecal(xy: [number, number][], z: (x: number) => number, color: string, normal: Vec3): Face {
  return { pts: xy.map(([x, y]) => [x, y, z(x) + 0.006] as Vec3), color, normal, flat: false };
}

function sideDecal(xz: [number, number][], y: number, sgn: 1 | -1, color: string): Face {
  const pts = xz.map(([x, z]) => [x, y, z] as Vec3);
  return { pts: sgn > 0 ? pts : pts.reverse(), color, normal: [0, sgn, 0] };
}

function carModel(sc: CarScheme, livery: Livery): Face[] {
  const h = 0.85;
  const zb = 0.16;
  const zt = 0.86;
  const body = sc.body;
  const side = (y: number): Face => {
    const sgn = (y > 0 ? 1 : -1) as 1 | -1;
    const pts: Vec3[] = [
      [-2, y, zb],
      [2, y, zb + 0.04],
      [2, y, zt - 0.14],
      [1.7, y, zt - 0.04],
      [-1.95, y, zt + 0.04],
    ];
    if (sgn < 0) pts.reverse();
    const n: Vec3 = [0, sgn, 0];
    const yy = y + sgn * 0.01;
    const decals: Face[] = [];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        const x = 1.25 + j * 0.2;
        const z = 0.36 + i * 0.1;
        const p: Vec3[] = [
          [x, yy, z],
          [x + 0.09, yy, z],
          [x + 0.09, yy, z + 0.06],
          [x, yy, z + 0.06],
        ];
        decals.push({ pts: sgn > 0 ? p : p.reverse(), color: WHITE, normal: n, flat: true });
      }
    }
    if (livery === 'flames') {
      decals.push(
        sideDecal(
          [
            [1.98, 0.28],
            [1.98, 0.64],
            [1.62, 0.56],
            [1.4, 0.72],
            [1.15, 0.52],
            [0.9, 0.64],
            [0.62, 0.42],
            [0.35, 0.3],
          ],
          yy,
          sgn,
          FLAME_OUT,
        ),
        sideDecal(
          [
            [1.96, 0.32],
            [1.96, 0.54],
            [1.66, 0.48],
            [1.45, 0.6],
            [1.22, 0.45],
            [0.95, 0.5],
            [0.7, 0.34],
          ],
          yy + sgn * 0.002,
          sgn,
          FLAME_IN,
        ),
      );
    }
    if (livery === 'band')
      decals.push(
        sideDecal(
          [
            [-1.92, 0.4],
            [1.96, 0.4],
            [1.96, 0.64],
            [-1.92, 0.64],
          ],
          yy,
          sgn,
          sc.roof,
        ),
      );
    decals.push(wheel(-1.3, yy, 0.3, 0.3, sgn), wheel(1.3, yy, 0.3, 0.3, sgn));
    return { pts, color: body, normal: n, outline: true, decals };
  };

  const cb: Vec3[] = [
    [-1.0, -0.8, zt + 0.02],
    [0.55, -0.8, zt],
    [0.55, 0.8, zt],
    [-1.0, 0.8, zt + 0.02],
  ];
  const hoodZ = (x: number) => zt - (0.04 * (x - 0.55)) / 1.15;
  const trunkZ = (x: number) => zt + 0.04 - (0.02 * (x + 1.95)) / 0.95;
  const hoodDecals: Face[] = [];
  const trunkDecals: Face[] = [];
  const roofDecals: Face[] = [];
  if (livery === 'stripes') {
    for (const y0 of [-0.3, 0.14]) {
      const band = (x0: number, x1: number): [number, number][] => [
        [x0, y0],
        [x1, y0],
        [x1, y0 + 0.16],
        [x0, y0 + 0.16],
      ];
      hoodDecals.push(topDecal(band(0.58, 1.68), hoodZ, sc.roof, [0.03, 0, 1]));
      trunkDecals.push(topDecal(band(-1.92, -1.02), trunkZ, sc.roof, [-0.02, 0, 1]));
      roofDecals.push(topDecal(band(-0.6, 0.0), () => 1.32, body, [0, 0, 1]));
    }
  }
  if (livery === 'arrow') {
    hoodDecals.push(
      topDecal(
        [
          [1.6, 0],
          [0.95, -0.55],
          [0.7, -0.55],
          [1.25, 0],
          [0.7, 0.55],
          [0.95, 0.55],
        ],
        hoodZ,
        sc.roof,
        [0.03, 0, 1],
      ),
    );
  }
  if (livery === 'flames') {
    hoodDecals.push(
      topDecal(
        [
          [1.68, -0.4],
          [1.68, 0.4],
          [1.3, 0.3],
          [1.15, 0.5],
          [0.95, 0.2],
          [0.75, 0.32],
          [0.62, 0],
          [0.75, -0.32],
          [0.95, -0.2],
          [1.15, -0.5],
          [1.3, -0.3],
        ],
        hoodZ,
        FLAME_OUT,
        [0.03, 0, 1],
      ),
    );
  }
  const rf: Vec3[] = [
    [-0.62, -0.64, 1.32],
    [0.02, -0.64, 1.32],
    [0.02, 0.64, 1.32],
    [-0.62, 0.64, 1.32],
  ];

  return [
    side(h),
    side(-h),
    quad([2, -h, zb + 0.04], [2, h, zb + 0.04], [2, h, zt - 0.14], [2, -h, zt - 0.14], body, [1, 0, 0], {
      outline: true,
      decals: [quad([2.01, -0.6, 0.3], [2.01, 0.6, 0.3], [2.01, 0.6, 0.42], [2.01, -0.6, 0.42], '#202020', [1, 0, 0], { flat: true })],
    }),
    quad([-2, h, zb], [-2, -h, zb], [-2, -h, zt + 0.04], [-2, h, zt + 0.04], body, [-1, 0, 0], { outline: true }),
    quad([1.7, -h, zt - 0.04], [2, -h, zt - 0.14], [2, h, zt - 0.14], [1.7, h, zt - 0.04], body, [0.3, 0, 0.95], { outline: true }),
    quad([0.55, -h, zt], [1.7, -h, zt - 0.04], [1.7, h, zt - 0.04], [0.55, h, zt], body, [0.03, 0, 1], {
      outline: true,
      decals: hoodDecals,
    }),
    quad([-1.95, -h, zt + 0.04], [-1.0, -h, zt + 0.02], [-1.0, h, zt + 0.02], [-1.95, h, zt + 0.04], body, [-0.02, 0, 1], {
      outline: true,
      decals: trunkDecals,
    }),
    quad([-1.0, -h, zt + 0.02], [0.55, -h, zt], [0.55, h, zt], [-1.0, h, zt + 0.02], body, [0, 0, 1]),
    quad([-2, -h, zt + 0.04], [-2, h, zt + 0.04], [-1.88, h, zt + 0.2], [-1.88, -h, zt + 0.2], sc.roof, [-0.8, 0, 0.6], { outline: true }),
    quad(cb[1]!, cb[2]!, rf[2]!, rf[1]!, GLASS, [0.6, 0, 0.8], { outline: true }),
    quad(cb[3]!, cb[0]!, rf[0]!, rf[3]!, GLASS, [-0.7, 0, 0.7], { outline: true }),
    quad(cb[3]!, rf[3]!, rf[2]!, cb[2]!, GLASS, [0, 0.93, 0.36], { outline: true }),
    quad(cb[0]!, cb[1]!, rf[1]!, rf[0]!, GLASS, [0, -0.93, 0.36], { outline: true }),
    { pts: rf, color: sc.roof, normal: [0, 0, 1], outline: true, decals: roofDecals },
  ];
}

const faceCache = new Map<number, Face[]>();

export function carFaces(colorIdx: number): Face[] {
  let f = faceCache.get(colorIdx);
  if (!f) {
    f = carModel(CAR_SCHEMES[colorIdx % CAR_SCHEMES.length]!, LIVERIES[colorIdx % LIVERIES.length]!);
    faceCache.set(colorIdx, f);
  }
  return f;
}

export const MODEL_SCALE = CAR_SCALE;

const carCache = new Map<string, HTMLCanvasElement>();

/** The sprite direction (of `dirs`) nearest to a heading. */
export function carDirIndex(heading: number, dirs = CAR_DIRECTIONS): number {
  const t = heading / (Math.PI * 2);
  return ((Math.round(t * dirs) % dirs) + dirs) % dirs;
}

export function carSprite3d(colorIdx: number, dir: number): HTMLCanvasElement {
  const key = `${colorIdx}:${dir}`;
  const cached = carCache.get(key);
  if (cached) return cached;
  const c = makeCanvas(SPRITE, SPRITE);
  const g = c.getContext('2d')!;
  renderModel(g, carFaces(colorIdx), (dir / CAR_DIRECTIONS) * Math.PI * 2, CAR_SCALE, CAR_ANCHOR_X, CAR_ANCHOR_Y);
  carCache.set(key, c);
  return c;
}

const glowCache = new Map<string, HTMLCanvasElement>();
const GLOW = 'rgba(255,215,140,0.95)';

export function carGlowSprite(colorIdx: number, dir: number): HTMLCanvasElement {
  const key = `${colorIdx}:${dir}`;
  const cached = glowCache.get(key);
  if (cached) return cached;
  const c = makeCanvas(SPRITE, SPRITE);
  const g = c.getContext('2d')!;
  g.shadowColor = GLOW;
  g.shadowBlur = 5;
  g.drawImage(carSprite3d(colorIdx, dir), 0, 0);
  g.shadowBlur = 0;
  g.drawImage(carSprite3d(colorIdx, dir), 0, 0);
  glowCache.set(key, c);
  return c;
}

// The player's in-between directions (those not a multiple of FINE_STEP) are cached for one colour
// only, so an AI car of the same colour never gets one; `warmed` counts the directions prewarmed.
let fine: { colorIdx: number; sprites: HTMLCanvasElement[]; warmed: number } = { colorIdx: -1, sprites: [], warmed: 0 };
// The bare car of an in-between direction, drawn here before its glow.
let fineRaw: HTMLCanvasElement | null = null;

function fineCache(colorIdx: number): typeof fine {
  if (fine.colorIdx !== colorIdx) fine = { colorIdx, sprites: [], warmed: 0 };
  return fine;
}

/** The player's car, with its glow, at direction `dir` of PLAYER_DIRECTIONS. */
export function playerCarSprite(colorIdx: number, dir: number): HTMLCanvasElement {
  if (dir % FINE_STEP === 0) return carGlowSprite(colorIdx, dir / FINE_STEP);
  const f = fineCache(colorIdx);
  const cached = f.sprites[dir];
  if (cached) return cached;
  fineRaw ??= makeCanvas(SPRITE, SPRITE);
  const r = fineRaw.getContext('2d')!;
  r.clearRect(0, 0, SPRITE, SPRITE);
  renderModel(r, carFaces(colorIdx), (dir / PLAYER_DIRECTIONS) * Math.PI * 2, CAR_SCALE, CAR_ANCHOR_X, CAR_ANCHOR_Y);
  const c = makeCanvas(SPRITE, SPRITE);
  const g = c.getContext('2d')!;
  g.shadowColor = GLOW;
  g.shadowBlur = 5;
  g.drawImage(fineRaw, 0, 0);
  g.shadowBlur = 0;
  g.drawImage(fineRaw, 0, 0);
  f.sprites[dir] = c;
  return c;
}

/**
 * Draws up to `n` more of the player's sprites. The start lights call it every step: all 128 at once
 * would stall a frame, and a car turning fast needs 3-4 new directions a frame.
 */
export function prewarmPlayerCar(colorIdx: number, n = 8): void {
  const f = fineCache(colorIdx);
  while (f.warmed < PLAYER_DIRECTIONS && n-- > 0) playerCarSprite(colorIdx, f.warmed++);
}

export function carIcon(g: CanvasRenderingContext2D, colorIdx: number, cx: number, cy: number, scale = 1): void {
  const spr = carSprite3d(colorIdx, 0);
  const w = SPRITE * scale;
  g.drawImage(spr, Math.round(cx - CAR_ANCHOR_X * scale), Math.round(cy - CAR_ANCHOR_Y * scale), w, w);
}

function boxFaces(x0: number, x1: number, hw: number, z0: number, z1: number, color: string): Face[] {
  return [
    quad([x0, hw, z0], [x1, hw, z0], [x1, hw, z1], [x0, hw, z1], color, [0, 1, 0], { outline: true }),
    quad([x1, -hw, z0], [x0, -hw, z0], [x0, -hw, z1], [x1, -hw, z1], color, [0, -1, 0], { outline: true }),
    quad([x1, hw, z0], [x1, -hw, z0], [x1, -hw, z1], [x1, hw, z1], color, [1, 0, 0], { outline: true }),
    quad([x0, -hw, z0], [x0, hw, z0], [x0, hw, z1], [x0, -hw, z1], color, [-1, 0, 0], { outline: true }),
    quad([x0, -hw, z1], [x1, -hw, z1], [x1, hw, z1], [x0, hw, z1], color, [0, 0, 1], { outline: true }),
  ];
}

function haulerModel(trailer: string): Face[] {
  const hw = 1.05;
  const faces = boxFaces(-4.6, 1.6, hw, 0.6, 2.8, trailer);
  const cab = boxFaces(1.75, 3.6, 0.95, 0.4, 2.3, '#5a5a5e');
  cab[2]!.decals = [quad([3.61, 0.75, 1.5], [3.61, -0.75, 1.5], [3.61, -0.75, 2.1], [3.61, 0.75, 2.1], '#20262c', [1, 0, 0])];
  for (const sgn of [1, -1] as const) {
    const y = sgn * (hw + 0.01);
    faces[sgn > 0 ? 0 : 1]!.decals = [wheel(-3.9, y, 0.42, 0.42, sgn), wheel(-2.9, y, 0.42, 0.42, sgn)];
    cab[sgn > 0 ? 0 : 1]!.decals = [wheel(3.0, sgn * 0.96, 0.42, 0.42, sgn), wheel(2.0, sgn * 0.96, 0.42, 0.42, sgn)];
  }
  return [...faces, ...cab];
}

export function drawHauler3d(g: CanvasRenderingContext2D, x: number, y: number, yaw: number, trailer: string): void {
  renderModel(g, haulerModel(trailer), yaw, 8.5, x, y);
}
