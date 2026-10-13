import { describe, expect, it } from 'vitest';
import { gpTracks } from '../src/track/gp';
import { runRace } from './sim/harness';

for (const track of gpTracks()) {
  describe(`headless races on ${track.name}`, () => {
    it('20 AI cars finish 3 laps without getting stuck or leaving the world', () => {
      const r = runRace({ track, seed: 1234, laps: 3 });
      console.log(
        `${track.name}: ${r.race.time.toFixed(1)} s, spins ${r.spins}, wall steps ${r.wallHits}, max still ${r.maxStill.toFixed(1)} s`,
      );
      expect(r.offWorld).toBe(0);
      expect(r.finished).toBe(20);
      expect(r.maxStill).toBeLessThan(10);
    });

    it('low on fuel, all at once: every car pits, refuels and finishes', () => {
      const r = runRace({ track, seed: 77, laps: 4, fuel0: 0.3 });
      const pitted = [...r.pitStops.values()].filter((n) => n > 0).length;
      console.log(`${track.name} pits: ${pitted}/20 cars pitted, ${r.race.time.toFixed(1)} s, max still ${r.maxStill.toFixed(1)} s`);
      expect(r.offWorld).toBe(0);
      expect(r.finished).toBe(20);
      expect(pitted).toBe(20);
      expect(r.race.cars.every((c) => c.fuel > 0)).toBe(true);
    });

    it('player pit autopilot takes over past the PIT LANE line and hands back at PIT EXIT', () => {
      const r = runRace({ track, seed: 5, laps: 3, cars: 8, fuel0: 0.18, humanPlayer: true });
      expect(r.pitAutoSteps).toBeGreaterThan(0);
      expect(r.race.player.finished).toBe(true);
      expect(r.pitStops.get(r.race.player.id) ?? 0).toBeGreaterThan(0);
    });
  });
}
