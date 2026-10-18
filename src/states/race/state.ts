import { CONFIG, type RaceOptions } from '../../config';
import { PIT_SOON_LAPS, stepCabin } from '../../gfx/fpv/cabin';
import { cockpitOverlayMs } from '../../gfx/fpv/timing';
import { drawCockpitView, prewarmCockpitView, prewarmScene } from '../../gfx/fpv/view';
import { Particles } from '../../gfx/particles';
import { driverName } from '../../gfx/vehicles';
import { drawCars, drawOil, drawTrack, trackCanvas } from '../../gfx/world';
import { keyLabel } from '../../input';
import { inFrame, layout } from '../../layout';
import { type Car, isStranded } from '../../race/car';
import { type GrandPrix, gridOrder, raceResult, raceSeed, round, saveGp } from '../../race/grandprix';
import { NO_INPUT } from '../../race/physics';
import { Race } from '../../race/race';
import { type Warn, WarnDisplay, warnings } from '../../race/warnings';
import type { TouchLayout } from '../../touch';
import { wrapAngle } from '../../track/common';
import { getTrack } from '../../track/tracks';
import type { Hit } from '../../ui/hit';
import { drawHudPanel, drawHudTop, drawSkidLamp, fuelOutlook } from '../../ui/hud';
import { drawPause, drawRaceMenu, drawRaceSettings, drawResults } from '../../ui/overlays';
import { ordinal } from '../../ui/text';
import { PR } from '../../ui/theme';
import { type Game, type State, saveOptions, tapSide } from '../game';
import { HelpState } from '../info';
import { RaceCamera } from './camera';
import { PlayerControls } from './controls';
import { menuItems, menuStats } from './menu';
import { RaceNotices } from './notices';
import { changeOption, OPTION_LABELS, optionRows, START_ROW } from './options';
import { RaceSound } from './sound';
import { drawDebug, drawRaceMessage, drawStartLights, LIGHT_INTERVAL_S, LIGHTS_COUNT, resultRows, type StartLights } from './view';
import { nextWatched } from './watch';

type Phase = 'choose' | 'options' | 'running' | 'paused' | 'finishing' | 'results';

/** A Grand Prix round: the championship so far and where to go when the race is over. */
export interface GpContext {
  gp: GrandPrix;
  done(gp: GrandPrix): void;
}

/** Simulated seconds per frame while the rest of the field finishes a Grand Prix race. */
const FINISH_SIM_S = 40;
/** After the winner, the field gets this long to finish before the rest are classified DNF. */
const FINISH_LIMIT_S = 180;

let overlayImg: HTMLImageElement | null = null;

export class RaceState implements State {
  private race: Race;
  private phase: Phase;
  private sel = 0;
  private midRace = false;
  private savedRace: Race | null = null;
  private finishTimer = 0;
  /** Out of fuel in a Grand Prix: the car the camera follows while the rest race on (watch.ts). */
  private watched: Car | null = null;
  private readonly camera = new RaceCamera();
  private readonly controls = new PlayerControls();
  // What the HUD and the cockpit show of the player's warnings (SKID blink phase, eased limit and LEDs).
  private readonly warnShown = new WarnDisplay();
  private readonly notices = new RaceNotices();
  private sound!: RaceSound;
  private lightsShown = 0;
  private lights: StartLights | null = null;
  private readonly particles = new Particles();
  private seed: number;
  private fps = 0;
  private lastRender = performance.now();

  constructor(
    private readonly game: Game,
    private opts: RaceOptions,
    phase: Phase,
    private readonly gpc: GpContext | null = null,
  ) {
    trackCanvas(getTrack(opts.track));
    if (game.params.overlayUrl && !overlayImg) {
      overlayImg = new Image();
      overlayImg.src = game.params.overlayUrl;
    }
    this.seed = game.params.seed;
    this.race = this.newRace();
    this.phase = phase;
    if (phase === 'running') this.beginLights();
    if (game.params.debug) (window as unknown as { __race: RaceState }).__race = this;
  }

  private newRace(): Race {
    this.particles?.clear();
    this.camera?.reset();
    this.controls?.reset();
    this.warnShown.reset();
    this.sound = new RaceSound(this.game.audio);
    this.lightsShown = 0;
    this.watched = null;
    const prefs = this.game.prefs;
    // Every race starts with the top-down camera; the cockpit is chosen per race.
    prefs.camera = 'top';
    this.notices?.reset();
    const rules = { penalties: prefs.penalties, collisions: prefs.collisions };
    const gp = this.gpc?.gp;
    if (gp) {
      const skills = new Map(gp.entries.flatMap((e) => (e.skill ? [[e.colorIdx, e.skill] as const] : [])));
      const lineup = { colors: gridOrder(gp), skills };
      return new Race(this.opts, raceSeed(gp, round(gp)), false, rules, getTrack(this.opts.track), lineup);
    }
    return new Race(this.opts, this.seed++, false, rules, getTrack(this.opts.track));
  }

