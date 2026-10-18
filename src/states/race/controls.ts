import { CONFIG } from '../../config';
import type { Input } from '../../input';
import type { DriveInput } from '../../race/physics';
import type { Race } from '../../race/race';
import { PlayerSteering } from '../../race/steering';
import { NO_STEER_FLAGS, type SteerFlags, SteerPlaytest } from './steerPlaytest';

/** The player's keys / touch buttons turned into this step's drive input. */
export class PlayerControls {
  private steering: PlayerSteering;
  // PLAYTEST ONLY (debug flags steer, assist, fine): the steering set per race and the overlay's numbers.
  private readonly playtest: SteerPlaytest;
  // Set while the hold-to-reverse key (↓ / S) put the car in reverse, so releasing it leaves reverse.
  private reverseHeld = false;
  /** Seconds left of the STOP TO ENGAGE REVERSE hint. */
  reverseHint = 0;
  // The steering wheel in the cockpit after this step and the step before (see `steerShown`).
  private steerVis = 0;
  private prevSteerVis = 0;

  constructor(flags: SteerFlags = NO_STEER_FLAGS) {
    this.playtest = new SteerPlaytest(flags);
    this.steering = new PlayerSteering(undefined, this.playtest.options());
  }

  /** A new race. */
  reset(): void {
    this.steering = new PlayerSteering(this.steering.track, this.playtest.options());
    this.reverseHeld = false;
    this.steerVis = this.prevSteerVis = 0;
  }

  /**
   * The steering wheel as drawn in the cockpit, between the last two steps like the car's heading.
   * It follows the player's steering at once (an eased wheel would lag the turning view).
   */
  steerShown(alpha: number): number {
    return this.prevSteerVis + (this.steerVis - this.prevSteerVis) * alpha;
  }

  /** The steering wheel (-1..1, the share of the key cap). */
  get wheel(): number {
    return this.steering.wheel;
  }

  /** The race is paused or lost focus: the keys are let go, the wheel centres (the assist blend stays). */
  release(): void {
    this.steering.release();
  }

  /** The debug overlay: the wheel, its limit and the overdrive (and the playtest's numbers). */
  debugLines(raceOver: boolean): string[] {
    const st = this.steering;
    return [
      `wheel ${st.wheel.toFixed(2)}  limit ${st.limit.toFixed(2)}  overdrive ${st.overdrive.toFixed(2)}`,
      ...this.playtest.lines(raceOver),
    ];
  }

  update(input: Input, race: Race, dt: number): DriveInput {
    const p = race.player;
    // With both arrows held the one pressed last steers (a fast change of direction never lets go of the
    // wheel), and a tap shorter than a step still counts for one step.
    const left = input.lastPress('left');
    const right = input.lastPress('right');
    const steerKey = right > left ? 1 : left > right ? -1 : 0;
    this.steering.track = race.track;
    const drive: DriveInput = {
      steer: 0,
      gas: input.isDown('gas'),
      brake: input.isDown('brake'),
      // A tap without a held key is the touch REV button, which toggles reverse.
      toggleReverse: input.pressed('reverse') && !input.isDown('reverse'),
    };
    this.holdReverse(race, drive, input.isDown('reverse'));
    // Under the pit autopilot the player's keys do not steer: the wheel centres, and a key still held when
    // it hands back is not a fresh press (the straight assist stays on).
    const fine = this.playtest.flags.fine && input.isDown('fine');
    const st = this.steering.update(p, race.pitAuto ? 0 : steerKey, dt, drive.brake, fine);
    if (race.pitAuto) this.steering.rearm(steerKey);
    else if (race.started) this.playtest.step(p, steerKey, dt, race.time);
    drive.steer = race.pitAuto ? 0 : st.steer;
    drive.straightTo = race.pitAuto ? undefined : st.straightTo;
    this.prevSteerVis = this.steerVis;
    // The pit autopilot's steering is eased: it is not the player's hands.
    if (race.pitAuto) this.steerVis += (race.playerDrive.steer - this.steerVis) * Math.min(1, dt * 12);
    else this.steerVis = drive.steer;
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
