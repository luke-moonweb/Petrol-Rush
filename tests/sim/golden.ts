import { CONFIG, DEFAULT_OPTIONS } from '../../src/config';
import { Race } from '../../src/race/race';

// FNV-1a over the exact (shortest round-trip) decimal form of every float, so any bit change shows.
export function hashState(race: Race): string {
  let h = 0x811c9dc5;
  const feed = (n: number) => {
    const s = String(n);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const c of race.cars) {
    feed(c.x);
    feed(c.y);
    feed(c.heading);
    feed(c.moveAngle);
    feed(c.speed);
    feed(c.fuel);
    feed(c.crashes);
  }
  return h.toString(16).padStart(8, '0');
}

export function runFor(seed: number, cars: number, laps: number, seconds: number): Race {
  const r = new Race({ ...DEFAULT_OPTIONS, cars, laps }, seed, true);
  r.start();
  const dt = 1 / CONFIG.STEP_HZ;
  const n = Math.round(seconds * CONFIG.STEP_HZ);
  for (let i = 0; i < n && !r.allFinished(); i++) r.step(dt, null);
  return r;
}

export function runRace(seed: number, cars = 20, laps = 18): Race {
  return runFor(seed, cars, laps, laps * 40);
}
