import type { GameAudio } from '../../audio/audio';
import type { Race } from '../../race/race';

const CRASH_WARN_PX = 1100;
const NOTICE_S = 4;
const RADIO_GAP_S = 8;

/** What the race tells the player about race events: the CRASH AHEAD banner, the radio and penalties. */
export class RaceNotices {
  notice: { text: string; age: number } | null = null;
  /** Seconds left of the penalty message. */
  penaltyMsg = 0;
  private radioCooldown = 0;

  reset(): void {
    this.notice = null;
    this.penaltyMsg = 0;
  }

  update(race: Race, dt: number, audio: GameAudio): void {
    const p = race.player;
    this.radioCooldown = Math.max(0, this.radioCooldown - dt);
    this.penaltyMsg = Math.max(0, this.penaltyMsg - dt);
    if (this.notice) {
      this.notice.age += dt;
      if (this.notice.age > NOTICE_S) this.notice = null;
    }
    for (const e of race.events) {
      if (e.type === 'penalty' && e.car === p) {
        this.penaltyMsg = 3;
        audio.radio(`Penalty! ${e.seconds} seconds.`);
        this.radioCooldown = 4;
        continue;
      }
      if (e.type !== 'spin' || e.car === p || p.finished) continue;
      const ds = race.track.deltaS(p.s, e.car.s);
      if (ds < -40 || ds > CRASH_WARN_PX || (e.car.pitSide && e.car.wasInPit)) continue;
      if (this.notice) this.notice.age = Math.min(this.notice.age, 1);
      else this.notice = { text: 'CAUTION  ·  CRASH AHEAD', age: 0 };
      if (this.radioCooldown <= 0) {
        audio.radio('Caution! Crash ahead!');
        this.radioCooldown = RADIO_GAP_S;
      }
    }
  }
}
