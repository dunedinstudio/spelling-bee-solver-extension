import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { at, save, json } from './common.mjs';

const name = process.argv[2] || 'chrome';
const corrective = process.argv.includes('--corrective');
const packageVersion = (await json(at('package.json'))).version;
const executables = {
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  opera: `${process.env.LOCALAPPDATA}/Programs/Opera/opera.exe`,
};
if (!(name in executables)) throw new Error('Choose chrome, edge or opera.');
const evidence = at(process.env.QA_EVIDENCE || 'evidence/corrective', `native-${name}`);
await mkdir(evidence, { recursive: true });
await mkdir(at('.cache'), { recursive: true });
const profile = await mkdtemp(at(`.cache/native-${name}-`));
const checks = [];
const exceptions = [];
const realWords = (await readFile(at('data/words.txt'), 'utf8')).trimEnd().split('\n');
const oracle = letters => realWords.filter(word => word.includes(letters[0]) && [...word].every(c => letters.includes(c)));
let context, cdp, popup, target, hostTab, extension;
const report = { browser: name, status: 'RUNNING', ownerAcceptance: 'PENDING', checks };

// Native action-popup targets aren't ordinary tabs and aren't exposed as
// Playwright Pages. Attach to the actual target through supported CDP routing.
async function attach(targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let next = 0;
  const jobs = new Map();
  const listener = event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    const job = jobs.get(message.id);
    if (!job) return;
    jobs.delete(message.id); clearTimeout(job.timer);
    if (message.error) job.reject(new Error(JSON.stringify(message.error)));
    else job.resolve(message.result);
  };
  cdp.on('Target.receivedMessageFromTarget', listener);
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { jobs.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
        jobs.set(id, { resolve, reject, timer });
        cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
      });
    },
    detach: async () => { cdp.off('Target.receivedMessageFromTarget', listener); await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {}); },
  };
}
async function evaluate(expression, gesture = false) {
  const response = await popup.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: gesture });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function waitFor(check, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await check(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
async function open() {
  await cdp.send('Target.activateTarget', { targetId: hostTab.targetId });
  await cdp.send('Extensions.triggerAction', { id: extension.id, targetId: hostTab.targetId });
  target = await waitFor(async () => (await cdp.send('Target.getTargets', { filter: [{}] })).targetInfos.find(t => t.type === 'page' && t.url === `chrome-extension://${extension.id}/popup.html`), 'native action target');
  popup = await attach(target.targetId);
  await popup.send('Runtime.enable');
  await waitFor(() => evaluate("Boolean(performance.getEntriesByName('solver-ready').length)"), 'popup initialization');
}
async function close() {
  await popup.detach();
  await cdp.send('Target.closeTarget', { targetId: target.targetId });
  await waitFor(async () => !(await cdp.send('Target.getTargets')).targetInfos.some(t => t.targetId === target.targetId), 'popup closes');
  // Opera clears its action-button pressed state after the target is destroyed.
  // Allow that native UI teardown to finish before a new action invocation.
  await new Promise(resolve => setTimeout(resolve, 300));
}
async function key(key) {
  const params = { key, ...(key === 'Enter' ? { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' } : key.length === 1 ? { text: key, unmodifiedText: key } : {}) };
  await popup.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await popup.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...(key === 'Enter' ? { code: 'Enter', windowsVirtualKeyCode: 13 } : {}) });
}
async function focus(index) { await evaluate(`document.querySelectorAll('.hive input')[${index}].focus()`); }
async function fill(letters) {
  await evaluate(`(()=>{const inputs=[...document.querySelectorAll('.hive input')];for(const input of inputs){input.value='';input.dispatchEvent(new InputEvent('input',{bubbles:true}));}for(const [i,value] of [...${JSON.stringify(letters)}].entries()){inputs[i].value=value;inputs[i].dispatchEvent(new InputEvent('input',{bubbles:true}));}})()`);
}
async function matches() { return evaluate("[...document.querySelectorAll('#words .word')].map(e=>e.textContent)"); }
async function shot(file) {
  // A native popup's DOM can be ready before Opera's compositor has a surface.
  // Retry only capture failures; functional assertions are never retried here.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { data } = await popup.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(`${evidence}/${file}.png`, Buffer.from(data, 'base64'));
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}
async function check(label, action) { await action(); checks.push({ name: label, status: 'PASS' }); console.log(`PASS ${name}: ${label}`); }
const storage = '(globalThis.browser ?? globalThis.chrome).storage.local';
const puzzleKey = 'spellingBeeSolver.puzzle.v1';
const cellValues = () => evaluate("[...document.querySelectorAll('.hive input')].map(e=>e.value)");
async function saved(cells) {
  await waitFor(async () => {
    const data = await evaluate(`${storage}.get(null)`);
    const record = data[puzzleKey];
    // Browser serialization can reorder object keys; compare the actual schema
    // and positional array rather than JSON property insertion order.
    return cells.some(Boolean) ? Object.keys(data).length === 1 && record?.version === 1 && Object.keys(record).length === 2 && JSON.stringify(record.cells) === JSON.stringify(cells) : Object.keys(data).length === 0;
  }, 'latest minimal local puzzle state');
}
async function expectPuzzle(cells) {
  assert.deepEqual(await cellValues(), cells);
  const expected = cells.every(Boolean) ? oracle(cells.join('').toLowerCase()) : [];
  assert.deepEqual(await matches(), expected);
  assert.equal(Number(await evaluate("document.querySelector('#word-count').textContent")), expected.length);
  const actualPangrams = await evaluate("[...document.querySelectorAll('#words li')].filter(e=>e.querySelector('.pangram')).map(e=>e.querySelector('.word').textContent)");
  assert.deepEqual(actualPangrams, expected.filter(word => cells.every(c => word.includes(c.toLowerCase()))));
}
async function clickReset() { await evaluate("document.querySelector('#reset').click()", true); }
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BROWSER_EXECUTABLE || executables[name], headless: false, viewport: null,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--window-size=1100,820', '--no-first-run'],
  });
  cdp = await context.browser().newBrowserCDPSession();
  const installed = (await cdp.send('Extensions.getExtensions')).extensions.find(item => item.path === at('dist/chromium') && item.enabled);
  extension = installed ? { id: installed.id } : await cdp.send('Extensions.loadUnpacked', { path: at('dist/chromium') });
  const host = await context.newPage();
  await host.setContent(`<title>Spelling Bee Solver native QA ${name}</title><h1>Local QA host</h1>`);
  hostTab = (await cdp.send('Target.getTargets', { filter: [{}] })).targetInfos.find(t => t.type === 'tab' && t.title === `Spelling Bee Solver native QA ${name}`);
  assert.ok(hostTab, 'Native host tab target is required.');
}

