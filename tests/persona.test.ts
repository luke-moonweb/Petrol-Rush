import { describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS, DIFFICULTY_CHOICES, type Difficulty } from '../src/config';
import type { Car } from '../src/race/car';
import { initProgress } from '../src/race/car';
import { newGrandPrix, parseGp, serializeGp } from '../src/race/grandprix';
import { hash01, LEVELS, PERSONA_KINDS, PERSONAS, type PersonaKind, personaOf } from '../src/race/persona';
import { gripFrac, lineUse, PLAN } from '../src/race/planner';
import { Race } from '../src/race/race';
import { changeOption, optionRows } from '../src/states/race/options';
import { laneCurvature } from '../src/track/curvature';
import { OVAL } from '../src/track/ovalTrack';
import { getTrack, trackIds } from '../src/track/tracks';
import { runCorner } from './sim/lab';

const race = (difficulty: Difficulty, seed: number) => new Race({ ...DEFAULT_OPTIONS, cars: 20, difficulty }, seed, true);
const ais = (r: Race) => r.cars.filter((c) => !c.isPlayer);

describe('AI personalities', () => {
  it('every level mixes the four personalities, shares adding up to 1', () => {
    for (const d of DIFFICULTY_CHOICES) {
      const mix = LEVELS[d].mix;
      expect(mix.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      expect(mix.every((m) => m > 0)).toBe(true);
    }
    expect(personaOf(0, 'normal').kind).toBe('gentle');
    expect(personaOf(0.999, 'normal').kind).toBe('blocker');
  });

  it('each AI driver gets the personality of its one draw; the player races plain', () => {
    const r = race('normal', 42);
    for (const c of ais(r)) {
      expect(c.ai.temper).toBeGreaterThanOrEqual(0);
      expect(c.ai.temper).toBeLessThan(1);
      expect(c.ai.persona).toBe(personaOf(c.ai.temper, 'normal'));
    }
    expect(r.player.ai.persona).toBe(PERSONAS.neutral);
    expect(r.player.ai.level).toBe(LEVELS.normal);
    expect(new Set(ais(r).map((c) => c.ai.temper)).size).toBe(19);
  });

  it('the difficulty does not move the draws: same seed, same skills and tempers', () => {
    const a = race('easy', 7);
    const b = race('hard', 7);
    a.cars.forEach((c, i) => {
      const o = b.cars[i]!;
      expect([c.ai.temper, c.ai.topMph, c.ai.turnMph, c.ai.pitFuelLaps]).toEqual([
        o.ai.temper,
        o.ai.topMph,
        o.ai.turnMph,
        o.ai.pitFuelLaps,
      ]);
    });
  });

  it('easy fields more gentle drivers, hard more aggressive drivers and blockers', () => {
    const count = (d: Difficulty) => {
      const n: Record<PersonaKind, number> = { gentle: 0, neutral: 0, aggressive: 0, blocker: 0 };
      for (let seed = 1; seed <= 40; seed++) for (const c of ais(race(d, seed))) n[c.ai.persona.kind]++;
      return n;
    };
    const easy = count('easy');
    const normal = count('normal');
    const hard = count('hard');
    expect(easy.gentle).toBeGreaterThan(normal.gentle);
    expect(normal.gentle).toBeGreaterThan(hard.gentle);
    expect(hard.aggressive).toBeGreaterThan(normal.aggressive);
    expect(normal.aggressive).toBeGreaterThan(easy.aggressive);
    expect(hard.blocker).toBeGreaterThan(normal.blocker);
    expect(normal.blocker).toBeGreaterThan(easy.blocker);
    for (const k of PERSONA_KINDS) expect(normal[k]).toBeGreaterThan(0);
  });

  it('gentle brakes earlier and overtakes later than aggressive, which slides more often', () => {
    const { gentle, neutral, aggressive } = PERSONAS;
    expect(gentle.brake).toBeLessThan(neutral.brake);
    expect(aggressive.brake).toBeGreaterThan(neutral.brake);
    expect(gentle.gapPx).toBeGreaterThan(aggressive.gapPx);
    expect(gentle.passClearPx).toBeGreaterThan(aggressive.passClearPx);
    expect(aggressive.slide).toBeGreaterThan(neutral.slide);
    expect(PERSONAS.blocker.blocks).toBe(true);
  });

  it('hash01 is deterministic and spread over 0..1', () => {
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    const xs = Array.from({ length: 2000 }, (_, i) => hash01(12345, i % 7, i));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});

describe('difficulty', () => {
  it('normal keeps the plain pace: grip from turnMph, line use and reaction from the draw', () => {
    for (const c of ais(race('normal', 3))) {
      expect(gripFrac(c)).toBe((c.ai.turnMph / 150) ** 2);
      const [r0, r1] = CONFIG.AI_REACTION_S;
      const [u0, u1] = PLAN.LINE_USE;
      expect(lineUse(c)).toBeCloseTo(u1 - ((u1 - u0) * (c.ai.reaction - r0)) / (r1 - r0), 12);
    }
  });

  it('easy corners slower, uses less of the width and reacts later; hard the other way', () => {
    const [e, n, h] = (['easy', 'normal', 'hard'] as const).map((d) => ais(race(d, 11)));
    e!.forEach((c, i) => {
      const cn = n![i]!;
      const ch = h![i]!;
      expect(gripFrac(c)).toBeLessThan(gripFrac(cn));
      expect(gripFrac(ch)).toBeGreaterThanOrEqual(gripFrac(cn));
      expect(gripFrac(ch)).toBeLessThanOrEqual(Math.max(gripFrac(cn), PLAN.GRIP_FRAC_MAX));
      expect(lineUse(c)).toBeLessThan(lineUse(cn));
      expect(lineUse(ch)).toBeGreaterThanOrEqual(lineUse(cn));
      expect(c.ai.reaction).toBeGreaterThan(cn.ai.reaction);
      expect(ch.ai.reaction).toBeLessThan(cn.ai.reaction);
    });
    expect(LEVELS.easy.slide).toBeGreaterThan(LEVELS.normal.slide);
    expect(LEVELS.hard.slide).toBeLessThan(LEVELS.normal.slide);
  });

  it('the race settings cycle the difficulty and show it', () => {
    let o = { ...DEFAULT_OPTIONS };
    const row = optionRows(o).findIndex((r) => r.label === 'DIFFICULTY');
    expect(optionRows(o)[row]!.value).toBe('NORMAL');
    o = changeOption(o, row, 1);
    expect(o.difficulty).toBe('hard');
    o = changeOption(o, row, 1);
    expect(o.difficulty).toBe('easy');
    expect(optionRows(o)[row]!.value).toBe('EASY');
  });

  it('a Grand Prix keeps its difficulty; one saved before it reads as normal, its drivers neutral', () => {
    const gp = newGrandPrix({ cars: 6, laps: 2, playerColor: 0, qualifying: 'last', difficulty: 'hard' }, 99, trackIds());
    const read = parseGp(serializeGp(gp), trackIds())!;
    expect(read.difficulty).toBe('hard');
    expect(read.entries.filter((e) => e.skill).every((e) => e.skill!.temper >= 0 && e.skill!.temper < 1)).toBe(true);
    const old = JSON.parse(serializeGp(gp));
    delete old.difficulty;
    for (const e of old.entries) if (e.skill) delete e.skill.temper;
    const oldRead = parseGp(JSON.stringify(old), trackIds())!;
    expect(oldRead.difficulty).toBe('normal');
    expect(oldRead.entries.filter((e) => e.skill).every((e) => personaOf(e.skill!.temper, 'normal').kind === 'neutral')).toBe(true);
  });
});

/** A straight point (s) on the oval a little before a bend, and that bend's curvature. */
function beforeBend(): { s: number; k: number } {
  const curves = OVAL.curves();
  for (let s = 0; s < OVAL.len; s += 8) {
    if (curves.at(s) === 0 && curves.at(s + 300) !== 0 && curves.at(s + 200) === 0) return { s, k: curves.at(s + 300) };
  }
  throw new Error('no bend');
}

function place(car: Car, s: number, d: number, mph: number): void {
  const p = OVAL.pointAt(s, d);
  Object.assign(car, {
    x: p.x,
    y: p.y,
    prevX: p.x,
    prevY: p.y,
    heading: p.heading,
    prevHeading: p.heading,
    moveAngle: p.heading,
    speed: mph,
    s,
    d,
  });
  initProgress(car, OVAL);
}

describe('blocker', () => {
  it('with a car close behind before a bend, moves to the inside lane once and holds it through the bend', () => {
    const { s, k } = beforeBend();
    const r = new Race({ ...DEFAULT_OPTIONS, cars: 2 }, 5, true);
    const [lead, chaser] = r.cars as [Car, Car];
    lead.ai.persona = PERSONAS.blocker;
    chaser.ai.persona = PERSONAS.neutral;
    place(lead, s, 9.5, 150);
    place(chaser, s - 45, 9.5, 152);
    lead.ai.lane = chaser.ai.lane = 9.5;
    r.start();
    r.time = 10;
    const lanes: number[] = [lead.ai.lane];
    let blocked: number | null = null;
    let leftBend = false;
    for (let i = 0; i < 60 * 6 && !leftBend; i++) {
      r.step(1 / 60, null);
      lanes.push(lead.ai.lane);
      blocked ??= lead.ai.blockLane;
      if (lead.ai.blockIn && OVAL.curves().at(lead.s) !== 0) expect(lead.ai.lane).toBe(blocked);
      leftBend = blocked !== null && lead.ai.blockLane === null;
    }
    expect(blocked).not.toBeNull();
    // (the inside: the lane with the tighter curve)
    expect(Math.abs(laneCurvature(k, blocked!))).toBeGreaterThan(Math.abs(laneCurvature(k, -blocked!)));
    // one move: from its lane to the inside, no weaving back and forth before the bend ends
    const moves = lanes.filter((l, i) => i > 0 && l !== lanes[i - 1]).length;
    expect(moves).toBe(1);
    expect(leftBend).toBe(true);
    expect(r.cars.every((c) => c.crashes === 0 && c.spinTime === 0)).toBe(true);
  });

  it('with nobody behind it drives on as any driver', () => {
    const { s } = beforeBend();
    const r = new Race({ ...DEFAULT_OPTIONS, cars: 1 }, 5, true);
    const lead = r.cars[0]!;
    lead.ai.persona = PERSONAS.blocker;
    place(lead, s, 9.5, 150);
    r.start();
    r.time = 10;
    for (let i = 0; i < 60 * 3; i++) {
      r.step(1 / 60, null);
      expect(lead.ai.blockLane).toBeNull();
    }
  });
});

describe('turn-in slide', () => {
  it('a forced slide on every corner of the lab steps the rear out and is caught: no spin, no wall', () => {
    for (const [r, deg] of [
      [60, 135],
      [100, 90],
      [140, 135],
      [200, 180],
    ] as const) {
      for (const skill of [0, 1]) {
        const run = runCorner({ r, deg, driver: 'ai', mode: 'flat', skill, slide: true });
        expect(run.spun, `r ${r} deg ${deg} skill ${skill}`).toBe(false);
        expect(run.wallHits, `r ${r} deg ${deg} skill ${skill}`).toBe(0);
      }
    }
    const fast = runCorner({ r: 140, deg: 90, driver: 'ai', mode: 'flat', skill: 1, slide: true });
    const plain = runCorner({ r: 140, deg: 90, driver: 'ai', mode: 'flat', skill: 1 });
    expect(fast.maxSlipDeg).toBeGreaterThan(plain.maxSlipDeg + 3);
    expect(fast.loose).toBe(false);
  });

  it('AI drivers slide now and then in a race, with no spins', () => {
    const r = new Race(
      { ...DEFAULT_OPTIONS, track: 'finale', cars: 20, laps: 2, qualifying: 'middle' },
      3,
      true,
      undefined,
      getTrack('finale'),
    );
    r.start();
    let slides = 0;
    const prev = r.cars.map(() => 0);
    while (!r.allFinished() && r.time < 300) {
      r.step(1 / 60, null);
      r.cars.forEach((c, i) => {
        if (c.ai.slide === 2 && prev[i] !== 2) slides++;
        prev[i] = c.ai.slide;
      });
    }
    expect(slides).toBeGreaterThan(3);
    expect(r.cars.reduce((a, c) => a + c.crashes, 0)).toBe(0);
  });
});
