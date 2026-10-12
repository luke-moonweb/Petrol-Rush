import type { CollisionMode } from './config';

export type CameraMode = 'top' | 'cockpit';

export interface Prefs {
  penalties: boolean;
  speedBar: boolean;
  collisions: CollisionMode;
  camera: CameraMode;
}

export const DEFAULT_PREFS: Prefs = { penalties: true, speedBar: true, collisions: 'realistic', camera: 'top' };

const STORAGE_KEY = 'petrolrush.prefs';

export function loadPrefs(): Prefs {
  const p = { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return p;
    const o = JSON.parse(raw) as Partial<Prefs>;
    if (typeof o.penalties === 'boolean') p.penalties = o.penalties;
    if (typeof o.speedBar === 'boolean') p.speedBar = o.speedBar;
    if (o.collisions === 'realistic' || o.collisions === 'classic') p.collisions = o.collisions;
    if (o.camera === 'top' || o.camera === 'cockpit') p.camera = o.camera;
  } catch {}
  return p;
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {}
}