  touchLayout(): TouchLayout {
    return this.phase === 'running' && !this.watched ? 'race' : 'menu';
  }

  touchCamera(): boolean {
    return true;
  }

  private get cockpit(): boolean {
    return this.game.prefs.camera === 'cockpit';
  }

  tap(hit: Hit | null, x: number): void {
    const input = this.game.input;
    switch (this.phase) {
      case 'choose':
        if (!hit) return;
        this.sel = hit.id;
        input.tapVirtual('enter');
        break;
      case 'options':
        if (!hit) return;
        this.sel = hit.id;
        input.tapVirtual(hit.id === START_ROW ? 'enter' : tapSide(hit, x));
        break;
      case 'results':
        input.tapVirtual('enter');
        break;
      default:
        break;
    }
  }

  private finishInBackground(): void {
    const race = this.race;
    race.autoPlayer = true;
    race.pitAuto = false;
    const dt = 1 / CONFIG.STEP_HZ;
    const limit = (race.finishTime(race.classification()[0]!) ?? race.time) + FINISH_LIMIT_S;
    for (let t = 0; t < FINISH_SIM_S && !race.raceOver() && race.time < limit; t += dt) race.step(dt, null);
    if (race.raceOver() || race.time >= limit) {
      this.particles.clear();
      this.phase = 'results';
    }
  }

  private retire(): void {
    this.race.playerRetired = true;
    this.lights = null;
    if (!this.race.started) this.race.start();
    this.phase = 'finishing';
  }

  hover(hit: Hit): void {
    if (this.phase === 'choose' || this.phase === 'options') this.sel = hit.id;
  }

  onBlur(): void {
    if (this.phase === 'running') this.phase = 'paused';
    this.game.audio.silence();
  }

  update(dt: number): void {
    const input = this.game.input;
    if (input.pressed('camera') && !this.watched) {
      const prefs = this.game.prefs;
      prefs.camera = prefs.camera === 'top' ? 'cockpit' : 'top';
      this.game.audio.ui('move');
    }
    if (this.game.params.debug && input.pressed('debugSpeed')) {
      this.game.timeScale = this.game.timeScale === 1 ? 4 : this.game.timeScale === 4 ? 8 : 1;
    }
    switch (this.phase) {
      case 'choose':
        this.updateChoose();
        break;
      case 'options':
        this.updateOptions();
        break;
      case 'running':
        this.updateRunning(dt);
        break;
      case 'paused':
        if (input.pressed('pause') || input.pressed('enter')) this.phase = 'running';
        else if (input.pressed('menu') || input.pressed('back')) this.openMenu();
        else if (input.pressed('help')) this.game.set(new HelpState(this.game, this));
        break;
      case 'finishing':
        this.finishInBackground();
        break;
      case 'results':
        if (input.pressed('enter') || input.pressed('back')) {
          if (this.gpc) this.gpc.done({ ...this.gpc.gp, results: [...this.gpc.gp.results, raceResult(this.race)] });
          else this.game.toTitle();
        }
        break;
    }
    if (this.phase !== 'running') this.game.audio.silence();
  }

  /** A race is under way (started, or the start lights are on) and the menu was opened from it. */
  private get live(): boolean {
    return this.midRace && (this.race.started || !!this.lights);
  }

  private openMenu(): void {
    this.midRace = true;
    this.phase = 'choose';
    this.sel = 0;
  }

  private updateChoose(): void {
    const input = this.game.input;
    const items = menuItems(this.gpc?.gp ?? null, this.midRace, this.live);
    const audio = this.game.audio;
    if (input.pressed('up') || input.pressed('down')) audio.ui('move');
    if (input.pressed('up')) this.sel = (this.sel + items.length - 1) % items.length;
    if (input.pressed('down')) this.sel = (this.sel + 1) % items.length;
    if (input.pressed('back') || input.pressed('menu')) {
      audio.ui('back');
      if (this.live) this.phase = 'running';
      else if (this.gpc) this.gpc.done(this.gpc.gp);
      else this.game.toTitle();
      return;
    }
    if (!input.pressed('enter')) return;
    audio.ui(items[this.sel] === 'QUIT TO MAIN MENU' ? 'back' : 'ok');
    switch (items[this.sel]) {
      case 'RACE SETTINGS':
        if (this.race.started) this.savedRace = this.race;
        else this.lights = null;
        this.race = this.newRace();
        this.phase = 'options';
        this.sel = 0;
        break;
      case 'RESTART RACE':
        if (this.gpc) {
          this.gpc.gp = { ...this.gpc.gp, restarts: this.gpc.gp.restarts + 1 };
          saveGp(this.gpc.gp);
        }
        this.startRace();
        break;
      case 'RETIRE':
        this.retire();
        break;
      case 'BACK TO GRAND PRIX':
        this.gpc!.done(this.gpc!.gp);
        break;
      case 'START RACE':
        this.startRace();
        break;
      case 'RESUME RACE':
        this.phase = 'running';
        break;
      case 'QUIT TO MAIN MENU':
        this.game.toTitle();
        break;
    }
  }

