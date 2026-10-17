import type { CollisionMode } from './config';

export type CameraMode = 'top' | 'cockpit';

export interface Prefs {
  penalties: boolean;
  collisions: CollisionMode;
  camera: CameraMode;
}

// `camera` is not restored: every race starts top-down (see RaceState.newRace).
export const DEFAULT_PREFS: Prefs = { penalties: true, collisions: 'realistic', camera: 'top' };

const STORAGE_KEY = 'petrolrush.prefs';

export function loadPrefs(): Prefs {
  const p = { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return p;
    const o = JSON.parse(raw) as Partial<Prefs>;
    if (typeof o.penalties === 'boolean') p.penalties = o.penalties;
    if (o.collisions === 'realistic' || o.collisions === 'classic') p.collisions = o.collisions;
  } catch {}
  return p;
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {}
}
