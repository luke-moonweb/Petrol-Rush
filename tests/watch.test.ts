import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/config';
import type { Car } from '../src/race/car';
import { Race } from '../src/race/race';
import { nextWatched } from '../src/states/race/watch';

/** Five cars, in race order by their slot: car 0 leads. */
function field(): { race: Race; cars: Car[] } {
  const race = new Race({ ...DEFAULT_OPTIONS, cars: 5, qualifying: 'middle' }, 3, true);
  const cars = [...race.cars].sort((a, b) => a.id - b.id);
  cars.forEach((c, i) => {
    Object.assign(c, { sectorsPassed: 20 - i, speed: 150 });
  });
  return { race, cars };
}

describe('watching the race out of fuel', () => {
  it('starts with the nearest racing car ahead, else the nearest behind', () => {
    const { race, cars } = field();
    const [a, b, c, , e] = cars;
    Object.assign(c!, { fuel: 0, speed: 0 });
    expect(nextWatched(race, c!, 0)).toBe(b);
    Object.assign(b!, { fuel: 0, speed: 0 });
    expect(nextWatched(race, c!, 0)).toBe(a);
    Object.assign(a!, { fuel: 0, speed: 0 });
    expect(nextWatched(race, c!, 0)).toBe(cars[3]);
    expect(nextWatched(race, e!, 0)).toBe(e);
  });

  it('the arrows go round the cars still racing, past finished and stranded ones', () => {
    const { race, cars } = field();
    const [a, b, c, d, e] = cars;
    Object.assign(c!, { fuel: 0, speed: 0 });
    b!.finished = true;
    expect(nextWatched(race, a!, 1)).toBe(d);
    expect(nextWatched(race, d!, -1)).toBe(a);
    expect(nextWatched(race, a!, -1)).toBe(e);
    expect(nextWatched(race, e!, 1)).toBe(a);
  });

  it('a car still rolling with an empty tank races on; with nobody racing there is nothing to watch', () => {
    const { race, cars } = field();
    Object.assign(cars[1]!, { fuel: 0, speed: 40 });
    Object.assign(cars[2]!, { fuel: 0, speed: 0 });
    expect(nextWatched(race, cars[2]!, 0)).toBe(cars[1]);
    for (const c of cars) c.finished = true;
    expect(nextWatched(race, cars[2]!, 0)).toBeNull();
  });
});
