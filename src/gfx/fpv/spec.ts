import type { Track } from '../../track/common';
import type { Parts } from './kit';
import type { PaddockAt } from './paddock3d';
import type { PitScene } from './pitScene';

/** What the scene builder needs to know about one type of track. */
export interface SceneSpec {
  track: Track;
  pit: PitScene;
  paddock: PaddockAt;
  /** The ground under everything. */
  ground(P: Parts): void;
  /** Lane lines, edge lines, the finish line and the walls. */
  ribbon(P: Parts): void;
  /** Raised ground the paddock stands on. */
  base(P: Parts): void;
  /** Floodlight masts and their pools of light. */
  masts(P: Parts): void;
  /** Landmarks of this track only, built last. */
  extras(P: Parts): void;
}
