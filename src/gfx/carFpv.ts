// Rival car model for the cockpit camera. The top-down sprites keep their own model (vehicles.ts carModel),
// which is authored for a 45° view from above; from eye height it shows holes and hides the livery.
// This one is built from closed convex pieces with normals computed from the winding, and carries the
// livery on the faces a driver actually sees: the rear, the nose and the sides.
import { newellNormal, type Vec3 } from './model3d';
import { CAR_SCHEMES, type CarScheme, FLAME_IN, FLAME_OUT, LIVERIES, type Livery } from './vehicles';

export interface FpvFace {
  pts: Vec3[];
  // The same points as x, y, z triplets, for the per-frame transform.
  xyz: Float32Array;
  color: string;
  // Index of `color` in FPV_PALETTE, for the renderer's style cache.
  cid: number;
  normal: Vec3;
  // normal · pts[0]: the face plane, so facing the camera is `normal · eye > d`.
  d: number;
  outline: boolean;
  // Flat faces ignore the light, like the wheels and white squares of the sprites.
  flat: boolean;
  // Small decals (number blocks, grille, hubs) that are dropped once the car is small on screen.
  detail: boolean;
  // Large rear and nose livery areas, still drawn when the car is tiny.
  broad: boolean;
  // Lies inside or on another piece, so it can never be seen. Kept for the closed-mesh check, never drawn.
  hidden: boolean;
  decals: FpvFace[];
}

export interface FpvPiece {
  faces: FpvFace[];
  center: Vec3;
}

export interface FpvModel {
  // Tyres: [rear left, front left, rear right, front right] (left is −y). The part inside the body width.
  tyres: FpvPiece[];
  // Outer slices of the same tyres (|y| BODY_W..TYRE_OUT), same order: outside the body, carrying the rims.
  wheels: FpvPiece[];
  floor: FpvPiece;
  // Dark block under the body that stands in for tyres and floor when the car is tiny on screen.
  skirt: FpvPiece;
  body: FpvPiece;
  cabin: FpvPiece;
  wing: FpvPiece;
  // End plates: [−y, +y].
  plates: FpvPiece[];
}

export const BODY_W = 0.85;
export const BODY_ZB = 0.15;
// Plane under the greenhouse (z = CABIN_Z0 + CABIN_SLOPE · (CABIN_X0 − x)): the body is below it, the greenhouse above.
export const CABIN_X0 = 0.55;
export const CABIN_Z0 = 0.86;
export const CABIN_SLOPE = 0.03 / 1.55;
// Plane x = WING_SPLIT_X separates the greenhouse (in front) from the spoiler (behind).
export const WING_SPLIT_X = -1.4;
export const WING_HW = 0.84;
export const FLOOR_HW = 0.55;
export const TYRE_X = 1.3;
// Outer tread face: a little outside the body so a sliver of tyre shows from straight behind or ahead.
export const TYRE_OUT = 0.88;
// Lowest point of the spoiler (end plate feet). Piece order assumes every eye is above it.
export const PLATE_Z0 = 0.9;
const TYRE_R = 0.3;
const TYRE_Z = 0.3;
const TYRE_IN = 0.62;
const DARK = '#202020';
const TREAD = '#141414';
// Tread seen under the bumper: a little lighter than the sprite tyre so it reads against the dark ground.
const TREAD_FACE = '#2a2a2e';
const RIM = '#8a8a8a';
const HUB = '#3a3a3a';
const WHITE = '#f4f4f4';
const GLASS_DARK = '#1a2236';
// The sprite glass (#b8c4d0) at 35 % over the dark glass: kept as a reflection strip.
const GLASS_SHEEN = '#515b6c';
const FLOOR = '#0d0c12';

// Side profile (x, z) of the body, front bottom first, going over the top to the rear bottom.
const PROFILE: [number, number][] = [
  [2, BODY_ZB],
  [2, 0.7],
  [1.7, 0.8],
  [CABIN_X0, CABIN_Z0],
  [-1.0, 0.89],
  [-2, 0.9],
  [-2, BODY_ZB],
];

function topZ(x: number): number {
  for (let i = 1; i < PROFILE.length - 2; i++) {
    const [x0, z0] = PROFILE[i]!;
    const [x1, z1] = PROFILE[i + 1]!;
    if (x <= x0 && x >= x1) return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0);
  }
  return PROFILE[PROFILE.length - 2]![1];
}

