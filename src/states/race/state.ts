import { CONFIG, LAP_CHOICES, QUALIFYING_CHOICES, type RaceOptions } from '../../config';
import { stepCabin } from '../../gfx/fpv/cabin';
import { prewarmCockpit } from '../../gfx/fpv/cockpit';
import { cockpitOverlayMs, drawCockpitView } from '../../gfx/fpv/view';
import { Particles } from '../../gfx/particles';
import { drawCars, drawOil, trackCanvas } from '../../gfx/world';
import { keyLabel } from '../../input';
import { inFrame, layout } from '../../layout';
import { savePrefs } from '../../prefs';
import { type Car, lapsCompleted } from '../../race/car';
import { cornerAssist, type DriveInput, SteerRamp, skidWarning } from '../../race/physics';
import { NUM_COLORS, Race } from '../../race/race';
import type { TouchLayout } from '../../touch';
import { deltaS, inTurn, trackHeadingAt, WORLD_W, wrapAngle } from '../../track/track';
import type { Hit } from '../../ui/hit';
import { drawHudPanel, drawHudTop, drawSkidLamp } from '../../ui/hud';
import { drawPause, drawRaceMenu, drawRaceSettings, drawResults, type SettingRow, type StatField } from '../../ui/overlays';
import { ordinal } from '../../ui/text';
import { PR } from '../../ui/theme';
import { type Game, type State, saveOptions, tapSide } from '../game';
import { HelpState } from '../info';
import { RaceSound } from './sound';
import {
  drawDebug,
  drawRaceMessage,
  drawSpeedBar,
  drawStartLights,
  LIGHT_INTERVAL_S,
  LIGHTS_COUNT,
  resultRows,
  type StartLights,
} from './view';

type Phase = 'choose' | 'options' | 'running' | 'paused' | 'results';

const CRASH_WARN_PX = 1100;
const NOTICE_S = 4;
const RADIO_GAP_S = 8;

let overlayImg: HTMLImageElement | null = null;

const OPTION_LABELS = ['CARS', 'LAPS', 'YOUR CAR', 'GRID POSITION', 'START RACE'];

const QUALIFYING_LABELS: Record<string, string> = {
  last: 'BACK OF GRID',
  middle: 'MIDDLE OF GRID',
  pole: 'POLE POSITION',
  random: 'RANDOM',
};

