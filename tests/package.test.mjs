import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { at, files, json, sha256 } from '../scripts/common.mjs';

const html = await readFile(at('dist/chromium/popup.html'), 'utf8');
test('17: exactly one clickable external link, exact copy and safe new tab', () => {
  const links = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)];
  assert.equal(links.length, 1);
  assert.equal(links[0][2], 'Try our FREE solver!');
  assert.match(links[0][1], /href="https:\/\/spellingbeeanswers\.app\/"/);
  assert.match(links[0][1], /target="_blank"/);
  assert.match(links[0][1], /rel="noopener noreferrer"/);
  assert.match(html, /Need hints, more dictionaries, filters or custom rules\? <a /);
});
test('18: attribution is exact plain text without inline handlers or hyperlinks', () => {
  assert.match(html, /<p class="attribution">Powered By spellingbeeanswers\.app<\/p>/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
});
test('19: both MV3 manifests request only storage, with no background code or host permissions', async () => {
  for (const browser of ['chromium', 'firefox']) {
    const manifest = await json(at('dist', browser, 'manifest.json'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'Spelling Bee Solver');
    assert.equal(manifest.action.default_title, 'Spelling Bee Solver');
    assert.deepEqual(manifest.permissions, ['storage']);
    for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'background', 'content_scripts', 'web_accessible_resources', 'externally_connectable', 'options_ui', 'update_url']) assert.equal(key in manifest, false, key);
    assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
    assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
    if (browser === 'firefox') assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
    else assert.equal(manifest.browser_specific_settings, undefined);
  }
});
test('20: both production builds contain only allowlisted runtime assets and notices', async () => {
  for (const browser of ['chromium', 'firefox']) {
    const names = await files(at('dist', browser));
    assert.deepEqual(names, ['dictionary.js', 'icons/icon-128.png', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'input.js', 'licenses/ESDB-Copyright.txt', 'licenses/ESDB-Sources.md', 'licenses/NOTICE.txt', 'licenses/provenance.json', 'manifest.json', 'persistence.js', 'popup.css', 'popup.html', 'popup.js', 'solver.js']);
    const icon = await readFile(at('dist', browser, 'icons/icon-128.png'));
    assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});
test('production code uses no remote runtime, unsafe HTML, web storage or analytics', async () => {
  for (const name of ['popup.js', 'solver.js', 'input.js', 'persistence.js']) {
    const code = await readFile(at('dist/chromium', name), 'utf8');
    assert.doesNotMatch(code, /\beval\s*\(|new\s+Function\s*\(|innerHTML|outerHTML|insertAdjacentHTML|https?:|fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|sendBeacon/);
  }
  assert.doesNotMatch(html, /Spelling Bee Answers/);
  assert.equal([...html.matchAll(/<input\b/g)].length, 7);
  assert.equal([...html.matchAll(/<section\b/g)].length, 2);
  assert.equal([...html.matchAll(/<button\b/g)].length, 1);
  assert.match(html, /id="reset"[^>]*>.*<span>Reset<\/span><\/button>/);
});
test('owner-supplied smiling bee icons match their pins at every manifest size', async () => {
  const provenance = await json(at('assets/bee/provenance.json'));
  for (const size of [16, 32, 48, 128]) {
    const pin = provenance.files.find(file => file.name === `icon-${size}.png`);
    for (const browser of ['chromium', 'firefox']) {
      const manifest = await json(at('dist', browser, 'manifest.json'));
      const name = manifest.icons[String(size)];
      assert.equal(name, manifest.action.default_icon[String(size)]);
      const bytes = await readFile(at('dist', browser, name));
      assert.equal(sha256(bytes), pin.sha256);
      assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
      assert.equal(bytes[25], 6, 'RGBA transparency');
    }
  }
});
test('dictionary provenance and full licenses remain checksum pinned in each output', async () => {
  const pin = await json(at('data/provenance.json'));
  assert.equal(pin.wordCount, 77533);
  assert.equal(sha256(await readFile(at('data/words.txt'))), pin.sha256);
  for (const browser of ['chromium', 'firefox']) for (const [name, hash] of Object.entries(pin.licenses)) {
    assert.equal(sha256(await readFile(at('dist', browser, 'licenses', name))), hash, `${browser}/${name}`);
  }
  const { wordsText } = await import('../dist/chromium/dictionary.js');
  assert.equal(sha256(wordsText), pin.sha256);
});
test('Firefox differs only by its documented browser-specific manifest settings', async () => {
  for (const name of await files(at('dist/chromium'))) {
    if (name === 'manifest.json') continue;
    assert.equal(sha256(await readFile(at('dist/chromium', name))), sha256(await readFile(at('dist/firefox', name))), name);
  }
  const chromium = await json(at('dist/chromium/manifest.json'));
  const { browser_specific_settings, ...firefox } = await json(at('dist/firefox/manifest.json'));
  assert.ok(browser_specific_settings.gecko.id);
  assert.deepEqual(firefox, chromium);
});
