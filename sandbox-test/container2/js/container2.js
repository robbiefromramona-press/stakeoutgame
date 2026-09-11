/* ==========================================================================
   STAKE-OUT SANDBOX — CONTAINER 2: RIGHT SCREEN (bubble level)
   --------------------------------------------------------------------------
   Isolates the vial, an analog joystick, and a MEASURE button. No position
   map, no directional arrows, no readout cards, no clock.

   ==== THE BUG THIS CONTAINER EXISTS TO FIX ==============================
   In V10 the on-screen pads have NO effect on the bubble. That is not a
   physics problem -- the spring/damper works fine. It is a missing wire.

   `bubbleTarget` inside game-engine.js has exactly two writers:
     1. onBubbleMouseMove()  -- a real mouse moving over the vial canvas
     2. the ARROW keys       -- keys['arrowup'] etc. in update()

   The pads call setDirection(), which writes keys['w'|'a'|'s'|'d'], and
   update() only ever applies those four to pos.x / pos.y. So the pad drives
   the player's POSITION and nothing else. Nothing reachable by a thumb has
   ever been connected to the bubble.

   ==== THE FIX ATTEMPTED HERE ============================================
   Rather than edit the engine -- it is shared byte-for-byte with Container 1
   and the main game -- this shell feeds the joystick through the engine's
   one existing analog bubble input: the vial's own mousemove handler. Each
   frame it synthesises a mousemove at the canvas coordinate the stick is
   pointing at, which is exactly what a desktop mouse does.

   That also buys the inverse for free. game-engine.js line ~220 reads:

       bubbleTarget.x = -bx;      // "the bubble's resting point sits
       bubbleTarget.y = -by;      //  opposite wherever the mouse is"

   So feeding the stick vector straight in yields target = -stick: push the
   stick toward the bubble and the bubble is driven AWAY from that side,
   which is the requested behaviour and the real vial's behaviour.

   This is a deliberate adapter, not the final fix. The clean version is a
   first-class setBubbleVector(x, y) on the engine, mirroring setDirection().
   Flagged in ../README.md as a port-back item.
   ========================================================================== */

