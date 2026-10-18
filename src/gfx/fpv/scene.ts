import type { Track } from '../../track/common';
import { attachSigns, emptyParts, type Parts } from './kit';
import { OVAL_SPEC } from './oval';
import { paddockBuildings, paddockPads, paddockSigns } from './paddock3d';
import { pitBase, pitBoxes, pitLines, pitSigns } from './pitScene';
import { gridMarks } from './ribbon';
import type { SceneSpec } from './spec';

export type { Glow, Pool } from './kit';

/** The static 3D world of one track; `signs` holds only the signs that hang on no wall. */
export type Scene = Parts;

/** Builds the static scene of a track from its spec. Within each list, the order is the draw order. */
export function buildScene(spec: SceneSpec): Scene {
  const P = emptyParts();
  spec.ground(P);
  spec.ribbon(P);
  spec.base(P);
  paddockPads(P, spec.paddock);
  pitBase(P, spec.pit);
  paddockBuildings(P, spec.paddock);
  spec.masts(P);
  pitBoxes(P, spec.pit);
  gridMarks(P, spec.track);
  pitLines(P, spec.pit);
  paddockSigns(P, spec.paddock);
  pitSigns(P, spec.pit);
  spec.extras(P);
  P.signs = attachSigns(P.solids, P.signs);
  return P;
}

export function sceneSpec(_track: Track): SceneSpec {
  return OVAL_SPEC;
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
