import type { Streak } from './cockpit';
import type { Camera } from './engine';
import type { Glow } from './scene';

const FLOOD_DEPTH = 176;
const FLOOD_SIDE = 140;
const MAX_STREAKS = 3;

const streaks: Streak[] = [];
const streakPool: Streak[] = Array.from({ length: MAX_STREAKS }, () => ({ x: 0, k: 0 }));

// The strongest floodlight masts just ahead, strongest first. The returned list is reused every frame.
export function floodStreaks(c: Camera, glows: Glow[]): Streak[] {
  streaks.length = 0;
  for (const gl of glows) {
    if (!gl.flood) continue;
    const dx = gl.x - c.x;
    const dy = gl.y - c.y;
    const d = dx * c.cos + dy * c.sin;
    const lat = -dx * c.sin + dy * c.cos;
    if (d <= 0 || d >= FLOOD_DEPTH || Math.abs(lat) >= FLOOD_SIDE) continue;
    const t = 1 - d / FLOOD_DEPTH;
    const k = t * t * (3 - 2 * t);
    // Insert into the sorted top list, dropping the weakest when it is full.
    let i = streaks.length;
    if (i === MAX_STREAKS) {
      if (k <= streaks[i - 1]!.k) continue;
      i--;
    } else streaks.push(streakPool[i]!);
    const slot = streaks[i]!;
    while (i > 0 && streaks[i - 1]!.k < k) {
      streaks[i] = streaks[i - 1]!;
      i--;
    }
    streaks[i] = slot;
    slot.x = c.ox + (c.focal * lat) / d;
    slot.k = k;
  }
  return streaks;
}