  private updateOptions(): void {
    const input = this.game.input;
    const n = OPTION_LABELS.length;
    const audio = this.game.audio;
    if (input.pressed('up') || input.pressed('down')) audio.ui('move');
    if (input.pressed('up')) this.sel = (this.sel + n - 1) % n;
    if (input.pressed('down')) this.sel = (this.sel + 1) % n;
    if (input.pressed('back') || input.pressed('menu')) {
      audio.ui('back');
      if (this.savedRace) {
        this.race = this.savedRace;
        this.savedRace = null;
      }
      this.phase = 'choose';
      this.sel = 0;
      return;
    }
    let delta = 0;
    if (input.pressed('navLeft')) delta = -1;
    if (input.pressed('navRight')) delta = 1;
    if (input.pressed('enter')) {
      if (this.sel === START_ROW) {
        audio.ui('ok');
        this.startRace();
        return;
      }
      delta = 1;
    }
    if (delta === 0) return;
    audio.ui('move');
    this.opts = changeOption(this.opts, this.sel, delta);
    this.race = this.newRace();
  }

  private startRace(): void {
    if (!this.gpc) saveOptions(this.opts);
    this.savedRace = null;
    if (this.race.started) this.race = this.newRace();
    this.beginLights();
    this.phase = 'running';
    this.midRace = false;
    this.finishTimer = 0;
  }

  private beginLights(): void {
    this.lights = { t: 0, outAt: LIGHTS_COUNT * LIGHT_INTERVAL_S + 0.2 + Math.random() * 2.3 };
  }

  private updateRunning(dt: number): void {
    const input = this.game.input;
    if (input.pressed('pause')) {
      this.phase = 'paused';
      return;
    }
    if (input.pressed('menu') || input.pressed('back')) {
      this.openMenu();
      return;
    }
    if (input.pressed('help')) {
      this.phase = 'paused';
      this.game.set(new HelpState(this.game, this));
      return;
    }
    if (this.watched && input.pressed('enter')) {
      // the rest of the race is run in the background, as after the player's own finish
      this.phase = 'finishing';
      return;
    }
    const drive = this.watched ? NO_INPUT : this.controls.update(input, this.race, dt);
    if (this.lights) {
      this.lights.t += dt;
      const lit = Math.min(LIGHTS_COUNT, Math.floor(this.lights.t / LIGHT_INTERVAL_S));
      if (!this.race.started && lit > this.lightsShown) this.game.audio.lightOn();
      this.lightsShown = lit;
      if (!this.race.started && this.lights.t >= this.lights.outAt) {
        this.race.start();
        this.game.audio.lightsOut();
      }
      if (this.lights.t >= this.lights.outAt + 1.5) this.lights = null;
      if (!this.race.started) {
        prewarmScene(this.race.track);
        this.game.audio.setEngine(drive.gas ? 70 : 10, true, drive.gas);
        return;
      }
    }
    this.race.step(dt, drive);
    this.warnShown.update(warnings(this.race.player, this.race.track), dt);
    stepCabin(this.race, dt);
    this.particles.emit(this.race.cars, dt);
    this.particles.update(dt);
    this.updateWatch();
    const focus = this.watched ?? this.race.player;
    this.camera.update(this.race.track, focus, dt);

    const used = this.race.pitAuto ? this.race.playerDrive : drive;
    this.sound.update(dt, this.race, used, this.camera.at(this.race.track, focus, focus.x, focus.y).x, this.cockpit);
    this.notices.update(this.race, dt, this.game.audio);

    if (this.race.player.finished || (this.watched && this.race.raceOver())) {
      this.finishTimer += dt;
      if (this.finishTimer > 3) this.phase = this.gpc ? 'finishing' : 'results';
    }
  }

