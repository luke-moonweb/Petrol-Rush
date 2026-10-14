import type { GameAudio } from '../../audio/audio';
import { CONFIG } from '../../config';
import { cockpitCameraYaw } from '../../gfx/fpv/view';
import { layout } from '../../layout';
import { lapsCompleted } from '../../race/car';
import type { DriveInput } from '../../race/physics';
import type { Race } from '../../race/race';

const SOUND_C = 700;

const COCKPIT_HEAR = 450;

export class RaceSound {
  private readonly crashes = new Map<number, number>();
  private scrape = 0;
  private wallCd = 0;
  private bumpCd = 0;
  private laps = 0;
  private lowFuel = false;
  private finished = false;

  constructor(private readonly audio: GameAudio) {}

  update(dt: number, race: Race, drive: DriveInput, camX: number, cockpit = false): void {
    const audio = this.audio;
    const p = race.player;
    this.wallCd = Math.max(0, this.wallCd - dt);
    this.bumpCd = Math.max(0, this.bumpCd - dt);

    audio.setEngine(p.speed, true, drive.gas && !p.reverse);
    const braking = drive.brake && Math.abs(p.speed) > 90 && p.spinTime <= 0;
    audio.setScreech(p.spinTime > 0 ? 1 : p.slideTime > 0 ? 0.7 : braking ? 0.35 : 0);
    audio.setRefuel(p.refueling);

    // In the cockpit, pan by where the camera looks: during a spin that is not the car's heading.
    const camYaw = cockpit ? cockpitCameraYaw(race) : Number.NaN;
    const earYaw = Number.isNaN(camYaw) ? p.heading : camYaw;
    const pc = Math.cos(earYaw);
    const ps = Math.sin(earYaw);
    const panOf = (c: { x: number; y: number }): number | null => {
      if (cockpit) {
        if (Math.hypot(c.x - p.x, c.y - p.y) > COCKPIT_HEAR) return null;
        return Math.max(-1, Math.min(1, ((c.x - p.x) * -ps + (c.y - p.y) * pc) / 120));
      }
      const sx = c.x - camX;
      const vw = layout.view.w;
      if (sx < -40 || sx > vw + 40) return null;
      return (sx - vw / 2) / (vw / 2);
    };

    let near = 0;
    for (const c of race.cars) if (c !== p && Math.hypot(c.x - p.x, c.y - p.y) < 260) near++;
    audio.setPack(near / 6);

    const pxm = CONFIG.PX_PER_MPH;
    const pvx = Math.cos(p.moveAngle) * p.speed * pxm;
    const pvy = Math.sin(p.moveAngle) * p.speed * pxm;
    const rivals = race.cars
      .filter((c) => c !== p)
      .map((c) => ({ c, dist: Math.hypot(c.x - p.x, c.y - p.y) }))
      .filter((r) => r.dist < 450)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
      .map(({ c, dist }) => {
        const ux = (c.x - p.x) / (dist || 1);
        const uy = (c.y - p.y) / (dist || 1);
        const toward = -(Math.cos(c.moveAngle) * c.speed * pxm * ux + Math.sin(c.moveAngle) * c.speed * pxm * uy);
        const listener = pvx * ux + pvy * uy;
        const doppler = Math.max(0.75, Math.min(1.3, (SOUND_C + listener) / (SOUND_C - toward)));
        return {
          mph: c.speed,
          pan: panOf(c) ?? Math.max(-1, Math.min(1, (c.x - camX - layout.view.w / 2) / (layout.view.w / 2))),
          vol: 1 - dist / 450,
          doppler,
          pitch: 0.88 + (c.colorIdx % 7) * 0.04,
        };
      });
    audio.setRivals(rivals);

    const prevCrashes = this.crashes.get(p.id) ?? 0;
    const touching = p.wallImpact > 0 || p.contactStrength > 0;
    let scrape = 0;
    if (p.crashes > prevCrashes && touching) {
      audio.crash(Math.max(p.wallImpact, p.contactStrength, 40));
      this.wallCd = this.bumpCd = 0.4;
    } else if (p.wallImpact > 0) {
      if (p.wallImpact >= 12 && this.wallCd <= 0) {
        audio.wallHit(p.wallImpact);
        this.wallCd = 0.25;
      } else if (Math.abs(p.speed) > 15) scrape = Math.min(1, 0.3 + Math.abs(p.speed) / 200);
    } else if (p.contactStrength > 0) {
      const fresh = p.contactPrev === 0;
      if ((fresh || p.contactStrength >= 10) && this.bumpCd <= 0) {
        audio.carBump(p.contactStrength);
        this.bumpCd = 0.2;
      } else scrape = Math.min(0.6, Math.abs(p.speed) / 300);
    }
    this.scrape = scrape > 0 ? 0.08 : Math.max(0, this.scrape - dt);
    audio.setScrape(scrape > 0 ? scrape : this.scrape > 0 ? 0.3 : 0);
    this.crashes.set(p.id, p.crashes);

    for (const c of race.cars) {
      if (c === p) continue;
      const prev = this.crashes.get(c.id) ?? 0;
      this.crashes.set(c.id, c.crashes);
      const pan = panOf(c);
      if (pan === null) continue;
      const vol = 0.45 * Math.max(0.2, 1 - Math.hypot(c.x - p.x, c.y - p.y) / 500);
      if (c.crashes > prev && (c.wallImpact > 0 || c.contactStrength > 0)) audio.crash(40, pan, vol);
      else if (c.wallImpact >= 20) audio.wallHit(c.wallImpact, pan, vol * 0.6);
    }

    const laps = lapsCompleted(p);
    if (p.finished && !this.finished) {
      this.finished = true;
      audio.finishFanfare();
    } else if (laps > this.laps && !p.finished && laps > 0) audio.lapChime();
    this.laps = laps;
    if (p.fuel < CONFIG.LOW_FUEL && !this.lowFuel && !p.finished) audio.lowFuel();
    this.lowFuel = p.fuel < CONFIG.LOW_FUEL;
  }
}
