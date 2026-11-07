import { wordsText } from './dictionary.js';
import { createSolver, validatePuzzle } from './solver.js';
import { arrowTarget, editCell } from './input.js';
import { createPersistence, getExtensionStorage } from './persistence.js';

const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.hive input'));
const list = document.querySelector<HTMLUListElement>('#words')!;
const count = document.querySelector<HTMLElement>('#word-count')!;
const summary = document.querySelector<HTMLElement>('#results-summary')!;
const empty = document.querySelector<HTMLElement>('#empty-state')!;
const error = document.querySelector<HTMLElement>('#input-error')!;
const progress = document.querySelector<HTMLElement>('#progress')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
let cells = Array<string>(7).fill('');
let storageNotice = '';
let inputNotice = '';
const persistence = createPersistence(getExtensionStorage(), failed => {
  storageNotice = failed ? 'Local saving is unavailable.' : '';
  error.textContent = [inputNotice, storageNotice].filter(Boolean).join(' ');
});

function focusCell(index: number): void {
  inputs[index]?.focus();
  inputs[index]?.select();
}

function setError(message: string, index?: number): void {
  inputNotice = message;
  error.textContent = [message, storageNotice].filter(Boolean).join(' ');
  inputs.forEach((input, i) => input.setAttribute('aria-invalid', String(Boolean(message) && i === index)));
}

try {
  const solve = createSolver(wordsText.trimEnd().split('\n'));
  function render(): void {
    const validation = validatePuzzle(cells);
    const matches = validation.ok ? solve(cells) : [];
    const filled = cells.filter(Boolean).length;
    progress.textContent = `${filled} of 7 letters`;
    progress.dataset.complete = String(validation.ok);
    count.textContent = String(matches.length);
    summary.textContent = validation.ok ? `${matches.length} matching ${matches.length === 1 ? 'word' : 'words'}` : 'Enter all 7 letters to see matching words.';
    empty.hidden = matches.length > 0;
    empty.textContent = validation.ok ? 'No matching words. Try a different set of letters.' : 'Your words will appear here. Start with the yellow center letter.';
    list.hidden = matches.length === 0;
    const fragment = document.createDocumentFragment();
    for (const match of matches) {
      const row = document.createElement('li');
      const word = document.createElement('span');
      word.className = 'word';
      word.textContent = match.word;
      row.append(word);
      if (match.isPangram) {
        const badge = document.createElement('span');
        badge.className = 'pangram';
        badge.textContent = 'Pangram';
        row.append(badge);
      }
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    document.querySelector('#results-scroll')!.scrollTop = 0;
  }

  function commit(index: number, raw: string, advance = true): void {
    const result = editCell(cells, index, raw);
    if (!result.ok) {
      inputs[index]!.value = cells[index]!;
      setError(result.message, index);
      focusCell(index);
      return;
    }
    cells = cells.map((value, i) => i === index ? result.value : value);
    inputs[index]!.value = result.value;
    setError('');
    render();
    persistence.save(cells);
    if (result.value && advance) {
      const nextEmpty = cells.findIndex((value, i) => i > index && !value);
      if (nextEmpty !== -1) focusCell(nextEmpty);
      else if (cells.some(value => !value)) focusCell(cells.indexOf(''));
      else focusCell(index);
    }
  }

  inputs.forEach((input, index) => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('click', () => input.select());
    input.addEventListener('keydown', event => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        focusCell(arrowTarget(index, event.key));
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (cells[index]) commit(index, '', false);
        else if (index > 0) { commit(index - 1, '', false); focusCell(index - 1); }
      } else if (event.key === 'Delete') {
        event.preventDefault();
        commit(index, '', false);
      } else if (event.key.length === 1) {
        event.preventDefault();
        commit(index, event.key);
      }
    });
    input.addEventListener('paste', event => {
      event.preventDefault();
      commit(index, event.clipboardData?.getData('text/plain') ?? '');
    });
    input.addEventListener('input', event => {
      if (!(event instanceof InputEvent) || !event.isComposing) commit(index, input.value);
    });
    input.addEventListener('compositionend', () => commit(index, input.value));
  });
  reset.addEventListener('click', () => {
    cells = Array<string>(7).fill('');
    inputs.forEach(input => { input.value = ''; });
    setError('');
    render();
    persistence.reset();
    focusCell(0);
  });
  window.addEventListener('pagehide', () => persistence.close(), { once: true });
  cells = [...await persistence.load()];
  inputs.forEach((input, index) => { input.value = cells[index]!; input.disabled = false; });
  reset.disabled = false;
  render();
  document.body.setAttribute('aria-busy', 'false');
  focusCell(0);
  performance.mark('solver-ready');
} catch {
  inputs.forEach(input => { input.disabled = true; });
  empty.textContent = 'The local dictionary could not be loaded. Reload the extension and try again.';
  setError('Dictionary unavailable.');
}
