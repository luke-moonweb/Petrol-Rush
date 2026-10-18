import { CONFIG } from '../../config';
import { type Cam, clampCamera } from '../../gfx/world';
import { layout } from '../../layout';
import type { Car } from '../../race/car';
import type { Track } from '../../track/common';

/** The top-down camera: it leads along the track ahead of the car and eases into the lead. */
export class RaceCamera {
  private offX = NaN;
  private offY = 0;

  reset(): void {
    this.offX = NaN;
  }

  update(track: Track, car: Car, dt: number): void {
    const [tx, ty] = lead(track, car);
    if (Number.isNaN(this.offX)) {
      this.offX = tx;
      this.offY = ty;
      return;
    }
    const k = Math.min(1, dt / CONFIG.CAMERA_LEAD_S);
    this.offX += (tx - this.offX) * k;
    this.offY += (ty - this.offY) * k;
  }

  /** The camera for a car drawn at (x, y). */
  at(track: Track, car: Car, x: number, y: number): Cam {
    const [ox, oy] = Number.isNaN(this.offX) ? lead(track, car) : [this.offX, this.offY];
    const v = layout.view;
    return clampCamera(Math.round(x + ox), Math.round(y + oy), v.w, v.h, track.worldW, track.worldH);
  }
}

function lead(track: Track, car: Car): [number, number] {
  const h = track.headingAt(car.x, car.y);
  const d = track.worldH > CONFIG.PLAY_H ? CONFIG.CAMERA_LEAD_2D : CONFIG.CAMERA_LEAD;
  return [d * Math.cos(h), d * Math.sin(h)];
}
