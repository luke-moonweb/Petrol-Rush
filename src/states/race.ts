import { CONFIG, LAP_CHOICES, QUALIFYING_CHOICES, RaceOptions } from '../config';
import { drawCars, drawOil, trackCanvas } from '../gfx/world';
import { Car, lapsCompleted } from '../race/car';
import { cornerAssist, DriveInput, skidWarning, SteerRamp } from '../race/physics';
import { NUM_COLORS, Race } from '../race/race';
import { deltaS, inTurn, trackHeadingAt, WORLD_W, wrapAngle } from '../track/track';
import { Particles } from '../gfx/particles';
import { drawFuelGauge, drawHudTop, drawSkidLamp, drawSpeedo, drawTower } from '../ui/hud';
import { keyLabel } from '../input';
import { drawPause, drawRaceMenu, drawRaceSettings, drawResults, ResultRow, SettingRow } from '../ui/overlays';
import { offBall, ordinal, redBall, text } from '../ui/text';
import { FONT_BLACK, PR } from '../ui/theme';
import { Game, saveOptions, State } from './game';
import { HelpState } from './info';
import { TitleState } from './title';

type Phase = 'choose' | 'options' | 'running' | 'paused' | 'results';

const W = CONFIG.SCREEN_W;
const VIEW_X = CONFIG.HUD_LEFT_W;
const VIEW_W = W - VIEW_X;
const LIGHTS_COUNT = 5;
const LIGHT_INTERVAL_S = 1;
const PLAY_H = CONFIG.PLAY_H;
const TOP = CONFIG.HUD_TOP_H;
const CRASH_WARN_PX = 1100;
const NOTICE_S = 4;
const RADIO_GAP_S = 8;
const SPEED_BAR_MAX_OVER = 20;

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
  private notice: { text: string; age: number } | null = null;
  private radioCooldown = 0;
  private penaltyMsg = 0;
  private sound = { crashes: new Map<number, number>(), scrape: 0, wallCd: 0, bumpCd: 0, lit: 0, laps: 0, lowFuel: false, finished: false };
  private lights: { t: number; outAt: number } | null = null;
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
    if (this.sound) this.sound = { crashes: new Map(), scrape: 0, wallCd: 0, bumpCd: 0, lit: 0, laps: 0, lowFuel: false, finished: false };
    const prefs = this.game.prefs;
    this.notice = null;
    this.penaltyMsg = 0;
    return new Race(this.opts, this.seed++, false, { penalties: prefs.penalties, collisions: prefs.collisions });
  }

  onBlur(): void {
    if (this.phase === 'running') this.phase = 'paused';
    this.game.audio.silence();
  }

  update(dt: number): void {
    const input = this.game.input;
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
        if (input.pressed('pause')) this.phase = 'running';
        else if (input.pressed('menu') || input.pressed('back')) this.openMenu();
        else if (input.pressed('help')) this.game.set(new HelpState(this.game, this));
        break;
      case 'results':
        if (input.pressed('enter') || input.pressed('back')) this.game.set(new TitleState(this.game));
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
      else this.game.set(new TitleState(this.game));
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
        this.game.set(new TitleState(this.game));
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
        o.laps = LAP_CHOICES[(cur + delta + LAP_CHOICES.length) % LAP_CHOICES.length];
        break;
      }
      case 2:
        o.playerColor = (o.playerColor + delta + NUM_COLORS) % NUM_COLORS;
        break;
      case 3: {
        const idx = QUALIFYING_CHOICES.indexOf(o.qualifying);
        o.qualifying = QUALIFYING_CHOICES[(idx + delta + QUALIFYING_CHOICES.length) % QUALIFYING_CHOICES.length];
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
    this.reverseHint = Math.max(0, this.reverseHint - dt);
    if (
      drive.toggleReverse &&
      !this.race.pitAuto &&
      !p0.reverse &&
      Math.abs(p0.speed) > CONFIG.REVERSE_TOGGLE_MAX_MPH
    ) {
      this.reverseHint = 1.5;
    }
    if (this.lights) {
      this.lights.t += dt;
      const lit = Math.min(LIGHTS_COUNT, Math.floor(this.lights.t / LIGHT_INTERVAL_S));
      if (!this.race.started && lit > this.sound.lit) this.game.audio.lightOn();
      this.sound.lit = lit;
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
    this.particles.emit(this.race.cars, dt);
    this.particles.update(dt);
    this.updateCamera(dt);

    const used = this.race.pitAuto ? this.race.playerDrive : drive;
    this.updateSound(dt, used);
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
    return Math.min(Math.max(Math.round(x + off) - VIEW_W / 2, 0), WORLD_W - VIEW_W);
  }

  private updateSound(dt: number, drive: DriveInput): void {
    const audio = this.game.audio;
    const race = this.race;
    const p = race.player;
    const snd = this.sound;
    snd.wallCd = Math.max(0, snd.wallCd - dt);
    snd.bumpCd = Math.max(0, snd.bumpCd - dt);

    audio.setEngine(p.speed, true, drive.gas && !p.reverse);
    const braking = drive.brake && Math.abs(p.speed) > 90 && p.spinTime <= 0;
    audio.setScreech(p.spinTime > 0 ? 1 : p.slideTime > 0 ? 0.7 : braking ? 0.35 : 0);
    audio.setRefuel(p.refueling);

    let near = 0;
    for (const c of race.cars) if (c !== p && Math.hypot(c.x - p.x, c.y - p.y) < 260) near++;
    audio.setPack(near / 6);

    const camX = this.camXFor(p.x);
    const pxm = CONFIG.PX_PER_MPH;
    const SOUND_C = 700;
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
          pan: (c.x - camX - VIEW_W / 2) / (VIEW_W / 2),
          vol: 1 - dist / 450,
          doppler,
          pitch: 0.88 + (c.colorIdx % 7) * 0.04,
        };
      });
    audio.setRivals(rivals);

    const prevCrashes = snd.crashes.get(p.id) ?? 0;
    const touching = p.wallImpact > 0 || p.contactStrength > 0;
    let scrape = 0;
    if (p.crashes > prevCrashes && touching) {
      audio.crash(Math.max(p.wallImpact, p.contactStrength, 40));
      snd.wallCd = snd.bumpCd = 0.4;
    } else if (p.wallImpact > 0) {
      if (p.wallImpact >= 12 && snd.wallCd <= 0) {
        audio.wallHit(p.wallImpact);
        snd.wallCd = 0.25;
      } else if (Math.abs(p.speed) > 15) scrape = Math.min(1, 0.3 + Math.abs(p.speed) / 200);
    } else if (p.contactStrength > 0) {
      const fresh = p.contactPrev === 0;
      if ((fresh || p.contactStrength >= 10) && snd.bumpCd <= 0) {
        audio.carBump(p.contactStrength);
        snd.bumpCd = 0.2;
      } else scrape = Math.min(0.6, Math.abs(p.speed) / 300);
    }
    snd.scrape = scrape > 0 ? 0.08 : Math.max(0, snd.scrape - dt);
    audio.setScrape(scrape > 0 ? scrape : snd.scrape > 0 ? 0.3 : 0);
    snd.crashes.set(p.id, p.crashes);

    for (const c of race.cars) {
      if (c === p) continue;
      const prev = snd.crashes.get(c.id) ?? 0;
      snd.crashes.set(c.id, c.crashes);
      const sx = c.x - camX;
      if (sx < -40 || sx > VIEW_W + 40) continue;
      const pan = (sx - VIEW_W / 2) / (VIEW_W / 2);
      const vol = 0.45 * Math.max(0.2, 1 - Math.hypot(c.x - p.x, c.y - p.y) / 500);
      if (c.crashes > prev && (c.wallImpact > 0 || c.contactStrength > 0)) audio.crash(40, pan, vol);
      else if (c.wallImpact >= 20) audio.wallHit(c.wallImpact, pan, vol * 0.6);
    }

    const laps = lapsCompleted(p);
    if (p.finished && !snd.finished) {
      snd.finished = true;
      audio.finishFanfare();
    } else if (laps > snd.laps && !p.finished && laps > 0) audio.lapChime();
    snd.laps = laps;
    if (p.fuel < 0.12 && !snd.lowFuel && !p.finished) audio.lowFuel();
    snd.lowFuel = p.fuel < 0.12;
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
    const camX = this.camXFor(Math.round(ix(race.player)));
    g.save();
    g.translate(VIEW_X, TOP);
    g.beginPath();
    g.rect(0, 0, VIEW_W, PLAY_H);
    g.clip();
    g.drawImage(trackCanvas(), camX, 0, VIEW_W, PLAY_H, 0, 0, VIEW_W, PLAY_H);
    drawOil(g, race.oil, camX, VIEW_W);
    this.particles.renderSmoke(g, camX);

    drawCars(g, race.cars, camX, VIEW_W, ix, iy, ih);
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
    if (this.game.prefs.speedBar && this.phase !== 'results') this.renderSpeedBar(g, px, py + 8);
    g.restore();

    drawHudTop(g, race, this.notice);
    drawTower(g, race);
    drawSpeedo(g, race.player.speed, 62, 396, 54);
    drawFuelGauge(g, race.player.fuel, race.time, 62, 456, 34);
    drawSkidLamp(g, this.phase === 'running' && race.started ? skidWarning(race.player) : 0, race.time, W - 6, TOP + 6);
    this.renderMessages(g);
    if (this.lights && this.phase !== 'choose' && this.phase !== 'options') this.renderLights(g);

    switch (this.phase) {
      case 'choose':
        this.renderChoose(g);
        break;
      case 'options':
        drawRaceSettings(g, this.optionItems(), this.sel, this.savedRace ? 'STARTING A NEW RACE ENDS THE CURRENT ONE' : null);
        break;
      case 'paused': {
        const b = this.game.input.getBindings();
        drawPause(g, { pause: keyLabel(b.pause[0] ?? b.pause[1]), help: keyLabel(b.help[0] ?? b.help[1]) });
        break;
      }
      case 'results':
        this.renderResults(g);
        break;
      default:
        break;
    }

    if (overlayImg?.complete && overlayImg.naturalWidth > 0) {
      g.globalAlpha = 0.5;
      g.drawImage(overlayImg, 0, 0, W, CONFIG.SCREEN_H);
      g.globalAlpha = 1;
    }
    if (this.game.params.debug) this.renderDebug(g);
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
    let stats;
    if (live) {
      const list = race.standings();
      const gap = list[0] === p ? null : race.gap(p, list[0]);
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
        { label: 'GRID', value: QUALIFYING_LABELS[o.qualifying].replace(' OF GRID', '').replace(' POSITION', '') },
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

  private renderLights(g: CanvasRenderingContext2D): void {
    const L = this.lights!;
    const out = L.t >= L.outAt;
    const lit = out ? 0 : Math.min(LIGHTS_COUNT, Math.floor(L.t / LIGHT_INTERVAL_S));
    const r = 7;
    const gap = 10;
    const w = LIGHTS_COUNT * 2 * r + (LIGHTS_COUNT + 1) * gap;
    const h = 2 * r + 2 * 8;
    const x0 = Math.round(VIEW_X + VIEW_W / 2 - w / 2);
    const y0 = TOP + 12;
    g.fillStyle = PR.night;
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = '#2A2740';
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    for (let i = 0; i < LIGHTS_COUNT; i++) {
      const cx = x0 + gap + r + i * (2 * r + gap);
      const cy = y0 + h / 2;
      if (i < lit) {
        g.save();
        g.shadowColor = PR.red;
        g.shadowBlur = 12;
        redBall(g, cx, cy);
        g.restore();
      } else offBall(g, cx, cy);
    }
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

  private renderSpeedBar(g: CanvasRenderingContext2D, cx: number, bottom: number): void {
    const p = this.race.player;
    if (this.race.pitAuto || p.finished || p.spinTime > 0) return;
    const over = Math.abs(p.speed) - CONFIG.SPIN_MPH;
    if (over <= 0.5) return;
    const W_BAR = 34;
    const H_BAR = 4;
    const scale = W_BAR / SPEED_BAR_MAX_OVER;
    const len = Math.min(W_BAR, over * scale);
    const slideEnd = CONFIG.SLIDE_SPIN_OVER * scale;
    const x0 = Math.round(cx - W_BAR / 2);
    const y0 = Math.round(bottom - H_BAR);
    g.fillStyle = 'rgba(10,9,20,0.55)';
    g.fillRect(x0 - 1, y0 - 1, W_BAR + 2, H_BAR + 2);
    g.fillStyle = '#FF9A2E';
    g.fillRect(x0, y0, Math.min(len, slideEnd), H_BAR);
    if (len > slideEnd) {
      g.fillStyle = PR.red;
      g.fillRect(x0 + slideEnd, y0, len - slideEnd, H_BAR);
    }
    g.fillStyle = 'rgba(255,248,232,0.5)';
    g.fillRect(x0 + slideEnd, y0 - 1, 1, H_BAR + 2);
  }

  private renderMessages(g: CanvasRenderingContext2D): void {
    if (this.phase !== 'running' && this.phase !== 'paused') return;
    const p = this.race.player;
    const f = `14px ${FONT_BLACK}`;
    const y = TOP + 44;
    let msg: string | null = null;
    if (p.finished) msg = `FINISHED ${ordinal(this.race.classification().indexOf(p) + 1)}!`;
    else if (p.fuel <= 0 && Math.abs(p.speed) < 1) msg = 'OUT OF FUEL  –  press ESC';
    else if (p.refueling) msg = 'REFUELING...';
    else if (this.race.pitAuto) msg = 'PIT LANE  –  AUTO';
    else if (p.fuel < 0.12 && Math.floor(this.race.time * 2) % 2 === 0) msg = 'LOW FUEL';
    else if (this.penaltyMsg > 0) msg = `PENALTY +${CONFIG.PENALTY_S} S  –  YOU CAUSED A CRASH`;
    else if (this.reverseHint > 0) msg = 'STOP TO ENGAGE REVERSE';
    else if (p.reverse) msg = 'REVERSE';
    if (!msg) return;
    g.save();
    g.shadowColor = PR.amber;
    g.shadowBlur = 8;
    text(g, msg, VIEW_X + VIEW_W / 2, y, { font: f, align: 'center', color: PR.amber, shadow: null });
    g.restore();
  }

  private renderResults(g: CanvasRenderingContext2D): void {
    const race = this.race;
    const list = race.classification();
    const winner = list[0];
    const tWin = race.resultTime(winner);
    const rows: ResultRow[] = list.map((car, i) => {
      let time: string;
      const t = race.resultTime(car);
      const lapsDown = lapsCompleted(winner) - lapsCompleted(car);
      if (i === 0 && t !== null) {
        const m = Math.floor(t / 60);
        time = `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
      } else if (t !== null && tWin !== null && lapsDown === 0) time = `+${(t - tWin).toFixed(2)}`;
      else if (lapsDown > 0) time = `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`;
      else time = 'RUNNING';
      return { colorIdx: car.colorIdx, isPlayer: car.isPlayer, time, penalty: car.penalty };
    });
    drawResults(g, rows, race.player.finished ? list.indexOf(race.player) + 1 : 0);
  }

  private renderDebug(g: CanvasRenderingContext2D): void {
    const p = this.race.player;
    const lines = [
      `fps ${this.fps.toFixed(0)}  time x${this.game.timeScale} (])`,
      `x ${p.x.toFixed(0)} y ${p.y.toFixed(0)}  s ${p.s.toFixed(0)} d ${p.d.toFixed(1)}`,
      `mph ${p.speed.toFixed(1)}  fuel ${(p.fuel * 100).toFixed(1)}%  spin ${p.spinTime.toFixed(2)}`,
      `sector ${p.lastSector} passed ${p.sectorsPassed}  t ${this.race.time.toFixed(1)}`,
    ];
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(4, 4, 300, lines.length * 12 + 6);
    lines.forEach((l, i) => text(g, l, 8, 16 + i * 12, { font: `10px monospace`, shadow: null, color: '#8f8' }));
  }
}
