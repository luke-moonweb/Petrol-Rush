import { it } from 'vitest';
import { CONFIG, DEFAULT_OPTIONS } from '../../src/config';
import { Race } from '../../src/race/race';
import { gpTracks } from '../../src/track/gp';

it('probe', () => {
  for (const track of gpTracks()) {
    const race = new Race({ ...DEFAULT_OPTIONS, cars: 20, laps: 3 }, 1234, true, undefined, track);
    race.start();
    const dt = 1 / CONFIG.STEP_HZ;
    let walls = 0;
    let maxStill = 0;
    const still = new Map<number, number>();
    while (!race.allFinished() && race.time < 400) {
      race.step(dt, null);
      for (const c of race.cars) {
        if (c.wallImpact > 0) walls++;
        const t = Math.abs(c.speed) < 2 && !c.finished ? (still.get(c.id) ?? 0) + dt : 0;
        still.set(c.id, t);
        maxStill = Math.max(maxStill, t);
      }
    }
    const fin = race.cars.filter((c) => c.finished).length;
    const spins = race.cars.reduce((a, c) => a + c.crashes, 0);
    const lead = race.classification()[0]!;
    console.log(
      `${track.name.padEnd(14)} len ${track.len.toFixed(0)} finished ${fin}/20 t=${race.time.toFixed(1)} win ${(race.resultTime(lead) ?? 0).toFixed(1)}s lap~${((race.resultTime(lead) ?? 0) / 3).toFixed(1)} spins ${spins} wallSteps ${walls} maxStill ${maxStill.toFixed(1)}`,
    );
  }
}, 120000);
