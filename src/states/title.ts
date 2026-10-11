import { CONFIG } from '../config';
import { Particles } from '../gfx/particles';
import { drawCars, drawOil, trackCanvas } from '../gfx/world';
import { Car, lapsCompleted } from '../race/car';
import { Race } from '../race/race';
import { trackHeadingAt, WORLD_W, wrapAngle } from '../track/track';
import { driverName } from '../gfx/vehicles';
import { drawTitle, TITLE_ITEMS } from '../ui/menus';
import { CreditsState } from './credits';
import { Game, loadOptions, State } from './game';
import { HelpState } from './info';
import { RaceState } from './race';
import { SettingsState } from './settings';

const W = CONFIG.SCREEN_W;
const TOP = CONFIG.HUD_TOP_H;
const DEMO_LAPS = 18;
const DEMO_WARMUP_S = 12;
const CAM_LEAD = 90;
const CAM_SMOOTH_S = 0.5;

export class TitleState implements State {
  private sel = 0;
  private demo: Race;
  private demoSeed: number;
  private readonly particles = new Particles();
  private camX = NaN;
  private prevCamX = NaN;

  constructor(private readonly game: Game) {
    this.demoSeed = game.params.seed + 7919;
    this.demo = this.newDemo();
  }

  private newDemo(): Race {
    const race = new Race({ cars: 20, laps: DEMO_LAPS, playerColor: 0, qualifying: 'random' }, this.demoSeed++, true);
    race.start();
    const dt = 1 / CONFIG.STEP_HZ;
    for (let t = 0; t < DEMO_WARMUP_S; t += dt) race.step(dt, null);
    this.particles.clear();
    this.camX = NaN;
    return race;
  }

  private camTarget(): number {
    const lead = this.demo.standings()[0];
    const x = lead.x + CAM_LEAD * Math.cos(trackHeadingAt(lead.x, lead.y));
    return Math.min(Math.max(x - W / 2, 0), WORLD_W - W);
  }

  update(dt: number): void {
    const input = this.game.input;
    const n = TITLE_ITEMS.length;
    const audio = this.game.audio;
    if (input.pressed('up')) {
      this.sel = (this.sel + n - 1) % n;
      audio.ui('move');
    }
    if (input.pressed('down')) {
      this.sel = (this.sel + 1) % n;
      audio.ui('move');
    }

    this.demo.step(dt, null);
    this.particles.emit(this.demo.cars, dt);
    this.particles.update(dt);
    if (this.demo.leaderFinished) this.demo = this.newDemo();
    const target = this.camTarget();
    if (Number.isNaN(this.camX)) this.camX = target;
    this.prevCamX = this.camX;
    this.camX += (target - this.camX) * Math.min(1, dt / CAM_SMOOTH_S);

    if (input.pressed('help')) {
      audio.ui('ok');
      this.game.set(new HelpState(this.game, this));
    }
    if (!input.pressed('enter')) return;
    audio.ui('ok');
    switch (TITLE_ITEMS[this.sel]) {
      case 'NEW GAME':
        this.game.set(new RaceState(this.game, loadOptions(this.game.params), 'choose'));
        break;
      case 'CONTROLS':
        this.game.set(new HelpState(this.game, this));
        break;
      case 'SETTINGS':
        this.game.set(new SettingsState(this.game, this));
        break;
      case 'CREDITS':
        this.game.set(new CreditsState(this.game, this));
        break;
    }
  }

  render(g: CanvasRenderingContext2D, alpha = 1): void {
    const race = this.demo;
    if (Number.isNaN(this.camX)) this.camX = this.prevCamX = this.camTarget();
    const ix = (c: Car) => c.prevX + (c.x - c.prevX) * alpha;
    const iy = (c: Car) => c.prevY + (c.y - c.prevY) * alpha;
    const ih = (c: Car) => c.prevHeading + wrapAngle(c.heading - c.prevHeading) * alpha;
    const camX = Math.round(this.prevCamX + (this.camX - this.prevCamX) * alpha);

    g.fillStyle = '#000';
    g.fillRect(0, 0, W, CONFIG.SCREEN_H);
    g.save();
    g.translate(0, TOP);
    g.beginPath();
    g.rect(0, 0, W, CONFIG.PLAY_H);
    g.clip();
    g.drawImage(trackCanvas(), camX, 0, W, CONFIG.PLAY_H, 0, 0, W, CONFIG.PLAY_H);
    drawOil(g, race.oil, camX, W);
    this.particles.renderSmoke(g, camX);
    drawCars(g, race.cars, camX, W, ix, iy, ih);
    this.particles.renderSparks(g, camX);
    g.restore();

    const order = race.standings();
    drawTitle(g, {
      sel: this.sel,
      lap: Math.min(race.laps, lapsCompleted(order[0]) + 1),
      laps: race.laps,
      top: order.slice(0, 5).map((c) => driverName(c.colorIdx)),
    });
  }
}
