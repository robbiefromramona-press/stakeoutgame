/* ==========================================================================
   STAKE-OUT smoke pass (Playwright, headless Chromium)
   --------------------------------------------------------------------------
   Checks that the game still WORKS -- not how it plays. Nothing here tunes or
   measures feel; it only proves every path still does its job:

     1. menu: level select and the BIPOD / POLE mode toggle
     2. BIPOD gate: panels, MEASURE locked, start gate clears
     3. movement, keyboard (WASD) and on-screen D-pad, both move the rod
     4. the bubble: joystick and vial both steer it
     5. POLE: MEASURE is live from the off; measuring every point of a level
        produces the field report, with one row per point
     6. CONTINUE goes to the next level (level switching); ESC aborts
     7. SAVE / QUIT opens the download modal; lol NO goes back to the menu
     8. (V12 only, skipped with --no-layers) every art layer, canvas and
        hotspot stays registered to the others at several window sizes and
        across a rotate

   There is no package.json in this repo (no build step), so install
   Playwright somewhere once and point NODE_PATH at it, or run from a folder
   that has it:
       npm install playwright && npx playwright install chromium
       python -m http.server 8123          (in the repo root)
       node tests/smoke.js http://127.0.0.1:8123/
   ========================================================================== */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const CHECK_LAYERS = process.argv.indexOf('--no-layers') < 0;

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

const readouts = (page) => page.evaluate(() =>
  ['roLeft', 'roRight', 'roTo', 'roAway'].map((id) => document.getElementById(id).textContent).join('|'));

// hold a pointer on a point inside an element, as a thumb would
async function holdAt(page, selector, fx, fy, ms) {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + box.width * fx, y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  const during = await page.locator(selector).evaluate((el) => el.classList.contains('is-down'));
  await page.mouse.up();
  return during;
}

