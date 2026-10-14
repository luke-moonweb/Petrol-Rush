export const WORLD_W = 2240;
export const CY = 208;
export const R_OUT = 194;
export const R_IN = 100;
export const RC = (R_OUT + R_IN) / 2;
export const HALF_W = (R_OUT - R_IN) / 2;
export const CX_L = 208;
export const CX_R = WORLD_W - 208;
export const FINISH_X = WORLD_W / 2;
export const STRAIGHT = CX_R - CX_L;
export const TURN_LEN = Math.PI * RC;
export const TRACK_LEN = 2 * STRAIGHT + 2 * TURN_LEN;
export const S_TURN1 = CX_R - FINISH_X;
export const S_TOP = S_TURN1 + TURN_LEN;
export const S_TURN2 = S_TOP + STRAIGHT;
export const S_BOTTOM = S_TURN2 + TURN_LEN;
export const NUM_SECTORS = 8;
export const SECTOR_LEN = TRACK_LEN / NUM_SECTORS;

export const CURB_H = 15;
export const PIT_LABEL_TOP = CY + 28;

export const PIT_X0 = 400;
export const PIT_X1 = WORLD_W - 400;
export const PIT_BOX_TOP = PIT_LABEL_TOP + CURB_H;
export const PIT_LANE_TOP = CY + 64;
export const PIT_WALL_TOP = CY + 92;
export const SEP_BOTTOM = CY + R_IN;
export const PIT_BOX_Y = (PIT_BOX_TOP + PIT_LANE_TOP) / 2;
export const PIT_DRIVE_Y = (PIT_LANE_TOP + PIT_WALL_TOP) / 2 + 1;
export const NUM_BOXES = 20;
export const BOX_PITCH = (PIT_X1 - PIT_X0) / NUM_BOXES;
export const BOX_W = BOX_PITCH - 14;

export const ISLE_R = R_IN - 12;
export const ISLE_ROAD_R = 20;
export const WALL_X0 = CX_L + 70;
export const WALL_X1 = CX_R - 70;
export const PIT_LINE_IN_X = PIT_X0 + 14;
export const PIT_LINE_OUT_X = PIT_X1 - 22;
export const PIT_ROAD_Y = (CY + ISLE_ROAD_R + CURB_H + PIT_WALL_TOP) / 2;

export function islandR(phi: number): number {
  if (phi <= -30) return ISLE_R;
  if (phi >= 50) return ISLE_ROAD_R;
  const t = (phi + 30) / 80;
  const s = t * t * (3 - 2 * t);
  return ISLE_R + (ISLE_ROAD_R - ISLE_R) * s;
}

function islandArc(pts: [number, number][], right: boolean, from: number, to: number, dyFor: (phi: number) => number): void {
  const step = from < to ? 3 : -3;
  for (let a = from; step > 0 ? a <= to : a >= to; a += step) {
    const r = islandR(a);
    const c = Math.cos((a * Math.PI) / 180);
    const s = Math.sin((a * Math.PI) / 180);
    pts.push([right ? CX_R + r * c : CX_L - r * c, CY + r * s + dyFor(a)]);
  }
}

export function islandOutline(dy: number): [number, number][] {
  const roadY = CY + ISLE_ROAD_R + dy;
  const pts: [number, number][] = [
    [CX_L, CY - ISLE_R + dy],
    [CX_R, CY - ISLE_R + dy],
  ];
  islandArc(pts, true, -90, 90, () => dy);
  pts.push([PIT_X1 + 8, roadY], [PIT_X1 - 10, PIT_LABEL_TOP + dy], [PIT_X0 + 10, PIT_LABEL_TOP + dy], [PIT_X0 - 8, roadY]);
  islandArc(pts, false, 90, -90, () => dy);
  return pts;
}

export function islandHull(): [number, number][] {
  const roadY = CY + ISLE_ROAD_R + CURB_H;
  const pts: [number, number][] = [
    [CX_L, CY - ISLE_R],
    [CX_R, CY - ISLE_R],
  ];
  islandArc(pts, true, -90, 0, () => 0);
  islandArc(pts, true, 0, 90, () => CURB_H);
  pts.push([PIT_X1 + 8, roadY], [PIT_X1 - 10, PIT_LABEL_TOP + CURB_H], [PIT_X0 + 10, PIT_LABEL_TOP + CURB_H], [PIT_X0 - 8, roadY]);
  islandArc(pts, false, 90, 0, () => CURB_H);
  islandArc(pts, false, 0, -90, () => 0);
  return pts;
}

