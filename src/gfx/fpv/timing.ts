// How long the cockpit overlays take to draw (median of the last frames), for the ?debug overlay.

const OVERLAY_SAMPLES = 60;

export const cabinMs: number[] = [];
export const mirrorMs: number[] = [];
export const carsMs: number[] = [];
const sortScratch: number[] = [];

export function sample(list: number[], ms: number): void {
  list.push(ms);
  if (list.length > OVERLAY_SAMPLES) list.shift();
}

function median(list: number[]): number {
  sortScratch.length = 0;
  for (const v of list) sortScratch.push(v);
  sortScratch.sort((a, b) => a - b);
  return sortScratch[Math.floor(sortScratch.length / 2)] ?? 0;
}

export function cockpitOverlayMs(): { cabin: number; mirror: number; cars: number } {
  return { cabin: median(cabinMs), mirror: median(mirrorMs), cars: median(carsMs) };
}
