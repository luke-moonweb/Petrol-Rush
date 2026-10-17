import { CONFIG, DEFAULT_RULES, type RaceOptions, type RaceRules } from '../config';
import { createRng, lerp, type Rng } from '../sim/rng';
import { inPitLane, NUM_SECTORS, PIT_LINE_IN_X, PIT_LINE_OUT_X, pointAt, project, SECTOR_LEN, TRACK_LEN } from '../track/track';
import { aiInput } from './ai';
import { type Car, initProgress, lapsCompleted, progress, updateProgress } from './car';
import { type OilSlick, oilRadius } from './oil';
import { collideCars, type DriveInput, NO_INPUT, startSpin, stepCar } from './physics';
import { boxX, updatePit } from './pit';

export const NUM_COLORS = 20;
const TYPICAL_MPH = 155;

export type RaceEvent = { type: 'spin'; car: Car } | { type: 'penalty'; car: Car; seconds: number };

export function gridS(slot: number): number {
  return CONFIG.GRID_FRONT_S - CONFIG.CAR_LEN / 2 - slot * CONFIG.GRID_SPACING;
}
const MAX_CARS = 20;

export class Race {
  readonly cars: Car[] = [];
  readonly player: Car;
  readonly laps: number;
  readonly finishOrder: Car[] = [];
  started = false;
  time = 0;
  leaderFinished = false;
  pitAuto = false;
  playerDrive: DriveInput = NO_INPUT;
  readonly oil: OilSlick[] = [];
  readonly events: RaceEvent[] = [];
  private readonly rng: Rng;
  private readonly sectorTimes = new Map<number, Map<number, number>>();
  private readonly finishTimes = new Map<number, number>();

  constructor(
    readonly opts: RaceOptions,
    seed: number,
    readonly playerAI = false,
    readonly rules: RaceRules = DEFAULT_RULES,
  ) {
    this.rng = createRng(seed);
    this.laps = opts.laps;
    const n = Math.max(1, Math.min(NUM_COLORS, opts.cars));

    const playerSlot = this.playerSlot(n);
    const otherColors: number[] = [];
    for (let c = 0; c < NUM_COLORS; c++) if (c !== opts.playerColor) otherColors.push(c);

    let aiIdx = 0;
    for (let slot = 0; slot < n; slot++) {
      const isPlayer = slot === playerSlot;
      const colorIdx = isPlayer ? opts.playerColor : otherColors[aiIdx++]!;
      this.cars.push(this.makeCar(slot, colorIdx, isPlayer));
    }
    this.player = this.cars[playerSlot]!;
  }

  private playerSlot(n: number): number {
    switch (this.opts.qualifying) {
      case 'pole':
        return 0;
      case 'middle':
        return Math.floor(n / 2);
      case 'random':
        return Math.floor(this.rng() * n);
      default:
        return n - 1;
    }
  }

  private makeCar(slot: number, colorIdx: number, isPlayer: boolean): Car {
    const d = CONFIG.GRID_LANES[slot % 2]!;
    const s = gridS(slot);
    const p = pointAt(s, d);
    const car: Car = {
      id: slot,
      colorIdx,
      isPlayer,
      x: p.x,
      y: p.y,
      prevX: p.x,
      prevY: p.y,
      prevHeading: p.heading,
      heading: p.heading,
      moveAngle: p.heading,
      speed: 0,
      reverse: false,
      fuel: 1,
      spinTime: 0,
      spinDir: 1,
      spinRate: 0,
      crashes: 0,
      overTime: 0,
      slideTime: 0,
      gripUse: 0,
      gripLong: 0,
      gripOver: 0,
      rearLoose: false,
      rearStress: 0,
      weightFwd: 0,
      slipPeak: 0,
      wallAgo: 99,
      penalty: 0,
      penaltyAt: -99,
      oilImmune: 0,
      braking: false,
      brakeHold: 0,
      s: 0,
      d: 0,
      lastSector: 0,
      sectorsPassed: 0,
      finished: false,
      finishPos: 0,
      finalProgress: 0,
      finalSectors: 0,
      pitSide: false,
      wasInPit: false,
      refueling: false,
      wallImpact: 0,
      contactX: 0,
      contactY: 0,
      contactStrength: 0,
      contactPrev: 0,
      ai: {
        topMph: lerp(CONFIG.AI_TOP_MPH[0], CONFIG.AI_TOP_MPH[1], this.rng()),
        turnMph: lerp(CONFIG.AI_TURN_MPH[0], CONFIG.AI_TURN_MPH[1], this.rng()),
        lane: d,
        laneCooldown: 0,
        pitPhase: 'none',
        boxX: boxX(slot),
        pitFuelLaps: lerp(CONFIG.AI_PIT_FUEL_LAPS[0], CONFIG.AI_PIT_FUEL_LAPS[1], this.rng()),
        stuckTime: 0,
        reaction: lerp(CONFIG.AI_REACTION_S[0], CONFIG.AI_REACTION_S[1], this.rng()),
        hazardTime: 0,
        recoverTime: 0,
        creepTime: 0,
        oilTime: 0,
      },
    };
    const st = project(car.x, car.y);
    car.s = st.s;
    car.d = st.d;
    initProgress(car);
    return car;
  }

