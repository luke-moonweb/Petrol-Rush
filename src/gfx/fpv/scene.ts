import type { Track } from '../../track/common';
import { SegmentTrack } from '../../track/segment';
import { PIT_D } from '../../track/straightPit';
import { circuitSpec } from './circuit';
import { attachSigns, emptyParts, type Parts } from './kit';
import { OVAL_SPEC } from './oval';
import { paddockBuildings, paddockPads, paddockSigns } from './paddock3d';
import { pitScene } from './pitScene';
import { ribbon } from './ribbon';
import type { Sky } from './sky';
import type { SceneSpec } from './spec';

export type { Glow, Pool } from './kit';

/** The static 3D world of one track; `signs` holds only the signs that hang on no wall. */
export interface Scene extends Parts {
  sky: Sky;
  /** The pit lane's driving line, for the minimap. */
  pitLine: { x0: number; x1: number; y: number };
}

/** Builds the static scene of a track from its spec. Within each list, the order is the draw order. */
export function buildScene(spec: SceneSpec): Scene {
  const P = emptyParts();
  spec.ground(P);
  ribbon(P, spec);
  spec.base(P);
  paddockPads(P, spec.paddock);
  pitScene(P, spec.pit);
  paddockBuildings(P, spec.paddock);
  paddockSigns(P, spec.paddock);
  spec.extras(P);
  P.signs = attachSigns(P.solids, P.signs);
  const { pit, look } = spec;
  return {
    ...P,
    sky: { ...look.sky, ground: look.horizon },
    pitLine: { x0: pit.x0, x1: pit.x1, y: pit.y0 + PIT_D.DRIVE },
  };
}

/** The adapter for the track's type. */
export function sceneSpec(track: Track): SceneSpec {
  if (track instanceof SegmentTrack) return circuitSpec(track);
  if (track === OVAL_SPEC.track) return OVAL_SPEC;
  throw new Error(`no cockpit scene for track ${track.id}`);
}

// The oval stays cached (it is the default track), plus the latest other track, as trackCanvas does.
let ovalScene: Scene | null = null;
let otherScene: { id: string; scene: Scene } | null = null;

/** The scene of a track, built on first use. */
export function sceneFor(track: Track): Scene {
  if (track.id === 'oval') {
    ovalScene ??= buildScene(sceneSpec(track));
    return ovalScene;
  }
  if (otherScene?.id !== track.id) otherScene = { id: track.id, scene: buildScene(sceneSpec(track)) };
  return otherScene.scene;
}
