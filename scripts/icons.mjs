import { mkdir, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { at, json, sha256 } from './common.mjs';

/** Copy the owner's supplied PNGs verbatim; no resizing/generation dependency. */
export async function makeIcons(directory) {
  const provenance = await json(at('assets/bee/provenance.json'));
  await mkdir(directory, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const name = `icon-${size}.png`;
    const bytes = await readFile(at('assets/bee', name));
    const pin = provenance.files.find(file => file.name === name);
    if (!pin || sha256(bytes) !== pin.sha256 || bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size || bytes[25] !== 6) throw new Error(`Invalid/unreviewed RGBA bee icon: ${name}`);
    await copyFile(at('assets/bee', name), path.join(directory, name));
  }
}
