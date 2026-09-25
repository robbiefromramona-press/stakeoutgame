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
     9. (V12.5) the dial is the right way round -- the crosshair painted at the
        centre of the face is the rod, and the blurred blob is the point, on
        the side the point actually lies -- plus the hold-distance curve and
        the halved POLE idle drift

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

  console.log('\n[9] V12.5 mechanics');
  /* (a) the dial is the right way round. It is a plan view centred on the rod:
     the crosshair painted at the centre of the face is the pole and never
     moves, and the blurred blob is the point, on the side of the crosshair the
     point actually lies. Point ahead of you -> blob at the TOP of the dial and
     the top triangle lit; walk towards it and the blob comes down to meet the
     crosshair. Up to V12 the blob sat on the opposite side. */
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => StakeOutApp.launch(0, 'pole'));
  await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  const centre = { cx: 214, cy: 214 };   // POS_GAUGE
  const rod0 = await page.evaluate(() => StakeOutApp.game.rodOffsetFt);
  const blob0 = await page.evaluate(() => StakeOutApp.game.pointBlobXY);
  // rodOffsetFt is the rod's offset FROM the point, so a positive y means the
  // point is north of you, the top triangle lights, and the blob belongs ABOVE
  // the centre of the dial -- and likewise for x
  check('the blob is on the same side as the point, north/south',
    Math.sign(blob0.y - centre.cy) === -Math.sign(rod0.y),
    'rod y ' + rod0.y.toFixed(2) + ' ft, blob y ' + blob0.y.toFixed(1));
  check('the blob is on the same side as the point, east/west',
    Math.sign(blob0.x - centre.cx) === -Math.sign(rod0.x),
    'rod x ' + rod0.x.toFixed(2) + ' ft, blob x ' + blob0.x.toFixed(1));
  // the lit triangles say which way to walk; the blob must agree with them
  const tri = await page.evaluate(() => {
    const r = StakeOutApp.game.rodOffsetFt;
    return { up: r.y > 0.03, down: r.y < -0.03, left: r.x > 0.03, right: r.x < -0.03 };
  });
  check('the blob agrees with the lit triangle',
    (!tri.up || blob0.y < centre.cy) && (!tri.down || blob0.y > centre.cy) &&
    (!tri.left || blob0.x < centre.cx) && (!tri.right || blob0.x > centre.cx),
    JSON.stringify(tri) + ' blob ' + blob0.x.toFixed(0) + ',' + blob0.y.toFixed(0));

  /* Which way the blob travels. Walking north lowers the rod's northing, so
     the blob comes DOWN the face; walking west sends it RIGHT. That holds
     wherever you are, including walking straight past the point, which is why
     it is asserted here rather than "the blob got closer" -- a walk that
     overshoots would fail that while behaving perfectly. */
  async function blobAfter(key, ms) {
    const a = await page.evaluate(() => StakeOutApp.game.pointBlobXY);
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(900);      // let the reading land
    const b = await page.evaluate(() => StakeOutApp.game.pointBlobXY);
    return { a: a, b: b };
  }
  const nS = await blobAfter('w', 600);
  check('walking north brings the blob down the dial', nS.b.y > nS.a.y + 0.05,
    'y ' + nS.a.y.toFixed(2) + ' -> ' + nS.b.y.toFixed(2));
  const eW = await blobAfter('a', 600);
  check('walking west sends the blob right across the dial', eW.b.x > eW.a.x + 0.05,
    'x ' + eW.a.x.toFixed(2) + ' -> ' + eW.b.x.toFixed(2));

  /* And the thing that matters in play: walk towards the point and the blob
     closes on the crosshair while the reading shrinks. Done on whichever axis
     we are furthest out on, and only when there is room to walk without
     sailing past it. */
  const rodN = await page.evaluate(() => StakeOutApp.game.rodOffsetFt);
  const useY = Math.abs(rodN.y) >= Math.abs(rodN.x);
  const gap = useY ? rodN.y : rodN.x;
  if (Math.abs(gap) > 2) {
    const key = useY ? (gap > 0 ? 'w' : 's') : (gap > 0 ? 'a' : 'd');
    const blobB = await page.evaluate(() => StakeOutApp.game.pointBlobXY);
    const walk = await blobAfter(key, 1000);           // about 1 ft
    const rodAfter = await page.evaluate(() => StakeOutApp.game.rodOffsetFt);
    const was = Math.abs(gap);
    const now = Math.abs(useY ? rodAfter.y : rodAfter.x);
    const dWas = Math.abs((useY ? blobB.y - centre.cy : blobB.x - centre.cx));
    const dNow = Math.abs((useY ? walk.b.y - centre.cy : walk.b.x - centre.cx));
    check('walking towards the point shortens the reading', now < was - 0.3,
      was.toFixed(2) + ' -> ' + now.toFixed(2) + ' ft on ' + (useY ? 'TO/AWAY' : 'LEFT/RIGHT'));
    check('walking towards the point brings the blob towards the crosshair',
      dNow < dWas - 0.5,
      'from centre ' + dWas.toFixed(1) + ' -> ' + dNow.toFixed(1) + ' units');
  } else {
    check('walking towards the point shortens the reading', true, 'skipped: started on the point');
    check('walking towards the point brings the blob towards the crosshair', true, 'skipped');
  }

  // and nothing is drawn at the centre of the face: the crosshair there is the
  // dial's own art, and the blob is out where the point is
  const glow = await page.evaluate(() => {
    const c = document.getElementById('posCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sx = 0, sy = 0, sw = 0;
    // only the dial face, inside r=110 units: the direction triangles live out
    // at ~144 units and, being lit on some sides and dark on others, would drag
    // the centroid off centre all by themselves
    const cx = 214 * 2, cy = 214 * 2, lim = 110 * 2;
    for (let y = 0; y < c.height; y += 4) {
      for (let x = 0; x < c.width; x += 4) {
        if (Math.hypot(x - cx, y - cy) > lim) continue;
        const i = (y * c.width + x) * 4;
        const a = d[i + 3];
        if (a < 40) continue;
        const w = a * a;
        sx += x * w; sy += y * w; sw += w;
      }
    }
    return sw ? { x: sx / sw / 2, y: sy / sw / 2 } : null;
  });
  const blobNow = await page.evaluate(() => StakeOutApp.game.pointBlobXY);
  check('what is painted on the face is the blob, where the point is',
    glow && Math.hypot(glow.x - blobNow.x, glow.y - blobNow.y) < 26,
    glow ? 'centroid ' + glow.x.toFixed(0) + ',' + glow.y.toFixed(0) +
      ' vs blob ' + blobNow.x.toFixed(0) + ',' + blobNow.y.toFixed(0) : 'nothing drawn');

  /* (b) the hold curve: distance goes with the square of the hold. */
  async function holdFor(ms) {
    await page.evaluate(() => StakeOutApp.launch(0, 'pole'));
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
    const a = await page.evaluate(() => StakeOutApp.game.rodOffsetFt);
    await page.keyboard.down('d');
    await page.waitForTimeout(ms);
    await page.keyboard.up('d');
    const b = await page.evaluate(() => StakeOutApp.game.rodOffsetFt);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  const tapDist = await holdFor(80);
  const halfDist = await holdFor(500);
  const fullDist = await holdFor(1000);
  check('a quick tap moves 0.004-0.020 ft', tapDist >= 0.004 && tapDist <= 0.020, tapDist.toFixed(4) + ' ft');
  check('a 0.5 s hold moves 0.18-0.42 ft', halfDist >= 0.18 && halfDist <= 0.42, halfDist.toFixed(3) + ' ft');
  check('a 1.0 s hold moves 0.80-1.25 ft', fullDist >= 0.80 && fullDist <= 1.25, fullDist.toFixed(3) + ' ft');
  check('the curve accelerates (1 s is well over 2x 0.5 s)', fullDist > halfDist * 2.5,
    halfDist.toFixed(3) + ' -> ' + fullDist.toFixed(3));

  /* (c) POLE idle drift is capped at half of what V11/V12 allowed, and BIPOD
     still does not drift at all. */
  async function idleDrift(mode, seconds) {
    await page.evaluate((m) => StakeOutApp.launch(0, m), mode);
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    const a = await page.evaluate(() => StakeOutApp.game.rodOffsetFt);
    await page.waitForTimeout(seconds * 1000);
    const b = await page.evaluate(() => StakeOutApp.game.rodOffsetFt);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  const poleDrift = await idleDrift('pole', 4);
  const bipodDrift = await idleDrift('bipod', 4);
  check('POLE idle drift stays inside the halved 0.050 ft cap',
    poleDrift > 0 && poleDrift <= 0.055, poleDrift.toFixed(4) + ' ft in 4 s');
  check('BIPOD still does not drift at all', bipodDrift < 0.0005, bipodDrift.toFixed(5) + ' ft in 4 s');

  console.log('\n[10] V12.5a quit plate and readout order');
  await page.evaluate(() => StakeOutApp.launch(0, 'bipod'));
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  // the plate sits on the painted logo at the bottom of the bezel
  const plate = await page.evaluate(() => {
    const a = document.getElementById('quitPlate').getBoundingClientRect();
    const b = document.querySelector('.layer-logo-bottom').getBoundingClientRect();
    return Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top),
                    Math.abs(a.width - b.width), Math.abs(a.height - b.height));
  });
  check('the quit plate sits on the painted logo', plate <= 1, plate.toFixed(2) + 'px');
  await tap(page, '#quitPlate');
  check('tapping the plate quits to the menu',
    (await page.evaluate(() => StakeOutApp.getState().currentScreen)) === 'menu');
  check('the level stopped when it quit',
    (await page.evaluate(() => StakeOutApp.game.isActive)) === false);
  // and it must not have logged a shot on the way out
  await page.evaluate(() => StakeOutApp.launch(0, 'pole'));
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  await tap(page, '#quitPlate');
  await page.waitForTimeout(200);
  check('quitting does not fire a measurement',
    (await page.evaluate(() => StakeOutApp.getState().currentScreen)) === 'menu' &&
    (await page.textContent('#hudPoint')) === '1');

  // TO/AWAY is the left-hand box now, LEFT/RIGHT the right-hand one
  await page.evaluate(() => StakeOutApp.launch(0, 'pole'));
  await page.waitForTimeout(200);
  const order = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { ta: r('.ro-2').left, lr: r('.ro-1').left, ts: r('.lcd').left };
  });
  check('TO/AWAY sits left of LEFT/RIGHT', order.ta < order.lr,
    'TO/AWAY ' + order.ta.toFixed(0) + ' vs LEFT/RIGHT ' + order.lr.toFixed(0));
  check('TIMESTAMP is still the right-hand box', order.lr < order.ts);

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