let hull: [number, number][] | null = null;
let hullRadius: Float32Array | null = null;

export function islandHullR(phi: number): number {
  if (!hull) hull = islandHull();
  if (!hullRadius) {
    const t = new Float32Array(181);
    const h = hull;
    for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
      for (let k = 0; k <= 8; k++) {
        const x = h[j]![0] + ((h[i]![0] - h[j]![0]) * k) / 8;
        const y = h[j]![1] + ((h[i]![1] - h[j]![1]) * k) / 8;
        if (x > CX_L) continue;
        const a = Math.round((Math.atan2(y - CY, CX_L - x) * 180) / Math.PI);
        if (a < -90 || a > 90) continue;
        t[a + 90] = Math.max(t[a + 90]!, Math.hypot(x - CX_L, y - CY));
      }
    }
    for (let a = 1; a <= 180; a++) if (t[a] === 0) t[a] = t[a - 1]!;
    hullRadius = t;
  }
  const a = Math.max(-90, Math.min(90, Math.round(phi)));
  let r = 0;
  for (let d = -6; d <= 6; d++) r = Math.max(r, hullRadius[Math.max(0, Math.min(180, a + 90 + d))]!);
  return r;
}

function collideIsland(p: { x: number; y: number }, r: number): WallNormal | null {
  if (p.x < CX_L - ISLE_R - r || p.x > CX_R + ISLE_R + r || p.y < CY - ISLE_R - r || p.y > CY + ISLE_ROAD_R + CURB_H + r) {
    return null;
  }
  if (!hull) hull = islandHull();
  const h = hull;
  let inside = false;
  let best = Infinity;
  let qx = 0;
  let qy = 0;
  for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
    const [ax, ay] = h[j]!;
    const [bx, by] = h[i]!;
    if (ay > p.y !== by > p.y && p.x < ((bx - ax) * (p.y - ay)) / (by - ay) + ax) inside = !inside;
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey || 1e-9;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.y - ay) * ey) / len2));
    const cx = ax + ex * t;
    const cy = ay + ey * t;
    const d2 = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    if (d2 < best) {
      best = d2;
      qx = cx;
      qy = cy;
    }
  }
  const dist = Math.sqrt(best);
  if (!inside && dist >= r) return null;
  let nx = (p.x - qx) / (dist || 1e-6);
  let ny = (p.y - qy) / (dist || 1e-6);
  if (inside) {
    nx = -nx;
    ny = -ny;
  }
  p.x = qx + nx * r;
  p.y = qy + ny * r;
  return { nx, ny };
}

export const STANDS_X1 = WORLD_W - 447;
export const STANDS_BOTTOM = PIT_LABEL_TOP;

export const CAR_R = 7;
export const LANES = [-28.5, -9.5, 9.5, 28.5];

export function wrapS(s: number): number {
  s %= TRACK_LEN;
  return s < 0 ? s + TRACK_LEN : s;
}

