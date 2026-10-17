// The player's steering: keyboard / touch keys go through the ramp, plus the corner assist, plus
// (grip model) the straight assist target. Shared by the race state and the tests.
import { CONFIG } from '../config';
import { laneCurvature } from '../track/curvature';
import { inTurn, trackCurves, trackHeadingAt } from '../track/track';
import type { Car } from './car';
import { cornerAssist, curvatureAssist, SteerRamp } from './physics';

export interface PlayerSteer {
  steer: number;
  /** Grip model: track heading for the straight assist (undefined in corners). */
  straightTo?: number;
}

export class PlayerSteering {
  private readonly ramp = new SteerRamp();
  private assistLevel = 0;

  /** New race: the assist blend starts from zero (the ramp keeps its state, as before). */
  resetAssist(): void {
    this.assistLevel = 0;
  }

  /** key: -1 left, 0 none, 1 right. */
  update(car: Car, key: number, dt: number): PlayerSteer {
    const C = CONFIG;
    const grip = C.DRIVE_MODEL === 'grip';
    let assist: number;
    let turn: boolean;
    let straightTo: number | undefined;
    if (grip) {
      const k = trackCurves().at(car.s);
      turn = k !== 0;
      assist = curvatureAssist(car, laneCurvature(k, car.d));
      if (!turn) straightTo = trackHeadingAt(car.x, car.y);
    } else {
      assist = cornerAssist(car);
      turn = inTurn(car.x);
    }
    const step = dt / C.CORNER_ASSIST_IN_S;
    this.assistLevel = assist !== 0 ? Math.min(1, this.assistLevel + step) : Math.max(0, this.assistLevel - step);
    const keySteer = this.ramp.update(key, dt, turn);
    return { steer: Math.max(-1, Math.min(1, keySteer + assist * this.assistLevel)), straightTo };
  }
}