  /**
   * Out of fuel in a Grand Prix, the player watches the cars still racing until they are all home:
   * the top-down camera follows one, the arrows switch to another (watch.ts).
   */
  private updateWatch(): void {
    const player = this.race.player;
    if (!this.gpc || (!this.watched && !isStranded(player))) return;
    if (!this.watched) this.game.prefs.camera = 'top';
    const input = this.game.input;
    const step = input.pressed('navLeft') ? -1 : input.pressed('navRight') ? 1 : 0;
    this.watched = nextWatched(this.race, this.watched ?? player, step) ?? this.watched ?? player;
  }

  render(g: CanvasRenderingContext2D, alpha = 1): void {
    const now = performance.now();
    this.fps = this.fps * 0.9 + (1000 / Math.max(1, now - this.lastRender)) * 0.1;
    this.lastRender = now;

    const race = this.race;
    const a = this.phase === 'running' ? alpha : 1;
    const ix = (c: Car) => c.prevX + (c.x - c.prevX) * a;
    const iy = (c: Car) => c.prevY + (c.y - c.prevY) * a;
    const ih = (c: Car) => c.prevHeading + wrapAngle(c.heading - c.prevHeading) * a;
    const view = layout.view;
    const cockpit = this.cockpit;
    const warn: Warn = this.warnShown.shown(this.phase === 'running' && race.started ? warnings(race.player, race.track) : null);
    if (cockpit) {
      const lt = this.lights;
      const out = !!lt && lt.t >= lt.outAt;
      const lights = lt
        ? { lit: out ? 0 : Math.min(LIGHTS_COUNT, Math.floor(lt.t / LIGHT_INTERVAL_S)), out, since: lt.t - lt.outAt }
        : undefined;
      const touch = this.game.touch;
      const pixelScale = g.canvas.width / layout.w;
      drawCockpitView(g, {
        race,
        view,
        ix,
        iy,
        ih,
        steer: this.controls.steerVis,
        time: race.time,
        touch,
        warn,
        arcFrom: warn.vRef,
        lights,
        particles: this.particles,
        pixelScale,
      });
    } else {
      this.renderTopDown(g, race, ix, iy, ih);
      prewarmCockpitView(g, view, race.player.colorIdx, this.game.touch);
    }

    drawHudTop(g, race, this.notices.notice);
    drawHudPanel(g, race, !cockpit, warn.vRef);
    if (!cockpit) drawSkidLamp(g, warn, view.x + view.w - 6, view.y + 6);
    const msg = this.message();
    const low = Math.round(view.h * 0.22);
    if (msg) drawRaceMessage(g, msg, cockpit ? low + 30 : 44);
    if (this.watched && this.phase === 'running') {
      drawRaceMessage(g, `← →  OTHER CAR  ·  ${this.game.touch ? 'OK' : 'ENTER'}  RESULTS`, 64, 10);
    }
    if (this.lights && this.phase !== 'choose' && this.phase !== 'options') drawStartLights(g, this.lights, cockpit ? low : 12);
    this.renderPhase(g);
  }

  private renderTopDown(
    g: CanvasRenderingContext2D,
    race: Race,
    ix: (c: Car) => number,
    iy: (c: Car) => number,
    ih: (c: Car) => number,
  ): void {
    const focus = this.watched ?? race.player;
    const cam = this.camera.at(race.track, focus, Math.round(ix(focus)), Math.round(iy(focus)));
    g.save();
    const view = layout.view;
    g.translate(view.x, view.y);
    g.beginPath();
    g.rect(0, 0, view.w, view.h);
    g.clip();
    drawTrack(g, race.track, cam);
    drawOil(g, race.oil, cam);
    this.particles.renderSmoke(g, cam);

    drawCars(g, race.cars, cam, ix, iy, ih);
    this.particles.renderSparks(g, cam);
    drawMarker(g, Math.round(ix(race.player)) - cam.x, Math.round(iy(race.player)) - cam.y - 26, PR.teal);
    if (focus !== race.player) drawMarker(g, Math.round(ix(focus)) - cam.x, Math.round(iy(focus)) - cam.y - 26, PR.amber);
    g.restore();
  }