  start(): void {
    this.started = true;
  }

  step(dt: number, playerInput: DriveInput | null): void {
    if (!this.started) return;
    this.time += dt;
    this.events.length = 0;
    const spinning = this.cars.map((c) => c.spinTime > 0);
    for (const car of this.cars) {
      car.prevX = car.x;
      car.prevY = car.y;
      car.prevHeading = car.heading;
      car.contactPrev = car.contactStrength;
      car.contactStrength = 0;
    }
    const view = { cars: this.cars, started: this.started, laps: this.laps, time: this.time, oil: this.oil };
    for (const car of this.cars) {
      const own = car.isPlayer && !this.playerAI && !this.pitAuto;
      const input = own ? (playerInput ?? NO_INPUT) : aiInput(car, view, dt);
      if (car.isPlayer) this.playerDrive = input;
      car.brakeHold = input.brake && Math.abs(car.speed) > 1 ? CONFIG.BRAKE_LIGHT_HOLD_S : Math.max(0, car.brakeHold - dt);
      car.braking = car.brakeHold > 0;
      stepCar(car, input, dt);
    }
    collideCars(this.cars, this.rules.collisions, (culprit) => this.penalize(culprit));
    this.updateOil(dt);
    this.cars.forEach((car, i) => {
      if (car.spinTime > 0 && !spinning[i]) {
        this.events.push({ type: 'spin', car });
        if (!inPitLane(car.x, car.y)) this.spillOil(car);
      }
      car.oilImmune = car.spinTime > 0 ? CONFIG.OIL_IMMUNE_S : Math.max(0, car.oilImmune - dt);
    });
    for (const car of this.cars) {
      const st = project(car.x, car.y);
      car.s = st.s;
      car.d = st.d;
      const before = car.sectorsPassed;
      const crossed = updateProgress(car);
      if (car.sectorsPassed !== before && !car.finished) this.logSector(car);
      if (crossed && !car.finished && (car.sectorsPassed >= this.laps * NUM_SECTORS || this.leaderFinished)) {
        this.finish(car);
      }
      updatePit(car, dt);
    }
    if (!this.playerAI) this.updatePitAuto(this.player);
  }

  private updatePitAuto(car: Car): void {
    const ai = car.ai;
    if (!this.pitAuto) {
      const crossed = car.prevX < PIT_LINE_IN_X && car.x >= PIT_LINE_IN_X;
      if (crossed && car.pitSide && inPitLane(car.x, car.y)) {
        this.pitAuto = true;
        ai.pitPhase = 'entering';
        ai.recoverTime = 0;
        ai.creepTime = 0;
        ai.stuckTime = 0;
      }
      return;
    }
    if (ai.pitPhase === 'parked') ai.pitPhase = 'fueling';
    const out = car.x >= PIT_LINE_OUT_X || !car.pitSide;
    if (out || ai.pitPhase === 'none') {
      this.pitAuto = false;
      ai.pitPhase = 'none';
      ai.recoverTime = 0;
      if (car.reverse && Math.abs(car.speed) <= CONFIG.REVERSE_TOGGLE_MAX_MPH) car.reverse = false;
    }
  }

  private penalize(culprit: Car | null): void {
    if (!culprit || !this.rules.penalties || culprit.finished) return;
    if (this.time - culprit.penaltyAt < CONFIG.PENALTY_INCIDENT_S) return;
    culprit.penalty += CONFIG.PENALTY_S;
    culprit.penaltyAt = this.time;
    this.events.push({ type: 'penalty', car: culprit, seconds: CONFIG.PENALTY_S });
  }