(function () {
  'use strict';

  const LEVELS = StakeOut.LEVELS;
  const $ = (id) => document.getElementById(id);

  /* ======================================================================== */
  /* GLOBAL TIME SCALE                                                        */
  /* ------------------------------------------------------------------------ */
  /* Runs the WHOLE simulation slower without altering a single mechanic.
     Everything that happens still happens, in the same order, with the same
     character -- it just happens further apart in real time.

     game-engine.js computes dt in exactly one place:

         const dt = Math.min((t - lastT) / 1000, 0.05);   // loop(), line ~541

     ...where `t` is the timestamp requestAnimationFrame hands it, and 15 call
     sites downstream multiply by that dt: the bubble spring and damping, the
     per-level random noise, pole drift, walking speed, the reveal timer. Hand
     the engine a clock that advances at 75% of real time and all fifteen slow
     down together, in proportion. Nothing is retuned, so the bubble still
     rings exactly as it did -- you simply get a third more real time to read
     each swing and hit MEASURE inside it.

     Implemented by wrapping the global requestAnimationFrame, because that is
     the engine's only source of time and it calls the bare global. Wrapping
     is also why this stays a Container 2 change: it is scoped to this page,
     so Container 1 and the main game are untouched.

     NOT a damping change. Damping, spring constant, BUBBLE_PERSONALITY and
     every tuning table are exactly as shipped. */
  let timeScale = 0.75;          // 1 = real time, 0.75 = the default here
  let baseReal = null;           // real timestamp the current scale started at
  let baseVirtual = 0;           // virtual time already elapsed before it

  function virtualTime(t) {
    if (baseReal === null) baseReal = t;
    return baseVirtual + (t - baseReal) * timeScale;
  }

  function setTimeScale(s) {
    // rebase first so the virtual clock never jumps backwards or forwards --
    // a discontinuity here would hand the engine a wild dt for one frame
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    baseVirtual = virtualTime(now);
    baseReal = now;
    timeScale = s;
  }

  // Install before StakeOut.create() so the engine's loop never sees the
  // unwrapped clock. Returns the real rAF id, so cancelAnimationFrame still
  // works untouched.
  const realRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return realRaf(function (t) { cb(virtualTime(t)); });
  };

  /* ---- geometry mirrored from BUBBLE_GAUGE in game-engine.js -------------
     The engine draws the vial at cx/cy 215, r 140 in 430 layout units (an
     860px canvas backed at 2x). cx and cy are exactly the canvas centre, so
     only the radius needs a ratio. If this ever drifts from the engine the
     failure is graceful: the engine clamps the vector's magnitude to 1, so a
     wrong ratio changes how quickly a push saturates, never whether it
     works. */
  const GAUGE_R_RATIO = 140 / 430;

  /* ---- rig options ------------------------------------------------------- */
  let selectedLevel = 0;
  let stickGain = 1;
  let stickReturn = 'hold';      // 'hold' | 'spring'

  const GAIN_NAME = { '0.6': 'SOFT', '1': 'NORMAL', '1.4': 'SHARP' };

  /* ======================================================================== */
  /* SCREEN ROUTING                                                           */
  /* ======================================================================== */
  const screens = { start: $('screen-start'), c2: $('screen-c2') };

  function showScreen(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('is-active', k === name);
    });
    if (name !== 'c2') {
      running = false;
      game.stop();
      resetStick();
    }
  }

  /* ======================================================================== */
  /* START SCREEN                                                             */
  /* ======================================================================== */
  function paintOptions() {
    Array.prototype.forEach.call($('levelPicker').children, function (b) {
      b.classList.toggle('is-on', Number(b.dataset.level) === selectedLevel);
    });
    Array.prototype.forEach.call($('gainPicker').children, function (b) {
      b.classList.toggle('is-on', Number(b.dataset.gain) === stickGain);
    });
    Array.prototype.forEach.call($('returnPicker').children, function (b) {
      b.classList.toggle('is-on', b.dataset.return === stickReturn);
    });
    Array.prototype.forEach.call($('speedPicker').children, function (b) {
      b.classList.toggle('is-on', Number(b.dataset.speed) === timeScale);
    });

    const lvl = LEVELS[selectedLevel];
    $('optHint').textContent =
      'BUBBLE TOLERANCE ' + lvl.bubbleTolerancePct + '%  •  ' +
      'SPEED ' + Math.round(timeScale * 100) + '%  •  ' +
      (stickReturn === 'hold'
        ? 'HOLD: the stick stays where you leave it, like the mouse does in the real game — let go and the tilt stays put.'
        : 'SPRING: the stick snaps back to centre on release, which also commands the bubble back to level.');
  }

  Array.prototype.forEach.call($('levelPicker').children, function (b) {
    b.addEventListener('click', function () { selectedLevel = Number(b.dataset.level); paintOptions(); });
  });
  Array.prototype.forEach.call($('gainPicker').children, function (b) {
    b.addEventListener('click', function () { stickGain = Number(b.dataset.gain); paintOptions(); });
  });
  Array.prototype.forEach.call($('returnPicker').children, function (b) {
    b.addEventListener('click', function () { stickReturn = b.dataset.return; paintOptions(); });
  });
  Array.prototype.forEach.call($('speedPicker').children, function (b) {
    b.addEventListener('click', function () { setTimeScale(Number(b.dataset.speed)); paintOptions(); });
  });

  $('startBtn').addEventListener('click', launch);
  $('backBtn').addEventListener('click', function () { showScreen('start'); });

  /* ======================================================================== */
  /* THE ENGINE                                                               */
  /* ------------------------------------------------------------------------ */
  /* POLE mode, always. In BIPOD the vial only unlocks after the player walks
     and then releases -- and this container has no walking, so the bubble
     would stay locked and dead forever. POLE sets bubbleActive = true from
     the first frame, which is the only mode where a bubble-only rig can run
     at all. Its position drift still ticks along underneath, unseen and
     unscored.                                                                */
  /* ======================================================================== */
  const bubbleCanvas = $('bubbleCanvas');

  /* The engine requires a position canvas it can draw into. This container
     never shows one, so it gets a tiny detached canvas: every position-gauge
     draw call still runs but clips to almost nothing, instead of rasterising
     a full 428px dial per frame that no one will ever see. */
  const throwawayPosCanvas = document.createElement('canvas');
  throwawayPosCanvas.width = 8;
  throwawayPosCanvas.height = 8;

  let running = false;
  let lastBubblePct = null;

  const game = StakeOut.create({
    posCanvas: throwawayPosCanvas,
    bubbleCanvas: bubbleCanvas,

    onReadouts: function (r) {
      // POLE keeps bubbleActive true, so this is a live number every frame
      const v = parseFloat(r.bubble);
      lastBubblePct = isFinite(v) ? v : null;
    }
  });

  /* ---- the adapter: joystick -> the engine's analog bubble input ---------- */
  function driveBubble(x, y) {
    const rect = bubbleCanvas.getBoundingClientRect();
    // a canvas with no layout box would make the engine's scale factor
    // Infinity; it guards against this too, but there is nothing to send
    if (!rect.width || !rect.height) return;

    // place the synthetic pointer where a real mouse would have to sit to
    // request this vector: centre + vector * gauge radius
    const fx = 0.5 + x * GAUGE_R_RATIO;
    const fy = 0.5 + y * GAUGE_R_RATIO;

    bubbleCanvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: rect.left + rect.width * fx,
      clientY: rect.top + rect.height * fy
    }));
  }

  function launch() {
    showScreen('c2');
    resetStick();
    clearTimeout(msgTimer); msgTimer = null;
    paintMsg('', null);
    $('shotLog').innerHTML = '';
    lastBubblePct = null;

    $('hudLevel').textContent = selectedLevel + 1;
    $('hudTol').textContent = LEVELS[selectedLevel].bubbleTolerancePct;
    $('hudGain').textContent = GAIN_NAME[String(stickGain)] || stickGain;
    $('hudReturn').textContent = stickReturn.toUpperCase();
    $('hudSpeed').textContent = Math.round(timeScale * 100) + '%';

    game.startLevel(selectedLevel, 'pole');
    game.startIfWaiting();     // this rig's START screen is the start gate
    running = true;
  }

  $('rerollBtn').addEventListener('click', function () {
    // re-randomises the bubble to 0.85-0.98 off centre, i.e. a fresh tilt to
    // correct. The stick keeps its position; the loop re-commands it anyway.
    game.startLevel(selectedLevel, 'pole');
    game.startIfWaiting();
    running = true;
    paintMsg('', null);
  });

  /* ======================================================================== */
  /* ANALOG STICK                                                             */
  /* ------------------------------------------------------------------------ */
  /* A continuous vector, not four buttons: the nub reports wherever the thumb
     actually is, so a half push is a half push. Container 1's pad is
     deliberately the opposite -- discrete on/off -- which is why this shell
     does not reuse it.                                                        */
  /* ======================================================================== */
  const stick = $('stick');
  const nub = $('stickNub');
  let jx = 0, jy = 0;             // raw stick vector, magnitude <= 1
  let stickPointer = null;

  function throwRadius(rect) {
    // full push should leave the nub tangent to the rim, not half outside it
    return Math.max(1, rect.width / 2 - nub.offsetWidth / 2);
  }

  function setStickFrom(e) {
    const rect = stick.getBoundingClientRect();
    if (!rect.width) return;
    const rad = throwRadius(rect);
    let x = (e.clientX - (rect.left + rect.width / 2)) / rad;
    let y = (e.clientY - (rect.top + rect.height / 2)) / rad;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    jx = x; jy = y;
    paintNub();
  }

  function paintNub() {
    const rect = stick.getBoundingClientRect();
    const rad = rect.width ? throwRadius(rect) : 0;
    nub.style.transform = 'translate(' + (jx * rad).toFixed(2) + 'px,' +
                                         (jy * rad).toFixed(2) + 'px)';
  }

  function resetStick() {
    jx = 0; jy = 0;
    stickPointer = null;
    stick.classList.remove('is-down');
    paintNub();
  }

  stick.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (stickPointer !== null) return;
    stickPointer = e.pointerId;
    stick.classList.add('is-down');
    if (stick.setPointerCapture) { try { stick.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ } }
    setStickFrom(e);
  });

  stick.addEventListener('pointermove', function (e) {
    if (e.pointerId !== stickPointer) return;
    e.preventDefault();
    setStickFrom(e);
  });

  function endStick(e) {
    if (e.pointerId !== stickPointer) return;
    e.preventDefault();
    stickPointer = null;
    stick.classList.remove('is-down');
    // HOLD leaves the tilt where you put it, the way the mouse does in the
    // real game. SPRING recentres, which also commands the bubble to level.
    if (stickReturn === 'spring') { jx = 0; jy = 0; paintNub(); }
  }
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  stick.addEventListener('lostpointercapture', endStick);
  stick.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ======================================================================== */
  /* MEASURE — the one and only way to fire a shot                            */
  /* ------------------------------------------------------------------------ */
  /* Same global fix as Container 1: there is no stage-wide click listener,
     by design and permanently. This handler is the only path to a shot.
     Scoring is BUBBLE-ONLY -- the engine's own handleClick() also grades
     horizontal position, and this rig starts the player 3-12 ft from the
     point with no way to walk, so every shot would fail for a reason you
     cannot see. Mirrors the positionOnly flag Container 1 uses.              */
  /* ======================================================================== */
  const shotMsg = $('shotMsg');
  const MSG_HOLD_MS = 1800;
  let msgTimer = null;

  function paintMsg(text, pass) {
    shotMsg.textContent = text;
    shotMsg.classList.toggle('is-on', !!text);
    shotMsg.classList.toggle('pass', pass === true);
    shotMsg.classList.toggle('fail', pass === false);
  }

  function measure() {
    if (!running || lastBubblePct === null) return;
    const tol = LEVELS[selectedLevel].bubbleTolerancePct;
    const pass = lastBubblePct <= tol;

    paintMsg((pass ? '✔ LEVEL — ' : '✘ OFF LEVEL — ') +
             lastBubblePct.toFixed(1) + '% vs ' + tol + '% TOL', pass);
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { msgTimer = null; paintMsg('', null); }, MSG_HOLD_MS);

    const log = $('shotLog');
    const li = document.createElement('li');
    li.className = pass ? 'p' : 'f';
    li.textContent = lastBubblePct.toFixed(1) + '%';
    log.appendChild(li);
    while (log.children.length > 6) log.removeChild(log.firstChild);
  }

  const measureBtn = $('measureBtn');
  let measPointer = null;

  measureBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (measPointer !== null) return;
    measPointer = e.pointerId;
    measureBtn.classList.add('is-down');
    if (measureBtn.setPointerCapture) { try { measureBtn.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ } }
  });

  function endMeasure(e) {
    if (e.pointerId !== measPointer) return;
    e.preventDefault();
    measPointer = null;
    measureBtn.classList.remove('is-down');
    // fire on release, only if the pointer is still on the disc, so a mis-tap
    // can be cancelled by sliding off the way a real button works
    if (e.type === 'pointerup') {
      const r = measureBtn.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top && e.clientY <= r.bottom) measure();
    }
  }
  measureBtn.addEventListener('pointerup', endMeasure);
  measureBtn.addEventListener('pointercancel', endMeasure);
  measureBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ======================================================================== */
  /* DRIVE LOOP                                                               */
  /* ------------------------------------------------------------------------ */
  /* Re-commands the bubble every frame from the current stick vector rather
     than only on pointer events. Two reasons: the engine's own arrow-key
     handler also writes bubbleTarget, and re-commanding each frame means it
     can never accumulate any influence; and a re-randomised tilt picks up the
     stick's current position immediately.                                     */
  /* ======================================================================== */
  const DIR = { L: 'LEFT', R: 'RIGHT', U: 'UP', D: 'DOWN' };

  function dominant(x, y) {
    if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'L' : 'R';
    return y < 0 ? 'U' : 'D';
  }

  function tick() {
    if (running) {
      // gain scales the throw, then clamp so telemetry matches what the
      // engine will actually accept (it clamps to 1 internally too)
      let tx = jx * stickGain, ty = jy * stickGain;
      const m = Math.hypot(tx, ty);
      if (m > 1) { tx /= m; ty /= m; }

      driveBubble(tx, ty);

      $('tStick').textContent  = tx.toFixed(2) + ', ' + ty.toFixed(2);
      // the engine inverts what it is given; show the value it lands on
      $('tTarget').textContent = (-tx).toFixed(2) + ', ' + (-ty).toFixed(2);

      const v = $('tVerdict');
      if (m < 0.06) {
        v.textContent = 'IDLE';
        v.className = 'idle';
      } else {
        const push = dominant(tx, ty);
        const away = dominant(-tx, -ty);
        v.textContent = DIR[push].charAt(0) + ' → ' + DIR[away];
        v.className = 'ok';
      }
    }
    requestAnimationFrame(tick);
  }

  /* ---- boot -------------------------------------------------------------- */
  paintOptions();
  showScreen('start');
  requestAnimationFrame(tick);
  window.addEventListener('resize', paintNub);

  // exposed for console poking during testing
  window.SandboxC2 = {
    launch: launch,
    showScreen: showScreen,
    drive: function (x, y) { jx = x; jy = y; paintNub(); },
    setSpeed: setTimeScale,
    state: function () {
      return { jx: jx, jy: jy, gain: stickGain, ret: stickReturn,
               speed: timeScale, bubblePct: lastBubblePct,
               level: selectedLevel, running: running };
    }
  };
})();
