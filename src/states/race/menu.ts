import type { RaceOptions } from '../../config';
import { lapsCompleted } from '../../race/car';
import { type GrandPrix, round, standings } from '../../race/grandprix';
import type { Race } from '../../race/race';
import { getTrack } from '../../track/tracks';
import type { StatField } from '../../ui/overlays';
import { QUALIFYING_LABELS } from './options';

// The race menu (before the start and on Esc during a race): its items and the four stats above them.

/** `live`: a race is under way (started, or the start lights are on). */
export function menuItems(gp: GrandPrix | null, midRace: boolean, live: boolean): string[] {
  if (gp) {
    if (live) return ['RESUME RACE', 'RESTART RACE', 'RETIRE', 'QUIT TO MAIN MENU'];
    return ['START RACE', 'BACK TO GRAND PRIX'];
  }
  if (live) return ['RESUME RACE', 'RESTART RACE', 'RACE SETTINGS', 'QUIT TO MAIN MENU'];
  if (midRace) return ['START RACE', 'RACE SETTINGS', 'QUIT TO MAIN MENU'];
  return ['START RACE', 'RACE SETTINGS'];
}

export function menuStats(race: Race, gp: GrandPrix | null, opts: RaceOptions, live: boolean): StatField[] {
  const p = race.player;
  if (live) {
    const list = race.standings();
    const gap = list[0] === p ? null : race.gap(p, list[0]!);
    return [
      { label: 'LAP', value: `${Math.min(race.laps, lapsCompleted(p) + 1)} / ${race.laps}` },
      { label: 'POSITION', value: `${race.position(p)} / ${race.cars.length}` },
      { label: 'FUEL', value: `${Math.round(Math.max(0, p.fuel) * 100)}%` },
      { label: 'TO LEADER', value: list[0] === p ? 'LEADING' : gap === null ? '—' : `+${gap.toFixed(2)}` },
    ];
  }
  if (gp) {
    const table = standings(gp);
    const mine = table.findIndex((s) => s.colorIdx === gp.playerColor);
    return [
      { label: 'TRACK', value: getTrack(opts.track).name },
      { label: 'LAPS', value: `${opts.laps}  ·  ${opts.cars} CARS` },
      { label: 'YOUR CAR', carColor: opts.playerColor },
      { label: 'POINTS', value: round(gp) === 0 ? '—' : `${table[mine]!.points}  ·  P${mine + 1}` },
    ];
  }
  return [
    { label: 'TRACK', value: getTrack(opts.track).name },
    { label: 'LAPS', value: `${opts.laps}  ·  ${opts.cars} CARS` },
    { label: 'YOUR CAR', carColor: opts.playerColor },
    { label: 'GRID', value: QUALIFYING_LABELS[opts.qualifying]!.replace(' OF GRID', '').replace(' POSITION', '') },
  ];
}
