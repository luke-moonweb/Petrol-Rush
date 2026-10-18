import type { Difficulty } from '../config';

// AI driver personalities and the difficulty levels. A driver's personality comes from one seeded draw
// (`temper`, Race.drawSkill); the difficulty sets the mix of personalities and scales pace and mistakes.

export type PersonaKind = 'gentle' | 'neutral' | 'aggressive' | 'blocker';

export interface Persona {
  kind: PersonaKind;
  /** Share of the planned braking rate: under 1 brakes earlier, over 1 later. */
  brake: number;
  /** Extra follow gap (px) behind a slower car (negative: closer). */
  gapPx: number;
  /** A pass needs this much straight (px) ahead with no curvature. */
  passClearPx: number;
  /** A pass needs the car ahead this much (mph) slower than our target. */
  passMph: number;
  /** Chance of a controlled turn-in slide per corner (before the difficulty scales it). */
  slide: number;
  /** Covers the inside before a corner when a car is close behind (ai.ts blockInside). */
  blocks: boolean;
}

export const PERSONAS: Record<PersonaKind, Persona> = {
  gentle: { kind: 'gentle', brake: 0.92, gapPx: 10, passClearPx: 200, passMph: 3, slide: 0.03, blocks: false },
  neutral: { kind: 'neutral', brake: 1, gapPx: 0, passClearPx: 160, passMph: 0, slide: 0.06, blocks: false },
  aggressive: { kind: 'aggressive', brake: 1.06, gapPx: -2, passClearPx: 140, passMph: 0, slide: 0.15, blocks: false },
  blocker: { kind: 'blocker', brake: 1, gapPx: 0, passClearPx: 160, passMph: 0, slide: 0.06, blocks: true },
};

export const PERSONA_KINDS: PersonaKind[] = ['gentle', 'neutral', 'aggressive', 'blocker'];

/** What a difficulty level does to the AI field. Normal is the plain driving (all factors 1). */
export interface Level {
  /** Factor on the grip fraction a driver corners at (planner.ts gripFrac). */
  grip: number;
  /** Factor on the share of the width the racing line uses (planner.ts lineUse). */
  line: number;
  /** Factor on the reaction time (oil, hazards, the start). */
  reaction: number;
  /** Factor on the chance of a turn-in slide. */
  slide: number;
  /** Shares of gentle, neutral, aggressive and blocker drivers (PERSONA_KINDS order). */
  mix: [number, number, number, number];
}

export const LEVELS: Record<Difficulty, Level> = {
  easy: { grip: 0.95, line: 0.9, reaction: 1.4, slide: 1.6, mix: [0.45, 0.4, 0.1, 0.05] },
  normal: { grip: 1, line: 1, reaction: 1, slide: 1, mix: [0.25, 0.4, 0.2, 0.15] },
  hard: { grip: 1.02, line: 1.04, reaction: 0.75, slide: 0.6, mix: [0.1, 0.35, 0.3, 0.25] },
};

/** The personality of a driver whose draw is `temper` (0..1), in the level's mix. */
export function personaOf(temper: number, difficulty: Difficulty): Persona {
  const mix = LEVELS[difficulty].mix;
  let acc = 0;
  for (let i = 0; i < mix.length; i++) {
    acc += mix[i]!;
    if (temper < acc) return PERSONAS[PERSONA_KINDS[i]!];
  }
  return PERSONAS[PERSONA_KINDS[mix.length - 1]!];
}

/** A deterministic 0..1 value for (a, b, c): per-corner choices with no RNG draw (the race RNG order stays). */
export function hash01(a: number, b: number, c: number): number {
  let h = Math.imul((a * 2654435761) >>> 0, 0x85ebca6b) ^ Math.imul(b + 0x9e3779b9, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
