import { CONFIG } from './config';

// The simulation speaks mph and px (Car.speed, CONFIG, the AI, the fuel model, the Grand Prix save).
// The screen speaks km/h and km, and converts here, at the edge, so the golden masters never see a change.

/** Exact, by the definition of the mile. */
export const KPH_PER_MPH = 1.609344;
/** Exact. */
export const MPS_PER_MPH = 0.44704;
/**
 * Metres per world pixel, from the definition of speed (`dist = speed * PX_PER_MPH * dt`): derived, never a
 * literal, so distances and average speeds agree with the speedometer. (Pixels are not metres: a car sprite
 * comes out about twice a real car's size at this scale.)
 */
export const M_PER_PX = MPS_PER_MPH / CONFIG.PX_PER_MPH;

export const toKph = (mph: number): number => mph * KPH_PER_MPH;

/** A speed for the screen: whole km/h, unsigned (in reverse the readout shows the pace, not a sign). */
export const fmtKph = (mph: number): string => String(Math.round(Math.abs(toKph(mph))));

export const pxToKm = (px: number): number => (px * M_PER_PX) / 1000;
