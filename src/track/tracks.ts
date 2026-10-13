import type { Track } from './common';
import { gpTracks } from './gp';
import { OVAL } from './ovalTrack';

export const OVAL_ID = 'oval';

/** Every circuit that can be raced: the oval first, then the Grand Prix calendar. */
export function allTracks(): Track[] {
  return [OVAL, ...gpTracks()];
}

export function trackIds(): string[] {
  return allTracks().map((t) => t.id);
}

export function getTrack(id: string): Track {
  return allTracks().find((t) => t.id === id) ?? OVAL;
}
