/* ==========================================================================
   STAKE-OUT V9 — application shell
   Screen routing, menu state, live HUD binding, field-report rendering and
   the two exports. All gameplay lives in game-engine.js.
   ========================================================================== */

(function () {
  'use strict';

  const LEVELS = StakeOut.LEVELS;
  const JOB_NAME = 'STAKE-OUT SIM';
  const OPERATOR = 'FIELD CREW';
  const INSTRUMENT = 'SIMULATED TS';

  /* ======================================================================== */
  /*  >>>  TUNE ME  <<<                                                       */
  /*  How many seconds the player may spend in ONE level before the TIMESTAMP */
  /*  digits go from green to red. Change this single number to move the      */
  /*  warning; nothing else reads it, and it has no effect on scoring, on     */
  /*  tolerances, or on when a level ends.                                    */
  /* ======================================================================== */
  const TIME_WARNING_THRESHOLD_SEC = 90;

  const $ = (id) => document.getElementById(id);

  const screens = {
    menu:   $('screen-menu'),
    player: $('screen-player'),
    report: $('screen-report')
  };

  /* ---- app state -------------------------------------------------------- */
  let selectedLevel = 0;        // 0-3
  let selectedMode = 'bipod';   // 'bipod' | 'pole'
  let lastRound = null;         // the round the report screen is showing
  let currentScreen = 'menu';

  /* ---- screen routing --------------------------------------------------- */
  function showScreen(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('is-active', k === name);
    });
    currentScreen = name;
    if (name !== 'player') {
      game.stop();
      releaseAllTouch();   // a finger still down when the level ends must not stick
      clockStop();
    }
    window.scrollTo(0, 0);
  }

  /* ======================================================================== */
  /* MENU                                                                     */
  /* ======================================================================== */
  const levelHits = Array.prototype.slice.call(document.querySelectorAll('.level-hit'));
  const modeSelect = $('modeSelect');
  const modeFace = $('modeFace');
  const menuHint = $('menuHint');
  const courseComplete = $('courseComplete');

  function paintMenu() {
    levelHits.forEach(function (el) {
      el.classList.toggle('is-selected', Number(el.dataset.level) === selectedLevel);
      el.setAttribute('aria-pressed', Number(el.dataset.level) === selectedLevel ? 'true' : 'false');
    });
    modeFace.innerHTML = 'MODE: ' + selectedMode.toUpperCase() + ' <b>&#9662;</b>';
    modeSelect.value = selectedMode;

    const lvl = LEVELS[selectedLevel];
    menuHint.textContent = lvl.name.toUpperCase().replace('—', '—') +
      '  •  ' + selectedMode.toUpperCase() +
      '  •  ' + lvl.points + ' POINTS' +
      '  •  ±' + lvl.posToleranceFt.toFixed(3) + ' ft' +
      '  •  BUBBLE ' + lvl.bubbleTolerancePct + '%';
  }

  levelHits.forEach(function (el) {
    el.addEventListener('click', function () {
      selectedLevel = Number(el.dataset.level);
      paintMenu();
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectedLevel = Number(el.dataset.level);
        paintMenu();
      }
    });
  });

  modeSelect.addEventListener('change', function () {
    selectedMode = modeSelect.value;
    paintMenu();
  });

  $('startBtn').addEventListener('click', function () {
    launch(selectedLevel, selectedMode);
  });

  /* ======================================================================== */
  /* PLAYER                                                                   */
  /* ======================================================================== */
  const playerStage = $('playerStage');
  const startGate = $('startGate');
  const shotMsg = $('shotMsg');

  const game = StakeOut.create({
    posCanvas: $('posCanvas'),
    bubbleCanvas: $('bubbleCanvas'),

    onHud: function (h) {
      $('hudLevel').textContent = h.level;
      $('hudPoint').textContent = h.point;
      $('hudTotal').textContent = h.totalPoints;
    },

    onReadouts: function (r) {
      $('roLeft').textContent  = r.left;
      $('roRight').textContent = r.right;
      $('roTo').textContent    = r.to;
      $('roAway').textContent  = r.away;
    },

    onMessage: function (text, pass) {
      shotMsg.textContent = text;
      shotMsg.classList.toggle('is-on', !!text);
      shotMsg.classList.toggle('pass', pass === true);
      shotMsg.classList.toggle('fail', pass === false);
    },

    onStartGate: function (show) {
      startGate.hidden = !show;
    },

    // fires the instant the start gate clears, i.e. when play really begins
    onPlayStart: function () {
      clockStart();
    },

    onRoundComplete: function (round) {
      lastRound = round;
      renderReport(round);
      showScreen('report');
    }
  });

  /* Tap-to-measure.
     V8 let a click anywhere in the stage fire a shot. That was fine when the
     stage held nothing but gauges, but V9 lays real D-pad and MEASURE hotspots
     over the same stage, and a tap on one of those bubbles up to here. So the
     listener now ignores any event that started inside a control cluster --
     the whole .tc block is flagged data-nomeasure -- while every other part of
     the stage (the gauges, the panels, the bezel, the start gate) measures
     exactly the way it did on desktop. The hotspot handlers below also call
     stopPropagation(), so this is belt and braces. */
  playerStage.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('[data-nomeasure]')) return;
    game.handleClick();
  });

  /* ======================================================================== */
  /* TOUCH CONTROLS                                                           */
  /* ------------------------------------------------------------------------ */
  /* Pointer events throughout, so a finger and a mouse take the same path and
     there is no touch-only branch to keep in sync. Every handler stops the
     event so the tap-to-measure listener above never sees it.                */
  /* ======================================================================== */
  const DIRECTIONS = ['up', 'down', 'left', 'right'];

  /* Both pads drive the same four directions, so one direction can be held by
     two pointers at once (a thumb on each pad's "up"). Count the pointers
     holding each direction and release the key only when the last one lifts,
     otherwise letting go of one pad would cancel the other pad's hold. */
  const heldBy = { up: [], down: [], left: [], right: [] };
  const dirPointers = new Map();      // pointerId -> { dir, el }
  const measPointers = new Map();     // pointerId -> element

  function dropFrom(list, id) {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
  }

  function withinRect(el, x, y) {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function capture(el, id) {
    if (el.setPointerCapture) {
      // capture so a thumb that slides off the arrow still reports its release
      try { el.setPointerCapture(id); } catch (err) { /* not fatal */ }
    }
  }

  /* ---- D-pads ----------------------------------------------------------- */
  function onDirDown(e) {
    e.preventDefault();          // no focus ring, no synthetic click, no scroll
    e.stopPropagation();
    if (dirPointers.has(e.pointerId)) return;
    const el = e.currentTarget;
    const dir = el.dataset.dir;
    if (!dir) return;
    game.startIfWaiting();       // a pad press also clears the start gate
    dirPointers.set(e.pointerId, { dir: dir, el: el });
    heldBy[dir].push(e.pointerId);
    el.classList.add('is-down');
    game.setDirection(dir, true);
    capture(el, e.pointerId);
  }

  function onDirUp(e) {
    const rec = dirPointers.get(e.pointerId);
    if (!rec) return;
    e.preventDefault();
    e.stopPropagation();
    dirPointers.delete(e.pointerId);
    dropFrom(heldBy[rec.dir], e.pointerId);
    rec.el.classList.remove('is-down');
    if (heldBy[rec.dir].length === 0) game.setDirection(rec.dir, false);
  }

  /* ---- MEASURE discs ----------------------------------------------------- */
  function onMeasureDown(e) {
    e.preventDefault();
    e.stopPropagation();
    if (measPointers.has(e.pointerId)) return;
    const el = e.currentTarget;
    measPointers.set(e.pointerId, el);
    el.classList.add('is-down');
    capture(el, e.pointerId);
  }

  function onMeasureUp(e) {
    const el = measPointers.get(e.pointerId);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    measPointers.delete(e.pointerId);
    el.classList.remove('is-down');
    // fire on release, and only if the pointer is still on the disc, so a
    // mis-tap can be cancelled by sliding off -- the way a real button works.
    // A shot is the scoring action; it should not be possible to trip by
    // brushing the bezel. game.handleClick() is the same call the desktop
    // click makes, gate handling included.
    if (e.type === 'pointerup' && withinRect(el, e.clientX, e.clientY)) {
      game.handleClick();
    }
  }

  function releaseAllTouch() {
    dirPointers.forEach(function (rec) { rec.el.classList.remove('is-down'); });
    dirPointers.clear();
    DIRECTIONS.forEach(function (d) { heldBy[d].length = 0; });
    measPointers.forEach(function (el) { el.classList.remove('is-down'); });
    measPointers.clear();
    game.releaseDirections();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tc-dir'), function (el) {
    el.addEventListener('pointerdown', onDirDown);
    el.addEventListener('pointerup', onDirUp);
    el.addEventListener('pointercancel', onDirUp);
    el.addEventListener('lostpointercapture', onDirUp);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tc-measure'), function (el) {
    el.addEventListener('pointerdown', onMeasureDown);
    el.addEventListener('pointerup', onMeasureUp);
    el.addEventListener('pointercancel', onMeasureUp);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });

  // a held pad must not survive the tab losing focus or being backgrounded
  window.addEventListener('blur', releaseAllTouch);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) releaseAllTouch();
  });

  /* ======================================================================== */
  /* TIMESTAMP - the per-level stopwatch                                      */
  /* ------------------------------------------------------------------------ */
  /* Seven-segment digits assembled from divs: each digit is seven absolutely
     positioned bars inside a box, switched on and off per value. No webfont
     and no sprite sheet, so there is nothing external that can fail to load.
     The clock is per level -- it resets to 00:00:00 at the top of every level
     rather than running for the whole session.                               */
  /* ======================================================================== */
  const lcd = $('lcdClock');
  const lcdRow = $('lcdRow');
  const lcdDigits = [];

  const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const HORIZONTAL = 'adg';               // the rest (b c e f) are the uprights
  const DIGIT_SEGMENTS = {
    '0': 'abcdef', '1': 'bc',    '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
    '5': 'acdfg',  '6': 'acdefg', '7': 'abc',  '8': 'abcdefg', '9': 'abcdfg'
  };

  function buildLcd() {
    // matches grid-template-columns in styles.css: digit, 5fr spacer, digit,
    // 26fr colon, ... which is the spacing measured off the artwork
    const plan = ['d', 'sp', 'd', 'colon', 'd', 'sp', 'd', 'colon', 'd', 'sp', 'd'];
    plan.forEach(function (kind) {
      const cell = document.createElement('div');
      if (kind === 'd') {
        cell.className = 'lcd-d';
        SEGMENTS.forEach(function (name) {
          const seg = document.createElement('span');
          seg.className = 'lcd-seg ' +
            (HORIZONTAL.indexOf(name) >= 0 ? 'h' : 'v') + ' s-' + name;
          cell.appendChild(seg);
        });
        lcdDigits.push(cell);
      } else if (kind === 'colon') {
        cell.className = 'lcd-colon';
      } else {
        cell.className = 'lcd-sp';
      }
      lcdRow.appendChild(cell);
    });
  }

  function paintDigit(cell, ch) {
    const on = DIGIT_SEGMENTS[ch] || '';
    for (let i = 0; i < SEGMENTS.length; i++) {
      cell.children[i].classList.toggle('is-on', on.indexOf(SEGMENTS[i]) >= 0);
    }
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function paintClock(elapsedSec) {
    const whole = Math.max(0, Math.floor(elapsedSec));
    const hh = Math.min(99, Math.floor(whole / 3600));
    const mm = Math.floor((whole % 3600) / 60);
    const ss = whole % 60;
    const digits = pad2(hh) + pad2(mm) + pad2(ss);
    for (let i = 0; i < lcdDigits.length; i++) paintDigit(lcdDigits[i], digits.charAt(i));
    // compared on the un-rounded elapsed time, so the flip lands on the frame
    // the readout first shows the threshold
    lcd.classList.toggle('is-warn', elapsedSec > TIME_WARNING_THRESHOLD_SEC);
    lcd.setAttribute('aria-label',
      'Level elapsed time ' + pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss));
  }

  let clockStartMs = null;
  let clockTimer = null;

  function clockStop() {
    if (clockTimer !== null) { clearInterval(clockTimer); clockTimer = null; }
  }

  function clockReset() {
    clockStop();
    clockStartMs = null;
    paintClock(0);
  }

  function clockStart() {
    clockStop();
    clockStartMs = Date.now();
    paintClock(0);
    clockTimer = setInterval(function () {
      paintClock((Date.now() - clockStartMs) / 1000);
    }, 200);
  }

  buildLcd();
  paintClock(0);

  window.addEventListener('keydown', function (e) {
    if (currentScreen === 'player' && e.key === 'Escape') {
      e.preventDefault();
      game.stop();
      showScreen('menu');
    }
  });

  function launch(levelIndex, mode) {
    selectedLevel = levelIndex;
    selectedMode = mode;
    courseComplete.hidden = true;
    paintMenu();
    showScreen('player');
    releaseAllTouch();
    clockReset();          // every level starts its own clock at 00:00:00
    game.startLevel(levelIndex, mode);
  }

  /* ======================================================================== */
  /* FIELD REPORT                                                             */
  /* ======================================================================== */
  const reportBody = $('reportBody');
  const reportNote = $('reportNote');
  const ROW_SLOTS = 10;   // the artwork's table is ruled for ten rows

  function tally(round) {
    const passed = round.rows.filter(function (r) { return r.pass; }).length;
    const total = round.rows.length;
    return {
      total: total,
      passed: passed,
      failed: total - passed,
      rate: total ? Math.round((passed / total) * 100) : 0
    };
  }

  function isoDate(d) {
    const p = (v) => String(v).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function renderReport(round) {
    const t = tally(round);

    $('metaJob').textContent = JOB_NAME;
    $('metaDate').textContent = isoDate(round.startedAt || new Date());
    $('metaOperator').textContent = OPERATOR;
    $('metaInstrument').textContent = INSTRUMENT;

    reportBody.innerHTML = '';
    for (let i = 0; i < ROW_SLOTS; i++) {
      const row = round.rows[i];
      const tr = document.createElement('div');
      tr.className = 'rep-row';
      if (row) {
        tr.innerHTML =
          '<div class="rep-c-point">' + row.pointLabel + '</div>' +
          '<div class="rep-c-time">' + row.timestamp + '</div>' +
          '<div class="rep-c-err">' + row.hOffset + ' ft</div>' +
          '<div><span class="rep-chip ' + (row.pass ? 'pass' : 'fail') + '">' +
            (row.pass ? 'PASS' : 'FAIL') + '</span></div>';
      } else {
        tr.innerHTML = '<div></div><div></div><div></div><div></div>';
      }
      reportBody.appendChild(tr);
    }

    $('sumTotal').textContent  = t.total;
    $('sumPassed').textContent = t.passed;
    $('sumFailed').textContent = t.failed;
    $('sumRate').textContent   = t.rate + '%';

    const atTop = round.level >= LEVELS.length - 1;
    $('continueBtn').innerHTML = atTop ? 'FINISH &#10095;' : 'CONTINUE &#10095;';
    reportNote.textContent = atTop
      ? 'LEVEL 4 CLEARED — CONTINUE RETURNS TO THE MENU'
      : 'CONTINUE STARTS ' + LEVELS[round.level + 1].name.toUpperCase() +
        ' IN ' + round.mode.toUpperCase() + ' MODE';
  }

  /* ---- exports ---------------------------------------------------------- */
  function download(filename, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function slugStamp(d) {
    const p = (v) => String(v).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
           p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function csvCell(v) {
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv(round) {
    const head = ['Point', 'Timestamp', 'DistanceErrorFt', 'BubbleOffsetPct', 'Result', 'Level', 'Mode'];
    const lines = [head.join(',')];
    round.rows.forEach(function (r) {
      lines.push([
        r.point,
        r.timestamp,
        r.hOffset,
        r.bOffset,
        r.pass ? 'PASS' : 'FAIL',
        round.level + 1,
        round.mode.toUpperCase()
      ].map(csvCell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* A self-contained, print-ready recreation of the field-report ticket.
     Built as styled HTML rather than a generated PDF so the export stays a
     single dependency-free file the browser can print straight to PDF. */
  function buildStyledReport(round) {
    const t = tally(round);
    const date = isoDate(round.startedAt || new Date());
    const rows = round.rows.map(function (r) {
      return '<tr>' +
        '<td class="pt">' + esc(r.pointLabel) + '</td>' +
        '<td class="ts">' + esc(r.timestamp) + '</td>' +
        '<td class="er">' + esc(r.hOffset) + ' ft</td>' +
        '<td class="pf"><span class="chip ' + (r.pass ? 'pass' : 'fail') + '">' +
          (r.pass ? 'PASS' : 'FAIL') + '</span></td>' +
      '</tr>';
    }).join('\n');

    return '<!DOCTYPE html>\n' +
'<html lang="en"><head><meta charset="utf-8" />\n' +
'<title>Field Report — ' + esc(LEVELS[round.level].name) + ' — ' + date + '</title>\n' +
'<style>\n' +
'  @page { size: landscape; margin: 12mm; }\n' +
'  * { box-sizing: border-box; }\n' +
'  body { margin:0; padding:28px; background:#000; color:#f5c518;\n' +
'         font-family:"Courier New",Consolas,monospace; }\n' +
'  .sheet { max-width:1180px; margin:0 auto; border:5px solid #f5c518; background:#000; padding:0 0 18px; }\n' +
'  .hd { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; padding:18px 22px 14px; }\n' +
'  .brand { font-family:Arial Narrow,Arial,sans-serif; }\n' +
'  .brand b { display:block; font-size:26px; letter-spacing:1px; color:#f5c518; }\n' +
'  .brand span { font-size:11px; letter-spacing:6px; color:#f5c518; }\n' +
'  .ttl { text-align:center; flex:1; }\n' +
'  .ttl h1 { margin:0; font-family:Arial Narrow,Arial,sans-serif; font-size:40px; letter-spacing:3px;\n' +
'            background:#f5c518; color:#000; display:inline-block; padding:4px 26px; }\n' +
'  .ttl p { margin:7px 0 0; font-size:12px; letter-spacing:5px; color:#f5c518; }\n' +
'  table.meta { border-collapse:collapse; font-size:12px; min-width:280px; }\n' +
'  table.meta th { text-align:left; color:#f5c518; padding:3px 16px 3px 0; letter-spacing:1px; font-weight:700; }\n' +
'  table.meta td { color:#fff; padding:3px 0; border-bottom:1px solid #f5c518; }\n' +
'  table.pts { width:calc(100% - 44px); margin:0 22px; border-collapse:collapse;\n' +
'              border:3px solid #f5c518; }\n' +
'  table.pts thead th { background:#f5c518; color:#000; font-family:Arial Narrow,Arial,sans-serif;\n' +
'              font-size:17px; letter-spacing:2px; padding:9px 4px; }\n' +
'  table.pts td { border:1px solid rgba(255,255,255,.24); padding:8px 4px; text-align:center;\n' +
'              font-size:16px; font-weight:700; }\n' +
'  td.pt { color:#f5c518; } td.ts { color:#fff; } td.er { color:#f5c518; }\n' +
'  .chip { display:inline-block; min-width:104px; padding:3px 0; color:#000;\n' +
'          font-family:Arial Narrow,Arial,sans-serif; letter-spacing:2px; font-size:16px; }\n' +
'  .chip.pass { background:#00e83c; } .chip.fail { background:#ff1f1f; }\n' +
'  .sum { display:flex; margin:16px 22px 0; border:3px solid #f5c518; }\n' +
'  .sum div { flex:1; text-align:center; padding:12px 4px 14px; border-right:1px solid rgba(255,255,255,.3); }\n' +
'  .sum div:last-child { border-right:0; }\n' +
'  .sum b { display:block; font-family:Arial Narrow,Arial,sans-serif; font-size:13px;\n' +
'           letter-spacing:2px; color:#fff; }\n' +
'  .sum u { display:block; text-decoration:none; font-family:Arial Narrow,Arial,sans-serif;\n' +
'           font-size:46px; line-height:1.05; }\n' +
'  .ok { color:#00e83c; } .bad { color:#ff1f1f; }\n' +
'  .ft { margin:14px 22px 0; font-size:11px; letter-spacing:1px; color:#8a8a8a; }\n' +
'  @media print { body { background:#fff; padding:0; } .sheet { border-color:#000; } }\n' +
'</style></head><body>\n' +
'<div class="sheet">\n' +
'  <div class="hd">\n' +
'    <div class="brand"><b>TotalStationTech</b><span>FIELD OPERATIONS</span></div>\n' +
'    <div class="ttl"><h1>FIELD REPORT</h1><p>POINT LAYOUT RESULTS</p></div>\n' +
'    <table class="meta">\n' +
'      <tr><th>JOB</th><td>' + esc(JOB_NAME) + '</td></tr>\n' +
'      <tr><th>DATE</th><td>' + date + '</td></tr>\n' +
'      <tr><th>OPERATOR</th><td>' + esc(OPERATOR) + '</td></tr>\n' +
'      <tr><th>INSTRUMENT</th><td>' + esc(INSTRUMENT) + '</td></tr>\n' +
'    </table>\n' +
'  </div>\n' +
'  <table class="pts">\n' +
'    <thead><tr><th>POINT #</th><th>TIMESTAMP</th><th>DISTANCE ERROR</th><th>PASS / FAIL</th></tr></thead>\n' +
'    <tbody>\n' + rows + '\n</tbody>\n' +
'  </table>\n' +
'  <div class="sum">\n' +
'    <div><b>TOTAL POINTS</b><u>' + t.total + '</u></div>\n' +
'    <div><b>PASSED</b><u class="ok">' + t.passed + '</u></div>\n' +
'    <div><b>FAILED</b><u class="bad">' + t.failed + '</u></div>\n' +
'    <div><b>ACCURACY RATE</b><u>' + t.rate + '%</u></div>\n' +
'  </div>\n' +
'  <p class="ft">' + esc(LEVELS[round.level].name) + '  &bull;  MODE: ' + round.mode.toUpperCase() +
   '  &bull;  POSITION TOLERANCE ±' + LEVELS[round.level].posToleranceFt.toFixed(3) + ' ft' +
   '  &bull;  BUBBLE TOLERANCE ' + LEVELS[round.level].bubbleTolerancePct + '%' +
   '  &bull;  STAKE-OUT V9 — TotalStationTech.com</p>\n' +
'</div></body></html>\n';
  }

  /* Both files, exactly as V8 produced them -- only the moment they are
     produced has moved, behind the confirm modal. */
  function exportRound(round) {
    if (!round) return;
    const base = 'stakeout-L' + (round.level + 1) + '-' + round.mode +
                 '-' + slugStamp(round.startedAt || new Date());
    download(base + '.csv', 'text/csv;charset=utf-8', buildCsv(round));
    download(base + '-report.html', 'text/html;charset=utf-8', buildStyledReport(round));
  }

  /* ======================================================================== */
  /* DOWNLOAD-CONFIRM MODAL                                                   */
  /* ------------------------------------------------------------------------ */
  /* SAVE / QUIT asks before it writes anything. HECK YEAH exports both files
     and goes to the menu; lol NO and the corner cross go to the menu with no
     files written. CONTINUE never opens this -- it still just starts the next
     level.                                                                   */
  /* ======================================================================== */
  const dlOverlay = $('dlOverlay');
  const dlStops = [$('dlYes'), $('dlNo'), $('dlClose')];

  function openDownloadModal() {
    dlOverlay.hidden = false;
    dlStops[0].focus();
  }

  function closeDownloadModal(withDownloads) {
    dlOverlay.hidden = true;
    if (withDownloads) exportRound(lastRound);
    showScreen('menu');
    const back = $('startBtn');
    if (back) back.focus({ preventScroll: true });
  }

  $('dlYes').addEventListener('click', function () { closeDownloadModal(true); });
  $('dlNo').addEventListener('click', function () { closeDownloadModal(false); });
  $('dlClose').addEventListener('click', function () { closeDownloadModal(false); });

  // tapping the dimmed area outside the card declines, same as lol NO
  dlOverlay.addEventListener('click', function (e) {
    if (e.target === dlOverlay) closeDownloadModal(false);
  });

  /* ESC declines, and Tab is kept inside the three buttons -- the field
     report is still rendered behind the overlay, so without this a keyboard
     user could tab onto SAVE / QUIT underneath the modal. */
  window.addEventListener('keydown', function (e) {
    if (dlOverlay.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeDownloadModal(false); return; }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const at = dlStops.indexOf(document.activeElement);
    const n = dlStops.length;
    const next = e.shiftKey ? (at <= 0 ? n - 1 : at - 1)
                            : (at < 0 || at === n - 1 ? 0 : at + 1);
    dlStops[next].focus();
  }, true);

  $('saveQuitBtn').addEventListener('click', function () {
    if (!lastRound) { showScreen('menu'); return; }
    openDownloadModal();
  });

  $('continueBtn').addEventListener('click', function () {
    if (!lastRound) { showScreen('menu'); return; }
    const next = lastRound.level + 1;
    if (next >= LEVELS.length) {
      courseComplete.hidden = false;
      selectedLevel = LEVELS.length - 1;
      paintMenu();
      showScreen('menu');
      return;
    }
    launch(next, lastRound.mode);
  });

  /* ---- boot -------------------------------------------------------------- */
  paintMenu();
  showScreen('menu');

  // exposed for manual testing in the console / headless checks
  window.StakeOutApp = {
    showScreen: showScreen,
    launch: launch,
    renderReport: renderReport,
    buildCsv: buildCsv,
    buildStyledReport: buildStyledReport,
    exportRound: exportRound,
    openDownloadModal: openDownloadModal,
    closeDownloadModal: closeDownloadModal,
    paintClock: paintClock,
    TIME_WARNING_THRESHOLD_SEC: TIME_WARNING_THRESHOLD_SEC,
    getState: function () {
      return { selectedLevel: selectedLevel, selectedMode: selectedMode, currentScreen: currentScreen, lastRound: lastRound };
    }
  };
})();