async function tap(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });

  console.log('\n[1] menu');
  await page.click('.lvl2');
  check('level 2 selects', (await page.evaluate(() => StakeOutApp.getState().selectedLevel)) === 1);
  await page.click('.lvl1');
  check('level 1 selects', (await page.evaluate(() => StakeOutApp.getState().selectedLevel)) === 0);
  await page.selectOption('#modeSelect', 'pole');
  check('mode -> POLE', (await page.evaluate(() => StakeOutApp.getState().selectedMode)) === 'pole');
  await page.selectOption('#modeSelect', 'bipod');
  check('mode -> BIPOD', (await page.evaluate(() => StakeOutApp.getState().selectedMode)) === 'bipod');

  console.log('\n[2] BIPOD start');
  await page.click('#startBtn');
  check('player screen shows', (await page.evaluate(() => StakeOutApp.getState().currentScreen)) === 'player');
  check('start gate up', await page.isVisible('#startGate'));
  check('HUD reads level 1 point 1 of 3',
    (await page.textContent('#hudLevel')) === '1' && (await page.textContent('#hudPoint')) === '1' &&
    (await page.textContent('#hudTotal')) === '3');
  const bip = await page.evaluate(() => ({
    panel: StakeOutApp.game.activePanel,
    meas: Array.from(document.querySelectorAll('.tc-measure')).every((b) => b.disabled),
    posFrame: document.getElementById('framePos').className,
    bubFrame: document.getElementById('frameBub').className,
    stickOff: document.getElementById('stickBubble').classList.contains('is-off')
  }));
  check('BIPOD starts on the dial', bip.panel === 'pos', bip.panel);
  check('MEASURE locked in BIPOD', bip.meas);
  check('dial frame active, vial frame idle', /is-active/.test(bip.posFrame) && /is-idle/.test(bip.bubFrame));
  check('joystick dead while vial idle', bip.stickOff);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  check('SPACE clears the gate', !(await page.isVisible('#startGate')));

  console.log('\n[3] movement');
  await page.waitForTimeout(700);
  let before = await readouts(page);
  await page.keyboard.down('d'); await page.waitForTimeout(500); await page.keyboard.up('d');
  await page.waitForTimeout(900);             // Level 1 readout lag is 0.5 s
  let after = await readouts(page);
  check('keyboard D moves the rod', before !== after, before + '  ->  ' + after);
  // BIPOD: walk, let go, and control hands over to the bubble -- the D-pad
  // is dead until it is levelled. So the D-pad gets a fresh level of its own.
  const handed = await page.evaluate(() => ({
    panel: StakeOutApp.game.activePanel,
    dpadDead: Array.from(document.querySelectorAll('.tc-dir')).every((b) => b.disabled)
  }));
  check('BIPOD hands off to the bubble after walking', handed.panel === 'bub' && handed.dpadDead, JSON.stringify(handed));

  await page.evaluate(() => StakeOutApp.launch(0, 'bipod'));
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  before = await readouts(page);
  const heldLeft = await holdAt(page, '.dir-left', 0.18, 0.5, 500);
  await page.waitForTimeout(900);
  after = await readouts(page);
  check('D-pad LEFT lights while held', heldLeft);
  check('D-pad LEFT moves the rod', before !== after, before + '  ->  ' + after);
  await page.evaluate(() => StakeOutApp.launch(0, 'bipod'));
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  before = await readouts(page);
  const heldUp = await holdAt(page, '.dir-up', 0.5, 0.18, 400);
  await page.waitForTimeout(900);
  after = await readouts(page);
  check('D-pad UP lights and moves', heldUp && before !== after, before + '  ->  ' + after);
  await page.keyboard.press('Escape');
  check('ESC aborts to the menu', (await page.evaluate(() => StakeOutApp.getState().currentScreen)) === 'menu');

  console.log('\n[4]+[5] POLE: bubble controls, measure, report');
  await page.selectOption('#modeSelect', 'pole');
  await page.click('#startBtn');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const pole = await page.evaluate(() => ({
    panel: StakeOutApp.game.activePanel, meas: StakeOutApp.game.measureEnabled,
    btn: document.querySelector('.meas-l').disabled
  }));
  check('POLE runs both panels', pole.panel === 'both', pole.panel);
  check('MEASURE live in POLE', pole.meas && !pole.btn);

  // joystick: hold hard left; the bubble's resting point goes right (inverted)
  const off0 = await page.evaluate(() => StakeOutApp.game.bubbleOffsetPct);
  const box = await page.locator('#stickBubble').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  const stickDown = await page.locator('#stickBubble').evaluate((el) => el.classList.contains('is-down'));
  const offCentre = await page.evaluate(() => StakeOutApp.game.bubbleOffsetPct);
  await page.mouse.up();
  check('joystick takes the thumb', stickDown);
  check('joystick centred levels the bubble', offCentre < off0, off0.toFixed(1) + '% -> ' + offCentre.toFixed(1) + '%');

  // the vial: hover the centre of the glass, the bubble should settle in
  await page.waitForTimeout(1500);
  const vOff0 = await page.evaluate(() => StakeOutApp.game.bubbleOffsetPct);
  const vb = await page.locator('#bubbleCanvas').boundingBox();
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.waitForTimeout(1500);
  const vOff = await page.evaluate(() => StakeOutApp.game.bubbleOffsetPct);
  check('cursor on the vial steers the bubble', vOff < vOff0, vOff0.toFixed(1) + '% -> ' + vOff.toFixed(1) + '%');
  await page.mouse.move(5, 5);

  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(700);
    await tap(page, i % 2 ? '.meas-r' : '.meas-l');
    await page.waitForTimeout(150);
    const msg = await page.textContent('#shotMsg');
    check('MEASURE ' + (i % 2 ? 'right' : 'left') + ' logs point ' + (i + 1), /TOLERANCE/.test(msg), msg);
  }
  await page.waitForTimeout(1000);
  check('report screen after the last point', (await page.evaluate(() => StakeOutApp.getState().currentScreen)) === 'report');
  const rep = await page.evaluate(() => ({
    rows: StakeOutApp.getState().lastRound.rows.length,
    total: document.getElementById('sumTotal').textContent,
    filled: Array.from(document.querySelectorAll('.rep-row')).filter((r) => r.textContent.trim()).length,
    csv: StakeOutApp.buildCsv(StakeOutApp.getState().lastRound).trim().split('\n').length
  }));
  check('report has 3 rows', rep.rows === 3 && rep.total === '3' && rep.filled === 3, JSON.stringify(rep));
  check('CSV has header + 3 rows', rep.csv === 4, rep.csv);

  console.log('\n[6] level switching');
  await page.click('#continueBtn');
  await page.waitForTimeout(200);
  check('CONTINUE starts level 2', (await page.textContent('#hudLevel')) === '2' &&
    (await page.textContent('#hudTotal')) === '4');
  check('still in POLE', (await page.evaluate(() => StakeOutApp.game.activePanel)) === 'both');

  console.log('\n[7] save / quit');
  await page.evaluate(() => StakeOutApp.showScreen('report'));
  await page.click('#saveQuitBtn');
  check('download modal opens', await page.isVisible('#dlOverlay'));
  await page.click('#dlNo');
  check('lol NO -> menu, modal closed',
    (await page.evaluate(() => StakeOutApp.getState().currentScreen)) === 'menu' && !(await page.isVisible('#dlOverlay')));

  if (CHECK_LAYERS) {
    console.log('\n[8] layer registration across sizes');
    // pairs that must sit exactly on top of each other: [a, b, what]
    const PAIRS = [
      ['.dir-up', '#artPadL', 'D-pad hotspot on pad art'],
      ['#stickBubble', '#artPadR', 'joystick on pad art'],
      ['.meas-l', '#artMeasL', 'left MEASURE on art'],
      ['.meas-r', '#artMeasR', 'right MEASURE on art']
    ];
    const CENTRES = [
      ['#posCanvas', '#dialFace', 'dial canvas centred on dial face'],
      ['#bubbleCanvas', '#vialFace', 'vial canvas centred on vial face']
    ];
    const sizes = [[1600, 900], [1280, 1024], [844, 390], [667, 375], [390, 844], [2560, 1080]];
    await page.selectOption('#modeSelect', 'bipod');
    await page.click('#startBtn');
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      const r = await page.evaluate(([pairs, centres]) => {
        const R = (s) => document.querySelector(s).getBoundingClientRect();
        const stage = R('#playerStage');
        const out = { stageW: stage.width, stageH: stage.height, fits: stage.right <= innerWidth + 0.5 && stage.bottom <= innerHeight + 0.5 };
        out.pairs = pairs.map(([a, b, n]) => {
          const A = R(a), B = R(b);
          return [n, Math.max(Math.abs(A.left - B.left), Math.abs(A.top - B.top), Math.abs(A.width - B.width), Math.abs(A.height - B.height))];
        });
        out.centres = centres.map(([a, b, n]) => {
          const A = R(a), B = R(b);
          return [n, Math.hypot(A.left + A.width / 2 - B.left - B.width / 2, A.top + A.height / 2 - B.top - B.height / 2)];
        });
        // every art layer must stay inside the stage
        out.inside = Array.from(document.querySelectorAll('#playerStage .layer')).every((el) => {
          const b = el.getBoundingClientRect();
          return b.left >= stage.left - 1 && b.right <= stage.right + 1 && b.top >= stage.top - 1 && b.bottom <= stage.bottom + 1;
        });
        return out;
      }, [PAIRS, CENTRES]);
      const tag = w + 'x' + h;
      // tolerance: 1 CSS px, or 0.2% of the stage for rounding on big screens
      const tol = Math.max(1, r.stageW * 0.002);
      r.pairs.forEach(([n, d]) => check(tag + ' ' + n, d <= tol, d.toFixed(2) + 'px'));
      r.centres.forEach(([n, d]) => check(tag + ' ' + n, d <= tol * 3, d.toFixed(2) + 'px'));
      check(tag + ' stage fits the window (' + Math.round(r.stageW) + 'x' + Math.round(r.stageH) + ')', r.fits);
      check(tag + ' all layers inside the stage', r.inside);
    }
    // the LCD canvases re-fit their bitmaps after a rotate
    const lcd = await page.evaluate(() => {
      const c = document.getElementById('lcdCanvas'), b = c.getBoundingClientRect();
      return Math.abs(c.width - Math.round(b.width * Math.min(devicePixelRatio, 3)));
    });
    check('clock canvas re-fitted after the last resize', lcd <= 1, lcd);
  }

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
