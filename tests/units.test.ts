import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { FUEL_RANGE_PX } from '../src/race/fuel';
import { OVAL } from '../src/track/ovalTrack';
import { fmtKph, KPH_PER_MPH, M_PER_PX, MPS_PER_MPH, pxToKm, toKph } from '../src/units';

// The simulation stays in mph and px; everything the player reads is converted here and nowhere else.
describe('units for the screen', () => {
  it('converts mph to km/h exactly', () => {
    expect(toKph(100)).toBe(160.9344);
    expect(toKph(0)).toBe(0);
    expect(toKph(-50)).toBe(-50 * KPH_PER_MPH);
  });

  it('formats a speed as whole km/h, without a sign', () => {
    expect(fmtKph(100)).toBe('161');
    expect(fmtKph(150)).toBe('241');
    expect(fmtKph(180)).toBe('290');
    expect(fmtKph(CONFIG.MAX_MPH)).toBe('290');
    expect(fmtKph(-10)).toBe('16');
    expect(fmtKph(0)).toBe('0');
  });

  it('derives metres per pixel from the definition of speed, not from a literal', () => {
    expect(M_PER_PX).toBe(MPS_PER_MPH / CONFIG.PX_PER_MPH);
    expect(M_PER_PX).toBeCloseTo(0.262965, 6);
  });

  it('measures the oval and a tank of fuel in km', () => {
    expect(pxToKm(OVAL.len)).toBeCloseTo(1.202, 3);
    expect(pxToKm(FUEL_RANGE_PX)).toBeCloseTo(14.43, 2);
    expect(pxToKm(0)).toBe(0);
  });
});
