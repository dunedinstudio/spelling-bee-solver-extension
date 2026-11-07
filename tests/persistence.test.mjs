import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence, decodePuzzle, PUZZLE_KEY } from '../dist/chromium/persistence.js';

const empty = () => Array(7).fill('');
const complete = [...'COATING'];
const partial = ['C', 'O', 'A', '', '', '', ''];
function memory(initial = {}) {
  const data = structuredClone(initial);
  const calls = [];
  return { data, calls, area: {
    async get() { return structuredClone(data); },
    async set(items) { calls.push(['set', structuredClone(items)]); Object.assign(data, structuredClone(items)); },
    async remove(key) { calls.push(['remove', key]); delete data[key]; },
  } };
}
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const state = cells => ({ version: 1, cells });

test('storage: clean installation restores exactly seven empty cells', async () => {
  const db = memory(); const p = createPersistence(db.area);
  assert.deepEqual(await p.load(), empty()); assert.deepEqual(db.data, {});
});
test('storage: complete and partial puzzles restore original positions and ASCII case', async () => {
  for (const cells of [complete, partial, [...'coating']]) {
    const db = memory({ [PUZZLE_KEY]: state(cells) });
    assert.deepEqual(await createPersistence(db.area).load(), cells.map(c => c.toUpperCase()));
  }
});
test('storage: corrupted, duplicate, unsupported and old-schema records are removed safely', async () => {
  for (const value of [null, [], {}, state(['C']), { version: 2, cells: complete }, { ...state(complete), answers: ['coat'] }, state(['C', 'C', 'A', '', '', '', '']), state(['K', '', '', '', '', '', '']), state([1, '', '', '', '', '', ''])]) {
    const db = memory({ [PUZZLE_KEY]: value });
    assert.equal(decodePuzzle(value), null);
    assert.deepEqual(await createPersistence(db.area).load(), empty());
    assert.deepEqual(db.data, {});
  }
});
test('storage: one minimal record contains letters/version only; never results or history', async () => {
  const db = memory(); const p = createPersistence(db.area);
  p.save(complete); await p.flush();
  assert.deepEqual(db.data, { [PUZZLE_KEY]: { version: 1, cells: ['C', 'O', 'A', 'T', 'I', 'N', 'G'] } });
});
test('storage: edit, center change and deletion save the latest exact positions', async () => {
  const db = memory(); const p = createPersistence(db.area);
  for (const cells of [complete, ['B', 'O', 'A', 'T', 'I', 'N', 'G'], ['B', 'O', '', 'T', 'I', 'N', 'H']]) { p.save(cells); await p.flush(); assert.deepEqual(await createPersistence(db.area).load(), cells); }
});
test('storage: invalid save calls cannot poison the accepted record', async () => {
  const db = memory(); const p = createPersistence(db.area);
  p.save(complete); await p.flush();
  assert.throws(() => p.save(['C', 'C', '', '', '', '', '']));
  assert.deepEqual(db.data[PUZZLE_KEY], state(complete));
});
test('storage: rapid edits coalesce behind a delayed write and finish with the latest state', async () => {
  const db = memory(); const delayed = gate(); let first = true;
  const set = db.area.set;
  db.area.set = async items => { if (first) { first = false; await delayed.promise; } await set(items); };
  const p = createPersistence(db.area); p.save(partial);
  for (let i = 0; i < 100; i++) p.save(i % 2 ? complete : partial);
  delayed.resolve(); await p.flush();
  assert.deepEqual(db.data[PUZZLE_KEY], state(complete));
  assert.equal(db.calls.length, 2, 'Only in-flight and newest snapshots are written');
});
test('storage: Reset waits behind a delayed save and removes it, without stale resurrection', async () => {
  const db = memory(); const delayed = gate(); const set = db.area.set;
  db.area.set = async items => { await delayed.promise; await set(items); };
  const p = createPersistence(db.area); p.save(complete); p.reset();
  delayed.resolve(); await p.flush();
  assert.deepEqual(db.data, {}); assert.equal(db.calls.at(-1)[0], 'remove');
  assert.deepEqual(await createPersistence(db.area).load(), empty());
});
test('storage: a new puzzle entered immediately after Reset becomes the only current puzzle', async () => {
  const db = memory(); const delayed = gate(); const set = db.area.set; let first = true;
  db.area.set = async items => { if (first) { first = false; await delayed.promise; } await set(items); };
  const p = createPersistence(db.area); p.save(complete); p.reset(); p.save(partial);
  delayed.resolve(); await p.flush(); assert.deepEqual(db.data, { [PUZZLE_KEY]: state(partial) });
});
test('storage: Reset clears complete, partial and already empty puzzles', async () => {
  for (const cells of [complete, partial, empty()]) {
    const db = memory({ [PUZZLE_KEY]: state(cells) }); const p = createPersistence(db.area);
    p.reset(); await p.flush(); assert.deepEqual(db.data, {});
  }
});
test('storage: failed reads and unavailable API return an empty puzzle with a notice', async () => {
  for (const area of [undefined, { ...memory().area, get: async () => { throw new Error('unavailable'); } }]) {
    const notices = []; const p = createPersistence(area, failed => notices.push(failed));
    assert.deepEqual(await p.load(), empty()); assert.deepEqual(notices, [true]);
    p.save(complete); await p.flush(); assert.equal(notices.at(-1), area === undefined);
  }
});
test('storage: rejected writes do not poison later saves or produce unhandled rejections', async () => {
  const db = memory(); const set = db.area.set; let fail = true; const notices = [];
  db.area.set = async items => { if (fail) throw new Error('quota or unavailable'); await set(items); };
  const p = createPersistence(db.area, failed => notices.push(failed));
  p.save(complete); await p.flush(); assert.equal(notices.at(-1), true);
  fail = false; p.save(partial); await p.flush();
  assert.deepEqual(db.data[PUZZLE_KEY], state(partial)); assert.equal(notices.at(-1), false);
});
test('storage: rejected Reset is reported while the controller remains usable', async () => {
  const db = memory(); const notices = [];
  db.area.remove = async () => { throw new Error('unavailable'); };
  const p = createPersistence(db.area, failed => notices.push(failed));
  p.reset(); await p.flush(); assert.equal(notices.at(-1), true);
  p.save(complete); await p.flush(); assert.deepEqual(db.data[PUZZLE_KEY], state(complete));
});
test('storage: queued snapshots cannot be changed by mutating the caller array', async () => {
  const db = memory(); const p = createPersistence(db.area); const cells = [...complete];
  p.save(cells); cells[0] = 'Z'; await p.flush(); assert.deepEqual(db.data[PUZZLE_KEY], state(complete));
});
test('storage: obsolete write failures cannot display a stale error after a newer save', async () => {
  const db = memory(); const delayed = gate(); const set = db.area.set; let first = true; const notices = [];
  db.area.set = async items => { if (first) { first = false; await delayed.promise; throw new Error('old failure'); } await set(items); };
  const p = createPersistence(db.area, failed => notices.push(failed)); p.save(partial); p.save(complete);
  delayed.resolve(); await p.flush(); assert.deepEqual(notices, [false]);
});
test('storage: page teardown submits the newest snapshot immediately and stops queued callbacks', async () => {
  const db = memory(); const reply = gate(); const set = db.area.set; let first = true;
  // Browser-like effect at submission, with a deliberately delayed API reply.
  db.area.set = async items => { await set(items); if (first) { first = false; await reply.promise; } };
  const p = createPersistence(db.area); p.save(partial); p.save(complete); p.close();
  await Promise.resolve(); assert.deepEqual(db.data[PUZZLE_KEY], state(complete));
  reply.resolve(); await p.flush(); assert.deepEqual(db.data[PUZZLE_KEY], state(complete));
});
test('storage: teardown while Reset is queued submits removal and never resaves old state', async () => {
  const db = memory(); const reply = gate(); const set = db.area.set;
  db.area.set = async items => { await set(items); await reply.promise; };
  const p = createPersistence(db.area); p.save(complete); p.reset(); p.close();
  await Promise.resolve(); assert.deepEqual(db.data, {});
  reply.resolve(); await p.flush(); assert.deepEqual(db.data, {});
});