  private spillOil(car: Car): void {
    if (this.oil.length >= CONFIG.OIL_MAX) this.oil.shift();
    const st = project(car.x, car.y);
    this.oil.push({ x: car.x, y: car.y, s: st.s, d: st.d, age: 0, owner: car.id });
  }

  private updateOil(dt: number): void {
    for (const o of this.oil) o.age += dt;
    while (this.oil.length > 0 && this.oil[0]!.age >= CONFIG.OIL_LIFE_S) this.oil.shift();
    for (const car of this.cars) {
      if (car.spinTime > 0 || car.oilImmune > 0 || Math.abs(car.speed) < CONFIG.OIL_MIN_MPH) continue;
      for (const o of this.oil) {
        if (o.owner === car.id) continue;
        if (Math.hypot(car.x - o.x, car.y - o.y) < oilRadius(o)) {
          startSpin(car, CONFIG.SPIN_RATE * 0.8, this.rng() < 0.5 ? -1 : 1);
          break;
        }
      }
    }
  }

  resultTime(car: Car): number | null {
    const t = this.finishTimes.get(car.id);
    return t === undefined ? null : t + car.penalty;
  }

  classification(): Car[] {
    const laps = (c: Car) => Math.floor((c.finished ? c.finalSectors : c.sectorsPassed) / NUM_SECTORS);
    return [...this.cars].sort((a, b) => {
      const la = laps(a);
      const lb = laps(b);
      if (la !== lb) return lb - la;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return this.resultTime(a)! - this.resultTime(b)!;
      return progress(b) - progress(a);
    });
  }

  private finish(car: Car): void {
    this.finishOrder.push(car);
    car.finishPos = this.finishOrder.length;
    car.finalSectors = car.sectorsPassed;
    car.finalProgress = car.sectorsPassed * SECTOR_LEN + (MAX_CARS - car.finishPos) * 0.01;
    car.finished = true;
    this.finishTimes.set(car.id, this.time);
    this.leaderFinished = true;
  }

  private logSector(car: Car): void {
    let log = this.sectorTimes.get(car.id);
    if (!log) {
      log = new Map();
      this.sectorTimes.set(car.id, log);
    }
    log.set(car.sectorsPassed, this.time);
  }

  gap(car: Car, ahead: Car): number | null {
    const mine = this.sectorTimes.get(car.id);
    const theirs = this.sectorTimes.get(ahead.id);
    if (!mine || !theirs) return null;
    const sectors = car.finished ? car.finalSectors : car.sectorsPassed;
    for (let k = sectors; k > sectors - 4; k--) {
      const t1 = mine.get(k);
      const t0 = theirs.get(k);
      if (t1 !== undefined && t0 !== undefined) return Math.max(0, t1 - t0);
    }
    return null;
  }

  finishTime(car: Car): number | null {
    return this.finishTimes.get(car.id) ?? null;
  }

  standings(): Car[] {
    return [...this.cars].sort((a, b) => progress(b) - progress(a));
  }

  position(car: Car): number {
    return this.standings().indexOf(car) + 1;
  }

  shownPosition(car: Car): number {
    return car.finished ? this.classification().indexOf(car) + 1 : this.position(car);
  }

  timeBehindLeader(car: Car): number {
    const leader = this.standings()[0]!;
    if (car === leader) return 0;
    const k = car.finished ? car.finalSectors : car.sectorsPassed;
    const t1 = this.sectorTimes.get(car.id)?.get(k);
    const t0 = this.sectorTimes.get(leader.id)?.get(k);
    if (t1 !== undefined && t0 !== undefined) return Math.max(0, t1 - t0);
    return Math.max(0, progress(leader) - progress(car)) / (TYPICAL_MPH * CONFIG.PX_PER_MPH);
  }

  projectedPosition(car: Car): number {
    const key = (c: Car) => this.timeBehindLeader(c) + c.penalty;
    const sorted = [...this.cars].sort((a, b) => key(a) - key(b));
    return sorted.indexOf(car) + 1;
  }

  lapsBehind(car: Car): number {
    const leader = this.standings()[0]!;
    if (this.leaderFinished) return Math.max(0, lapsCompleted(leader) - lapsCompleted(car));
    return Math.max(0, Math.floor((progress(leader) - progress(car)) / TRACK_LEN));
  }

  lapsToGo(car: Car): number {
    if (car.finished) return 0;
    if (this.leaderFinished) return 1;
    return Math.max(0, this.laps - lapsCompleted(car));
  }

  allFinished(): boolean {
    return this.cars.every((c) => c.finished);
  }
}
