import { LAP_CHOICES, QUALIFYING_CHOICES, type RaceOptions } from '../../config';
import { NUM_COLORS } from '../../race/race';
import { getTrack, trackIds } from '../../track/tracks';
import type { SettingRow } from '../../ui/overlays';

// RACE SETTINGS screen of a quick race: the rows and how left / right change them.

export const OPTION_LABELS = ['TRACK', 'CARS', 'LAPS', 'YOUR CAR', 'GRID POSITION', 'START RACE'];
export const START_ROW = OPTION_LABELS.indexOf('START RACE');

export const QUALIFYING_LABELS: Record<string, string> = {
  last: 'BACK OF GRID',
  middle: 'MIDDLE OF GRID',
  pole: 'POLE POSITION',
  random: 'RANDOM',
};

/** The options with row `row` stepped by `delta` (-1 / 1), wrapping around. */
export function changeOption(opts: RaceOptions, row: number, delta: number): RaceOptions {
  const o = { ...opts };
  switch (row) {
    case 0: {
      const ids = trackIds();
      o.track = ids[(ids.indexOf(o.track) + delta + ids.length) % ids.length]!;
      break;
    }
    case 1:
      o.cars = ((o.cars - 1 + delta + 20) % 20) + 1;
      break;
    case 2: {
      const idx = LAP_CHOICES.indexOf(o.laps);
      const cur = idx < 0 ? LAP_CHOICES.indexOf(18) : idx;
      o.laps = LAP_CHOICES[(cur + delta + LAP_CHOICES.length) % LAP_CHOICES.length]!;
      break;
    }
    case 3:
      o.playerColor = (o.playerColor + delta + NUM_COLORS) % NUM_COLORS;
      break;
    case 4: {
      const idx = QUALIFYING_CHOICES.indexOf(o.qualifying);
      o.qualifying = QUALIFYING_CHOICES[(idx + delta + QUALIFYING_CHOICES.length) % QUALIFYING_CHOICES.length]!;
      break;
    }
  }
  return o;
}

export function optionRows(o: RaceOptions): SettingRow[] {
  return OPTION_LABELS.map((label, i) => {
    switch (i) {
      case 0:
        return { label, value: getTrack(o.track).name };
      case 1:
        return { label, value: String(o.cars) };
      case 2:
        return { label, value: String(o.laps) };
      case 3:
        return { label, carColor: o.playerColor };
      case 4:
        return { label, value: QUALIFYING_LABELS[o.qualifying] };
      default:
        return { label, action: true };
    }
  });
}
