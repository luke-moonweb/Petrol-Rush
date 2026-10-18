import { CONFIG } from '../../config';
import type { Input } from '../../input';
import type { DriveInput } from '../../race/physics';
import type { Race } from '../../race/race';
import { PlayerSteering } from '../../race/steering';

/** The player's keys / touch buttons turned into this step's drive input. */
export class PlayerControls {
  private readonly steering = new PlayerSteering();
  // Set while the hold-to-reverse key (↓ / S) put the car in reverse, so releasing it leaves reverse.
  private reverseHeld = false;
  /** Seconds left of the STOP TO ENGAGE REVERSE hint. */
  reverseHint = 0;
  /** The steering wheel as drawn in the cockpit, eased. */
  steerVis = 0;

  reset(): void {
    this.steering.resetAssist();
    this.reverseHeld = false;
  }

  update(input: Input, race: Race, dt: number): DriveInput {
    const p = race.player;
    const steerKey = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    this.steering.track = race.track;
    const drive: DriveInput = {
      steer: 0,
      gas: input.isDown('gas'),
      brake: input.isDown('brake'),
      // A tap without a held key is the touch REV button, which toggles reverse.
      toggleReverse: input.pressed('reverse') && !input.isDown('reverse'),
    };
    this.holdReverse(race, drive, input.isDown('reverse'));
    const st = this.steering.update(p, steerKey, dt, drive.brake);
    drive.steer = race.pitAuto ? 0 : st.steer;
    drive.straightTo = race.pitAuto ? undefined : st.straightTo;
    const shownSteer = race.pitAuto ? race.playerDrive.steer : drive.steer;
    this.steerVis += (shownSteer - this.steerVis) * Math.min(1, dt * 12);
    this.reverseHint = Math.max(0, this.reverseHint - dt);
    if (drive.toggleReverse && !race.pitAuto && !p.reverse && Math.abs(p.speed) > CONFIG.REVERSE_TOGGLE_MAX_MPH) {
      this.reverseHint = 1.5;
    }
    return drive;
  }

  // Holding ↓ / S brakes; once the car has nearly stopped it engages reverse and backs up.
  // Releasing the key leaves reverse and the car rolls to a stop.
  private holdReverse(race: Race, drive: DriveInput, held: boolean): void {
    const p = race.player;
    if (held) {
      if (p.reverse) drive.gas = true;
      else if (Math.abs(p.speed) <= CONFIG.REVERSE_TOGGLE_MAX_MPH) {
        drive.toggleReverse = true;
        drive.gas = true;
      } else drive.brake = true;
      if (drive.gas) drive.brake = false;
      this.reverseHeld = true;
    } else if (this.reverseHeld) {
      this.reverseHeld = false;
      if (p.reverse) drive.toggleReverse = true;
    }
  }
}
