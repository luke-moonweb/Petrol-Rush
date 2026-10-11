export interface TextOpts {
  font?: string;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  shadow?: string | null;
  shadowOffset?: number;
}

export const FONT_UI = 'Arial, Helvetica, sans-serif';

export function text(g: CanvasRenderingContext2D, str: string, x: number, y: number, o: TextOpts = {}): void {
  g.font = o.font ?? `bold 11px ${FONT_UI}`;
  g.textAlign = o.align ?? 'left';
  g.textBaseline = o.baseline ?? 'alphabetic';
  if (o.shadow !== null) {
    const off = o.shadowOffset ?? 1;
    g.fillStyle = o.shadow ?? '#000';
    g.fillText(str, x + off, y + off);
  }
  g.fillStyle = o.color ?? '#fff';
  g.fillText(str, x, y);
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function redBall(g: CanvasRenderingContext2D, x: number, y: number): void {
  const grad = g.createRadialGradient(x - 2, y - 2, 1, x, y, 6);
  grad.addColorStop(0, '#ffb0a0');
  grad.addColorStop(0.4, '#e02010');
  grad.addColorStop(1, '#600000');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, 6, 0, Math.PI * 2);
  g.fill();
}

export function offBall(g: CanvasRenderingContext2D, x: number, y: number): void {
  const grad = g.createRadialGradient(x - 2, y - 2, 1, x, y, 6);
  grad.addColorStop(0, '#8a8a8a');
  grad.addColorStop(0.4, '#3a3a3a');
  grad.addColorStop(1, '#141414');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, 6, 0, Math.PI * 2);
  g.fill();
}
