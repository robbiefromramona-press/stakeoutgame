/* ==========================================================================
   STAKE-OUT SANDBOX — CONTAINER 1: LEFT SCREEN (pole / walk movement)
   --------------------------------------------------------------------------
   Isolates exactly six things and nothing else:
     - the round "map" dial
     - the yellow directional arrows
     - the white point pip, which hides itself while a direction is held
     - live TO/AWAY and LEFT/RIGHT readout cards
     - a discrete 4-way D-pad (no joystick smoothing, no analog ramp)
     - a MEASURE button

   No bubble vial, no clock, no right-screen anything.

   All of the physics comes from js/game-engine.js, a VENDORED copy of the
   main build's engine -- byte-identical, not a fork. It has to live in this
   folder because Netlify publishes sandbox-test/ as the site root, so
   "../js/..." 404s on the deployed site. Re-copy it with sync-engine.sh
   after any engine edit; see README, "Known port-back cleanup".

   This file is a shell: it routes two screens, paints the cards, and
   translates pointer events into the engine's existing setDirection() /
   handleClick() calls. Nothing about movement, drift, per-level noise or the
   pass/fail test is reimplemented here, so anything that gets fixed in this
   container is a fix to the real engine.

   >>> GLOBAL FIX APPLIED HERE <<<
   The full game's app.js carries a stage-wide click listener that fires a
   measurement from a tap anywhere that isn't a control. This container has
   no such listener, by design and permanently: onMeasureUp() below is the
   ONLY path to game.handleClick(). The desktop click-anywhere fallback is
   intentionally dropped rather than replaced -- a real desktop input scheme
   gets mapped once mobile is settled.
   ========================================================================== */

