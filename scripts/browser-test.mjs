import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { at, save } from './common.mjs';

const checks = [];
const errors = [];
const remoteRequests = [];
const started = performance.now();
const evidence = process.env.QA_EVIDENCE || 'evidence';
const ev = (...parts) => at(evidence, ...parts);
await mkdir(at('.cache'), { recursive: true });
await mkdir(ev('screenshots'), { recursive: true });
const profile = await mkdtemp(at('.cache/browser-'));
// Chrome's supported experimental CDP extension loader operates in this fresh,
// disposable QA profile only. No everyday browser profile is accessed.
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: process.env.BROWSER_CHANNEL || 'chrome' }), headless: true,
  viewport: { width: 380, height: 620 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging'],
});
const browser = context.browser();
const version = browser.version();
const cdp = await browser.newBrowserCDPSession();
const { id } = await cdp.send('Extensions.loadUnpacked', { path: at('dist/chromium') });
const origin = `chrome-extension://${id}`;
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
});
// Explicit footer-click testing is intercepted locally; never contact the live site.
await context.route('https://spellingbeeanswers.app/**', route => route.fulfill({ contentType: 'text/html', body: '<title>QA link destination</title><p>Intercepted by local test.</p>' }));
const inputs = page.locator('.hive input');
const realWords = (await readFile(at('data/words.txt'), 'utf8')).trimEnd().split('\n');
const expected = puzzle => realWords.filter(word => word.includes(puzzle[0]) && [...word].every(c => puzzle.includes(c)));
const popupPerformance = { readySamplesMs: [] };
async function check(name, action) {
  await action();
  checks.push({ name, status: 'PASS' });
  console.log(`PASS ${name}`);
}
async function fill(puzzle) {
  for (let i = 0; i < 7; i++) await inputs.nth(i).fill('');
  for (let i = 0; i < 7; i++) await inputs.nth(i).fill(puzzle[i]);
}
async function paste(index, text) {
  await inputs.nth(index).evaluate((input, value) => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', value);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, text);
}
let failure;
try {
  await page.goto(`${origin}/popup.html`);
  await page.waitForFunction(() => performance.getEntriesByName('solver-ready').length === 1);
  popupPerformance.readySamplesMs.push(await page.evaluate(() => performance.getEntriesByName('solver-ready')[0].startTime));
  await check('Installed MV3 extension has correct name/version and is enabled', async () => {
    const { extensions } = await cdp.send('Extensions.getExtensions');
    assert.ok(extensions.some(extension => extension.id === id && extension.enabled && extension.name === 'Spelling Bee Solver'));
  });
  await check('Immediate center focus, seven labelled cells and initial empty state', async () => {
    await expect(inputs).toHaveCount(7);
    await expect(inputs.nth(0)).toBeFocused();
    assert.match(await inputs.nth(0).getAttribute('aria-label'), /Center/);
    for (let i = 1; i < 7; i++) assert.match(await inputs.nth(i).getAttribute('aria-label'), new RegExp(`Outer letter ${i}`));
    await expect(page.locator('#word-count')).toHaveText('0');
    await expect(page.locator('#empty-state')).toContainText('yellow center');
    assert.notEqual(await page.locator('.center').evaluate(e => getComputedStyle(e, '::before').backgroundColor), await page.locator('.outer-1').evaluate(e => getComputedStyle(e, '::before').backgroundColor));
    await page.locator('body').screenshot({ path: ev('screenshots/initial.png') });
  });
  await check('Keyboard entry auto-advances, uppercases and immediately solves', async () => {
    await page.keyboard.type('coating');
    assert.deepEqual(await inputs.evaluateAll(elements => elements.map(input => input.value)), [...'COATING']);
    await expect(page.locator('#progress')).toHaveText('7 of 7 letters');
    const actual = await page.locator('#words .word').allTextContents();
    assert.deepEqual(actual, expected([...'coating']));
    await expect(page.locator('#word-count')).toHaveText(String(actual.length));
  });
  await check('Pangram badges exactly match all-seven-letter membership', async () => {
    const actual = await page.locator('#words li').evaluateAll(rows => rows.map(row => ({ word: row.querySelector('.word').textContent, pangram: Boolean(row.querySelector('.pangram')) })));
    assert.ok(actual.some(row => row.word === 'coating' && row.pangram));
    for (const row of actual) assert.equal(row.pangram, [...'coating'].every(c => row.word.includes(c)), row.word);
    await page.getByText('coating', { exact: true }).scrollIntoViewIfNeeded();
    await page.locator('#results-scroll').focus();
    await page.locator('body').screenshot({ path: ev('screenshots/matches.png') });
  });
  await check('Duplicate edits are clearly rejected without corrupting existing valid results', async () => {
    const before = await page.locator('#word-count').textContent();
    await inputs.nth(0).press('o');
    await expect(inputs.nth(0)).toHaveValue('C');
    await expect(inputs.nth(0)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#input-error')).toContainText('already in the honeycomb');
    await expect(page.locator('#word-count')).toHaveText(before);
  });
  await check('Numbers, punctuation and unsupported Unicode are rejected in actual inputs', async () => {
    for (const value of ['1', '-', 'é', 'K', 'ı', 'ſ']) {
      await inputs.nth(0).fill(value);
      await expect(inputs.nth(0)).toHaveValue('C');
      await expect(page.locator('#input-error')).toContainText('English letter');
    }
  });
  await check('Editing letters updates real dictionary results and clears the prior error', async () => {
    await inputs.nth(6).press('h');
    assert.deepEqual(await page.locator('#words .word').allTextContents(), expected([...'coatinh']));
    assert.ok((await page.locator('#words .word').allTextContents()).includes('coach'));
    await expect(page.locator('#input-error')).toHaveText('');
  });
  await check('Delete clears one letter and removes stale results immediately', async () => {
    await inputs.nth(6).press('Delete');
    await expect(inputs.nth(6)).toHaveValue('');
    await expect(page.locator('#word-count')).toHaveText('0');
    await expect(page.locator('#words li')).toHaveCount(0);
    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('#progress')).toHaveText('6 of 7 letters');
  });
  await check('Backspace on an empty cell clears and focuses its predecessor', async () => {
    await inputs.nth(6).press('Backspace');
    await expect(inputs.nth(5)).toBeFocused();
    await expect(inputs.nth(5)).toHaveValue('');
    await expect(inputs.nth(6)).toHaveValue('');
  });
  await check('Backspace on a populated cell stays there; center cannot navigate before itself', async () => {
    await inputs.nth(0).press('Backspace');
    await expect(inputs.nth(0)).toBeFocused();
    await expect(inputs.nth(0)).toHaveValue('');
    await inputs.nth(0).press('Backspace');
    await expect(inputs.nth(0)).toBeFocused();
  });
  await check('Tab/Shift+Tab and spatial arrow navigation work', async () => {
    await inputs.nth(0).focus();
    await page.keyboard.press('Tab'); await expect(inputs.nth(1)).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(inputs.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowRight'); await expect(inputs.nth(2)).toBeFocused();
    await inputs.nth(0).press('ArrowUp'); await expect(inputs.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(inputs.nth(0)).toBeFocused();
  });
  await check('Single-letter paste normalizes; multi-letter and Unicode pastes are rejected', async () => {
    await paste(0, 'c'); await expect(inputs.nth(0)).toHaveValue('C');
    for (const text of ['ab', 'ß', 'o']) {
      await paste(0, text); await expect(inputs.nth(0)).toHaveValue('C');
      await expect(page.locator('#input-error')).not.toHaveText('');
    }
  });
  await check('Select-all replacement and same-cell edits preserve one-letter semantics', async () => {
    await inputs.nth(0).focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('b');
    await expect(inputs.nth(0)).toHaveValue('B');
    await inputs.nth(0).press('b'); await expect(inputs.nth(0)).toHaveValue('B');
  });
  await check('Zero-match puzzle shows an elegant empty state and exact zero count', async () => {
    await fill([...'qxzjkvb']);
    await expect(page.locator('#word-count')).toHaveText('0');
    await expect(page.locator('#empty-state')).toContainText('No matching words');
    await expect(page.locator('#words li')).toHaveCount(0);
    await page.locator('body').screenshot({ path: ev('screenshots/zero-matches.png') });
  });
  await check('Matching list scrolls independently and popup remains compact', async () => {
    await fill([...'coating']);
    const dimensions = await page.evaluate(() => {
      const list = document.querySelector('#results-scroll');
      return { scroll: list.scrollHeight, height: list.clientHeight, popup: document.body.getBoundingClientRect().height, width: document.body.scrollWidth };
    });
    assert.ok(dimensions.scroll > dimensions.height);
    assert.ok(dimensions.popup <= 600, JSON.stringify(dimensions));
    assert.equal(dimensions.width, 380);
    await page.locator('#results-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.ok(await page.locator('#results-scroll').evaluate(element => element.scrollTop > 0));
  });
  await check('Popup works offline with local data and performs no remote solving requests', async () => {
    assert.deepEqual(remoteRequests, []);
    await context.setOffline(true);
    await inputs.nth(6).press('h');
    assert.deepEqual(await page.locator('#words .word').allTextContents(), expected([...'coatinh']));
    await context.setOffline(false);
  });
  await check('320px width and short desktop viewport retain the full interface', async () => {
    await page.setViewportSize({ width: 320, height: 600 });
    assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth));
    assert.ok(await page.evaluate(() => document.body.getBoundingClientRect().height <= innerHeight));
    await expect(page.locator('footer')).toBeInViewport();
    await page.locator('body').screenshot({ path: ev('screenshots/compact.png') });
    await page.setViewportSize({ width: 380, height: 620 });
  });
  await check('Footer has one exact external link and exact non-clickable attribution', async () => {
    await expect(page.locator('a')).toHaveCount(1);
    await expect(page.locator('footer a')).toHaveAttribute('href', 'https://spellingbeeanswers.app/');
    await expect(page.locator('footer a')).toHaveText('Try our FREE solver!');
    await expect(page.locator('.website-prompt')).toHaveText('Need hints, more dictionaries, filters or custom rules? Try our FREE solver!');
    await expect(page.locator('.attribution')).toHaveText('Powered By spellingbeeanswers.app');
    assert.equal(await page.locator('.attribution').evaluate(e => e.closest('a') === null && e.onclick === null && getComputedStyle(e).cursor !== 'pointer'), true);
    const session = await context.newCDPSession(page);
    // Playwright adds its own global window pointer listeners. Inspect the
    // attribution and DOM ancestors; source checks prohibit global app handlers.
    for (const expression of ["document.querySelector('.attribution')", "document.querySelector('footer')", 'document.body', 'document']) {
      const { result } = await session.send('Runtime.evaluate', { expression });
      const { listeners } = await session.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      assert.ok(!listeners.some(listener => ['click', 'auxclick', 'pointerdown'].includes(listener.type)), expression);
    }
    await session.detach();
  });
  await check('Automated accessibility scan has zero WCAG A/AA violations', async () => {
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    await save(ev('accessibility.json'), { violations: axe.violations, passes: axe.passes.length, incomplete: axe.incomplete.map(({ id, impact }) => ({ id, impact })), scope: 'Installed extension DOM; automated checks are not full accessibility certification.' });
    assert.deepEqual(axe.violations, []);
  });
  await check('Popup initialization, repeated rendering and coarse browser heap are measured', async () => {
    for (let i = 0; i < 9; i++) {
      const sample = await context.newPage();
      await sample.goto(`${origin}/popup.html`);
      await sample.waitForFunction(() => performance.getEntriesByName('solver-ready').length === 1);
      popupPerformance.readySamplesMs.push(await sample.evaluate(() => performance.getEntriesByName('solver-ready')[0].startTime));
      await sample.close();
    }
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    await fill([...'coating']);
    await session.send('HeapProfiler.collectGarbage');
    const metric = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.filter(m => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents'].includes(m.name)).map(m => [m.name, m.value]));
    popupPerformance.before = await metric();
    popupPerformance.editSamplesMs = await page.evaluate(() => {
      const input = document.querySelectorAll('.hive input')[6];
      const samples = [];
      for (let i = 0; i < 200; i++) {
        const start = performance.now();
        input.value = i % 2 ? 'g' : 'h';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: input.value }));
        samples.push(performance.now() - start);
      }
      return samples;
    });
    await session.send('HeapProfiler.collectGarbage');
    popupPerformance.after = await metric();
    const ready = [...popupPerformance.readySamplesMs].sort((a, b) => a - b);
    const edits = [...popupPerformance.editSamplesMs].sort((a, b) => a - b);
    popupPerformance.readyMedianMs = (ready[4] + ready[5]) / 2;
    popupPerformance.readyMaxMs = ready.at(-1);
    popupPerformance.editMedianMs = (edits[99] + edits[100]) / 2;
    popupPerformance.editP95Ms = edits[189];
    popupPerformance.methodology = '10 fresh extension documents in one isolated Chrome process, including module loading and real index construction, measured from navigation start to solver-ready. Browser/OS caches are warm after first document. 200 alternating single-cell input events measured synchronously through real solver and DOM replacement; excludes next paint. CDP full GC before/after for coarse heap diagnostics; not a leak proof or field guarantee.';
    await save(ev('popup-performance.json'), popupPerformance);
    await session.detach();
    assert.deepEqual(await page.locator('#words .word').allTextContents(), expected([...'coating']));
  });
  await check('Only an explicit footer click opens a new tab; no opener is exposed', async () => {
    const before = context.pages().length;
    await page.locator('.attribution').click();
    assert.equal(context.pages().length, before);
    const newTab = context.waitForEvent('page');
    await page.locator('footer a').click();
    const destination = await newTab;
    await destination.waitForLoadState();
    assert.equal(destination.url(), 'https://spellingbeeanswers.app/');
    assert.equal(await destination.evaluate(() => window.opener), null);
    await destination.close();
  });
  await check('No runtime JavaScript errors occurred', async () => assert.deepEqual(errors, []));
  await rm(ev('screenshots/failure.png'), { force: true });
} catch (error) {
  failure = error;
  checks.push({ name: 'Current browser check failed', status: 'FAIL', error: String(error) });
  await page.screenshot({ path: ev('screenshots/failure.png'), fullPage: true }).catch(() => {});
} finally {
  await save(ev('browser.json'), {
    status: failure ? 'FAIL' : 'PASS', browser: version, engine: process.env.BROWSER_CHANNEL || 'chrome',
    mode: 'Actual unpacked MV3 extension loaded in isolated Chrome profile using CDP; popup.html opened as an extension page with real CSP and packaged dictionary.',
    toolbarPopupNativeWindow: 'NOT TESTED; extension page layout and interactions tested at popup viewports.',
    otherBrowserResults: 'Recorded separately by each Phase 2 browser run; this report applies only to its recorded engine.',
    checks, passed: checks.filter(check => check.status === 'PASS').length, errors, durationMs: performance.now() - started,
    websiteLinkNetwork: 'Explicit click intercepted by local test; no request reached production.',
  });
  await context.close();
}
if (failure) throw failure;
