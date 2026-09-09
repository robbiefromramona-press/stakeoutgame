/* ==========================================================================
   STAKE-OUT V8 — application shell
   Screen routing, menu state, live HUD binding, field-report rendering and
   the two exports. All gameplay lives in game-engine.js.
   ========================================================================== */

(function () {
  'use strict';

  const LEVELS = StakeOut.LEVELS;
  const JOB_NAME = 'STAKE-OUT SIM';
  const OPERATOR = 'FIELD CREW';
  const INSTRUMENT = 'SIMULATED TS';

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
    if (name !== 'player') game.stop();
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

    onRoundComplete: function (round) {
      lastRound = round;
      renderReport(round);
      showScreen('report');
    }
  });

  playerStage.addEventListener('click', function () { game.handleClick(); });

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
   '  &bull;  STAKE-OUT V8 — TotalStationTech.com</p>\n' +
'</div></body></html>\n';
  }

  $('saveQuitBtn').addEventListener('click', function () {
    if (!lastRound) { showScreen('menu'); return; }
    const base = 'stakeout-L' + (lastRound.level + 1) + '-' + lastRound.mode +
                 '-' + slugStamp(lastRound.startedAt || new Date());
    download(base + '.csv', 'text/csv;charset=utf-8', buildCsv(lastRound));
    download(base + '-report.html', 'text/html;charset=utf-8', buildStyledReport(lastRound));
    showScreen('menu');
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
    getState: function () {
      return { selectedLevel: selectedLevel, selectedMode: selectedMode, currentScreen: currentScreen, lastRound: lastRound };
    }
  };
})();
