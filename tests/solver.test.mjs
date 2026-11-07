import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSolver, validatePuzzle } from '../dist/chromium/solver.js';
import { editCell, arrowTarget } from '../dist/chromium/input.js';
import { at } from '../scripts/common.mjs';

// Intentionally hand-verifiable, including negatives. Not the production corpus.
const fixture = ['toting', 'cat', 'coat', 'coating', 'coacting', 'coach', 'cocoa', 'coat'];
const cells = ['c', 'o', 'a', 't', 'i', 'n', 'g'];
const solve = createSolver(fixture);
const words = result => result.map(match => match.word);

test('01: seven distinct ASCII letters accepted, case independent', () => {
  assert.equal(validatePuzzle(cells).ok, true);
  assert.deepEqual(solve(cells), solve(cells.map(c => c.toUpperCase())));
});
test('02: duplicates rejected in both raw validation and edits', () => {
  assert.deepEqual(validatePuzzle(['c', 'C', 'a', 't', 'i', 'n', 'g']), { ok: false, reason: 'duplicate' });
  assert.equal(editCell(cells, 1, 'C').ok, false);
  assert.deepEqual(solve(['c', 'c', 'a', 't', 'i', 'n', 'g']), []);
});
test('03: invalid characters, Unicode case-fold tricks and multi-letter edits rejected', () => {
  for (const raw of ['1', '.', '-', 'é', 'K', 'ı', 'ſ', 'ß', '😀', 'AB', ' ', '\n']) {
    assert.equal(editCell(cells, 1, raw).ok, false, raw);
    assert.equal(validatePuzzle([raw, ...cells.slice(1)]).ok, false, raw);
  }
});
test('04: mandatory center removes toting', () => {
  assert.ok(!words(solve(cells)).includes('toting'));
  assert.ok(solve(cells).every(match => match.word.includes('c')));
});
test('05: minimum length is four', () => assert.ok(!words(solve(cells)).includes('cat')));
test('06: outside letters excluded (coach has h)', () => assert.ok(!words(solve(cells)).includes('coach')));
test('07: repeated letters within words allowed', () => assert.ok(words(solve(cells)).includes('cocoa')));
test('08: all seven letters identify both pangrams, including repeated c', () => {
  assert.deepEqual(solve(cells).filter(m => m.isPangram).map(m => m.word), ['coacting', 'coating']);
});
test('09: non-pangrams never labelled', () => assert.deepEqual(solve(cells).filter(m => !m.isPangram).map(m => m.word), ['coat', 'cocoa']));
test('10: duplicate dictionary surfaces deduplicated', () => assert.equal(words(solve(cells)).filter(w => w === 'coat').length, 1));
test('11: exact hand-reasoned complete result set', () => assert.deepEqual(solve(cells), [
  { word: 'coacting', isPangram: true }, { word: 'coat', isPangram: false },
  { word: 'coating', isPangram: true }, { word: 'cocoa', isPangram: false },
]));
test('12: editing a letter recomputes and changing center matters', () => {
  assert.deepEqual(solve(['c', 'o', 'a', 't', 'i', 'n', 'h']), [
    { word: 'coach', isPangram: false }, { word: 'coat', isPangram: false }, { word: 'cocoa', isPangram: false },
  ]);
  assert.ok(words(solve(['t', 'o', 'a', 'c', 'i', 'n', 'g'])).includes('toting'));
});
test('13: missing cells clear results', () => assert.deepEqual(solve(['', ...cells.slice(1)]), []));
test('14: zero matches is an empty result', () => assert.deepEqual(solve(['q', 'x', 'z', 'j', 'k', 'v', 'b']), []));
test('15: deterministic under repeated solves, input permutation and source order', () => {
  const expected = solve(cells);
  assert.deepEqual(createSolver([...fixture].reverse())(cells), expected);
  for (let i = 0; i < 20; i++) assert.deepEqual(solve([cells[0], ...cells.slice(1).reverse()]), expected);
});
test('16: edits permit clear, replacement, same-cell letter and uppercase display', () => {
  assert.deepEqual(editCell(cells, 0, 'C'), { ok: true, value: 'C' });
  assert.deepEqual(editCell(cells, 0, ''), { ok: true, value: '' });
  assert.deepEqual(editCell(cells, 0, 'b'), { ok: true, value: 'B' });
});
test('16: spatial arrows follow the honeycomb and stop at edges', () => {
  assert.equal(arrowTarget(0, 'ArrowUp'), 1);
  assert.equal(arrowTarget(1, 'ArrowDown'), 0);
  assert.equal(arrowTarget(1, 'ArrowUp'), 1);
  assert.equal(arrowTarget(0, 'ArrowLeft'), 5);
  assert.equal(arrowTarget(0, 'ArrowRight'), 2);
  assert.equal(arrowTarget(0, 'Tab'), 0);
});
test('malformed dictionary surfaces fail closed', () => {
  for (const raw of ['Coat', 'a-b', '<script>', '', 'café']) assert.throws(() => createSolver([raw]));
});

const realWords = (await readFile(at('data/words.txt'), 'utf8')).trimEnd().split('\n');
const realSolve = createSolver(realWords);
// Independent reference deliberately uses string/set membership, never bitmasks.
function oracle(puzzle) {
  const allowed = new Set(puzzle);
  return realWords.filter(word => word.length >= 4 && word.includes(puzzle[0]) && [...word].every(c => allowed.has(c)))
    .map(word => ({ word, isPangram: puzzle.every(c => word.includes(c)) }));
}
test('real dictionary covers ordinary repeated words and a genuine pangram', () => {
  const puzzle = ['a', 'n', 'b', 'd', 'o', 'm', 'e'];
  assert.ok(words(realSolve(puzzle)).includes('banana'));
  assert.ok(realSolve(cells).some(m => m.word === 'coating' && m.isPangram));
  assert.ok(!realWords.includes('nanana'));
});
test('250 seeded full-corpus puzzles agree with independent string/set oracle', () => {
  let seed = 0xb33;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 250; i++) {
    const available = [...'abcdefghijklmnopqrstuvwxyz'];
    const puzzle = Array.from({ length: 7 }, () => available.splice(random(available.length), 1)[0]);
    assert.deepEqual(realSolve(puzzle), oracle(puzzle), puzzle.join(''));
  }
});
test('real words cannot be mutated through a previous result', () => {
  const before = realSolve(cells);
  if (before[0]) before[0].word = 'corrupted';
  assert.deepEqual(realSolve(cells), oracle(cells));
});
