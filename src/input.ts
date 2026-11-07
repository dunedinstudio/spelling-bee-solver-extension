export type CellEdit =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string };

export function editCell(cells: readonly string[], index: number, raw: string): CellEdit {
  if (raw === '') return { ok: true, value: '' };
  if (!/^[a-zA-Z]$/.test(raw)) return { ok: false, message: 'Use one English letter, A–Z.' };
  const value = raw.toUpperCase();
  if (cells.some((cell, i) => i !== index && cell.toUpperCase() === value)) {
    return { ok: false, message: `${value} is already in the honeycomb. Choose a different letter.` };
  }
  return { ok: true, value };
}

export const CELL_POSITIONS: readonly (readonly [number, number])[] = [
  [0, 0], [0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1],
];

/** Arrow keys move toward the closest cell in that spatial direction. */
export function arrowTarget(index: number, key: string): number {
  const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const)[key as 'ArrowLeft'];
  const origin = CELL_POSITIONS[index];
  if (!direction || !origin) return index;
  let best = index;
  let score = Infinity;
  CELL_POSITIONS.forEach(([x, y], candidate) => {
    const dx = x - origin[0];
    const dy = y - origin[1];
    const forward = dx * direction[0] + dy * direction[1];
    if (forward <= 0) return;
    const sideways = Math.abs(dx * direction[1] - dy * direction[0]);
    const candidateScore = sideways * 3 + Math.hypot(dx, dy);
    if (candidateScore < score) { best = candidate; score = candidateScore; }
  });
  return best;
}
