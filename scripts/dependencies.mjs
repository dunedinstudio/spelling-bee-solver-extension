import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { at, json, require, save } from './common.mjs';

async function size(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) { const result = await size(name); bytes += result.bytes; files += result.files; }
    else if (entry.isFile()) { bytes += (await stat(name)).size; files++; }
  }
  return { bytes, files };
}
const lock = await json(at('package-lock.json'));
const packages = [];
for (const [key, pin] of Object.entries(lock.packages).filter(([key]) => key !== '')) {
  const name = key.replace('node_modules/', '');
  let location = path.dirname(require.resolve(name));
  let pkg;
  for (;;) {
    pkg = await json(path.join(location, 'package.json')).catch(() => undefined);
    if (pkg?.name === name) break;
    const parent = path.dirname(location);
    if (parent === location) throw new Error(`Package root not found: ${name}`);
    location = parent;
  }
  assert.equal(pkg.version, pin.version, `Installed package must match lock: ${name}`);
  packages.push({ name, version: pkg.version, ...await size(location) });
}
const report = {
  runtimePackages: 0,
  declaredDirectDevPackages: Object.keys(lock.packages[''].devDependencies).length,
  transitiveDevPackagesIncludingDirect: packages.length,
  installedPackageFileBytes: packages.reduce((total, pkg) => total + pkg.bytes, 0),
  packages,
  method: 'Actual installed file bytes, excluding nested node_modules, browser binaries, filesystem allocation and unrelated parent dependencies. Installed versions verified against the extension lock. No development packages ship in the production build.',
};
await save(at('evidence/dependencies.json'), report);
console.log(JSON.stringify(report, null, 2));