function hexDarken(hex: string, amt: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.round(v * (1 + amt))
      .toString(16)
      .padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

export const FPV_PALETTE: string[] = [];
const paletteIds = new Map<string, number>();

function colorId(hex: string): number {
  let id = paletteIds.get(hex);
  if (id === undefined) {
    id = FPV_PALETTE.push(hex) - 1;
    paletteIds.set(hex, id);
  }
  return id;
}

interface FaceOpts {
  outline?: boolean;
  flat?: boolean;
  detail?: boolean;
  hidden?: boolean;
  broad?: boolean;
}

function makeFace(pts: Vec3[], color: string, o: FaceOpts = {}): FpvFace {
  const normal = newellNormal(pts);
  const p0 = pts[0]!;
  const xyz = new Float32Array(pts.length * 3);
  for (const [i, p] of pts.entries()) xyz.set(p, i * 3);
  return {
    pts,
    xyz,
    color,
    cid: colorId(color),
    normal,
    d: normal[0] * p0[0] + normal[1] * p0[1] + normal[2] * p0[2],
    outline: o.outline ?? false,
    flat: o.flat ?? false,
    detail: o.detail ?? false,
    hidden: o.hidden ?? false,
    broad: o.broad ?? false,
    decals: [],
  };
}

function centroid(pts: readonly Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0] / pts.length;
    c[1] += p[1] / pts.length;
    c[2] += p[2] / pts.length;
  }
  return c;
}

// A convex piece: every face is turned so its winding faces away from the piece centre.
function piece(polys: { pts: Vec3[]; color: string; o?: FaceOpts }[]): FpvPiece {
  const center = centroid(polys.flatMap((p) => p.pts));
  const faces = polys.map(({ pts, color, o }) => {
    const n = newellNormal(pts);
    const c = centroid(pts);
    const out = n[0] * (c[0] - center[0]) + n[1] * (c[1] - center[1]) + n[2] * (c[2] - center[2]);
    return makeFace(out < 0 ? [...pts].reverse() : pts, color, o);
  });
  return { faces, center };
}

// Decal on a face: wound like its parent so it faces the same way.
function decal(parent: FpvFace, pts: Vec3[], color: string, o: FaceOpts = {}): FpvFace {
  const n = newellNormal(pts);
  const dot = n[0] * parent.normal[0] + n[1] * parent.normal[1] + n[2] * parent.normal[2];
  const f = makeFace(dot < 0 ? [...pts].reverse() : pts, color, o);
  parent.decals.push(f);
  return f;
}

