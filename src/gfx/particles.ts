import { CONFIG } from '../config';
import type { Car } from '../race/car';

enum Kind {
  Spark,
  Smoke,
}

interface Particle {
  alive: boolean;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
}

const POOL_SIZE = 700;
const SPARK_COLORS = ['#ffffff', '#fff6a0', '#ffd040', '#ff9a20', '#e04010'];

export class Particles {
  private readonly pool: Particle[] = [];
  private next = 0;
  private readonly decel = new Map<number, { speed: number; avg: number }>();

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({ alive: false, kind: Kind.Spark, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1 });
    }
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
    this.decel.clear();
  }

  private spawn(kind: Kind, x: number, y: number, vx: number, vy: number, life: number, size: number): void {
    const p = this.pool[this.next]!;
    this.next = (this.next + 1) % POOL_SIZE;
    p.alive = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.age = 0;
    p.life = life;
    p.size = size;
  }

  emit(cars: Car[], dt: number): void {
    const pxm = CONFIG.PX_PER_MPH;
    for (const car of cars) {
      const cvx = Math.cos(car.moveAngle) * car.speed * pxm;
      const cvy = Math.sin(car.moveAngle) * car.speed * pxm;

      if (car.contactStrength > 7) {
        const n = Math.min(16, Math.round(car.contactStrength / 5) + (Math.random() < 0.5 ? 1 : 0));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 40 + Math.random() * (60 + car.contactStrength * 2.5);
          this.spawn(
            Kind.Spark,
            car.contactX,
            car.contactY,
            cvx * 0.55 + Math.cos(a) * sp,
            cvy * 0.55 + Math.sin(a) * sp,
            0.18 + Math.random() * 0.35,
            Math.random() < 0.3 ? 2 : 1,
          );
        }
        if (car.contactStrength > CONFIG.CRASH_IMPACT_MPH) this.smokePuffs(car, cvx, cvy, 3, 1.4);
      }

      const st = this.decel.get(car.id) ?? { speed: car.speed, avg: 0 };
      const d = (st.speed - car.speed) / dt;
      st.avg += (d - st.avg) * Math.min(1, dt * 8);
      st.speed = car.speed;
      this.decel.set(car.id, st);
      const spinning = car.spinTime > 0;
      const sliding = car.slideTime > 0;
      if ((spinning && Math.abs(car.speed) > 8) || sliding || (st.avg > 42 && Math.abs(car.speed) > 20)) {
        const rate = spinning ? 1 : sliding ? 0.8 : 0.6;
        if (Math.random() < rate) this.smokePuffs(car, cvx, cvy, spinning ? 2 : 1, 1);
      }
    }
  }

  private smokePuffs(car: Car, cvx: number, cvy: number, count: number, sizeMul: number): void {
    const ch = Math.cos(car.heading);
    const sh = Math.sin(car.heading);
    for (let i = 0; i < count; i++) {
      const along = car.spinTime > 0 && Math.random() < 0.5 ? 12 : -12;
      const side = (Math.random() < 0.5 ? -1 : 1) * 6;
      const x = car.x + ch * along - sh * side;
      const y = car.y + sh * along + ch * side;
      this.spawn(
        Kind.Smoke,
        x + (Math.random() - 0.5) * 3,
        y + (Math.random() - 0.5) * 3,
        cvx * 0.15 + (Math.random() - 0.5) * 20,
        cvy * 0.15 + (Math.random() - 0.5) * 20 - 6,
        0.7 + Math.random() * 0.6,
        (2 + Math.random() * 1.5) * sizeMul,
      );
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const drag = p.kind === Kind.Spark ? 3.5 : 2.2;
      const k = Math.max(0, 1 - drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  renderSmoke(g: CanvasRenderingContext2D, camX: number): void {
    for (const p of this.pool) {
      if (!p.alive || p.kind !== Kind.Smoke) continue;
      const t = p.age / p.life;
      const r = p.size * (1 + t * 2.2);
      g.globalAlpha = 0.55 * (1 - t);
      g.fillStyle = t < 0.3 ? '#e8e8e8' : '#bdbdbd';
      g.beginPath();
      g.arc(Math.round(p.x - camX), Math.round(p.y), r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  renderSparks(g: CanvasRenderingContext2D, camX: number): void {
    for (const p of this.pool) {
      if (!p.alive || p.kind !== Kind.Spark) continue;
      const t = p.age / p.life;
      g.fillStyle = SPARK_COLORS[Math.min(SPARK_COLORS.length - 1, Math.floor(t * SPARK_COLORS.length))]!;
      const x = Math.round(p.x - camX);
      const y = Math.round(p.y);
      g.fillRect(x, y, p.size, p.size);
      const tx = Math.round(x - p.vx * 0.012);
      const ty = Math.round(y - p.vy * 0.012);
      if (tx !== x || ty !== y) g.fillRect(tx, ty, 1, 1);
    }
  }

  aliveCount(): number {
    return this.pool.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
  }
}
