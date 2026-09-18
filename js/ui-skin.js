/* ==========================================================================
   STAKE-OUT V12 — UI skin
   --------------------------------------------------------------------------
   The V12 art is a stack of real image layers (see the player screen in
   index.html). Most of it is static and is simply placed with CSS. This file
   holds the parts that MOVE, which have to be drawn onto canvases every frame:

     - the four direction triangles and the blurred point glow on the
       POINT POSITION dial
     - the neon bubble in the BUBBLE LEVEL vial
     - the LCD digits in the LEFT/RIGHT, TO/AWAY and TIMESTAMP boxes

   Every one of those is a sprite cut from the V12 art by
   tools/prep_v12_layers.py -- nothing here draws a CSS or vector copy of the
   artwork. The engine is handed StakeOutSkin.gauges and draws the sprites
   itself; this file only loads them and converts the art's measurements into
   the canvas coordinates the engine already uses.

   Load order: after game-engine.js, before app.js.
   ========================================================================== */

const StakeOutSkin = (function () {
  'use strict';

  const DIR = 'assets/img/v12/';

  /* ---- sprite loading ----------------------------------------------------
     WebP first, PNG if the browser cannot decode it. Anything drawn before a
     sprite has finished loading is simply skipped for that frame; onReady
     lets the shell repaint once they are all in. */
  const pending = [];
  let loaded = 0;

  function sprite(name) {
    const img = new Image();
    img.decoding = 'async';
    const p = new Promise(function (resolve) {
      img.onload = function () { loaded++; resolve(); };
      img.onerror = function () {
        if (img.src.indexOf('.webp') >= 0) { img.src = DIR + name + '.png'; }
        else { resolve(); }       // missing art: draw nothing rather than throw
      };
    });
    img.src = DIR + name + '.webp';
    pending.push(p);
    return img;
  }

  function isReady(img) { return img && img.complete && img.naturalWidth > 0; }

  /* ---- the art's own measurements -----------------------------------------
     All in MASTER PIXELS -- the 1920x1080 concept master the layers were
     registered to. prep_v12_layers.py prints these; if the art is re-exported
     and the script re-run, copy its numbers in here.

     The two gauges are described exactly the way the engine describes them:
     a centre and a radius r. The engine's canvases are then positioned (in
     styles.css) so that the engine's own r lands on the art's r, which is why
     none of the engine's geometry or input maths had to change. */
  const DIAL = { cx: 698.0, cy: 475.0, r: 174.0 };     // grey outer ring
  const VIAL = { cx: 1233.0, cy: 475.0, r: 157.5 };    // outer edge of the green glass

  // triangle sprite boxes on the dial: x, y, w, h
  const TRI_BOXES = {
    up:    [668, 270, 64, 42],
    down:  [666, 634, 65, 41],
    left:  [469, 442, 49, 68],
    right: [879, 441, 50, 69]
  };

  /* The engine's gauge geometry, mirrored from game-engine.js (POS_GAUGE and
     BUBBLE_GAUGE). Used only to convert the art's measurements into canvas
     units -- the engine keeps its own copy and nothing here changes it. */
  const ENGINE_POS = { cx: 214, cy: 214, r: 122 };
  const ENGINE_BUB = { cx: 215, cy: 215, r: 140 };

  // master px -> engine canvas units, for one gauge
  function toUnits(art, eng, box) {
    const k = eng.r / art.r;
    return {
      x: eng.cx + (box[0] - art.cx) * k,
      y: eng.cy + (box[1] - art.cy) * k,
      w: box[2] * k,
      h: box[3] * k
    };
  }

  const tri = {};
  Object.keys(TRI_BOXES).forEach(function (dir) {
    tri[dir] = Object.assign({ img: sprite('tri_' + dir) }, toUnits(DIAL, ENGINE_POS, TRI_BOXES[dir]));
  });

  /* What the engine draws. Sizes are in the engine's canvas units.

     bubble.r   the painted bubble fills the vial's white centring ring (the
                ring V10 drew at 0.30 r), so the sprite is drawn at the size
                the art paints it: 40 master px, which is 35.6 units. Purely a
                size on screen -- the bubble's position, and every pass/fail
                test, still use its centre exactly as before.
     glow.r     the V11 pip was a PIP_RADIUS 60 gradient plus an 18px blur,
                so it read about 75 units across the radius; the glow sprite
                is drawn to the same footprint so the dial stays exactly as
                hard to read by eye as V11 made it. */
  const gauges = {
    pos: {
      tri: tri,
      unlitAlpha: 0.14,                 // a dark triangle reads as an unlit lamp
      glow: { img: sprite('point_glow'), r: 78, alpha: 0.62 }
    },
    bub: {
      bubble: { img: sprite('bubble'), r: 40 * (ENGINE_BUB.r / VIAL.r) }
    },
    isReady: isReady
  };

  /* ======================================================================== */
  /* LCD DIGITS                                                               */
  /* ------------------------------------------------------------------------ */
  /* lcd_digits is an atlas of the digits_1.png glyphs: three rows (green,
     yellow, red), eleven 96x132 cells each -- 0 to 9, then the decimal point.
     Glyphs are right-aligned in their cells like a real seven-segment '1'.  */
  const atlas = sprite('lcd_digits');
  const ghost = sprite('ts_ghost');
  const CELL_W = 96, CELL_H = 132;
  const ROW = { green: 0, yellow: 1, red: 2 };
  // how far each glyph advances, as a fraction of the cell height
  const ADV_DIGIT = 0.60, ADV_DOT = 0.26;

  /* Canvases are sized to their CSS box times the device pixel ratio every
     time they paint, so rotating a phone or resizing the window never leaves
     a stretched or blurry bitmap behind. */
  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function glyphCell(ch) { return ch === '.' ? 10 : Number(ch); }

  function textWidth(text, gh) {
    let w = 0;
    for (let i = 0; i < text.length; i++) w += (text[i] === '.' ? ADV_DOT : ADV_DIGIT) * gh;
    return w;
  }

  // draw `text` (digits and '.') right-aligned so it ends at xRight
  function drawDigits(ctx, text, xRight, yTop, gh, row, alpha) {
    if (!isReady(atlas)) return;
    const sy = ROW[row] * CELL_H;
    const cw = CELL_W * (gh / CELL_H);
    let x = xRight;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i];
      const c = glyphCell(ch);
      if (isNaN(c)) continue;
      const adv = (ch === '.' ? ADV_DOT : ADV_DIGIT) * gh;
      // the dot sits centred in its (narrower) advance; digits hug the right
      const dx = ch === '.' ? x - adv / 2 - cw / 2 : x - cw + gh * 0.03;
      ctx.drawImage(atlas, c * CELL_W, sy, CELL_W, CELL_H, dx, yTop, cw, gh);
      x -= adv;
    }
    ctx.globalAlpha = 1;
  }

  /* One readout box -> two slots, the way V11 laid them out: LEFT and RIGHT
     side by side under "LEFT / RIGHT", TO and AWAY under "TO / AWAY". Only one
     of each pair is ever live; the other shows the unlit ghost of the LCD,
     which is what '---' was standing in for. */
  function paintReadout(canvas, a, b) {
    const f = fit(canvas);
    const slot = f.w / 2;
    const room = slot * 0.92;
    // one glyph height for both slots, sized so "00.000" fits a slot -- the
    // lit value and the ghost beside it then match
    const gh = Math.min(f.h * 0.88, room / textWidth('00.000', 1));
    const y = (f.h - gh) / 2;
    [a, b].forEach(function (val, i) {
      const right = slot * (i + 1) - slot * 0.04;
      if (!val || val === '---') {
        drawDigits(f.ctx, '0.000', right, y, gh, 'green', 0.12);
        return;
      }
      // shrink further only if someone walks a very long way off
      let g = gh;
      const tw = textWidth(val, g);
      if (tw > room) g = g * room / tw;
      drawDigits(f.ctx, val, right, y + (gh - g) / 2, g, 'green', 1);
    });
  }

  /* TIMESTAMP: the grey "88.88.88" ghost from lcd_readouts.png, with the live
     HH MM SS lit on top in the digits_1 glyphs. Green, red past the warning
     threshold (app.js decides that; this only paints it). The ghost's glyph
     columns come from prep_v12_layers.py: three pairs of digits. */
  const GHOST_W = 401, GHOST_H = 105;
  /* Where each unlit glyph sits in ts_ghost.png (ghost px, measured off the
     sprite): six digits 58 wide and 87 tall from y=8, and the two separator
     dots. The glyphs are italic, so neighbouring boxes overlap a little. */
  const GHOST_DIGIT_X = [8, 64, 144, 200, 278, 334];
  const GHOST_DIGIT = { y: 8, w: 58, h: 87 };
  const GHOST_DOTS = [{ x: 123, y: 80, w: 13, h: 14 }, { x: 256, y: 80, w: 13, h: 14 }];
  // the lit glyph's own box inside its atlas cell (the '8', which every digit
  // is right-aligned to) and the dot's
  const ATLAS_DIGIT = { x: 15, y: 13, w: 75, h: 105 };
  const ATLAS_DOT = { x: 38, y: 105, w: 20, h: 19 };

  function blitGlyph(ctx, cell, row, src, dx, dy, dw, dh) {
    ctx.drawImage(atlas, cell * CELL_W + src.x, ROW[row] * CELL_H + src.y, src.w, src.h, dx, dy, dw, dh);
  }

  function paintClock(canvas, hhmmss, warn) {
    const f = fit(canvas);
    if (!isReady(ghost) || !isReady(atlas)) return;
    // the ghost is drawn as large as the box allows, centred
    const s = Math.min(f.w / GHOST_W, f.h / GHOST_H);
    const ox = (f.w - GHOST_W * s) / 2, oy = (f.h - GHOST_H * s) / 2;
    f.ctx.drawImage(ghost, ox, oy, GHOST_W * s, GHOST_H * s);
    // then each live digit lands exactly on its unlit glyph
    const row = warn ? 'red' : 'green';
    for (let i = 0; i < 6; i++) {
      const c = Number(hhmmss.charAt(i));
      if (isNaN(c)) continue;
      blitGlyph(f.ctx, c, row, ATLAS_DIGIT,
        ox + GHOST_DIGIT_X[i] * s, oy + GHOST_DIGIT.y * s, GHOST_DIGIT.w * s, GHOST_DIGIT.h * s);
    }
    // the separators stay lit, as the V10 colons did
    GHOST_DOTS.forEach(function (d) {
      blitGlyph(f.ctx, 10, row, ATLAS_DOT, ox + d.x * s, oy + d.y * s, d.w * s, d.h * s);
    });
  }

  function onReady(fn) {
    Promise.all(pending).then(fn);
  }

  return {
    gauges: gauges,
    paintReadout: paintReadout,
    paintClock: paintClock,
    onReady: onReady,
    get loadedCount() { return loaded; }
  };
})();