  private renderPhase(g: CanvasRenderingContext2D): void {
    const race = this.race;
    switch (this.phase) {
      case 'choose':
        this.renderChoose(g);
        break;
      case 'options':
        drawRaceSettings(g, optionRows(this.opts), this.sel, this.savedRace ? 'STARTING A NEW RACE ENDS THE CURRENT ONE' : null);
        break;
      case 'paused': {
        const b = this.game.input.getBindings();
        const pause = this.game.touch ? 'ENTER' : keyLabel(b.pause[0] ?? b.pause[1]);
        drawPause(g, { pause, help: keyLabel(b.help[0] ?? b.help[1]) });
        break;
      }
      case 'finishing':
      case 'results':
        g.fillStyle = 'rgba(8,6,18,0.55)';
        g.fillRect(0, 0, layout.w, layout.h);
        inFrame(g, () => drawResults(g, resultRows(race), race.player.finished ? race.classification().indexOf(race.player) + 1 : 0));
        break;
      default:
        break;
    }

    if (overlayImg?.complete && overlayImg.naturalWidth > 0) {
      g.globalAlpha = 0.5;
      g.drawImage(overlayImg, 0, 0, layout.w, layout.h);
      g.globalAlpha = 1;
    }
    if (this.game.params.debug) drawDebug(g, this.debugLines());
  }

  private renderChoose(g: CanvasRenderingContext2D): void {
    const gp = this.gpc?.gp ?? null;
    const live = this.live;
    drawRaceMenu(g, {
      tag: gp ? `GRAND PRIX  ·  ROUND ${round(gp) + 1} / ${gp.tracks.length}` : live ? 'RACE MENU' : 'PRE-RACE',
      title: live ? 'RACE PAUSED' : 'READY TO RACE?',
      stats: menuStats(this.race, gp, this.opts, live),
      items: menuItems(gp, this.midRace, live),
      sel: this.sel,
      danger: ['QUIT TO MAIN MENU', 'RETIRE'],
    });
  }

  private message(): string | null {
    if (this.phase !== 'running' && this.phase !== 'paused') return null;
    const p = this.race.player;
    if (p.finished) return `FINISHED ${ordinal(this.race.classification().indexOf(p) + 1)}!`;
    if (this.watched && this.watched !== p) return `OUT OF FUEL  –  WATCHING ${driverName(this.watched.colorIdx)}`;
    if (isStranded(p)) return this.gpc ? 'OUT OF FUEL' : this.game.touch ? 'OUT OF FUEL  –  open MENU' : 'OUT OF FUEL  –  press ESC';
    if (p.refueling) return 'REFUELING  –  GAS to leave';
    if (this.race.pitAuto) return 'PIT LANE  –  AUTO';
    if (p.fuel < CONFIG.LOW_FUEL && Math.floor(this.race.time * 2) % 2 === 0) return 'LOW FUEL';
    // short of the finish at the player's own rate, when lifting can make it up or a stop is close
    const fuel = fuelOutlook(this.race);
    if (fuel.call === 'short' && (fuel.canSave || fuel.laps < PIT_SOON_LAPS)) return 'FUEL SHORT  –  SAVE OR PIT';
    if (this.notices.penaltyMsg > 0) return `PENALTY +${CONFIG.PENALTY_S} S  –  YOU CAUSED A CRASH`;
    if (this.controls.reverseHint > 0) return 'STOP TO ENGAGE REVERSE';
    if (p.reverse) return 'REVERSE';
    return null;
  }

  private overlayLine(): string {
    const ms = cockpitOverlayMs();
    return `world ${ms.world.toFixed(2)} ms · cabin ${ms.cabin.toFixed(2)} ms · mirror ${ms.mirror.toFixed(2)} ms · cars ${ms.cars.toFixed(2)} ms (median 60)`;
  }

  private debugLines(): string[] {
    const p = this.race.player;
    return [
      `fps ${this.fps.toFixed(0)}  time x${this.game.timeScale} (])`,
      `x ${p.x.toFixed(0)} y ${p.y.toFixed(0)}  s ${p.s.toFixed(0)} d ${p.d.toFixed(1)}`,
      `mph ${p.speed.toFixed(1)}  fuel ${(p.fuel * 100).toFixed(1)}%  spin ${p.spinTime.toFixed(2)}`,
      `sector ${p.lastSector} passed ${p.sectorsPassed}  t ${this.race.time.toFixed(1)}`,
      `grip ${p.gripUse.toFixed(2)} slip ${((wrapAngle(p.heading - p.moveAngle) * 180) / Math.PI).toFixed(1)}° rear ${p.rearLoose ? 'LOOSE' : p.rearStress.toFixed(2)} limit ${warnings(p, this.race.track).vRef.toFixed(0)}`,
      ...(this.cockpit ? [this.overlayLine()] : []),
    ];
  }
}

/** The arrow over a car in the top-down view: the player's (teal) and the watched car's (amber). */
function drawMarker(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - 5, y - 6);
  g.lineTo(x + 5, y - 6);
  g.lineTo(x, y);
  g.closePath();
  g.fill();
}
