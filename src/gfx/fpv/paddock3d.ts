import { createRng } from '../../sim/rng';
import {
  PAD_BOTTOM,
  PAD_L0,
  PAD_TOP,
  POOL_ROW_Y,
  RC_FRONT,
  RC_TOP,
  RC_X0,
  RC_X1,
  STAND_FRONT,
  STAND_TOP,
  STAND_X0,
  STAND_X1,
  TEAMS,
  UNIT_TOP,
  UNIT_W,
  unitXs,
} from '../track/oval/paddock';
import { rect, upright } from './geom';
import { box, ground, label, night, type Parts } from './kit';
import { lazyCanvas, type TexQuad, texQuad } from './texture';

// The paddock in 3D: team garages, the grandstand with its crowd, race control and the light pools in
// front of them. It is laid out in the oval's paddock coordinates (as the top-down canvases draw it);
// another track moves it by (dx, dy), as `withPaddock` in circuit/canvas.ts does.

export interface PaddockAt {
  dx: number;
  dy: number;
  /** Height of the ground the paddock stands on. */
  z: number;
}

const TIERS = 4;
const STAND_DEPTH = (STAND_FRONT - STAND_TOP) / TIERS;

export const crowd = lazyCanvas(96, 32, (g) => {
  const rng = createRng(4711);
  g.fillStyle = '#1C1830';
  g.fillRect(0, 0, 96, 32);
  const shirts = ['#E63B2E', '#FFB627', '#12B5A6', '#FFF8E8', '#2633C5', '#C8F03C', '#F06EAA'];
  const skin = ['#f0c098', '#e0a878', '#c88a5a', '#8a5a38'];
  for (let y = 3; y < 30; y += 9) {
    g.fillStyle = '#2A2640';
    g.fillRect(0, y + 6, 96, 2);
    for (let x = 1; x < 96; x += 5) {
      if (rng() < 0.12) continue;
      g.fillStyle = shirts[Math.floor(rng() * shirts.length)]!;
      g.fillRect(x, y + 2, 4, 4);
      g.fillStyle = skin[Math.floor(rng() * skin.length)]!;
      g.fillRect(x + 1, y - 1, 2, 3);
    }
  }
});

const windows = lazyCanvas(96, 40, (g) => {
  g.fillStyle = '#3A3846';
  g.fillRect(0, 0, 96, 40);
  for (let x = 4; x < 92; x += 16) {
    g.fillStyle = '#FFD27A';
    g.fillRect(x, 6, 12, 28);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(x, 6, 12, 4);
  }
});

const garageDoor = lazyCanvas(112, 26, (g) => {
  const gr = g.createLinearGradient(0, 0, 0, 26);
  gr.addColorStop(0, '#6E6048');
  gr.addColorStop(1, '#C8B088');
  g.fillStyle = gr;
  g.fillRect(0, 0, 112, 26);
  g.fillStyle = 'rgba(23,20,43,0.35)';
  for (let x = 14; x < 112; x += 28) g.fillRect(x, 4, 2, 22);
});

/** The tarmac under the garages and race control. */
export function paddockPads(P: Parts, at: PaddockAt): void {
  const { dx, dy } = at;
  const pad = night('#4A4858');
  P.island.push(ground(rect(PAD_L0 - 8 + dx, PAD_TOP + dy, PAD_L0 + 6 * 75 + 2 + dx, PAD_BOTTOM + dy, at.z + 0.05), pad));
  P.island.push(ground(rect(RC_X0 - 8 + dx, PAD_TOP + dy, RC_X1 + 220 + dx, PAD_BOTTOM + dy, at.z + 0.05), pad));
}

