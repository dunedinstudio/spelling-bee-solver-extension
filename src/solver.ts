/** Adapted from the site's solver/internal.ts and scoring.ts. Fixed seven-letter
 * rules remove regional selectors, scoring, workers and web release machinery.
 * Mask subset and equality semantics are independently oracle-tested. */
export type PuzzleValidation =
  | { readonly ok: true; readonly mask: number; readonly centerMask: number }
  | { readonly ok: false; readonly reason: 'incomplete' | 'invalid' | 'duplicate' };

export interface Match {
  readonly word: string;
  readonly isPangram: boolean;
}

export function letterMask(word: string): number {
  let mask = 0;
  for (const letter of word) mask |= 1 << (letter.charCodeAt(0) - 97);
  return mask;
}

/** Cell 0 is always the mandatory center. Reject before Unicode case folding. */
export function validatePuzzle(cells: readonly string[]): PuzzleValidation {
  if (cells.length !== 7 || cells.some(cell => !/^[a-zA-Z]?$/.test(cell))) return { ok: false, reason: 'invalid' };
  const letters = cells.map(cell => cell.toLowerCase());
  const filled = letters.filter(Boolean);
  if (new Set(filled).size !== filled.length) return { ok: false, reason: 'duplicate' };
  if (filled.length !== 7) return { ok: false, reason: 'incomplete' };
  return { ok: true, mask: letterMask(letters.join('')), centerMask: letterMask(letters[0]!) };
}

/** Prepare once per popup. Preserve all eligible words; ASCII sort is locale independent. */
export function createSolver(rawWords: readonly string[]): (cells: readonly string[]) => readonly Match[] {
  if (rawWords.some(word => !/^[a-z]+$/.test(word))) throw new Error('Dictionary must contain lowercase English words.');
  const words = [...new Set(rawWords.filter(word => word.length >= 4))].sort();
  const masks = Uint32Array.from(words, letterMask);
  return cells => {
    const puzzle = validatePuzzle(cells);
    if (!puzzle.ok) return [];
    const matches: Match[] = [];
    for (let i = 0; i < words.length; i++) {
      const mask = masks[i]!;
      if ((mask & puzzle.mask) === mask && (mask & puzzle.centerMask) !== 0) {
        matches.push({ word: words[i]!, isPangram: mask === puzzle.mask });
      }
    }
    return matches;
  };
}
