import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { at, root, run, require, save } from './common.mjs';

await run([require.resolve('typescript/bin/tsc'), '--project', at('tsconfig.json'), '--noEmit']);
await run([at('scripts/build.mjs')]);
const command = ['--test', '--test-reporter=tap', at('tests/solver.test.mjs'), at('tests/package.test.mjs'), at('tests/persistence.test.mjs')];
let output = '';
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, command, { cwd: root });
  child.stdout.on('data', bytes => { output += bytes; process.stdout.write(bytes); });
  child.stderr.on('data', bytes => { output += bytes; process.stderr.write(bytes); });
  child.once('error', reject);
  child.once('exit', resolve);
});
await writeFile(at('evidence/unit-tests.tap'), output);
const number = label => Number(output.match(new RegExp(`^# ${label} (\\d+)$`, 'm'))?.[1] ?? 0);
await save(at('evidence/unit-tests.json'), { status: code === 0 ? 'PASS' : 'FAIL', tests: number('tests'), passed: number('pass'), failed: number('fail'), command: 'node scripts/check.mjs', typecheck: 'PASS', productionBuild: 'PASS', output: 'unit-tests.tap' });
if (code !== 0) throw new Error(`Tests failed: ${code}`);
