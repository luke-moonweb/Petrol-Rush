export type ThrottleMode = 'cruise' | 'hold';

export const CONFIG = {
  SCREEN_W: 640,
  SCREEN_H: 480,
  HUD_TOP_H: 24,
  HUD_LEFT_W: 124,
  PLAY_H: 456,
  CAMERA_LEAD: 70,
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
  THROTTLE_MODE: 'cruise' as ThrottleMode,
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
  STRAIGHT_ASSIST_DEG: 7,
  STRAIGHT_ASSIST_RATE: 0.6,
  MIN_TURN_RADIUS: 34,

  SPIN_MPH: 150,
  SPIN_GRACE_S: 0.15,
  SLIDE_SPIN_OVER: 8,
  SLIDE_GRIP: 0.65,
  SLIDE_DECEL_MPH_S: 30,
  SLIDE_MAX_S: 1,
  SPIN_MAX_S: 3,
  SPIN_END_MPH: 4,
  SPIN_RATE: 9,
  SPIN_DECEL_MPH_S: 85,

  CRASH_IMPACT_MPH: 24,
  CRASH_SIDE_MPH: 40,
  CRASH_MIN_SPEED_MPH: 35,
  CRASH_RESTITUTION: 0.45,
  WALL_CRASH_MPH: 45,
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
  WALL_GLANCE: 0.42,

  FUEL_RANGE_LAPS: 12,
  REFUEL_TIME_S: 5,
  OUT_OF_FUEL_CRAWL_MPH: 0,
  PIT_STOP_MPH: 3,

  AI_TOP_MPH: [171, 180] as [number, number],
  AI_TURN_MPH: [141, 149] as [number, number],
  AI_PIT_FUEL_LAPS: [1.3, 6] as [number, number],
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
  cars: number;
  laps: number;
  playerColor: number;
  qualifying: Qualifying;
}

export const DEFAULT_OPTIONS: RaceOptions = {
  cars: 20,
  laps: 18,
  playerColor: 0,
  qualifying: 'last',
};

export const LAP_CHOICES = [1, 2, 3, 5, 10, 15, 18, 20, 25, 30, 40, 50, 75, 100];
export const QUALIFYING_CHOICES: Qualifying[] = ['last', 'middle', 'pole', 'random'];