try {
  await launch();
  report.version = context.browser().version();
  report.product = await cdp.send('Browser.getVersion');
  await check('Unpacked extension installs and is enabled', async () => {
    const { extensions } = await cdp.send('Extensions.getExtensions');
    assert.ok(extensions.some(e => e.id === extension.id && e.enabled && e.name === 'Spelling Bee Solver'));
  });
  await open();
  await check('Real native toolbar action popup opens, not an ordinary extension tab', async () => {
    let ordinaryWindow = true;
    try { await cdp.send('Browser.getWindowForTarget', { targetId: target.targetId }); }
    catch { ordinaryWindow = false; }
    assert.equal(ordinaryWindow, false, 'Action target must not belong to an ordinary tab window.');
    report.nativeTarget = { type: target.type, url: target.url, method: 'Extensions.triggerAction on real browser tab; no page.goto(popup.html)' };
  });
  await check('Popup fits its actual viewport, with all honeycomb cells and footer visible', async () => {
    const metrics = await evaluate(`(()=>{const footer=document.querySelector('footer').getBoundingClientRect();return {width:innerWidth,height:innerHeight,bodyWidth:document.body.scrollWidth,bodyHeight:document.body.getBoundingClientRect().height,documentHeight:document.scrollingElement.scrollHeight,footerBottom:footer.bottom,required:[...document.querySelectorAll('header,.hive,#reset,#hive-help,.results-title,#results-scroll,.dictionary-note,.website-prompt,.attribution')].map(e=>{const r=e.getBoundingClientRect();return {name:e.id||e.className||e.tagName,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),cells:[...document.querySelectorAll('.cell')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};})()`);
    assert.ok(metrics.width >= 320 && metrics.width <= 400, JSON.stringify(metrics));
    assert.ok(metrics.height<=600 && metrics.documentHeight<=metrics.height+1, JSON.stringify(metrics));
    assert.ok(metrics.bodyWidth <= metrics.width && metrics.bodyHeight <= metrics.height + 1 && metrics.footerBottom <= metrics.height + 1, JSON.stringify(metrics));
    assert.equal(metrics.cells.length, 7);
    assert.ok(metrics.cells.every(r => r.left >= 0 && r.right <= metrics.width && r.top >= 0 && r.bottom <= metrics.height));
    assert.ok(metrics.required.every(r=>r.left>=0 && r.right<=metrics.width && r.top>=0 && r.bottom<=metrics.height), JSON.stringify(metrics.required));
    report.dimensions = metrics; await shot('initial');
  });
  await check('Center autofocus and accessible input names are present', async () => {
    assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /Center/);
    assert.equal((await evaluate("[...document.querySelectorAll('.hive input')].map(e=>e.getAttribute('aria-label'))")).filter(Boolean).length, 7);
    assert.equal(await evaluate("document.querySelector('#word-count').textContent"), '0');
    if (corrective) assert.deepEqual(await evaluate(`${storage}.get(null)`), {});
  });
  await check('FINAL UI: full approved bee and title are centered together, with centered exact subtitle', async () => {
    const header = await evaluate(`(()=>{
      const image=document.querySelector('.brand-mark'),title=document.querySelector('h1'),subtitle=document.querySelector('.subtitle');
      const icon=image.getBoundingClientRect(),heading=title.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(subtitle);
      return {title:title.textContent,subtitle:subtitle.textContent,groupCenter:(icon.left+heading.right)/2,viewportCenter:innerWidth/2,gap:heading.left-icon.right,
        subtitleCenters:[...range.getClientRects()].map(r=>(r.left+r.right)/2),subtitleAlign:getComputedStyle(subtitle).textAlign,
        source:image.getAttribute('src'),natural:[image.naturalWidth,image.naturalHeight],display:[icon.width,icon.height],alt:image.alt,hidden:image.getAttribute('aria-hidden'),
        interactive:!!image.closest('a,button,[role="button"],[tabindex]'),images:document.images.length,headings:document.querySelectorAll('h1').length};})()`);
    assert.equal(header.title, 'Spelling Bee Solver');
    assert.equal(header.subtitle, 'Enter 7 letters to find matching words instantly.');
    assert.ok(Math.abs(header.groupCenter-header.viewportCenter)<=1, JSON.stringify(header));
    assert.ok(header.gap>=4 && header.gap<=10);
    assert.equal(header.subtitleAlign,'center');
    assert.ok(header.subtitleCenters.length>0 && header.subtitleCenters.every(center=>Math.abs(center-header.viewportCenter)<=1), JSON.stringify(header));
    assert.equal(header.source,'icons/icon-128.png'); assert.deepEqual(header.natural,[128,128]); assert.deepEqual(header.display,[32,32]);
    assert.equal(header.alt,''); assert.equal(header.hidden,'true'); assert.equal(header.interactive,false);
    assert.equal(header.images,1); assert.equal(header.headings,1);
    report.headerLayout=header;
  });
  await check('FINAL UI: the sole Reset is centered directly below the hive, before its note, with a static refresh SVG', async () => {
    const reset = await evaluate(`(()=>{
      const button=document.querySelector('#reset'),hive=document.querySelector('.hive'),help=document.querySelector('#hive-help'),icon=button.querySelector('svg');
      const b=button.getBoundingClientRect(),h=hive.getBoundingClientRect(),n=help.getBoundingClientRect(),i=icon.getBoundingClientRect();
      return {buttons:document.querySelectorAll('button').length,text:button.textContent,center:(b.left+b.right)/2,hiveCenter:(h.left+h.right)/2,gap:b.top-h.bottom,
        height:b.height,width:b.width,beforeNote:b.bottom<=n.top,captionChildren:[...document.querySelector('.results-title').children].map(e=>e.id),
        oldReset:document.querySelectorAll('.results-title button').length,iconBeforeText:i.right<=button.querySelector('span').getBoundingClientRect().left,
        iconSize:[i.width,i.height],decorative:icon.getAttribute('aria-hidden'),animation:getComputedStyle(icon).animationName};})()`);
    assert.equal(reset.buttons,1); assert.equal(reset.text,'Reset'); assert.equal(reset.oldReset,0);
    assert.ok(Math.abs(reset.center-reset.hiveCenter)<=1 && reset.gap>=0 && reset.gap<=8, JSON.stringify(reset));
    assert.ok(reset.height>=28 && reset.height<=32 && reset.width<90); assert.equal(reset.beforeNote,true);
    assert.deepEqual(reset.captionChildren,['results-heading','word-count']); assert.equal(reset.iconBeforeText,true);
    assert.deepEqual(reset.iconSize,[13,13]); assert.equal(reset.decorative,'true'); assert.equal(reset.animation,'none');
    report.resetLayout=reset;
  });
  await check('Native keyboard input uppercases, advances and solves automatically', async () => {
    for (const letter of 'coating') await key(letter);
    assert.equal(await evaluate("[...document.querySelectorAll('.hive input')].map(e=>e.value).join('')"), 'COATING');
    assert.deepEqual(await matches(), oracle('coating'));
  });
  await check('Count, center membership, minimum length, deduplication and pangrams are exact', async () => {
    const words = await matches();
    assert.equal(Number(await evaluate("document.querySelector('#word-count').textContent")), words.length);
    assert.ok(words.every(w => w.includes('c') && w.length >= 4));
    assert.equal(new Set(words).size, words.length);
    const rows = await evaluate("[...document.querySelectorAll('#words li')].map(e=>({word:e.querySelector('.word').textContent,pangram:!!e.querySelector('.pangram')}))");
    for (const row of rows) assert.equal(row.pangram, [...'coating'].every(c => row.word.includes(c)));
    assert.ok(rows.some(r => r.word === 'coating' && r.pangram));
    report.samplePuzzle = { center: 'C', outer: 'O A T I N G', words: words.length, pangrams: rows.filter(r => r.pangram).map(r => r.word) };
  });
  await check('FINAL UI: Tab reaches Reset with visible focus; Enter clears storage and returns focus to the center', async () => {
    await focus(6); await key('Tab');
    const focusStyle=await evaluate(`(()=>{const b=document.activeElement,s=getComputedStyle(b);return {id:b.id,visible:b.matches(':focus-visible'),outline:s.outlineStyle,width:s.outlineWidth};})()`);
    assert.equal(focusStyle.id,'reset'); assert.equal(focusStyle.visible,true);
    assert.equal(focusStyle.outline,'solid'); assert.ok(parseFloat(focusStyle.width)>=1.5, 'Visible outline after device-pixel rounding');
    await shot('reset-focused');
    await key('Enter'); await expectPuzzle(Array(7).fill('')); await saved(Array(7).fill(''));
    assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /Center/);
    await fill('coating'); await saved([...'COATING']);
    report.resetKeyboard=focusStyle;
  });
  await check('Duplicate and invalid native key edits are rejected clearly', async () => {
    await focus(0); await key('o');
    assert.equal(await evaluate("document.querySelector('.center input').value"), 'C');
    assert.match(await evaluate("document.querySelector('#input-error').textContent"), /already/);
    await key('1'); assert.match(await evaluate("document.querySelector('#input-error').textContent"), /English/);
  });
  await check('Arrow and Tab navigation, replacement and Delete work in the action popup', async () => {
    await key('ArrowUp'); assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /Outer letter 1/);
    await key('Tab'); assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /Outer letter 2/);
    await focus(6); await key('h'); assert.deepEqual(await matches(), oracle('coatinh'));
    await key('Delete'); assert.equal((await matches()).length, 0);
    assert.equal(await evaluate("document.querySelector('#progress').textContent"), '6 of 7 letters');
  });
  await check('Backspace removes a predecessor from an empty cell', async () => {
    await key('Backspace'); assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /Outer letter 5/);
    assert.equal(await evaluate('document.activeElement.value'), '');
  });
  await check('Zero matches and repeated letters within real words work', async () => {
    await fill('qxzjkvb'); assert.deepEqual(await matches(), []);
    assert.match(await evaluate("document.querySelector('#empty-state').textContent"), /No matching words/);
    await fill('anbdome'); assert.ok((await matches()).includes('banana'));
  });
  await check('Results scroll independently; footer remains visible', async () => {
    await fill('coating');
    const scroll = await evaluate("(()=>{const e=document.querySelector('#results-scroll');e.scrollTop=e.scrollHeight;return {top:e.scrollTop,overflow:e.scrollHeight>e.clientHeight,bodyTop:document.scrollingElement.scrollTop};})()");
    assert.ok(scroll.overflow && scroll.top > 0); assert.equal(scroll.bodyTop, 0);
    await evaluate("[...document.querySelectorAll('#words li')].find(e=>e.querySelector('.word').textContent==='coating').scrollIntoView({block:'center'})");
    await shot('matches');
  });
  await check('Exactly one approved anchor and non-interactive Powered By text', async () => {
    const footer = await evaluate("(()=>{const a=document.querySelector('a'),p=document.querySelector('.attribution'),cta=document.querySelector('.website-prompt');return {anchors:document.querySelectorAll('a').length,url:a.href,target:a.target,rel:a.rel,text:a.textContent,prompt:cta.textContent,plain:cta.firstChild.textContent,powered:p.textContent,handler:p.onclick,linked:!!p.closest('a,button,[role=button],[tabindex]')};})()");
    assert.deepEqual(footer, { anchors: 1, url: 'https://spellingbeeanswers.app/', target: '_blank', rel: 'noopener noreferrer', text: 'Try our FREE solver!', prompt:'Need hints, more dictionaries, filters or custom rules? Try our FREE solver!', plain:'Need hints, more dictionaries, filters or custom rules? ', powered: 'Powered By spellingbeeanswers.app', handler: null, linked: false });
    report.footer=footer;
  });
  await check('CSP blocks inline script insertion and outgoing fetch', async () => {
    await evaluate("globalThis.__qaCspViolations=[];document.addEventListener('securitypolicyviolation',e=>globalThis.__qaCspViolations.push({directive:e.effectiveDirective,blockedURI:e.blockedURI}))");
    assert.equal(await evaluate("(()=>{const e=document.createElement('script');e.textContent='globalThis.__untrustedInlineRan=true';document.body.append(e);return globalThis.__untrustedInlineRan===true;})()"), false);
    assert.equal(await evaluate("fetch('https://invalid.example/qa-csp-probe').then(()=>false,()=>true)"), true);
    await waitFor(() => evaluate("globalThis.__qaCspViolations.some(e=>e.directive==='connect-src') && globalThis.__qaCspViolations.some(e=>e.directive.startsWith('script-src')&&e.blockedURI==='inline')"), 'explicit script/connect CSP violations');
    report.cspViolations = await evaluate('globalThis.__qaCspViolations');
  });
  await check('Closing/reopening restores letters, results and center focus', async () => {
    await close(); await open();
    assert.equal(await evaluate("[...document.querySelectorAll('.hive input')].map(e=>e.value).join('')"), 'COATING');
    assert.deepEqual(await matches(), oracle('coating'));
    assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /Center/);
  });
  await check('The real popup initializes and solves after offline reopening', async () => {
    await context.setOffline(true); await close(); await open();
    await fill('coating'); assert.deepEqual(await matches(), oracle('coating'));
    await context.setOffline(false);
  });
  if (corrective) {
    await check('CORRECTIVE: ten native popup closures restore every letter, word, count and pangram', async () => {
      for (let i = 0; i < 10; i++) { await close(); await open(); await expectPuzzle([...'COATING']); }
      report.repeatReopens = 10;
    });
    await check('CORRECTIVE: a full browser restart with the identical persistent profile restores the puzzle', async () => {
      await saved([...'COATING']); await context.close(); await launch(); await open();
      await expectPuzzle([...'COATING']);
      report.browserRestart = { completed: true, sameProfile: profile, wholeBrowserClosedAndRelaunched: true };
    });
    await check('CORRECTIVE: outer-letter editing survives closing and reopening', async () => {
      await focus(6); await key('h'); await close(); await open(); await expectPuzzle([...'COATINH']);
    });
    await check('CORRECTIVE: changing the mandatory center survives closing and reopening', async () => {
      await focus(0); await key('b'); await close(); await open(); await expectPuzzle([...'BOATINH']);
    });
    await check('CORRECTIVE: partial puzzle positions survive reopening without showing premature matches', async () => {
      await clickReset(); for (const letter of 'coa') await key(letter);
      await close(); await open(); await expectPuzzle(['C', 'O', 'A', '', '', '', '']);
      await shot('partial-restored');
    });
    await check('CORRECTIVE: Reset clears complete puzzle, results, badges, saved state and restores center focus', async () => {
      await fill('coating'); await saved([...'COATING']); await clickReset();
      await expectPuzzle(Array(7).fill('')); await saved(Array(7).fill(''));
      assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /Center/);
      await close(); await open(); await expectPuzzle(Array(7).fill(''));
      await shot('reset-empty');
    });
    await check('CORRECTIVE: resetting a partial puzzle prevents its return on reopen', async () => {
      await fill(['C', '', 'A', '', '', 'N', '']); await clickReset();
      await close(); await open(); await expectPuzzle(Array(7).fill('')); await saved(Array(7).fill(''));
    });
    await check('CORRECTIVE: rapid edits/deletions and immediate popup closing preserve only the latest state', async () => {
      for (let i = 0; i < 20; i++) { await fill(i % 2 ? 'coatinh' : 'coating'); }
      await fill('coating'); await close(); await open(); await expectPuzzle([...'COATING']); await saved([...'COATING']);
    });
    await check('CORRECTIVE: a delayed storage reply followed by Reset cannot resurrect an old puzzle', async () => {
      await evaluate(`(()=>{const area=${storage},original=area.set.bind(area);globalThis.__restoreStorageSet=()=>{area.set=original;};area.set=items=>{const pending=original(items);return new Promise((resolve,reject)=>setTimeout(()=>pending.then(resolve,reject),400));};})()`);
      await fill('coating'); await clickReset(); await expectPuzzle(Array(7).fill('')); await saved(Array(7).fill(''));
      await evaluate('globalThis.__restoreStorageSet()'); await close(); await open(); await expectPuzzle(Array(7).fill(''));
    });
    await check('CORRECTIVE: Reset and immediate teardown while a write reply is delayed stays cleared', async () => {
      await evaluate(`(()=>{const area=${storage},original=area.set.bind(area);area.set=items=>{const pending=original(items);return new Promise((resolve,reject)=>setTimeout(()=>pending.then(resolve,reject),800));};})()`);
      await fill('coating'); await clickReset(); await close(); await open();
      await expectPuzzle(Array(7).fill('')); await saved(Array(7).fill(''));
    });
    await check('CORRECTIVE: corrupt/incompatible saved data is discarded safely on opening', async () => {
      await evaluate(`${storage}.set({${JSON.stringify(puzzleKey)}:{version:999,cells:['X'],answers:['fabricated']}})`);
      await close(); await open(); await expectPuzzle(Array(7).fill('')); await saved(Array(7).fill(''));
    });
    await check('CORRECTIVE: rejected storage writes show a notice while the visible puzzle continues solving', async () => {
      await evaluate(`(()=>{const area=${storage},original=area.set.bind(area);globalThis.__restoreStorageSet=()=>{area.set=original;};area.set=()=>Promise.reject(new Error('Simulated storage unavailability'));})()`);
      await fill('coating'); await expectPuzzle([...'COATING']);
      await waitFor(() => evaluate("document.querySelector('#input-error').textContent.includes('Local saving is unavailable')"), 'storage error notice');
      await evaluate('globalThis.__restoreStorageSet()'); await clickReset(); await saved(Array(7).fill(''));
    });
    await check('CORRECTIVE: restored letters and regenerated matches work entirely offline', async () => {
      await fill('coating'); await saved([...'COATING']); await context.setOffline(true);
      await close(); await open(); await expectPuzzle([...'COATING']); await context.setOffline(false);
      await shot('saved-results');
    });
    await check('CORRECTIVE: only one minimal letters/version record is retained locally', async () => {
      const data = await evaluate(`${storage}.get(null)`);
      assert.deepEqual(data, { [puzzleKey]: { version: 1, cells: [...'COATING'] } });
      report.storedData = data; report.storedJSONBytes = Buffer.byteLength(JSON.stringify(data));
    });
    await check('CORRECTIVE: attribution is deep black on a light surface and Reset is the sole button', async () => {
      const ui = await evaluate("(()=>{const p=document.querySelector('.attribution');return {color:getComputedStyle(p).color,weight:getComputedStyle(p).fontWeight,background:getComputedStyle(document.querySelector('footer')).backgroundColor,buttons:[...document.querySelectorAll('button')].map(e=>e.textContent),links:document.querySelectorAll('a').length};})()");
      assert.equal(ui.color, 'rgb(11, 11, 11)'); assert.equal(ui.weight, '400');
      assert.equal(ui.background, 'rgb(252, 252, 249)'); assert.deepEqual(ui.buttons, ['Reset']); assert.equal(ui.links, 1);
      report.correctiveAppearance = ui;
    });
    await check('CORRECTIVE: live manifest requests only storage and all four bee icons load locally', async () => {
      const manifest = await evaluate('(globalThis.browser ?? globalThis.chrome).runtime.getManifest()');
      assert.deepEqual(manifest.permissions, ['storage']); assert.equal(manifest.version, packageVersion);
      for (const size of [16, 32, 48, 128]) {
        assert.equal(manifest.icons[size], `icons/icon-${size}.png`);
        const dimensions = await evaluate(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=reject;image.src=(globalThis.browser??globalThis.chrome).runtime.getURL('icons/icon-${size}.png');})`);
        assert.deepEqual(dimensions, [size, size]);
      }
    });
  }
  await check('Attribution click does nothing; approved CTA opens a tab only when clicked', async () => {
    await context.route('https://spellingbeeanswers.app/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Local intercepted CTA</title>' }));
    const before = context.pages().length;
    await evaluate("document.querySelector('.attribution').click()", true);
    assert.equal(context.pages().length, before);
    const next = context.waitForEvent('page');
    await evaluate("document.querySelector('a').click()", true);
    const destination = await next; await destination.waitForLoadState();
    assert.equal(destination.url(), 'https://spellingbeeanswers.app/');
    assert.equal(await destination.evaluate(() => window.opener), null);
    await destination.close();
  });
  await check('No unexpected JavaScript exceptions', async () => assert.deepEqual(exceptions, []));
  report.status = 'PASS';
} catch (error) {
  report.status = checks.length ? 'FAIL' : 'BLOCKED'; report.error = String(error);
  if (popup) await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  report.passed = checks.length;
  report.physicalToolbarIconClick = 'NOT TESTED: isolated automation windows are not exposed to the Windows desktop CUA surface. Real native action popup invoked by CDP; no claim of a physical mouse click or owner acceptance.';
  report.exceptions = exceptions;
  await save(`${evidence}/results.json`, report);
  await context?.close();
}