export class RaceState implements State {
  private race: Race;
  private phase: Phase;
  private sel = 0;
  private midRace = false;
  private savedRace: Race | null = null;
  private finishTimer = 0;
  private assistLevel = 0;
  private camOff = NaN;
  private readonly steerRamp = new SteerRamp();
  private reverseHint = 0;
  private steerVis = 0;
  private notice: { text: string; age: number } | null = null;
  private radioCooldown = 0;
  private penaltyMsg = 0;
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
  ) {
    trackCanvas();
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
    this.camOff = NaN;
    this.assistLevel = 0;
    this.sound = new RaceSound(this.game.audio);
    this.lightsShown = 0;
    const prefs = this.game.prefs;
    this.notice = null;
    this.penaltyMsg = 0;
    return new Race(this.opts, this.seed++, false, { penalties: prefs.penalties, collisions: prefs.collisions });
  }

  touchLayout(): TouchLayout {
    return this.phase === 'running' ? 'race' : 'menu';
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
        input.tapVirtual(OPTION_LABELS[hit.id] === 'START RACE' ? 'enter' : tapSide(hit, x));
        break;
      case 'results':
        input.tapVirtual('enter');
        break;
      default:
        break;
    }
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
    if (input.pressed('camera')) {
      const prefs = this.game.prefs;
      prefs.camera = prefs.camera === 'top' ? 'cockpit' : 'top';
      savePrefs(prefs);
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
      case 'results':
        if (input.pressed('enter') || input.pressed('back')) this.game.toTitle();
        break;
    }
    if (this.phase !== 'running') this.game.audio.silence();
  }

  private chooseItems(): string[] {
    if (this.midRace && (this.race.started || this.lights)) {
      return ['RESUME RACE', 'RESTART RACE', 'RACE SETTINGS', 'QUIT TO MAIN MENU'];
    }
    if (this.midRace) return ['START RACE', 'RACE SETTINGS', 'QUIT TO MAIN MENU'];
    return ['START RACE', 'RACE SETTINGS'];
  }

  private openMenu(): void {
    this.midRace = true;
    this.phase = 'choose';
    this.sel = 0;
  }

  private updateChoose(): void {
    const input = this.game.input;
    const items = this.chooseItems();
    const audio = this.game.audio;
    if (input.pressed('up') || input.pressed('down')) audio.ui('move');
    if (input.pressed('up')) this.sel = (this.sel + items.length - 1) % items.length;
    if (input.pressed('down')) this.sel = (this.sel + 1) % items.length;
    if (input.pressed('back') || input.pressed('menu')) {
      audio.ui('back');
      if (this.midRace && (this.race.started || this.lights)) this.phase = 'running';
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
      case 'START RACE':
      case 'RESTART RACE':
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
      if (OPTION_LABELS[this.sel] === 'START RACE') {
        audio.ui('ok');
        this.startRace();
        return;
      }
      delta = 1;
    }
    if (delta === 0) return;
    audio.ui('move');
    const o = { ...this.opts };
    switch (this.sel) {
      case 0:
        o.cars = ((o.cars - 1 + delta + 20) % 20) + 1;
        break;
      case 1: {
        const idx = LAP_CHOICES.indexOf(o.laps);
        const cur = idx < 0 ? LAP_CHOICES.indexOf(18) : idx;
        o.laps = LAP_CHOICES[(cur + delta + LAP_CHOICES.length) % LAP_CHOICES.length]!;
        break;
      }
      case 2:
        o.playerColor = (o.playerColor + delta + NUM_COLORS) % NUM_COLORS;
        break;
      case 3: {
        const idx = QUALIFYING_CHOICES.indexOf(o.qualifying);
        o.qualifying = QUALIFYING_CHOICES[(idx + delta + QUALIFYING_CHOICES.length) % QUALIFYING_CHOICES.length]!;
        break;
      }
    }
    this.opts = o;
    this.race = this.newRace();
  }

  private startRace(): void {
    saveOptions(this.opts);
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
    const p0 = this.race.player;
    const steerKey = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    const assist = cornerAssist(p0);
    const step = dt / CONFIG.CORNER_ASSIST_IN_S;
    this.assistLevel = assist !== 0 ? Math.min(1, this.assistLevel + step) : Math.max(0, this.assistLevel - step);
    const keySteer = this.steerRamp.update(steerKey, dt, inTurn(p0.x));
    const drive: DriveInput = {
      steer: this.race.pitAuto ? 0 : Math.max(-1, Math.min(1, keySteer + assist * this.assistLevel)),
      gas: input.isDown('gas'),
      brake: input.isDown('brake'),
      toggleReverse: input.pressed('reverse'),
    };
    const shownSteer = this.race.pitAuto ? this.race.playerDrive.steer : drive.steer;
    this.steerVis += (shownSteer - this.steerVis) * Math.min(1, dt * 12);
    this.reverseHint = Math.max(0, this.reverseHint - dt);
    if (drive.toggleReverse && !this.race.pitAuto && !p0.reverse && Math.abs(p0.speed) > CONFIG.REVERSE_TOGGLE_MAX_MPH) {
      this.reverseHint = 1.5;
    }
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
        this.game.audio.setEngine(drive.gas ? 70 : 10, true, drive.gas);
        return;
      }
    }
    this.race.step(dt, drive);
    stepCabin(this.race, dt);
    this.particles.emit(this.race.cars, dt);
    this.particles.update(dt);
    this.updateCamera(dt);

    const used = this.race.pitAuto ? this.race.playerDrive : drive;
    this.sound.update(dt, this.race, used, this.camXFor(this.race.player.x), this.game.prefs.camera === 'cockpit');
    this.handleEvents(dt);
    const p = this.race.player;

    if (p.finished) {
      this.finishTimer += dt;
      if (this.finishTimer > 3) this.phase = 'results';
    }
  }

  private updateCamera(dt: number): void {
    const p = this.race.player;
    const target = CONFIG.CAMERA_LEAD * Math.cos(trackHeadingAt(p.x, p.y));
    if (Number.isNaN(this.camOff)) this.camOff = target;
    else this.camOff += (target - this.camOff) * Math.min(1, dt / CONFIG.CAMERA_LEAD_S);
  }

  private camXFor(x: number): number {
    const p = this.race.player;
    const off = Number.isNaN(this.camOff) ? CONFIG.CAMERA_LEAD * Math.cos(trackHeadingAt(p.x, p.y)) : this.camOff;
    const vw = layout.view.w;
    return Math.min(Math.max(Math.round(x + off) - vw / 2, 0), WORLD_W - vw);
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
    const cockpit = this.game.prefs.camera === 'cockpit';
    const skid = this.phase === 'running' && race.started ? skidWarning(race.player) : 0;
    if (cockpit) {
      const lt = this.lights;
      const out = !!lt && lt.t >= lt.outAt;
      const lights = lt
        ? { lit: out ? 0 : Math.min(LIGHTS_COUNT, Math.floor(lt.t / LIGHT_INTERVAL_S)), out, since: lt.t - lt.outAt }
        : undefined;
      const touch = this.game.touch;
      drawCockpitView(g, { race, view, ix, iy, ih, steer: this.steerVis, time: race.time, touch, skid, lights, particles: this.particles });
    } else {
      this.renderTopDown(g, race, ix, iy, ih);
      prewarmCockpit(g, view.w, view.h, race.player.colorIdx, this.game.touch);
    }

    drawHudTop(g, race, this.notice);
    drawHudPanel(g, race);
    if (!cockpit) drawSkidLamp(g, skid, race.time, view.x + view.w - 6, view.y + 6);
    const msg = this.message();
    const low = Math.round(view.h * 0.22);
    if (msg) drawRaceMessage(g, msg, cockpit ? low + 30 : 44);
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
    const camX = this.camXFor(Math.round(ix(race.player)));
    g.save();
    const view = layout.view;
    g.translate(view.x, view.y);
    g.beginPath();
    g.rect(0, 0, view.w, view.h);
    g.clip();
    g.drawImage(trackCanvas(), camX, 0, view.w, view.h, 0, 0, view.w, view.h);
    drawOil(g, race.oil, camX, view.w);
    this.particles.renderSmoke(g, camX);

    drawCars(g, race.cars, camX, view.w, ix, iy, ih);
    this.particles.renderSparks(g, camX);
    const px = Math.round(ix(race.player)) - camX;
    const py = Math.round(iy(race.player)) - 26;
    g.fillStyle = PR.teal;
    g.beginPath();
    g.moveTo(px - 5, py - 6);
    g.lineTo(px + 5, py - 6);
    g.lineTo(px, py);
    g.closePath();
    g.fill();
    if (this.game.prefs.speedBar && this.phase !== 'results') drawSpeedBar(g, race.player, race.pitAuto, px, py + 8);
    g.restore();
  }

  private renderPhase(g: CanvasRenderingContext2D): void {
    const race = this.race;
    switch (this.phase) {
      case 'choose':
        this.renderChoose(g);
        break;
      case 'options':
        drawRaceSettings(g, this.optionItems(), this.sel, this.savedRace ? 'STARTING A NEW RACE ENDS THE CURRENT ONE' : null);
        break;
      case 'paused': {
        const b = this.game.input.getBindings();
        const pause = this.game.touch ? 'ENTER' : keyLabel(b.pause[0] ?? b.pause[1]);
        drawPause(g, { pause, help: keyLabel(b.help[0] ?? b.help[1]) });
        break;
      }
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

  private optionItems(): SettingRow[] {
    const o = this.opts;
    return OPTION_LABELS.map((label, i) => {
      switch (i) {
        case 0:
          return { label, value: String(o.cars) };
        case 1:
          return { label, value: String(o.laps) };
        case 2:
          return { label, carColor: o.playerColor };
        case 3:
          return { label, value: QUALIFYING_LABELS[o.qualifying] };
        default:
          return { label, action: true };
      }
    });
  }

  private renderChoose(g: CanvasRenderingContext2D): void {
    const race = this.race;
    const items = this.chooseItems();
    const live = this.midRace && (race.started || this.lights);
    const p = race.player;
    let stats: StatField[];
    if (live) {
      const list = race.standings();
      const gap = list[0] === p ? null : race.gap(p, list[0]!);
      stats = [
        { label: 'LAP', value: `${Math.min(race.laps, lapsCompleted(p) + 1)} / ${race.laps}` },
        { label: 'POSITION', value: `${race.position(p)} / ${race.cars.length}` },
        { label: 'FUEL', value: `${Math.round(Math.max(0, p.fuel) * 100)}%` },
        { label: 'TO LEADER', value: list[0] === p ? 'LEADING' : gap === null ? '—' : `+${gap.toFixed(2)}` },
      ];
    } else {
      const o = this.opts;
      stats = [
        { label: 'CARS', value: String(o.cars) },
        { label: 'LAPS', value: String(o.laps) },
        { label: 'YOUR CAR', carColor: o.playerColor },
        { label: 'GRID', value: QUALIFYING_LABELS[o.qualifying]!.replace(' OF GRID', '').replace(' POSITION', '') },
      ];
    }
    drawRaceMenu(g, {
      tag: live ? 'RACE MENU' : 'PRE-RACE',
      title: live ? 'RACE PAUSED' : 'READY TO RACE?',
      stats,
      items,
      sel: this.sel,
      danger: ['QUIT TO MAIN MENU'],
    });
  }

  private handleEvents(dt: number): void {
    const race = this.race;
    const p = race.player;
    this.radioCooldown = Math.max(0, this.radioCooldown - dt);
    this.penaltyMsg = Math.max(0, this.penaltyMsg - dt);
    if (this.notice) {
      this.notice.age += dt;
      if (this.notice.age > NOTICE_S) this.notice = null;
    }
    const audio = this.game.audio;
    for (const e of race.events) {
      if (e.type === 'penalty' && e.car === p) {
        this.penaltyMsg = 3;
        audio.radio(`Penalty! ${e.seconds} seconds.`);
        this.radioCooldown = 4;
        continue;
      }
      if (e.type !== 'spin' || e.car === p || p.finished) continue;
      const ds = deltaS(p.s, e.car.s);
      if (ds < -40 || ds > CRASH_WARN_PX || (e.car.pitSide && e.car.wasInPit)) continue;
      if (this.notice) this.notice.age = Math.min(this.notice.age, 1);
      else this.notice = { text: 'CAUTION  ·  CRASH AHEAD', age: 0 };
      if (this.radioCooldown <= 0) {
        audio.radio('Caution! Crash ahead!');
        this.radioCooldown = RADIO_GAP_S;
      }
    }
  }

  private message(): string | null {
    if (this.phase !== 'running' && this.phase !== 'paused') return null;
    const p = this.race.player;
    if (p.finished) return `FINISHED ${ordinal(this.race.classification().indexOf(p) + 1)}!`;
    if (p.fuel <= 0 && Math.abs(p.speed) < 1) return this.game.touch ? 'OUT OF FUEL  –  open MENU' : 'OUT OF FUEL  –  press ESC';
    if (p.refueling) return 'REFUELING...';
    if (this.race.pitAuto) return 'PIT LANE  –  AUTO';
    if (p.fuel < CONFIG.LOW_FUEL && Math.floor(this.race.time * 2) % 2 === 0) return 'LOW FUEL';
    if (this.penaltyMsg > 0) return `PENALTY +${CONFIG.PENALTY_S} S  –  YOU CAUSED A CRASH`;
    if (this.reverseHint > 0) return 'STOP TO ENGAGE REVERSE';
    if (p.reverse) return 'REVERSE';
    return null;
  }

  private debugLines(): string[] {
    const p = this.race.player;
    return [
      `fps ${this.fps.toFixed(0)}  time x${this.game.timeScale} (])`,
      `x ${p.x.toFixed(0)} y ${p.y.toFixed(0)}  s ${p.s.toFixed(0)} d ${p.d.toFixed(1)}`,
      `mph ${p.speed.toFixed(1)}  fuel ${(p.fuel * 100).toFixed(1)}%  spin ${p.spinTime.toFixed(2)}`,
      `sector ${p.lastSector} passed ${p.sectorsPassed}  t ${this.race.time.toFixed(1)}`,
      ...(this.game.prefs.camera === 'cockpit' ? [`cockpit overlay ${cockpitOverlayMs().toFixed(2)} ms (median 60)`] : []),
    ];
  }
}