export function deltaS(a: number, b: number): number {
  let d = wrapS(b - a);
  if (d > TRACK_LEN / 2) d -= TRACK_LEN;
  return d;
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export interface TrackPoint {
  x: number;
  y: number;
  heading: number;
}

export function pointAt(sIn: number, d: number): TrackPoint {
  const s = wrapS(sIn);
  if (s < S_TURN1) return { x: FINISH_X + s, y: CY + RC + d, heading: 0 };
  if (s < S_TOP) {
    const th = Math.PI / 2 - (s - S_TURN1) / RC;
    return arcPoint(CX_R, th, RC + d);
  }
  if (s < S_TURN2) return { x: CX_R - (s - S_TOP), y: CY - RC - d, heading: Math.PI };
  if (s < S_BOTTOM) {
    const th = -Math.PI / 2 - (s - S_TURN2) / RC;
    return arcPoint(CX_L, th, RC + d);
  }
  return { x: CX_L + (s - S_BOTTOM), y: CY + RC + d, heading: 0 };
}

function arcPoint(cx: number, th: number, r: number): TrackPoint {
  const c = Math.cos(th);
  const sn = Math.sin(th);
  return { x: cx + r * c, y: CY + r * sn, heading: Math.atan2(-c, sn) };
}

export function project(x: number, y: number): { s: number; d: number } {
  if (x > CX_R) {
    const dx = x - CX_R;
    const dy = y - CY;
    const t = Math.PI / 2 - Math.atan2(dy, dx);
    return { s: S_TURN1 + t * RC, d: Math.hypot(dx, dy) - RC };
  }
  if (x < CX_L) {
    const dx = x - CX_L;
    const dy = y - CY;
    let th = Math.atan2(dy, dx);
    if (th > 0) th -= 2 * Math.PI;
    const t = -Math.PI / 2 - th;
    return { s: S_TURN2 + t * RC, d: Math.hypot(dx, dy) - RC };
  }
  if (y < CY) return { s: S_TOP + (CX_R - x), d: CY - RC - y };
  return { s: wrapS(x - FINISH_X), d: y - (CY + RC) };
}

export function inTurn(x: number): boolean {
  return x < CX_L || x > CX_R;
}

export function inPitRange(x: number): boolean {
  return x >= PIT_X0 && x <= PIT_X1;
}

export function inWallRange(x: number): boolean {
  return x >= WALL_X0 && x <= WALL_X1;
}

export function inPitLane(x: number, y: number): boolean {
  return inPitRange(x) && y > PIT_BOX_TOP - 4 && y < PIT_WALL_TOP + 4;
}

export function inPitBox(x: number, y: number): boolean {
  return inPitRange(x) && y > PIT_BOX_TOP - 4 && y < PIT_LANE_TOP + 6;
}

export function boxX(i: number): number {
  return PIT_X0 + BOX_PITCH / 2 + i * BOX_PITCH;
}

export interface Constrainable {
  x: number;
  y: number;
  pitSide: boolean;
  wasInPit: boolean;
}

export interface WallNormal {
  nx: number;
  ny: number;
}

export function constrainPos(p: Constrainable): WallNormal | null {
  const r = CAR_R;
  let hit: WallNormal | null = null;

  if (p.x < CX_L || p.x > CX_R) {
    const cx = p.x < CX_L ? CX_L : CX_R;
    const dx = p.x - cx;
    const dy = p.y - CY;
    const dist = Math.hypot(dx, dy) || 1e-6;
    const maxR = R_OUT - r;
    if (dist > maxR) {
      p.x = cx + (dx / dist) * maxR;
      p.y = CY + (dy / dist) * maxR;
      hit = { nx: -dx / dist, ny: -dy / dist };
    }
  } else if (p.y < CY) {
    const minY = CY - R_OUT + r;
    if (p.y < minY) {
      p.y = minY;
      hit = { nx: 0, ny: 1 };
    }
  } else {
    const maxY = CY + R_OUT - r;
    if (p.y > maxY) {
      p.y = maxY;
      hit = { nx: 0, ny: -1 };
    }
  }

  const wallBand = p.y > PIT_WALL_TOP - r && p.y < SEP_BOTTOM + r;
  if (p.y > CY && inWallRange(p.x)) {
    if (!p.wasInPit) {
      if (wallBand) {
        if (p.x - WALL_X0 < WALL_X1 - p.x) {
          p.x = WALL_X0 - r;
          hit = { nx: -1, ny: 0 };
        } else {
          p.x = WALL_X1 + r;
          hit = { nx: 1, ny: 0 };
        }
        return hit;
      }
      p.pitSide = p.y < (PIT_WALL_TOP + SEP_BOTTOM) / 2;
      p.wasInPit = true;
    }
    if (p.pitSide && p.y > PIT_WALL_TOP - r) {
      p.y = PIT_WALL_TOP - r;
      hit = { nx: 0, ny: -1 };
    } else if (!p.pitSide && p.y < SEP_BOTTOM + r) {
      p.y = SEP_BOTTOM + r;
      hit = { nx: 0, ny: 1 };
    }
  } else {
    p.wasInPit = false;
    if (p.y > CY && wallBand) {
      if (p.x >= WALL_X0 - r && p.x < WALL_X0) {
        p.x = WALL_X0 - r;
        hit = { nx: -1, ny: 0 };
      } else if (p.x > WALL_X1 && p.x <= WALL_X1 + r) {
        p.x = WALL_X1 + r;
        hit = { nx: 1, ny: 0 };
      }
    }
  }

  const isl = collideIsland(p, r);
  if (isl) hit = isl;
  return hit;
}

export function trackHeadingAt(x: number, y: number): number {
  return pointAt(project(x, y).s, 0).heading;
}
