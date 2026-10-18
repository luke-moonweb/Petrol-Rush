import { CONFIG, DEFAULT_RULES, type RaceOptions, type RaceRules } from '../config';
import { createRng, lerp, type Rng } from '../sim/rng';
import { NUM_SECTORS, type Track } from '../track/common';
import { OVAL } from '../track/ovalTrack';
import { aiInput } from './ai';
import { type Car, initProgress, lapsCompleted, progress, updateProgress } from './car';
import { draftOf, logLapFuel, nominalLapFuel } from './fuel';
import type { DriverSkill } from './grandprix';
import { type OilSlick, oilRadius } from './oil';
import { LEVELS, PERSONAS, personaOf } from './persona';
import { collideCars, type DriveInput, NO_INPUT, startSpin, stepCar } from './physics';
import { updatePit } from './pit';

export const NUM_COLORS = 20;
const TYPICAL_MPH = 155;

/** A fixed starting grid: colorIdx per slot and the AI drivers' skills (Grand Prix). */
export interface Lineup {
  colors: number[];
  skills: Map<number, DriverSkill>;
}

export type RaceEvent = { type: 'spin'; car: Car } | { type: 'penalty'; car: Car; seconds: number };

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
  /** The gas was released since the refuel began: pressing it now ends the refuel (race/race.ts). */
  private refuelGasArmed = false;
  /** The AI drives the player's car (finishing a Grand Prix race in the background). */
  autoPlayer = false;
  /** The player retired: classified last and scores nothing. */
  playerRetired = false;
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
    readonly track: Track = OVAL,
    lineup?: Lineup,
  ) {
    this.rng = createRng(seed);
    this.laps = opts.laps;
    if (lineup) {
      lineup.colors.forEach((colorIdx, slot) => {
        const isPlayer = colorIdx === opts.playerColor;
        this.cars.push(this.makeCar(slot, colorIdx, isPlayer, lineup.skills.get(colorIdx) ?? this.drawSkill()));
      });
      this.player = this.cars.find((c) => c.isPlayer) ?? this.cars[0]!;
      return;
    }
    const n = Math.max(1, Math.min(NUM_COLORS, opts.cars));

    const playerSlot = this.playerSlot(n);
    const otherColors: number[] = [];
    for (let c = 0; c < NUM_COLORS; c++) if (c !== opts.playerColor) otherColors.push(c);

    let aiIdx = 0;
    for (let slot = 0; slot < n; slot++) {
      const isPlayer = slot === playerSlot;
      const colorIdx = isPlayer ? opts.playerColor : otherColors[aiIdx++]!;
      this.cars.push(this.makeCar(slot, colorIdx, isPlayer, this.drawSkill()));
    }
    this.player = this.cars[playerSlot]!;
  }

  private drawSkill(): DriverSkill {
    return {
      topMph: lerp(CONFIG.AI_TOP_MPH[0], CONFIG.AI_TOP_MPH[1], this.rng()),
      turnMph: lerp(CONFIG.AI_TURN_MPH[0], CONFIG.AI_TURN_MPH[1], this.rng()),
      pitFuelLaps: lerp(CONFIG.AI_PIT_FUEL_LAPS[0], CONFIG.AI_PIT_FUEL_LAPS[1], this.rng()),
      reaction: lerp(CONFIG.AI_REACTION_S[0], CONFIG.AI_REACTION_S[1], this.rng()),
      fuelSave: lerp(CONFIG.AI_FUEL_SAVE[0], CONFIG.AI_FUEL_SAVE[1], this.rng()),
      temper: this.rng(),
    };
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

  private makeCar(slot: number, colorIdx: number, isPlayer: boolean, skill: DriverSkill): Car {
    const { s, d } = this.track.gridSlot(slot);
    // (the difficulty and the personalities are the opponents': the player's car, when the AI drives it, races plain)
    const difficulty = isPlayer ? 'normal' : (this.opts.difficulty ?? 'normal');
    const level = LEVELS[difficulty];
    const p = this.track.pointAt(s, d);
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
      draft: 0,
      spinTime: 0,
      spinDir: 1,
      spinRate: 0,
      crashes: 0,
      overTime: 0,
      slideTime: 0,
      gripUse: 0,
      gripOver: 0,
      turnDir: 0,
      rearLoose: false,
      rearStress: 0,
      weightFwd: 0,
      slipPeak: 0,
      wallAgo: 99,
      wallYaw: 0,
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
        topMph: skill.topMph,
        turnMph: skill.turnMph,
        lane: d,
        laneCooldown: 0,
        pitPhase: 'none',
        box: slot,
        pitFuelLaps: skill.pitFuelLaps,
        fuelSave: skill.fuelSave,
        economy: false,
        stuckTime: 0,
        reaction: skill.reaction * level.reaction,
        hazardTime: 0,
        recoverTime: 0,
        creepTime: 0,
        oilTime: 0,
        mergeWait: 0,
        merging: false,
        pitHeld: false,
        skipped: false,
        fuelPerLap: nominalLapFuel(this.track) * (1 + CONFIG.FUEL.EST_MARGIN),
        lapFuel: -1,
        refuelledThisLap: false,
        onLine: false,
        temper: skill.temper,
        persona: isPlayer ? PERSONAS.neutral : personaOf(skill.temper, difficulty),
        level,
        blockLane: null,
        blockIn: false,
        slide: 0,
        slideTime: 0,
        slideDir: 1,
        slideRun: -1,
        freeShift: 0,
        passId: -1,
        passSide: 0,
      },
    };
    const st = this.track.project(car.x, car.y);
    car.s = st.s;
    car.d = st.d;
    initProgress(car, this.track);
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
    const track = this.track;
    const playerDriving = !this.playerAI && !this.pitAuto && !this.autoPlayer;
    const view = {
      track,
      cars: this.cars,
      started: this.started,
      laps: this.laps,
      time: this.time,
      oil: this.oil,
      pitAuto: this.pitAuto,
      playerDriving,
    };
    for (const car of this.cars) car.draft = draftOf(car, this.cars, track);
    for (const car of this.cars) {
      const own = car.isPlayer && playerDriving;
      const input = own ? (playerInput ?? NO_INPUT) : aiInput(car, view, dt);
      if (car.isPlayer) this.playerDrive = input;
      car.brakeHold = input.brake && Math.abs(car.speed) > 1 ? CONFIG.BRAKE_LIGHT_HOLD_S : Math.max(0, car.brakeHold - dt);
      car.braking = car.brakeHold > 0;
      stepCar(car, input, dt, track);
    }
    collideCars(this.cars, track, this.rules.collisions, (culprit) => this.penalize(culprit));
    this.updateOil(dt);
    this.cars.forEach((car, i) => {
      if (car.spinTime > 0 && !spinning[i]) {
        this.events.push({ type: 'spin', car });
        if (!track.pit.inLane(car.x, car.y)) this.spillOil(car);
      }
      car.oilImmune = car.spinTime > 0 ? CONFIG.OIL_IMMUNE_S : Math.max(0, car.oilImmune - dt);
    });
    for (const car of this.cars) {
      const st = track.project(car.x, car.y);
      car.s = st.s;
      car.d = st.d;
      const before = car.sectorsPassed;
      const crossed = updateProgress(car, track);
      if (crossed) logLapFuel(car);
      if (car.sectorsPassed !== before && !car.finished) this.logSector(car);
      if (crossed && !car.finished && (car.sectorsPassed >= this.laps * NUM_SECTORS || this.leaderFinished)) {
        this.finish(car);
      }
      updatePit(car, dt, track);
    }
    if (!this.playerAI) this.updatePitAuto(this.player, playerInput);
  }

  private updatePitAuto(car: Car, input: DriveInput | null): void {
    const ai = car.ai;
    if (!this.pitAuto) {
      if (this.track.pit.autoIn(car)) {
        this.pitAuto = true;
        ai.pitPhase = 'entering';
        ai.recoverTime = 0;
        ai.creepTime = 0;
        ai.stuckTime = 0;
      }
      return;
    }
    if (ai.pitPhase === 'parked') ai.pitPhase = 'fueling';
    this.cutRefuel(car, input);
    const out = this.track.pit.autoOut(car);
    if (out || ai.pitPhase === 'none') {
      this.pitAuto = false;
      ai.pitPhase = 'none';
      ai.recoverTime = 0;
      if (car.reverse && Math.abs(car.speed) <= CONFIG.REVERSE_TOGGLE_MAX_MPH) car.reverse = false;
    }
  }

  /**
   * Pressing the gas while refuelling ends the refuel: the autopilot drives out with what is in the
   * tank. A gas key still held from the way in does not count until it is released.
   */
  private cutRefuel(car: Car, input: DriveInput | null): void {
    if (car.ai.pitPhase !== 'fueling') {
      this.refuelGasArmed = false;
      return;
    }
    const gas = input?.gas ?? false;
    if (!gas) this.refuelGasArmed = true;
    else if (this.refuelGasArmed && car.refueling) car.ai.pitPhase = 'exiting';
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
    const st = this.track.project(car.x, car.y);
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
      return progress(b, this.track) - progress(a, this.track);
    });
  }

  private finish(car: Car): void {
    this.finishOrder.push(car);
    car.finishPos = this.finishOrder.length;
    car.finalSectors = car.sectorsPassed;
    car.finalProgress = car.sectorsPassed * this.track.sectorLen + (MAX_CARS - car.finishPos) * 0.01;
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
    return [...this.cars].sort((a, b) => progress(b, this.track) - progress(a, this.track));
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
    return Math.max(0, progress(leader, this.track) - progress(car, this.track)) / (TYPICAL_MPH * CONFIG.PX_PER_MPH);
  }

  projectedPosition(car: Car): number {
    const key = (c: Car) => this.timeBehindLeader(c) + c.penalty;
    // equal times (gaps clamp at 0) keep the order on the track
    const order = this.standings();
    const sorted = [...order].sort((a, b) => key(a) - key(b));
    return sorted.indexOf(car) + 1;
  }

  lapsBehind(car: Car): number {
    const leader = this.standings()[0]!;
    if (this.leaderFinished) return Math.max(0, lapsCompleted(leader) - lapsCompleted(car));
    return Math.max(0, Math.floor((progress(leader, this.track) - progress(car, this.track)) / this.track.len));
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