(function () {
  'use strict';

  const LEVELS = StakeOut.LEVELS;
  const $ = (id) => document.getElementById(id);

  /* ---- rig options, driven by the START screen -------------------------- */
  let selectedLevel = 0;         // 0-3
  let selectedMode = 'bipod';    // 'bipod' | 'pole'

  const MODE_HINT = {
    bipod: 'BIPOD — readings hide the moment you press a direction and come ' +
           'straight back when you let go. Your position never moves on its own.',
    pole:  'POLE — readings come back about a second after you stop, and the ' +
           'pole slowly wanders while you stand still (capped at 0.200 ft).'
  };

  /* ======================================================================== */
  /* SCREEN ROUTING                                                           */
  /* ======================================================================== */
  const screens = { start: $('screen-start'), c1: $('screen-c1') };

  function showScreen(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('is-active', k === name);
    });
    if (name !== 'c1') {
      game.stop();
      releaseAllPointers();
      $('doneOverlay').hidden = true;
    }
  }

  /* ======================================================================== */
  /* START SCREEN                                                             */
  /* ======================================================================== */
  const optHint = $('optHint');

  function paintOptions() {
    Array.prototype.forEach.call($('levelPicker').children, function (b) {
      b.classList.toggle('is-on', Number(b.dataset.level) === selectedLevel);
    });
    Array.prototype.forEach.call($('modePicker').children, function (b) {
      b.classList.toggle('is-on', b.dataset.mode === selectedMode);
    });
    const lvl = LEVELS[selectedLevel];
    optHint.textContent =
      lvl.points + ' POINTS  •  ±' + lvl.posToleranceFt.toFixed(3) + ' ft  —  ' +
      MODE_HINT[selectedMode];
  }

  Array.prototype.forEach.call($('levelPicker').children, function (b) {
    b.addEventListener('click', function () {
      selectedLevel = Number(b.dataset.level);
      paintOptions();
    });
  });

  Array.prototype.forEach.call($('modePicker').children, function (b) {
    b.addEventListener('click', function () {
      selectedMode = b.dataset.mode;
      paintOptions();
    });
  });

  $('startBtn').addEventListener('click', launch);
  $('backBtn').addEventListener('click', function () { showScreen('start'); });
  $('doneBackBtn').addEventListener('click', function () { showScreen('start'); });
  $('againBtn').addEventListener('click', function () {
    $('doneOverlay').hidden = true;
    launch();
  });

  /* ======================================================================== */
  /* THE ENGINE                                                               */
  /* ------------------------------------------------------------------------ */
  /* No bubbleCanvas is passed. The engine reads that as a position-only rig:
     the vial is neither drawn nor scored, and in BIPOD mode releasing the pad
     is enough to reveal a fresh reading. Everything else -- speed, per-level
     move noise, the pole drift cap, the position tolerance test -- runs
     exactly as it does in the full game.                                     */
  /* ======================================================================== */
  const shotMsg = $('shotMsg');
  const cardLR = $('cardLR'), cardTA = $('cardTA');

  const MSG_HOLD_MS = 1600;   // how long a PASS/FAIL stays legible
  let msgTimer = null;

  function paintMsg(text, pass) {
    shotMsg.textContent = text;
    shotMsg.classList.toggle('is-on', !!text);
    shotMsg.classList.toggle('pass', pass === true);
    shotMsg.classList.toggle('fail', pass === false);
  }

  const game = StakeOut.create({
    posCanvas: $('posCanvas'),

    onHud: function (h) {
      $('hudLevel').textContent = h.level;
      $('hudPoint').textContent = h.point;
      $('hudTotal').textContent = h.totalPoints;
      $('hudMode').textContent = h.mode.toUpperCase();
      $('hudTol').textContent = LEVELS[h.level - 1].posToleranceFt.toFixed(3);
    },

    onReadouts: function (r) {
      paintCard(cardLR, r.visible, $('hLeft'), $('hRight'), $('vLR'), r.left, r.right);
      paintCard(cardTA, r.visible, $('hTo'), $('hAway'), $('vTA'), r.to, r.away);
    },

    onMessage: function (text, pass) {
      /* The engine clears this message 500 ms later, when the next point
         resets. That is too quick to read a PASS/FAIL on a phone mid-test,
         so the shell holds it for MSG_HOLD_MS and swallows the engine's
         early clear. Timing only -- the engine's own point cadence is
         untouched, and nothing here changes when a shot is scored. */
      if (text) {
        clearTimeout(msgTimer);
        paintMsg(text, pass);
        msgTimer = setTimeout(function () { msgTimer = null; paintMsg('', null); }, MSG_HOLD_MS);
      } else if (msgTimer === null) {
        paintMsg('', null);
      }
    },

    onRoundComplete: showDone
  });

  /* One readout card. The engine sends '---' both when a reading is hidden
     and when that axis is inside the 0.03 ft dead zone, so `visible` is what
     separates "you're walking, no reading for you" from "you're on line". */
  function paintCard(card, visible, headA, headB, valEl, a, b) {
    const onA = visible && a !== '---';
    const onB = visible && b !== '---';
    headA.classList.toggle('is-on', onA);
    headB.classList.toggle('is-on', onB);
    card.classList.toggle('is-hidden', !visible);

    if (!visible)      valEl.textContent = '---';
    else if (onA)      valEl.textContent = a;
    else if (onB)      valEl.textContent = b;
    else               valEl.textContent = 'ON LINE';
  }

  function launch() {
    showScreen('c1');
    releaseAllPointers();
    clearTimeout(msgTimer); msgTimer = null;
    paintMsg('', null);
    game.startLevel(selectedLevel, selectedMode);
    // this rig's START screen *is* the start gate, so play begins immediately
    game.startIfWaiting();
  }

  /* ======================================================================== */
  /* D-PAD — discrete 4-way, no smoothing                                     */
  /* ------------------------------------------------------------------------ */
  /* Pointer events so a thumb and a mouse take one code path. A direction is
     simply on or off: setDirection() writes into the same key map WASD writes
     into, so a pad press and a keypress are indistinguishable to the engine.
     Held directions are ref-counted by pointer id, so two thumbs holding the
     same arrow don't cancel each other when the first one lifts.             */
  /* ======================================================================== */
  const DIRECTIONS = ['up', 'down', 'left', 'right'];
  const heldBy = { up: [], down: [], left: [], right: [] };
  const dirPointers = new Map();     // pointerId -> { dir, el }
  const measPointers = new Map();    // pointerId -> element

  function dropFrom(list, id) {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
  }

  function withinRect(el, x, y) {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function capture(el, id) {
    // capture so a thumb that slides off the arrow still reports its release
    if (el.setPointerCapture) { try { el.setPointerCapture(id); } catch (err) { /* not fatal */ } }
  }

  function onDirDown(e) {
    e.preventDefault();          // no scroll, no focus ring, no synthetic click
    if (dirPointers.has(e.pointerId)) return;
    const el = e.currentTarget;
    const dir = el.dataset.dir;
    if (!dir) return;
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
    dirPointers.delete(e.pointerId);
    dropFrom(heldBy[rec.dir], e.pointerId);
    rec.el.classList.remove('is-down');
    if (heldBy[rec.dir].length === 0) game.setDirection(rec.dir, false);
  }

  /* ---- MEASURE — the one and only way to fire a shot --------------------- */
  function onMeasureDown(e) {
    e.preventDefault();
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
    measPointers.delete(e.pointerId);
    el.classList.remove('is-down');
    // fire on release, and only if the pointer is still on the disc, so a
    // mis-tap can be cancelled by sliding off the way a real button works
    if (e.type === 'pointerup' && withinRect(el, e.clientX, e.clientY)) {
      game.handleClick();
    }
  }

  function releaseAllPointers() {
    dirPointers.forEach(function (rec) { rec.el.classList.remove('is-down'); });
    dirPointers.clear();
    DIRECTIONS.forEach(function (d) { heldBy[d].length = 0; });
    measPointers.forEach(function (el) { el.classList.remove('is-down'); });
    measPointers.clear();
    game.releaseDirections();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.dbtn'), function (el) {
    el.addEventListener('pointerdown', onDirDown);
    el.addEventListener('pointerup', onDirUp);
    el.addEventListener('pointercancel', onDirUp);
    el.addEventListener('lostpointercapture', onDirUp);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });

  const measureBtn = $('measureBtn');
  measureBtn.addEventListener('pointerdown', onMeasureDown);
  measureBtn.addEventListener('pointerup', onMeasureUp);
  measureBtn.addEventListener('pointercancel', onMeasureUp);
  measureBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // a held pad must not survive the tab losing focus or being backgrounded
  window.addEventListener('blur', releaseAllPointers);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) releaseAllPointers();
  });

  /* ======================================================================== */
  /* END OF ROUND                                                             */
  /* ======================================================================== */
  function showDone(round) {
    const passed = round.rows.filter(function (r) { return r.pass; }).length;
    $('doneTitle').textContent = 'LEVEL ' + (round.level + 1) + ' — ' + round.mode.toUpperCase();
    $('dTotal').textContent = round.rows.length;
    $('dPass').textContent = passed;
    $('dFail').textContent = round.rows.length - passed;

    const list = $('doneList');
    list.innerHTML = '';
    round.rows.forEach(function (r) {
      const li = document.createElement('li');
      li.innerHTML = '<span>PT ' + r.pointLabel + '</span>' +
                     '<span>' + r.hOffset + ' ft</span>' +
                     '<span class="' + (r.pass ? 'ok' : 'bad') + '">' +
                       (r.pass ? 'PASS' : 'FAIL') + '</span>';
      list.appendChild(li);
    });

    releaseAllPointers();
    $('doneOverlay').hidden = false;
  }

  /* ---- boot -------------------------------------------------------------- */
  paintOptions();
  showScreen('start');

  // exposed for console poking during testing
  window.SandboxC1 = {
    launch: launch,
    showScreen: showScreen,
    setLevel: function (i) { selectedLevel = i; paintOptions(); },
    setMode: function (m) { selectedMode = m; paintOptions(); }
  };
})();
