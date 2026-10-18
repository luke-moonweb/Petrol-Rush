// biome-ignore-all lint/correctness/noPrecisionLoss: fdlibm constants are kept digit for digit
// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: fdlibm constants are kept digit for digit
// biome-ignore-all lint/suspicious/noSelfCompare: x !== x is fdlibm's NaN test
// Pure-JS port of fdlibm sin/cos/atan/atan2 (as in V8 base/ieee754.cc). JS has no FMA, so this
// computes what a non-FMA (x64) build of V8 does. Node for macOS arm64 builds fdlibm with FMA and is
// 1 ulp off on some inputs; the error grows over a race, so the golden masters use this port.
// Inputs it does not cover (|x| > 2^19 * pi/2, infinities) fall back to the native functions.
const nativeSin = Math.sin;
const nativeCos = Math.cos;
const nativeAtan2 = Math.atan2;
const LARGE = 0x413921fb;
const f = new Float64Array(1);
const u = new Int32Array(f.buffer);
const HI = (x: number) => {
  f[0] = x;
  return u[1]!;
};
const LO = (x: number) => {
  f[0] = x;
  return u[0]!;
};
const fromWords = (hi: number, lo: number) => {
  u[1] = hi;
  u[0] = lo;
  return f[0]!;
};

const S1 = -1.66666666666666324348e-1,
  S2 = 8.33333333332248946124e-3,
  S3 = -1.98412698298579493134e-4,
  S4 = 2.75573137070700676789e-6,
  S5 = -2.50507602534068634195e-8,
  S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2,
  C2 = -1.38888888888741095749e-3,
  C3 = 2.48015872894767294178e-5,
  C4 = -2.75573143513906633035e-7,
  C5 = 2.0875723212981748279e-9,
  C6 = -1.13596475577881948265e-11;

function ksin(x: number, y: number, iy: number): number {
  const ix = HI(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x,
    v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}
function kcos(x: number, y: number): number {
  const ix = HI(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx,
    a = 1 - qx;
  return a - (hz - (z * r - x * y));
}
const NPIO2 = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c,
  0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c,
  0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];
const invpio2 = 6.36619772367581382433e-1,
  pio2_1 = 1.57079632673412561417,
  pio2_1t = 6.07710050650619224932e-11,
  pio2_2 = 6.0771005063039659766e-11,
  pio2_2t = 2.02226624879595063154e-21,
  pio2_3 = 2.0222662487111664558e-21,
  pio2_3t = 8.47842766036889956997e-32;
const y = [0, 0];
function remPio2(x: number): number {
  const hx = HI(x),
    ix = hx & 0x7fffffff;
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      let z = x - pio2_1;
      if (ix !== 0x3ff921fb) {
        y[0] = z - pio2_1t;
        y[1] = z - y[0]! - pio2_1t;
      } else {
        z -= pio2_2;
        y[0] = z - pio2_2t;
        y[1] = z - y[0]! - pio2_2t;
      }
      return 1;
    }
    let z = x + pio2_1;
    if (ix !== 0x3ff921fb) {
      y[0] = z + pio2_1t;
      y[1] = z - y[0]! + pio2_1t;
    } else {
      z += pio2_2;
      y[0] = z + pio2_2t;
      y[1] = z - y[0]! + pio2_2t;
    }
    return -1;
  }
  let t = Math.abs(x);
  const n = (t * invpio2 + 0.5) | 0;
  const fn = n;
  let r = t - fn * pio2_1;
  let w = fn * pio2_1t;
  if (n < 32 && ix !== NPIO2[n - 1]) y[0] = r - w;
  else {
    const j = ix >> 20;
    y[0] = r - w;
    let i = j - ((HI(y[0]!) >> 20) & 0x7ff);
    if (i > 16) {
      t = r;
      w = fn * pio2_2;
      r = t - w;
      w = fn * pio2_2t - (t - r - w);
      y[0] = r - w;
      i = j - ((HI(y[0]!) >> 20) & 0x7ff);
      if (i > 49) {
        t = r;
        w = fn * pio2_3;
        r = t - w;
        w = fn * pio2_3t - (t - r - w);
        y[0] = r - w;
      }
    }
  }
  y[1] = r - y[0]! - w;
  if (hx < 0) {
    y[0] = -y[0]!;
    y[1] = -y[1]!;
    return -n;
  }
  return n;
}
export function sin(x: number): number {
  const ix = HI(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return ksin(x, 0, 0);
  if (ix > LARGE) return nativeSin(x);
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return ksin(y[0]!, y[1]!, 1);
    case 1:
      return kcos(y[0]!, y[1]!);
    case 2:
      return -ksin(y[0]!, y[1]!, 1);
    default:
      return -kcos(y[0]!, y[1]!);
  }
}
export function cos(x: number): number {
  const ix = HI(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kcos(x, 0);
  if (ix > LARGE) return nativeCos(x);
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kcos(y[0]!, y[1]!);
    case 1:
      return -ksin(y[0]!, y[1]!, 1);
    case 2:
      return -kcos(y[0]!, y[1]!);
    default:
      return ksin(y[0]!, y[1]!, 1);
  }
}
const atanhi = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558];
const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const aT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1, 9.09088713343650656196e-2,
  -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.6531572744216915527e-2,
  1.62858201153657823623e-2,
];
export function atan(x: number): number {
  const hx = HI(x),
    ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) {
    if (x !== x) return x + x;
    return hx > 0 ? atanhi[3]! + atanlo[3]! : -atanhi[3]! - atanlo[3]!;
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  let z = x * x;
  const w = z * z;
  const s1 = z * (aT[0]! + w * (aT[2]! + w * (aT[4]! + w * (aT[6]! + w * (aT[8]! + w * aT[10]!)))));
  const s2 = w * (aT[1]! + w * (aT[3]! + w * (aT[5]! + w * (aT[7]! + w * aT[9]!))));
  if (id < 0) return x - x * (s1 + s2);
  z = atanhi[id]! - (x * (s1 + s2) - atanlo[id]! - x);
  return hx < 0 ? -z : z;
}
const tiny = 1e-300,
  pi_o_2 = 1.570796326794896558,
  pi = 3.141592653589793116,
  pi_lo = 1.2246467991473531772e-16;
export function atan2(yy: number, x: number): number {
  if (x !== x || yy !== yy) return x + yy;
  const hx = HI(x),
    ix = hx & 0x7fffffff,
    lx = LO(x),
    hy = HI(yy),
    iy = hy & 0x7fffffff,
    ly = LO(yy);
  if (((hx - 0x3ff00000) | lx) === 0) return atan(yy);
  let m = ((hy >>> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1:
        return yy;
      case 2:
        return pi + tiny;
      default:
        return -pi - tiny;
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
  if (ix === 0x7ff00000 || iy === 0x7ff00000) return nativeAtan2(yy, x);
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    z = pi_o_2 + 0.5 * pi_lo;
    m &= 1;
  } else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(yy / x));
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return pi - (z - pi_lo);
    default:
      return z - pi_lo - pi;
  }
}

/** Swaps Math.sin, Math.cos and Math.atan2 for this port; returns a function that restores them. */
export function useFdlibm(): () => void {
  Math.sin = sin;
  Math.cos = cos;
  Math.atan2 = atan2;
  return () => {
    Math.sin = nativeSin;
    Math.cos = nativeCos;
    Math.atan2 = nativeAtan2;
  };
}
