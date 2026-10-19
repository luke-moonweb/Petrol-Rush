let touch = false;

const TOUCH_KEYS: Record<string, string> = {
  ENTER: 'OK',
  ESC: 'BACK',
  '↑↓': '▲▼',
  '↑ ↓': '▲ ▼',
  '←→': '◀▶',
  '← →': '◀ ▶',
  '↓': '▼',
  'ENTER / ESC': 'OK / BACK',
};

export function setTouchHints(on: boolean): void {
  touch = on;
}

export function touchHints(): boolean {
  return touch;
}

export function hintList(list: [string, string][]): [string, string][] {
  if (!touch) return list;
  return list.flatMap(([k, l]): [string, string][] => {
    const key = TOUCH_KEYS[k];
    return key && key !== l ? [[key, l]] : [];
  });
}
