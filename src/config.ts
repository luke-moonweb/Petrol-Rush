export type ThrottleMode = 'cruise' | 'hold';

export const CONFIG = {
  SCREEN_W: 640,
  SCREEN_H: 480,
  HUD_TOP_H: 24,
  HUD_LEFT_W: 124,
  PLAY_H: 456,
  CAMERA_LEAD: 70,
  CAMERA_LEAD_2D: 110,
  CAMERA_LEAD_S: 0.4,

  STEP_HZ: 60,
  MAX_STEPS_PER_FRAME: 5,

  PX_PER_MPH: 1.7,

  MAX_MPH: 180,
  MAX_REVERSE_MPH: 25,
  ACCEL_MPH_S_LOW: 30,
  ACCEL_MPH_S_HIGH: 9,
  BRAKE_MPH_S: 55,
  BRAKE_MPH_S_HIGH: 75,
  COAST_MPH_S: 8,
  THROTTLE_MODE: 'hold' as ThrottleMode,
  REVERSE_TOGGLE_MAX_MPH: 15,

  MAX_TURN_RATE: 2.9,
  STEER_MIN: 0.15,
  STEER_RAMP_S: 0.3,
  STEER_MIN_TURN: 0.3,
  CORNER_ASSIST: 0.3,
  CORNER_ASSIST_MIN_MPH: 40,
  CORNER_ASSIST_IN_S: 0.15,
  STEER_RAMP_TURN_S: 0.15,
  STEER_RELEASE_S: 0.2,
  STRAIGHT_ASSIST_RATE: 0.6,
  MIN_TURN_RADIUS: 34,

  // Grip model. Lateral limit on a line of radius r: v^2 / r = gripAt(v) (race/physics.ts): GRIP up to
  // KNEE_MPH, then fading linearly to TOP at MAX_MPH, so only gentle bends are flat out (corner lab: npm run lab).
  GRIP: {
    /** px/s^2 of tyre force up to KNEE_MPH, shared by cornering and braking (friction ellipse). */
    GRIP: 500,
    /** Above this speed the grip fades... */
    KNEE_MPH: 140,
    /** ...linearly to this (px/s^2) at MAX_MPH: a line of radius MAX_MPH^2 / TOP and wider is flat out. */
    TOP: 120,
    /** A loose rear swings at SLIDE_SOFT x its full rate up to SLIDE_SOFT_MPH, rising to the full rate at KNEE_MPH. */
    SLIDE_SOFT: 0.5,
    SLIDE_SOFT_MPH: 100,
    /** Share of the grip that full braking at top speed takes away. */
    FC_K: 0.6,
    /** 1/s: how fast the tyres pull the direction of travel back to the nose. */
    ALIGN: 6,
    /** Full lock never asks for more than STEER_CAP x the grip. */
    STEER_CAP: 1.5,
    /** Player keys / touch: a held key asks for KEY_CAP x the grip left (like the AI's cap). */
    KEY_CAP: 1.05,
    /**
     * Holding the key against that cap into a corner the car is too fast for (its line needs more than
     * 1 + OVERDRIVE_OVER x the grip) for OVERDRIVE_S opens the steering to full lock over OVERDRIVE_RAMP_S.
     */
    OVERDRIVE_OVER: 0.1,
    /** At n x OVERDRIVE_OVER the overdrive comes n times sooner, up to this factor. */
    OVERDRIVE_RATE_MAX: 3,
    /** Full lock only from OVERDRIVE_OVER + OVERDRIVE_FULL over; less excess opens it partly. */
    OVERDRIVE_FULL: 0.3,
    OVERDRIVE_S: 0.5,
    /** Push time lost per second while the key is released. */
    OVERDRIVE_DECAY: 2,
    OVERDRIVE_RAMP_S: 0.5,
    MIN_V: 20,
    /** Rear stress builds while the demand is above U_REAR; the rear lets go at 1. */
    U_REAR: 1.3,
    STRESS_S: 0.55,
    STRESS_DECAY_S: 0.5,
    STRESS_MAX: 1.2,
    /** Rear stress left after a slide is caught. */
    CAUGHT_STRESS: 0.5,
    /** Share of a countersteer that bends the travel direction (the rest only turns the nose back). */
    COUNTER_COURSE: 0.3,
    /** Weight transfer: lifting puts LIFT_WEIGHT on the front, full braking 1; smoothed over WEIGHT_S. */
    LIFT_WEIGHT: 0.5,
    WEIGHT_S: 0.25,
    /** Extra front grip at full weight transfer (the nose can out-turn the travel direction). */
    FRONT_GAIN: 0.12,
    /** rad/s of tuck-in at full weight transfer and full lateral load. */
    LIFT_YAW: 0.3,
    /** The tuck-in (LIFT_YAW, FRONT_GAIN) stops adding slip at TUCK_SLIP rad, fading in over TUCK_FADE before it. */
    TUCK_SLIP: 0.07,
    TUCK_FADE: 0.02,
    /** ...unless the demand is above TUCK_FREE_U x the grip (far too fast and insisting). */
    TUCK_FREE_U: 1.4,
    /** ...or once the rear stress passes this (demand held over U_REAR). */
    TUCK_FREE_STRESS: 0.6,
    /** Extra rear stress rate at full weight transfer. */
    WEIGHT_STRESS: 1,
    OS_KICK: 1.5,
    LOOSE_SLIP: 0.22,
    LOOSE_GAIN: 3,
    SPIN_SLIP: 0.75,
    SCRUB: 0.25,
    SLIP_DRAG: 0.6,
    SLIDE_OVER_MIN: 0.05,
    SLIDE_SLIP_MIN: 0.08,
    /** Grip use above which a rear hit spins at REAR_SPIN_TURN_MPH. */
    LOADED_USE: 0.7,
    /** Straight assist: full strength up to FULL_DEG of heading error, fading out by OFF_DEG. */
    STRAIGHT_FULL_DEG: 5,
    STRAIGHT_OFF_DEG: 20,
    /** Walls: glancing below GLANCE_DEG (straightened, friction only), spin above SPIN_DEG and SPIN_MPH. */
    WALL_GLANCE_DEG: 15,
    WALL_SPIN_DEG: 30,
    WALL_SPIN_MPH: 28,
    WALL_FRICTION: 0.4,
    /** A fresh hit (no contact for WALL_FRESH_S) also loses up to 2 x this share of the speed. */
    WALL_HIT_SCRUB: 0.06,
    WALL_FRESH_S: 0.4,
    /** Extra share of the speed a fresh hit costs when the car arrives understeering (over its grip). */
    WALL_PLOUGH_SCRUB: 0.15,
  },

  SPIN_MPH: 150,
  SLIDE_SPIN_OVER: 8,
  SPIN_MAX_S: 3,
  SPIN_END_MPH: 4,
  SPIN_RATE: 9,
  SPIN_DECEL_MPH_S: 85,

  CRASH_IMPACT_MPH: 24,
  CRASH_SIDE_MPH: 40,
  CRASH_MIN_SPEED_MPH: 35,
  CRASH_RESTITUTION: 0.45,
  REAR_SPIN_MPH: 22,
  REAR_SPIN_TURN_MPH: 14,
  SIDE_REAR_SPIN_MPH: 20,
  PENALTY_S: 2,
  PENALTY_INCIDENT_S: 3,
  BLAME_AHEAD_PX: 18,
  OIL_RADIUS: 13,
  OIL_LIFE_S: 12,
  OIL_GROW_S: 0.6,
  OIL_FADE_S: 1.5,
  OIL_MIN_MPH: 15,
  OIL_IMMUNE_S: 1.5,
  OIL_MAX: 20,

  BRAKE_LIGHT_HOLD_S: 0.25,

  WALL_BOUNCE: 0.25,
  WALL_SCRUB: 0.04,

  /** Laps of the oval a full tank lasts at the normal pace; the same distance on every track (race/fuel.ts). */
  FUEL_RANGE_LAPS: 12,
  /** The fuel model (race/fuel.ts). */
  FUEL: {
    /** FUEL_RANGE_LAPS times the oval's length (tests/fuel.test.ts checks it). */
    RANGE_PX: 54_860,
    /** Work (mph^2) one lap of the oval takes at the normal pace. */
    LAP_WORK: 76700,
    /** On the gas: work per mph*s driven (at least COAST_MPH_S, so coasting is never free). */
    DRAG: 25,
    /** Right behind another car: the share of the drag saved. */
    DRAFT_CUT: 0.12,
    DRAFT_PX: 160,
    DRAFT_HALF_W: 12,
    DRAFT_MIN_MPH: 80,
    /** Weight of the last lap in a car's running fuel-per-lap estimate. */
    LAP_LOG_GAIN: 0.5,
    /** Safety share on top of the estimate when an AI driver fills up. */
    EST_MARGIN: 0.05,
  },
  LOW_FUEL: 0.12,
  REFUEL_TIME_S: 5,
  OUT_OF_FUEL_CRAWL_MPH: 0,
  PIT_STOP_MPH: 3,

  AI_TOP_MPH: [171, 180] as [number, number],
  AI_TURN_MPH: [141, 149] as [number, number],
  AI_PIT_FUEL_LAPS: [1.3, 6] as [number, number],
  /** 0 = never lifts to save fuel, 1 = saves whenever lifting can make the finish. */
  AI_FUEL_SAVE: [0, 1] as [number, number],
  /** Laps of fuel on top of the finish an AI driver fills up to. */
  AI_FILL_MARGIN_LAPS: 0.6,
  /** Saving fuel: what lifting is counted on to gain (at fuelSave 1), the top speed given up, the margin. */
  AI_ECO: { GAIN: 0.06, MPH: 15, MARGIN_LAPS: 0.5 },
  AI_PIT_MPH: 70,
  AI_FINISHED_MPH: 90,
  AI_REACTION_S: [0.25, 0.7] as [number, number],
  AI_HAZARD_RANGE: 260,

  CAR_LEN: 36,
  CAR_WID: 16,
  GRID_FRONT_S: -24,
  GRID_SPACING: 32,
  GRID_LANES: [-28.5, 9.5] as [number, number],
};

export type Qualifying = 'last' | 'middle' | 'pole' | 'random';

export type CollisionMode = 'realistic' | 'classic';

export interface RaceRules {
  penalties: boolean;
  collisions: CollisionMode;
}

export const DEFAULT_RULES: RaceRules = { penalties: true, collisions: 'realistic' };

export interface RaceOptions {
  track: string;
  cars: number;
  laps: number;
  playerColor: number;
  qualifying: Qualifying;
}

export const DEFAULT_OPTIONS: RaceOptions = {
  track: 'oval',
  cars: 20,
  laps: 18,
  playerColor: 0,
  qualifying: 'last',
};

export const LAP_CHOICES = [1, 2, 3, 5, 10, 15, 18, 20, 25, 30, 40, 50, 75, 100];
export const QUALIFYING_CHOICES: Qualifying[] = ['last', 'middle', 'pole', 'random'];