/** Garages with their haulers, the grandstand's tiers and roof, race control. */
export function paddockBuildings(P: Parts, at: PaddockAt): void {
  const { dx, dy, z: base } = at;
  const solids = P.solids;
  unitXs().forEach((ux, i) => {
    const x = ux + dx;
    const tm = TEAMS[i % TEAMS.length]!;
    const y1 = UNIT_TOP + 52 + dy;
    box(solids, x + 4, UNIT_TOP - 36 + dy, x + UNIT_W - 4, UNIT_TOP - 20 + dy, base, base + 15, night(tm.a, 0.8), night(tm.a, 0.6));
    box(solids, x, UNIT_TOP + dy, x + UNIT_W, y1, base, base + 22, night(tm.a, 0.7), night(tm.a, 0.5), night(tm.a));
  });
  for (let t = 0; t < TIERS; t++) {
    const y1 = STAND_FRONT - t * STAND_DEPTH + dy;
    box(
      solids,
      STAND_X0 + dx,
      y1 - STAND_DEPTH,
      STAND_X1 + dx,
      y1,
      base,
      base + 8 + t * 9,
      night('#3a3450'),
      night(t % 2 ? '#6a4a7a' : '#4a5a8a'),
      night(t % 2 ? '#5a4a6a' : '#46405e'),
    );
  }
  box(
    solids,
    STAND_X0 + dx,
    STAND_TOP + dy,
    STAND_X1 + dx,
    STAND_TOP + STAND_DEPTH * 1.6 + dy,
    base + 44,
    base + 46,
    night('#2a2838'),
    night('#5a5870'),
  );
  box(solids, RC_X0 + dx, RC_TOP + dy, RC_X1 + dx, RC_FRONT + dy, base, base + 36, night('#4a4858'), night('#3a3846'), night('#5a5868'));
}

/** Garage doors and team names, the crowd, the grandstand and race control signs, the light pools. */
export function paddockSigns(P: Parts, at: PaddockAt): void {
  const { dx, dy, z } = at;
  unitXs().forEach((ux, i) => {
    const x = ux + dx;
    const tm = TEAMS[i % TEAMS.length]!;
    const y = UNIT_TOP + 52 + dy;
    P.signs.push(texQuad(upright(x + 8, y + 0.4, x + UNIT_W - 8, y + 0.4, z, z + 13), garageDoor));
    P.glows.push({ x: x + UNIT_W / 2, y: y + 2, z: z + 6, r: 14, color: '255,214,140' });
    P.pools.push({ x: x + UNIT_W / 2, y: y + 10, r: 26, z: z + 0.08 });
    P.signs.push(texQuad(upright(x + 4, y + 0.6, x + UNIT_W - 4, y + 0.6, z + 14, z + 21), label(240, 26, tm.name, tm.a, tm.t, 17, tm.b)));
  });
  P.signs.push(...grandstandSigns(at));
  for (const x of [560, 700, 840, 990, 1120, 1250, 1400, 1540, 1680]) P.pools.push({ x: x + dx, y: POOL_ROW_Y + dy, r: 60, z: z + 0.08 });
}

function grandstandSigns(at: PaddockAt): TexQuad[] {
  const { dx, dy, z } = at;
  const out: TexQuad[] = [];
  for (let t = 0; t < TIERS; t++) {
    const y1 = STAND_FRONT - t * STAND_DEPTH + 0.4 + dy;
    const top = z + 8 + t * 9;
    const z0 = t === 0 ? z : z + 8 + (t - 1) * 9;
    out.push(texQuad(upright(STAND_X0 + dx, y1, STAND_X1 + dx, y1, z0, top), crowd, { tile: true }));
  }
  const roof = STAND_TOP + STAND_DEPTH * 1.6 + 0.4 + dy;
  out.push(
    texQuad(
      upright(STAND_X0 + 40 + dx, roof, STAND_X1 - 40 + dx, roof, z + 34, z + 44),
      label(700, 20, 'PETROL RUSH  ·  MAIN GRANDSTAND', '#17142B', '#FFB627', 14),
      { far: 1300 },
    ),
  );
  const front = RC_FRONT + 0.6 + dy;
  out.push(texQuad(upright(RC_X0 + 6 + dx, front, RC_X1 - 6 + dx, front, z + 16, z + 28), windows, { tile: true }));
  out.push(
    texQuad(
      upright(RC_X0 + 4 + dx, front, RC_X1 - 4 + dx, front, z + 29, z + 35),
      label(340, 20, 'RACE CONTROL', '#17142B', '#FFC85A', 14),
      { far: 1300 },
    ),
  );
  return out;
}
