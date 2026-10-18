import { type Car, isStranded } from '../../race/car';
import type { Race } from '../../race/race';

// Out of fuel in a Grand Prix, the player watches the cars still racing until they are all home:
// the top-down camera follows one of them, and the player can switch to another.

const racing = (c: Car) => !c.finished && !isStranded(c);

/**
 * The car the camera follows. `step` 0 keeps `current` while it races; -1 / +1 move to the racing car
 * ahead of / behind it, round the field. A car that no longer races (the player out of fuel, or a
 * watched car that finished or ran dry) hands over to the nearest racing car ahead of it in the race
 * order, else the nearest behind it. null once no car races.
 */
export function nextWatched(race: Race, current: Car, step: number): Car | null {
  const order = race.standings();
  const field = order.filter(racing);
  if (field.length === 0) return null;
  const at = field.indexOf(current);
  if (at >= 0) return field[(at + step + field.length) % field.length]!;
  for (let i = order.indexOf(current) - 1; i >= 0; i--) if (racing(order[i]!)) return order[i]!;
  // (no racing car ahead: the first one in the field is the nearest behind)
  return field[0]!;
}
