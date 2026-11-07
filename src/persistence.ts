import { validatePuzzle } from './solver.js';

export const PUZZLE_KEY = 'spellingBeeSolver.puzzle.v1';
export interface LocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
interface SavedPuzzle { readonly version: 1; readonly cells: readonly string[] }
interface ExtensionGlobal {
  readonly browser?: { readonly storage?: { readonly local?: LocalStorageArea } };
  readonly chrome?: { readonly storage?: { readonly local?: LocalStorageArea } };
}

export function getExtensionStorage(): LocalStorageArea | undefined {
  const scope = globalThis as ExtensionGlobal;
  return scope.browser?.storage?.local ?? scope.chrome?.storage?.local;
}

/** Reject unknown schemas, extra data, unsupported characters and duplicates. */
export function decodePuzzle(value: unknown): readonly string[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  if (Object.keys(saved).length !== 2 || saved.version !== 1 || !Array.isArray(saved.cells) || saved.cells.length !== 7) return null;
  if (!saved.cells.every((cell: unknown) => typeof cell === 'string' && /^[A-Za-z]?$/.test(cell))) return null;
  const cells = (saved.cells as string[]).map(cell => cell.toUpperCase());
  const valid = validatePuzzle(cells);
  return valid.ok || valid.reason === 'incomplete' ? cells : null;
}

/** One current puzzle, serialized/coalesced writes, and a Reset barrier.
 * No persistence occurs in promise callbacks after the popup is closing. */
export function createPersistence(area: LocalStorageArea | undefined, notice: (failed: boolean) => void = () => {}) {
  let desired: SavedPuzzle | null = null;
  let pending: { value: SavedPuzzle | null; generation: number } | undefined;
  let generation = 0;
  let running: Promise<void> | undefined;
  let closing = false;
  let dirty = false;

  function issue(value: SavedPuzzle | null): Promise<void> {
    if (!area) return Promise.reject(new Error('Extension local storage unavailable.'));
    try { return value === null ? area.remove(PUZZLE_KEY) : area.set({ [PUZZLE_KEY]: value }); }
    catch (error) { return Promise.reject(error); }
  }

  function drain(): void {
    if (running || closing || !pending) return;
    const operation = pending;
    pending = undefined;
    // Invoke the API immediately; do not debounce edits until the popup unloads.
    running = issue(operation.value).then(() => {
      if (operation.generation === generation) { dirty = false; notice(false); }
    }, () => {
      if (operation.generation === generation) notice(true);
    }).finally(() => { running = undefined; drain(); });
  }

  function enqueue(value: SavedPuzzle | null): void {
    if (closing) return;
    desired = value; dirty = true;
    pending = { value, generation: ++generation };
    drain();
  }

  return {
    async load(): Promise<readonly string[]> {
      const empty = Array<string>(7).fill('');
      try {
        if (!area) throw new Error('Extension local storage unavailable.');
        const data = await area.get(PUZZLE_KEY);
        if (!(PUZZLE_KEY in data)) return empty;
        const restored = decodePuzzle(data[PUZZLE_KEY]);
        if (!restored) { await area.remove(PUZZLE_KEY); return empty; }
        desired = { version: 1, cells: restored };
        return restored;
      } catch { notice(true); return empty; }
    },
    save(cells: readonly string[]): void {
      const clean = decodePuzzle({ version: 1, cells: [...cells] });
      if (!clean) throw new Error('Only validated current puzzle cells can be saved.');
      enqueue(clean.some(Boolean) ? { version: 1, cells: clean } : null);
    },
    reset(): void { enqueue(null); },
    async flush(): Promise<void> {
      while (running) await running;
    },
    close(): void {
      closing = true;
      pending = undefined;
      // Submit the latest snapshot/removal directly before teardown, after all
      // already-issued requests. Nothing is left only in a popup-owned queue.
      // Browser-owned local-storage operations survive their popup's lifetime.
      if (dirty) void issue(desired).catch(() => {});
    },
  };
}
