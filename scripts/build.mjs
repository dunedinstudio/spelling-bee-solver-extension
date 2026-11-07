import { readFile, mkdir, copyFile, writeFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { manifest } from '../manifest.mjs';
import { makeIcons } from './icons.mjs';
import { at, root, json, sha256, save, run, require, files } from './common.mjs';

const provenance = await json(at('data/provenance.json'));
const dictionary = await readFile(at('data/words.txt'), 'utf8');
if (sha256(dictionary) !== provenance.sha256 || Buffer.byteLength(dictionary) !== provenance.bytes) throw new Error('Dictionary checksum failed.');
const words = dictionary.trimEnd().split('\n');
if (words.length !== provenance.wordCount || words.some((w, i) => !/^[a-z]{4,64}$/.test(w) || (i > 0 && w <= words[i - 1]))) throw new Error('Invalid packaged dictionary.');
for (const [name, expected] of Object.entries(provenance.licenses)) {
  if (sha256(await readFile(at('licenses', name))) !== expected) throw new Error(`License checksum failed: ${name}`);
}
// Delete generated output only; reject symlinks and verify the absolute boundary.
const output = at('dist');
if (path.dirname(output) !== path.resolve(root) || path.basename(output) !== 'dist') throw new Error('Unsafe build directory.');
const info = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (info?.isSymbolicLink()) throw new Error('Refusing symlinked build output.');
await rm(output, { recursive: true, force: true });
await mkdir(at('dist/chromium'), { recursive: true });
await run([require.resolve('typescript/bin/tsc'), '--project', at('tsconfig.json')]);
const pkg = await json(at('package.json'));
const reports = {};
for (const browser of ['chromium', 'firefox']) {
  const directory = at('dist', browser);
  await mkdir(directory, { recursive: true });
  if (browser === 'firefox') for (const name of ['solver.js', 'input.js', 'persistence.js', 'popup.js']) await copyFile(at('dist/chromium', name), path.join(directory, name));
  for (const name of ['popup.html', 'popup.css']) await copyFile(at('public', name), path.join(directory, name));
  await writeFile(path.join(directory, 'dictionary.js'), `// ESDB-derived word list; see licenses/NOTICE.txt and full upstream notices.\nexport const wordsText = ${JSON.stringify(dictionary)};\n`);
  await save(path.join(directory, 'manifest.json'), manifest(browser, pkg.version));
  await mkdir(path.join(directory, 'licenses'), { recursive: true });
  for (const name of Object.keys(provenance.licenses)) await copyFile(at('licenses', name), path.join(directory, 'licenses', name));
  await copyFile(at('data/provenance.json'), path.join(directory, 'licenses/provenance.json'));
  await makeIcons(path.join(directory, 'icons'));
  const inventory = await Promise.all((await files(directory)).map(async name => {
    const bytes = await readFile(path.join(directory, name));
    return { path: name, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length, sha256: sha256(bytes) };
  }));
  reports[browser] = {
    fileCount: inventory.length,
    totalBytes: inventory.reduce((sum, file) => sum + file.bytes, 0),
    sumIndividualGzipBytes: inventory.reduce((sum, file) => sum + file.gzipBytes, 0),
    files: inventory,
  };
}
await save(at('evidence/build.json'), { node: process.version, version: pkg.version, runtimeDependencies: 0, dictionary: provenance, outputs: reports, compressionNote: 'Sum of separately gzip-compressed files, not a ZIP size. Actual local release archive sizes, when generated, are in release/PACKAGE_INVENTORY.json.' });
console.log(JSON.stringify(Object.fromEntries(Object.entries(reports).map(([browser, report]) => [browser, { files: report.fileCount, bytes: report.totalBytes }]))));
