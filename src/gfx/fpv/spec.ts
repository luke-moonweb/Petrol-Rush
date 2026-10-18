import type { Track } from '../../track/common';
import type { Parts } from './kit';
import type { PaddockAt } from './paddock3d';
import type { PitScene } from './pitScene';

/** What stands along a track edge: a red and cream wall, a low kerb wall, or nothing (the pit). */
export type Barrier = 'wall' | 'curb' | 'none';

/** Colours and spacing of a scene. */
export interface SceneLook {
  /** The ground beyond the scene, below the horizon. */
  horizon: string;
  /** Ground just outside the barriers, and the back of a kerb wall. */
  shoulder: string;
  /** Floodlight colour, 'r,g,b'. */
  lamp: string;
  /** Distance along the lap between floodlight masts. */
  mastStep: number;
}

/**
 * What the scene builder needs to know about one type of track (one adapter per type, not per track):
 * the oval in oval.ts, the Grand Prix circuits in circuit.ts.
 */
export interface SceneSpec {
  track: Track;
  /** Extra drivable width [left, right] at s; the barrier stands at its edge. */
  kerbs(s: number): readonly [number, number];
  /** What stands along the edge on one side (-1 left, 1 right) at s. */
  barrier(side: -1 | 1, s: number): Barrier;
  pit: PitScene;
  paddock: PaddockAt;
  look: SceneLook;
  /** The ground under everything, tarmac included. */
  ground(P: Parts): void;
  /** Raised ground the paddock stands on. */
  base(P: Parts): void;
  /** Scenery of this track only, built last. */
  extras(P: Parts): void;
}