function prism(profile: [number, number][], y0: number, y1: number, color: string, o: FaceOpts = {}, hide?: (i: number) => boolean) {
  const n = profile.length;
  const polys: { pts: Vec3[]; color: string; o?: FaceOpts }[] = [
    { pts: profile.map(([x, z]) => [x, y0, z] as Vec3), color, o },
    { pts: profile.map(([x, z]) => [x, y1, z] as Vec3), color, o },
  ];
  for (let i = 0; i < n; i++) {
    const [ax, az] = profile[i]!;
    const [bx, bz] = profile[(i + 1) % n]!;
    polys.push({
      pts: [
        [ax, y0, az],
        [bx, y0, bz],
        [bx, y1, bz],
        [ax, y1, az],
      ],
      color,
      o: hide?.(i) ? { ...o, hidden: true } : o,
    });
  }
  return piece(polys);
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, o: FaceOpts = {}) {
  return prism(
    [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
    y0,
    y1,
    color,
    o,
  );
}

function ring(cx: number, cz: number, r: number, n: number, from = 0, to = Math.PI * 2): [number, number][] {
  const out: [number, number][] = [];
  const full = to - from >= Math.PI * 2 - 1e-9;
  const steps = full ? n : n + 1;
  for (let i = 0; i < steps; i++) {
    const a = from + ((to - from) * (i + (full ? 0.5 : 0))) / n;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

// Finders for the faces of a piece, by the direction of their normal.
function faceAlong(p: FpvPiece, dir: Vec3, min = 0.99): FpvFace {
  const f = p.faces.find((f) => f.normal[0] * dir[0] + f.normal[1] * dir[1] + f.normal[2] * dir[2] > min);
  if (!f) throw new Error('missing face');
  return f;
}

function topFace(p: FpvPiece, x: number): FpvFace {
  const f = p.faces.find((f) => {
    if (f.normal[2] < 0.3) return false;
    const xs = f.pts.map((q) => q[0]);
    return x <= Math.max(...xs) && x >= Math.min(...xs);
  });
  if (!f) throw new Error('missing top face');
  return f;
}

type YZ = [number, number];
const onSide = (sgn: number, xz: [number, number][]): Vec3[] => xz.map(([x, z]) => [x, sgn * BODY_W, z] as Vec3);
const onRear = (yz: YZ[]): Vec3[] => yz.map(([y, z]) => [-2, y, z] as Vec3);
const onFront = (yz: YZ[]): Vec3[] => yz.map(([y, z]) => [2, y, z] as Vec3);
const onTop = (xy: [number, number][]): Vec3[] => xy.map(([x, y]) => [x, y, topZ(x)] as Vec3);
const mirrorY = (yz: YZ[]): YZ[] => yz.map(([y, z]) => [-y, z]);
const rect = (a0: number, a1: number, b0: number, b1: number): [number, number][] => [
  [a0, b0],
  [a1, b0],
  [a1, b1],
  [a0, b1],
];

// Point on a quad face [a, b, c, d] (a → b along the bottom edge, d → c along the top), at u across and t up.
function onQuad(f: FpvFace, u: number, t: number): Vec3 {
  const [a, b, c, d] = f.pts as [Vec3, Vec3, Vec3, Vec3];
  const lo: Vec3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const hi: Vec3 = [d[0] + (c[0] - d[0]) * u, d[1] + (c[1] - d[1]) * u, d[2] + (c[2] - d[2]) * u];
  return [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t];
}

function quadPatch(f: FpvFace, u0: number, u1: number, t0: number, t1: number): Vec3[] {
  return [onQuad(f, u0, t0), onQuad(f, u1, t0), onQuad(f, u1, t1), onQuad(f, u0, t1)];
}

// Glass: dark, with the sprite's light glass kept as a reflection strip along the top and roof-colour pillars.
function glaze(f: FpvFace, roof: string, pillar: number): void {
  // Bottom edge of each greenhouse face is the edge with the lowest points; reorder so pts[0..1] is that edge.
  const zs = f.pts.map((p) => p[2]);
  const minZ = Math.min(...zs);
  let i0 = 0;
  for (let i = 0; i < 4; i++) {
    if (f.pts[i]![2] < minZ + 0.05 && f.pts[(i + 1) % 4]![2] < minZ + 0.05) i0 = i;
  }
  const quad = { ...f, pts: [0, 1, 2, 3].map((k) => f.pts[(i0 + k) % 4]!) };
  decal(f, quadPatch(quad, 0, 1, 0.8, 1), GLASS_SHEEN);
  decal(f, quadPatch(quad, 0, pillar, 0, 1), roof);
  decal(f, quadPatch(quad, 1 - pillar, 1, 0, 1), roof);
}

export function carModelFpv(sc: CarScheme, livery: Livery): FpvModel {
  const body = sc.body;
  const roof = sc.roof;

  // Body: one closed prism of the side profile.
  const bodyPiece = prism(PROFILE, -BODY_W, BODY_W, body, { outline: true });
  const rear = faceAlong(bodyPiece, [-1, 0, 0]);
  const front = faceAlong(bodyPiece, [1, 0, 0]);
  const sides = [faceAlong(bodyPiece, [0, -1, 0]), faceAlong(bodyPiece, [0, 1, 0])] as const;
  const nose = topFace(bodyPiece, 1.85);
  const hood = topFace(bodyPiece, 1.0);
  const trunk = topFace(bodyPiece, -1.5);

  // Greenhouse: a frustum standing on the deck; its roof is parallel to the deck so every face is planar.
  const cz = (x: number) => CABIN_Z0 + CABIN_SLOPE * (CABIN_X0 - x);
  const bf = (s: number): Vec3 => [CABIN_X0, s * 0.8, cz(CABIN_X0)];
  const br = (s: number): Vec3 => [-1.0, s * 0.8, cz(-1.0)];
  const rf = (s: number): Vec3 => [0.02, s * 0.64, cz(0.02) + 0.46];
  const rr = (s: number): Vec3 => [-0.62, s * 0.64, cz(-0.62) + 0.46];
  const cabin = piece([
    { pts: [bf(-1), bf(1), rf(1), rf(-1)], color: GLASS_DARK, o: { outline: true } },
    { pts: [br(1), br(-1), rr(-1), rr(1)], color: GLASS_DARK, o: { outline: true } },
    { pts: [br(-1), bf(-1), rf(-1), rr(-1)], color: GLASS_DARK, o: { outline: true } },
    { pts: [bf(1), br(1), rr(1), rf(1)], color: GLASS_DARK, o: { outline: true } },
    { pts: [rr(-1), rf(-1), rf(1), rr(1)], color: roof, o: { outline: true } },
    { pts: [bf(-1), br(-1), br(1), bf(1)], color: body, o: { hidden: true } },
  ]);
  glaze(cabin.faces[0]!, roof, 0.07);
  glaze(cabin.faces[1]!, roof, 0.07);
  glaze(cabin.faces[2]!, roof, 0.09);
  glaze(cabin.faces[3]!, roof, 0.09);

  // Spoiler: a closed wing box between two end plates that stand on the deck.
  const wing = box(-2.0, -1.8, -WING_HW, WING_HW, 1.0, 1.06, roof, { outline: true });
  const plates = [-1, 1].map((s) => box(-2.0, -1.8, s * WING_HW, s * (WING_HW + 0.04), PLATE_Z0, 1.08, roof, { outline: true }));

  // Tyres: octagonal prisms. Tread faces that lie inside the body can never be seen and are not drawn.
  const tyreProfile = ring(0, TYRE_Z, TYRE_R, 8);
  const tyres = [-1, 1].flatMap((s) =>
    [-TYRE_X, TYRE_X].map((tx) =>
      prism(
        tyreProfile.map(([x, z]) => [x + tx, z] as [number, number]),
        s * TYRE_IN,
        s * BODY_W,
        TREAD_FACE,
        {},
        (i) => tyreProfile[i]![1] >= BODY_ZB && tyreProfile[(i + 1) % 8]![1] >= BODY_ZB,
      ),
    ),
  );
  // The outer slice of each tyre lies outside the body, so it is a separate piece; its cap carries the rim.
  const wheels = [-1, 1].flatMap((s) =>
    [-TYRE_X, TYRE_X].map((tx) => {
      const w = prism(
        tyreProfile.map(([x, z]) => [x + tx, z] as [number, number]),
        s * BODY_W,
        s * TYRE_OUT,
        TREAD,
        { flat: true },
      );
      const cap = faceAlong(w, [0, s, 0]);
      const onCap = (xz: [number, number][]) => xz.map(([x, z]) => [x, s * TYRE_OUT, z] as Vec3);
      decal(cap, onCap(ring(tx, TYRE_Z, 0.13, 8)), RIM, { flat: true });
      decal(cap, onCap(ring(tx, TYRE_Z, 0.05, 6)), HUB, { flat: true, detail: true });
      return w;
    }),
  );
  const floor = box(-1.85, 1.85, -FLOOR_HW, FLOOR_HW, 0.04, BODY_ZB, FLOOR);
  for (const f of floor.faces) if (f.normal[2] > 0.9) f.hidden = true;
  const skirt = box(-TYRE_X - 0.3, TYRE_X + 0.3, -BODY_W, BODY_W, 0.02, BODY_ZB, TREAD_FACE);
  for (const f of skirt.faces) if (f.normal[2] > 0.9) f.hidden = true;

  // Sides: white squares, livery, wheel arches and wheels, number roundel.
  for (const [k, side] of sides.entries()) {
    const s = k === 0 ? -1 : 1;
    if (livery === 'stripes') {
      decal(side, onSide(s, rect(-1.96, 1.97, 0.6, 0.64)), roof);
      decal(side, onSide(s, rect(-1.96, 1.85, 0.68, 0.72)), roof);
    }
    if (livery === 'arrow') {
      decal(
        side,
        onSide(s, [
          [-1.96, 0.66],
          [1.25, 0.66],
          [1.25, 0.62],
          [1.86, 0.69],
          [1.25, 0.76],
          [1.25, 0.72],
          [-1.96, 0.72],
        ]),
        roof,
      );
    }
    if (livery === 'flames') {
      decal(
        side,
        onSide(s, [
          [1.98, 0.28],
          [1.98, 0.64],
          [1.62, 0.56],
          [1.4, 0.72],
          [1.15, 0.52],
          [0.9, 0.64],
          [0.62, 0.42],
          [0.35, 0.3],
        ]),
        FLAME_OUT,
      );
      decal(
        side,
        onSide(s, [
          [1.96, 0.32],
          [1.96, 0.54],
          [1.66, 0.48],
          [1.45, 0.6],
          [1.22, 0.45],
          [0.95, 0.5],
          [0.7, 0.34],
        ]),
        FLAME_IN,
      );
    }
    if (livery === 'band') decal(side, onSide(s, rect(-1.92, 1.96, 0.4, 0.64)), roof);
    // White squares over the livery so flames and band do not hide them.
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++)
        decal(side, onSide(s, rect(0.5 + j * 0.2, 0.59 + j * 0.2, 0.3 + i * 0.1, 0.36 + i * 0.1)), WHITE, { flat: true, detail: true });
    }
    for (const tx of [-TYRE_X, TYRE_X]) {
      const arch = ring(tx, TYRE_Z, 0.36, 6, 0, Math.PI);
      arch.unshift([tx + 0.36, BODY_ZB]);
      arch.push([tx - 0.36, BODY_ZB]);
      decal(side, onSide(s, arch), hexDarken(body, -0.65), { flat: true });
    }
    decal(side, onSide(s, ring(-0.25, 0.5, 0.15, 8)), WHITE, { flat: true });
    decal(side, onSide(s, ring(-0.25, 0.5, 0.105, 8)), sc.number, { flat: true, detail: true });
  }

  // Rear: diffuser, roof-colour lip, livery, number panel.
  decal(rear, onRear(rect(-BODY_W, BODY_W, BODY_ZB, 0.3)), DARK);
  for (const y of [-0.5, -0.17, 0.17, 0.5]) decal(rear, onRear(rect(y - 0.02, y + 0.02, BODY_ZB, 0.27)), '#3a3a3a', { detail: true });
  decal(rear, onRear(rect(-BODY_W, BODY_W, 0.84, 0.9)), roof);
  if (livery === 'stripes') for (const y0 of [-0.3, 0.14]) decal(rear, onRear(rect(y0, y0 + 0.16, 0.3, 0.84)), roof);
  if (livery === 'arrow') {
    decal(
      rear,
      onRear([
        [0, 0.82],
        [-0.36, 0.5],
        [-0.36, 0.38],
        [0, 0.7],
        [0.36, 0.38],
        [0.36, 0.5],
      ]),
      roof,
    );
  }
  if (livery === 'flames') {
    const outer: YZ[] = [
      [-0.84, 0.3],
      [-0.28, 0.3],
      [-0.4, 0.36],
      [-0.5, 0.34],
      [-0.62, 0.42],
      [-0.72, 0.38],
      [-0.84, 0.44],
    ];
    const inner: YZ[] = [
      [-0.82, 0.3],
      [-0.4, 0.3],
      [-0.5, 0.33],
      [-0.62, 0.37],
      [-0.72, 0.34],
      [-0.82, 0.38],
    ];
    for (const m of [false, true]) {
      decal(rear, onRear(m ? mirrorY(outer) : outer), FLAME_OUT);
      decal(rear, onRear(m ? mirrorY(inner) : inner), FLAME_IN);
    }
  }
  // The band runs above the tail lamps here so they do not cut it in three.
  if (livery === 'band') decal(rear, onRear(rect(-BODY_W, BODY_W, 0.62, 0.8)), roof);
  // Number plate between the stripes (|y| ≤ 0.12), so the stripes stay whole.
  const plate = decal(rear, onRear(rect(-0.12, 0.12, 0.31, 0.43)), sc.number, { flat: true, detail: true });
  for (const y0 of [-0.09, 0.01]) decal(plate, onRear(rect(y0, y0 + 0.08, 0.35, 0.39)), WHITE, { flat: true, detail: true });

  // Nose: grille, livery.
  decal(front, onFront(rect(-0.36, 0.36, 0.2, 0.3)), DARK, { detail: true });
  if (livery === 'stripes') for (const y0 of [-0.3, 0.14]) decal(front, onFront(rect(y0, y0 + 0.16, 0.32, 0.7)), roof);
  if (livery === 'arrow') {
    decal(
      front,
      onFront([
        [0, 0.68],
        [-0.3, 0.46],
        [-0.3, 0.36],
        [0, 0.58],
        [0.3, 0.36],
        [0.3, 0.46],
      ]),
      roof,
    );
  }
  if (livery === 'flames') {
    decal(
      front,
      onFront([
        [-0.36, 0.32],
        [0.36, 0.32],
        [0.26, 0.42],
        [0.16, 0.38],
        [0.08, 0.52],
        [0, 0.44],
        [-0.08, 0.52],
        [-0.16, 0.38],
        [-0.26, 0.42],
      ]),
      FLAME_OUT,
    );
  }
  if (livery === 'band') decal(front, onFront(rect(-BODY_W, BODY_W, 0.54, 0.68)), roof);

  // Top surfaces keep the sprite livery (hood, trunk) for views from a little above.
  if (livery === 'stripes') {
    for (const y0 of [-0.3, 0.14]) {
      decal(nose, onTop(rect(1.7, 2, y0, y0 + 0.16)), roof);
      decal(hood, onTop(rect(CABIN_X0, 1.7, y0, y0 + 0.16)), roof);
      decal(trunk, onTop(rect(-2, -1.0, y0, y0 + 0.16)), roof);
      for (const f of wing.faces) {
        if (f.normal[2] > 0.9)
          decal(
            f,
            rect(-2.0, -1.8, y0, y0 + 0.16).map(([x, y]) => [x, y, 1.06] as Vec3),
            body,
          );
        if (f.normal[0] < -0.9)
          decal(
            f,
            rect(y0, y0 + 0.16, 1.0, 1.06).map(([y, z]) => [-2.0, y, z] as Vec3),
            body,
          );
      }
    }
  }
  if (livery === 'arrow') {
    decal(
      hood,
      onTop([
        [1.6, 0],
        [0.95, -0.55],
        [0.7, -0.55],
        [1.25, 0],
        [0.7, 0.55],
        [0.95, 0.55],
      ]),
      roof,
    );
  }
  if (livery === 'flames') {
    decal(
      hood,
      onTop([
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
      ]),
      FLAME_OUT,
    );
  }

  for (const f of [rear, front]) for (const d of f.decals) d.broad = !d.detail;

  return { tyres, wheels, floor, skirt, body: bodyPiece, cabin, wing, plates };
}

const fpvCache = new Map<number, FpvModel>();

export function carFacesFpv(colorIdx: number): FpvModel {
  let m = fpvCache.get(colorIdx);
  if (!m) {
    m = carModelFpv(CAR_SCHEMES[colorIdx % CAR_SCHEMES.length]!, LIVERIES[colorIdx % LIVERIES.length]!);
    fpvCache.set(colorIdx, m);
  }
  return m;
}

export function fpvPieces(m: FpvModel): FpvPiece[] {
  return [...m.tyres, ...m.wheels, m.floor, m.skirt, m.body, m.cabin, m.wing, ...m.plates];
}

// How much of a car is drawn, from its length on screen in device px: 0 everything, 1 without small details,
// 2 body, greenhouse, spoiler, a dark underside and the broad rear and nose livery.
export const LOD_DETAIL_PX = 110;
export const LOD_LIVERY_PX = 30;
// A car switches tier only once it is this far past a threshold, so it does not flicker on the boundary.
export const LOD_HYSTERESIS = 0.07;

export function carLod(lengthPx: number, prev: -1 | 0 | 1 | 2 = -1): 0 | 1 | 2 {
  const h = prev < 0 ? 0 : LOD_HYSTERESIS;
  // Leaving a finer tier needs the size to drop below the threshold by h; entering one, to exceed it by h.
  const detail = LOD_DETAIL_PX * (prev === 0 ? 1 - h : 1 + h);
  const livery = LOD_LIVERY_PX * (prev === 2 ? 1 + h : 1 - h);
  if (lengthPx >= detail) return 0;
  if (lengthPx >= livery) return 1;
  return 2;
}
