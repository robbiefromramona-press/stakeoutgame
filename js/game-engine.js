/* ==========================================================================
   STAKE-OUT V11 — game engine
   --------------------------------------------------------------------------
   V11 is the mechanics overhaul. Five things changed; everything else is V10.

   1. ACTIVE PANEL. The two gauges are no longer both live all the time. One
      `activePanel` value ('pos' | 'bub' | 'both') now says which gauge the
      player is allowed to touch, and the shell paints the borders and the
      grey-out from it. See setActivePanel().

   2. BIPOD IS A HAND-OFF LOOP. Read the dial, walk, let go of the button --
      and control jumps straight to the bubble. Get the bubble inside
      BIPOD_FLIP_TOLERANCE_PCT and control jumps back to the dial. Do that
      until you are on line, at which point BOTH gauges go live together,
      MEASURE unlocks and the bubble goes into HOLD. See the bipod branch of
      update().

   3. READOUT LAG. A fresh reading no longer appears the instant you stop.
      Each level has a `readoutLagSec` and the readouts sit on '---' for that
      long first -- this is the total-station-to-prism computation delay.

   4. THE POINT PIP IS NOW A BLURRED BLOB. Ten times the old radius with a
      soft falloff, so it tells you roughly where the point is and nothing
      more. Precision has to come from the bubble now. Display only.

   5. THE BUBBLE HAS A HOME. It spawns at a random angle off centre and, the
      moment you stop steering it, it runs back to that spot instead of
      quietly settling wherever you abandoned it. Centring is something you
      hold, not something that happens to you. The one exception is HOLD.
   --------------------------------------------------------------------------
   V10 gives the bubble a "personality": instead of one flat spring/damper
   pulling it toward the mouse-driven target in every direction, it now
   resists centering and snaps outward faster when you drift off-level,
   the way a real bullseye vial behaves. The whole effect is scaled by one
   constant, BUBBLE_PERSONALITY (search for it below) -- turn it up for a
   meaner bubble, down for a gentler one, or to 0 to get the exact old V9
   feel back with no personality at all. It also scales itself up on harder
   levels via the existing bubbleHump number, so Level 4 is naturally more
   twitchy than Level 1 without a second tuning table. Nothing else about
   position gauge, movement, drift, noise, the bipod lock cycle, tolerances,
   or the pass/fail test changed.
   --------------------------------------------------------------------------
   V9 added three things and changed no rule: setDirection()/releaseDirections()
   so the on-screen D-pads can write into the same `keys` map WASD writes into,
   startIfWaiting() so a pad press can clear the start gate, and an onPlayStart
   callback so the shell can start the level stopwatch at the moment play
   actually begins. The only other edit was where drawBubbleGauge() puts its
   caption - see the note there. (Title line above was never updated when V9
   shipped -- fixed now.)
   --------------------------------------------------------------------------
   Ported from reference/stake-out-prototype-v7.html. The LEVELS table, every
   tuning constant, the bipod lock/unlock cycle, the pole-mode drift cap and
   the pass/fail test are carried over unchanged. The only reshaping was
   plumbing: v7 kept its state in bare module-scope variables and drew both
   gauges into one 900x380 canvas; V8 put state on a game object and drew
   into the two separate panel canvases the shell positions over the artwork.
   Gauge geometry is expressed as ratios of v7's own numbers so the gauges
   scale up to the concept-art panels without changing their proportions.
   ========================================================================== */

const StakeOut = (function () {
  'use strict';

  /* ---- level configuration -----------------------------------------------
     V11 retuned two columns and added one. Everything else is v7's and is
     still not to be touched.

       bubbleHump      how violently the bubble reacts to being steered. It
                       scales three things at once: the spring stiffness that
                       pulls the bubble toward your cursor, the damping that
                       decides how much it overshoots and wobbles, and a small
                       random jitter added every frame. Higher = faster and
                       twitchier = harder to hold level. V11 raises it from
                       0.15/0.30/0.50/0.80 to 0.50/0.75/0.75/1.00, i.e. the
                       50% / 75% / 75% / 100% difficulty ramp.

       readoutLagSec   NEW in V11. Seconds the LEFT/RIGHT and TO/AWAY boxes
                       sit on '---' after you stop walking, before the fresh
                       reading appears. Stands in for the real round trip an
                       instrument makes out to the prism and back, so it gets
                       longer on harder levels.

       posDriftAccel   POLE MODE ONLY -- BIPOD never drifts at all, a real
                       bipod just holds the rod where you put it. This is how
                       fast the pole wanders once you stop walking, in ft/sec
                       per second of standing still. It pushes the rod
                       radially AWAY from the point, which is why it moves
                       BOTH axes at once: nudge TO/AWAY, stand there a moment,
                       and LEFT/RIGHT opens up on its own. V11.1 slows that
                       down -- 50% off Level 1, 25% off Level 2, 10% off
                       Level 3, Level 4 left alone -- so the cross-axis creep
                       is something you can work with rather than race.
                       This is the RATE only -- see driftCapFt for the amount.

       driftCapFt      POLE MODE ONLY. The furthest the pole may wander in one
                       idle session, in feet. This was the global DRIFT_CAP_FT
                       constant, flat 0.200 ft on every level; V11.1 moves it
                       into the table because it, not posDriftAccel, is what
                       actually decides how far you stray.

                       Why it had to move: drift accelerates so quickly that
                       it pegs the cap in well under a second at every level.
                       So the cap alone set the stray, and slowing the accel
                       barely mattered -- halving Level 1's accel only bought
                       0.4 of a second before it pegged anyway. And a flat
                       0.200 ft is brutal at the sharp end: three times Level
                       3's ±0.060 ft tolerance and ten times Level 4's ±0.020.
                       Scaled here by the same 50/25/10/0% reduction as the
                       accel, so "stray less" actually means less stray.

       posToleranceFt  doubles as V11's "on line" threshold -- see checkOnLine().
  */
  const LEVELS = [
    { name:"Level 1 — Rookie",            points:3, posToleranceFt:0.30, bubbleTolerancePct:30, bubbleHump:0.50, posDriftAccel:0.30, driftCapFt:0.100, moveNoisePct:0.05, readoutLagSec:0.5 },
    { name:"Level 2 — Journeyman",        points:4, posToleranceFt:0.15, bubbleTolerancePct:18, bubbleHump:0.75, posDriftAccel:0.75, driftCapFt:0.150, moveNoisePct:0.12, readoutLagSec:1.0 },
    { name:"Level 3 — Foreman",           points:5, posToleranceFt:0.06, bubbleTolerancePct:9,  bubbleHump:0.75, posDriftAccel:1.44, driftCapFt:0.180, moveNoisePct:0.20, readoutLagSec:1.5 },
    { name:"Level 4 — No Room For Error", points:6, posToleranceFt:0.02, bubbleTolerancePct:3,  bubbleHump:1.00, posDriftAccel:2.40, driftCapFt:0.200, moveNoisePct:0.30, readoutLagSec:2.0 },
  ];

  const BASE_SPEED_FT = 2.2;   // ft/sec base WASD speed
  const EPS = 0.03;            // ft dead-zone before a triangle counts as "reached"
  // V7's flat pole-drift cap. Kept as the documented baseline and as the
  // value Level 4 still uses; the live number is each level's driftCapFt.
  const DRIFT_CAP_FT = 0.2;

  /* BUBBLE_MAX_VEL is the global bubble speed limit -- the one number that
     caps how fast the bubble can travel across the vial, whatever the spring
     and the jitter are asking for. V11.1 takes it down 20% (6.0 -> 4.8) to
     calm the whole thing down without touching the feel of any single level.

     BUBBLE_SPRING_K is deliberately NOT part of that 20%. It is stiffness,
     not speed: it sets how hard the bubble is pulled back toward where you
     are steering it. Weakening it would leave the per-frame random jitter
     unchanged while shrinking the only force pushing back against it, so the
     bubble would wander MORE, not less -- the opposite of the intent. */
  const BUBBLE_SPRING_K = 6, BUBBLE_DAMPING = 0.75, ARROW_TARGET_SPEED = 1.4, BUBBLE_MAX_VEL = 4.8;

  /* How much random restlessness is kicked into the bubble every frame,
     scaled per level by bubbleHump. Previously an unnamed 1.5 buried in the
     physics; named here so it can be found. Value unchanged from V10.

     ---- WHAT ACTUALLY MAKES THE BUBBLE HARD, measured ----------------------
     Worth writing down, because three obvious-looking dials are all the wrong
     one and it costs an afternoon to rediscover that.

       BUBBLE_MAX_VEL   a symmetric top-speed cap. Lowering it slows the
                        bubble coming BACK to centre exactly as much as it
                        slows it running away, so difficulty barely moves.

       bubbleHump       responsiveness, not difficulty. It raises the spring
                        that follows your cursor as well as the jitter, so
                        LOWERING it makes the bubble harder to control, not
                        easier. Measured: -20% took Level 1 from 62% of the
                        time inside tolerance down to 32%.

       BUBBLE_JITTER    barely moves it either, because the steady state was
                        never the problem -- see below.

     The bubble is not hard to HOLD, it is hard to SETTLE. Parked with the
     cursor dead centre and given time, it sits at 0.7% offset on Level 1 and
     stays inside tolerance 100% of the time. The difficulty is entirely in
     the transient: the spring/damper is very underdamped (damping ratio about
     0.11), so every time the bubble is thrown out to its home -- new point,
     hand-off, or simply letting go -- it rings for a long time before it
     stops. Time to settle and STAY inside tolerance, measured: 3.5s on Level
     1, and Level 4 never manages it inside 18 seconds.

     So the dial for "calmer and easier" is BUBBLE_DAMPING, which is what
     governs the ringing -- and that is the one V11.1 turns: 0.6 -> 0.75.
     Everything above is recorded so the next person does not spend an
     afternoon turning the other three first.

     If it still wants calming, BUBBLE_DAMPING is the number to raise and the
     only one. Past roughly 1.0 the bubble stops behaving like a liquid vial
     and starts behaving like a dial with a needle, so that is the ceiling to
     stay under unless that trade is wanted. */
  const BUBBLE_JITTER = 1.5;

  /* How close to dead centre the bubble has to get, in percent of the vial
     radius, before BIPOD hands control back to the position dial. This is the
     hand-off gate only -- it is NOT the pass/fail test. That is still each
     level's own bubbleTolerancePct, checked in handleClick(). On Level 1 the
     gate (10%) is tighter than the pass mark (30%); on Level 4 it is looser
     than the pass mark (3%), so on the hard levels getting the hand-off is
     not the same as earning the point. */
  const BIPOD_FLIP_TOLERANCE_PCT = 10;

  /* The point pip in the position dial. V11 blows it up ~10x and smears it so
     you can see roughly where the point is and never line it up by eye. */
  const PIP_RADIUS = 60;       // was 6 in V10 -- "scale up ~1000%"
  const PIP_BLUR_PX = 18;      // extra canvas blur on top of the soft gradient

  /* ---- V10: bubble "personality" ----------------------------------------
     Everything below shapes how the spring/damper reacts depending on (a)
     whether the mouse-driven target is moving away from level or back
     toward it, and (b) how far off-level that target currently is. None of
     it touches BUBBLE_SPRING_K / BUBBLE_DAMPING above -- those still set
     the baseline; this only multiplies on top of them. */
  const BUBBLE_PERSONALITY = 1.0;       // <<< THE ONE NUMBER TO TURN DURING TESTING.
                                         //   0     = old V9 feel, zero personality (safe fallback / A-B check)
                                         //   1.0   = default tuning, start here
                                         //   1.5-2 = noticeably meaner, harder to hold level
                                         //   0.3-0.5 = gentler, more forgiving
  const BUBBLE_ESCAPE_MULT      = 2.2;  // stiffness multiplier while the target is moving AWAY from center
  const BUBBLE_RETURN_MULT      = 1.0;  // stiffness multiplier while the target is moving TOWARD center
  const BUBBLE_ESCAPE_DAMP_MULT = 0.75; // less resistance while escaping = feels punchier
  const BUBBLE_RETURN_DAMP_MULT = 1.35; // more resistance while returning = feels controlled
  const BUBBLE_SENSITIVITY_GAIN = 1.8;  // extra kick the farther off-level the target sits
  const BUBBLE_SENSITIVITY_POW  = 1.5;  // curve shape -- higher = more dramatic drop-off near dead-center

  /* ---- gauge geometry -----------------------------------------------------
     v7 drew the position dial at r=85 with triangle apex/base/half-width of
     35/10/18 px. Those are kept as ratios of r so the dial can be drawn at
     the larger radius the concept-art panel wants without changing shape. */
  const T_APEX = 35 / 85, T_BASE = 10 / 85, T_HALF = 18 / 85;
  const POS_GAUGE    = { cx: 214, cy: 214, r: 122 };
  const BUBBLE_GAUGE = { cx: 215, cy: 215, r: 140 };

  const YELLOW = '#f5c518';

  function pad3(n) { return String(n).padStart(3, '0'); }

  function stamp(d) {
    const p = (v) => String(v).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ======================================================================== */
  function create(cfg) {
    const posCanvas = cfg.posCanvas;
    const bubbleCanvas = cfg.bubbleCanvas;
    const pctx = posCanvas.getContext('2d');
    const bctx = bubbleCanvas.getContext('2d');

    // Each canvas is backed at 2x its layout size; draw in layout units.
    const PIX = 2;
    pctx.setTransform(PIX, 0, 0, PIX, 0, 0);
    bctx.setTransform(PIX, 0, 0, PIX, 0, 0);
    const POS_W = posCanvas.width / PIX, POS_H = posCanvas.height / PIX;
    const BUB_W = bubbleCanvas.width / PIX, BUB_H = bubbleCanvas.height / PIX;

    /* ---- state (v7's module-scope variables, now on one object) ---------- */
    let levelIndex = 0, pointNum = 1, report = [], running = false, processingClick = false;
    let currentMode = 'bipod';
    let pos = { x:0, y:0 };
    let bubble = { x:0, y:0, vx:0, vy:0 };
    let lastRevealed = { x:0, y:0 };
    let readoutsVisible = true, timeNoInput = 0, driftAngle = null;
    let bubbleActive = false;
    let waitingToStart = true;
    let driftAccumulated = 0;

    /* ---- V11 state -------------------------------------------------------
       activePanel   which gauge the player may touch this instant:
                       'pos'  position dial live, bubble greyed out
                       'bub'  bubble live, position dial greyed out
                       'both' both live -- POLE always, BIPOD once on line
       bubbleHome    the random off-centre spot this point's bubble spawned at
                     and runs back to whenever nobody is steering it
       bubbleHeld    HOLD: the bubble stays where you left it instead of
                     running home. Only true in the BIPOD "both live" endgame
       bubbleGrabbed true while a cursor or finger is actually on the vial
       revealPending seconds left on the readout lag; <= 0 means nothing due
       onLine        both axes inside this level's posToleranceFt as of the
                     last reading                                            */
    let activePanel = 'pos';
    let bubbleHome = { x: 1, y: 0 };
    let bubbleHeld = false;
    let bubbleGrabbed = false;
    let stickHeld = false;        // right thumb stick is being held
    let measureEnabled = false;
    let revealPending = 0;
    let onLine = false;
    let movingLastFrame = false;

    let bubbleTarget = { x: 1, y: 0 }; // starts off-center on purpose so an untouched mouse can't auto-solve it
    let keys = {};
    let lastT = null;
    let rafId = null;
    let active = false;   // true while the player screen owns input
    let roundStartedAt = null;
    const timers = [];

    function later(fn, ms) { const id = setTimeout(fn, ms); timers.push(id); return id; }
    function clearTimers() { while (timers.length) clearTimeout(timers.pop()); }

    const emitHud = () => cfg.onHud && cfg.onHud({
      level: levelIndex + 1,
      point: pointNum,
      totalPoints: LEVELS[levelIndex].points,
      mode: currentMode
    });

    /* The one place the shell learns which gauge is live. It drives the
       border weight, the grey-out, and whether MEASURE is pressable. */
    const emitPanels = () => cfg.onPanelState && cfg.onPanelState({
      activePanel: activePanel,
      posActive: activePanel === 'pos' || activePanel === 'both',
      bubActive: activePanel === 'bub' || activePanel === 'both',
      measureEnabled: measureEnabled,
      bubbleHeld: bubbleHeld,
      onLine: onLine
    });

    function setActivePanel(next) {
      if (activePanel === next) return;
      const leavingBubble = activePanel === 'bub';
      activePanel = next;

      // a finger or cursor on the vial, or a thumb on the stick, does not
      // carry over a hand-off
      bubbleGrabbed = false;
      stickHeld = false;

      // Walking away from the bubble resets it to its off-centre home rather
      // than leaving it parked at the centre you just earned -- otherwise the
      // next hand-off would already be solved before the player touched it.
      if (leavingBubble) {
        bubble.x = bubbleHome.x; bubble.y = bubbleHome.y;
        bubble.vx = 0; bubble.vy = 0;
        bubbleTarget.x = bubbleHome.x; bubbleTarget.y = bubbleHome.y;
      }

      // BIPOD only unlocks MEASURE in the endgame; POLE has it from the off.
      measureEnabled = (currentMode === 'pole') || (activePanel === 'both');
      bubbleHeld = (currentMode === 'bipod') && (activePanel === 'both');
      emitPanels();
    }

    /* "On line" = the LEFT/RIGHT distance AND the TO/AWAY distance are each
       inside this level's foot tolerance. Checked the moment a fresh reading
       lands, which is the moment the player could act on it. In BIPOD this is
       what ends the read/walk/level loop and lights both gauges up. */
    function checkOnLine() {
      const lvl = LEVELS[levelIndex];
      const wasOnLine = onLine;
      onLine = Math.abs(pos.x) < lvl.posToleranceFt && Math.abs(pos.y) < lvl.posToleranceFt;
      if (currentMode === 'bipod' && onLine && activePanel !== 'both') {
        setActivePanel('both');   // emits for us
      } else if (onLine !== wasOnLine) {
        emitPanels();
      }
    }

    /* ---- lifecycle ------------------------------------------------------- */
    function startLevel(i, mode) {
      clearTimers();
      levelIndex = i; pointNum = 1; report = []; running = true;
      currentMode = mode || currentMode;
      roundStartedAt = new Date();
      resetPoint();
      waitingToStart = true;
      active = true;
      cfg.onStartGate && cfg.onStartGate(true);
      emitHud();
      draw();
      if (rafId === null) rafId = requestAnimationFrame(loop);
    }

    function stop() {
      active = false; running = false; waitingToStart = true;
      clearTimers();
      keys = {};
      bubbleGrabbed = false; stickHeld = false; movingLastFrame = false; revealPending = 0;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function doReveal() { lastRevealed = { x: pos.x, y: pos.y }; readoutsVisible = true; }

    function resetPoint() {
      cfg.onMessage && cfg.onMessage('', null);

      const ang = Math.random() * Math.PI * 2;
      const dist = 3 + Math.random() * 9; // hidden start, 3-12 ft
      pos = { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };

      /* The bubble's home. A full-circle random angle, so up, down, left,
         right and everything between all come up -- nothing is favoured and
         nothing is excluded. 0.85-0.98 of the vial radius puts it hard against
         the rim. This is both where it spawns and where it runs back to. */
      const bang = Math.random() * Math.PI * 2;
      const brad = 0.85 + Math.random() * 0.13;
      bubbleHome = { x: Math.cos(bang) * brad, y: Math.sin(bang) * brad };
      bubble = { x: bubbleHome.x, y: bubbleHome.y, vx: 0, vy: 0 };
      bubbleTarget = { x: bubbleHome.x, y: bubbleHome.y };
      bubbleGrabbed = false; stickHeld = false;

      timeNoInput = 0; driftAngle = null; driftAccumulated = 0;
      revealPending = 0; movingLastFrame = false; onLine = false;

      // POLE runs both gauges live from the first frame; BIPOD starts the
      // player on the dial with the bubble dark.
      activePanel = (currentMode === 'pole') ? 'both' : 'pos';
      measureEnabled = (currentMode === 'pole');
      bubbleHeld = false;
      bubbleActive = (currentMode === 'pole');

      doReveal();
      processingClick = false;
      emitHud();
      emitPanels();
    }

    /* ---- input ----------------------------------------------------------- */
    function onKeyDown(e) {
      if (!active) return;
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (['arrowup','arrowdown','arrowleft','arrowright'].includes(k)) e.preventDefault();
      if (k === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (waitingToStart) { openGate(); }
      }
    }
    function onKeyUp(e) { if (!active) return; keys[e.key.toLowerCase()] = false; }
    function onBlur() { keys = {}; }

    /* ---- steering the bubble ------------------------------------------------
       V10 listened for 'mousemove' only. V11 uses pointer events so a finger
       and a mouse take the identical path, and -- the bigger change -- it now
       tracks whether anybody is ACTUALLY on the vial right now, not just where
       they were the last time they moved.

       "Grabbed" means a cursor is inside the vial canvas, or a finger is down
       on it. The moment that stops being true, update() sends the bubble back
       to bubbleHome. That is the fix for the old behaviour where an abandoned
       joystick left the bubble sitting wherever it happened to settle -- which
       near enough always ended up being the centre, solving the level for you
       while you did nothing. */
    function onBubbleGrab(e) {
      if (!active || !bubbleActive) return;
      bubbleGrabbed = true;
      onBubbleMouseMove(e);
    }

    function onBubbleRelease() { bubbleGrabbed = false; }

    function onBubbleMouseMove(e) {
      if (!active || !bubbleActive) return;
      bubbleGrabbed = true;
      const rect = bubbleCanvas.getBoundingClientRect();
      // A canvas with no layout box (zero-sized viewport, hidden tab, print)
      // would make the scale factor Infinity and the product NaN. bubbleTarget
      // feeds the spring, so a single NaN poisons bubble.x/y for the rest of
      // the round -- it never recovers, and drawBubbleGauge then throws on
      // every frame. Drop the event instead; there is no sane reading from a
      // box with no size.
      if (!rect.width || !rect.height) return;
      const mx = (e.clientX - rect.left) * (BUB_W / rect.width);
      const my = (e.clientY - rect.top) * (BUB_H / rect.height);
      // v7 only tracked the mouse over the bubble half of its single canvas;
      // here the bubble canvas *is* that half, so every move on it counts.
      let bx = (mx - BUBBLE_GAUGE.cx) / BUBBLE_GAUGE.r;
      let by = (my - BUBBLE_GAUGE.cy) / BUBBLE_GAUGE.r;
      if (!isFinite(bx) || !isFinite(by)) return;
      const mag = Math.hypot(bx, by);
      if (mag > 1) { bx /= mag; by /= mag; }
      // inverted: the bubble's resting point sits opposite wherever the mouse is
      bubbleTarget.x = -bx;
      bubbleTarget.y = -by;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    bubbleCanvas.addEventListener('pointerenter', onBubbleGrab);
    bubbleCanvas.addEventListener('pointerdown', onBubbleGrab);
    bubbleCanvas.addEventListener('pointermove', onBubbleMouseMove);
    bubbleCanvas.addEventListener('pointerleave', onBubbleRelease);
    bubbleCanvas.addEventListener('pointerup', onBubbleRelease);
    bubbleCanvas.addEventListener('pointercancel', onBubbleRelease);

    function openGate() {
      waitingToStart = false;
      cfg.onStartGate && cfg.onStartGate(false);
      lastT = null;
      // play has actually begun -- this is where the level stopwatch starts,
      // not when the screen appeared, so time spent reading the gate is free
      cfg.onPlayStart && cfg.onPlayStart();
    }

    /* ---- directional input from the on-screen D-pads -----------------------
       These write into the very same `keys` map onKeyDown writes into, so
       update() cannot tell a pad press from a WASD press: identical speed,
       identical per-level move noise, identical bipod lock/unlock, identical
       pole drift. Nothing here reimplements movement. */
    const DIR_KEYS = { up: 'w', down: 's', left: 'a', right: 'd' };

    // V11: a direction only registers while the position dial is one of the
    // live panels. Presses aimed at a greyed-out dial do nothing at all.
    function posPanelLive() { return activePanel === 'pos' || activePanel === 'both'; }

    function setDirection(dir, on) {
      const k = DIR_KEYS[dir];
      if (!k) return;
      keys[k] = (active && posPanelLive()) ? !!on : false;
    }

    function releaseDirections() {
      keys['w'] = false; keys['a'] = false; keys['s'] = false; keys['d'] = false;
    }

    /* ---- V11.2: the right-hand bubble joystick ------------------------------
       The instrument art has a round pad on each side. The LEFT one is a
       four-way D-pad driving WASD, unchanged in behaviour and only enlarged so
       a thumb can hit it. The RIGHT one used to duplicate it, which left the
       bubble with no thumb control at all and made POLE -- which needs walking
       and levelling at once -- unplayable on a phone, because levelling meant
       parking a thumb on the vial itself.

       So the right pad is now an analog joystick for the bubble. It does not
       reimplement anything: it writes the same bubbleTarget the vial and the
       arrow keys write. Inverted, exactly like both of those -- push the stick
       right and the bubble runs left, because you are tilting the rod, not
       dragging the bubble. Position maps straight to tilt, so a small push is
       a small tilt, which is what makes it precise enough to chase a tight
       tolerance with a thumb. */
    function setBubbleStick(nx, ny) {
      if (!active || !bubbleActive) { stickHeld = false; return; }
      stickHeld = true;
      let x = nx, y = ny;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }   // clamp to the pad, no over-travel
      bubbleTarget.x = -x;
      bubbleTarget.y = -y;
    }

    function releaseBubbleStick() { stickHeld = false; }

    // a pad press is a valid way through the start gate; unlike handleClick()
    // it can never fall through into a measurement
    function startIfWaiting() {
      if (active && waitingToStart) openGate();
    }

    function clampMag(o, max) {
      const mag = Math.hypot(o.x, o.y);
      if (mag > max) { o.x = (o.x / mag) * max; o.y = (o.y / mag) * max; }
    }

    /* ---- simulation (verbatim v7 movement/drift; bubble spring is V10) ---- */
    function walk(dt, lvl) {
      const noise = 1 + (Math.random() * 2 - 1) * lvl.moveNoisePct;
      const spd = BASE_SPEED_FT * noise;
      if (keys['w']) pos.y -= spd * dt;
      if (keys['s']) pos.y += spd * dt;
      if (keys['a']) pos.x -= spd * dt;
      if (keys['d']) pos.x += spd * dt;
    }

    function update(dt) {
      const lvl = LEVELS[levelIndex];
      // a direction only counts if the dial it drives is actually live
      const anyKey = posPanelLive() && (keys['w'] || keys['a'] || keys['s'] || keys['d']);

      if (currentMode === 'bipod') {
        /* ---- BIPOD: the read / walk / level hand-off loop -------------------
           pos live  -> press a direction, walk, LET GO
           on release -> control jumps to the bubble IMMEDIATELY (no lag here,
                         by design; the lag belongs on the way back)
           bub live  -> get inside BIPOD_FLIP_TOLERANCE_PCT
           on success -> control jumps back to pos, and the fresh reading takes
                         readoutLagSec to appear
           repeat until on line, then BOTH go live and MEASURE unlocks.        */
        if (anyKey) {
          readoutsVisible = false;
          revealPending = 0;          // a new move cancels any reading in flight
          movingLastFrame = true;
          walk(dt, lvl);
        } else if (movingLastFrame) {
          // the exact frame the last direction was released
          movingLastFrame = false;
          if (activePanel === 'pos') {
            setActivePanel('bub');    // step 3: hand off at once
          } else {
            // already in the both-live endgame -- no hand-off, just re-read
            revealPending = lvl.readoutLagSec;
          }
        }

        if (activePanel === 'bub') {
          const bOffsetPct = Math.hypot(bubble.x, bubble.y) * 100;
          if (bOffsetPct <= BIPOD_FLIP_TOLERANCE_PCT) {
            setActivePanel('pos');
            readoutsVisible = false;
            revealPending = lvl.readoutLagSec;   // step 5: the lag lands here
          }
        }

        bubbleActive = activePanel === 'bub' || activePanel === 'both';
        // bipod position never drifts on its own -- a real bipod just holds it there
      } else {
        // pole-only mode: both panels live throughout, bubble always live,
        // position drifts but capped
        bubbleActive = true;
        if (anyKey) {
          revealPending = 0; readoutsVisible = false;
          movingLastFrame = true;
          walk(dt, lvl);
          timeNoInput = 0; driftAngle = null; driftAccumulated = 0;
        } else {
          // arm the next reading: once on release, then rolling, because the
          // pole keeps drifting and a stale number would be a lie
          if (movingLastFrame) { movingLastFrame = false; revealPending = lvl.readoutLagSec; }
          else if (revealPending <= 0) { revealPending = lvl.readoutLagSec; }

          timeNoInput += dt;
          const dist = Math.hypot(pos.x, pos.y);
          let angle;
          if (dist > 0.02) { angle = Math.atan2(pos.y, pos.x); driftAngle = null; }
          else { if (driftAngle === null) driftAngle = Math.random() * Math.PI * 2; angle = driftAngle; }
          const cappedT = Math.min(timeNoInput, 6);
          const driftSpeed = lvl.posDriftAccel * cappedT;
          const rawStep = driftSpeed * dt;
          // per-level since V11.1; never exceeds this level's driftCapFt in
          // one idle session, and tapping any direction resets the session
          const remainingRoom = Math.max(0, lvl.driftCapFt - driftAccumulated);
          const appliedStep = Math.min(rawStep, remainingRoom);
          driftAccumulated += appliedStep;
          pos.x += Math.cos(angle) * appliedStep;
          pos.y += Math.sin(angle) * appliedStep;
        }
      }

      /* ---- the readout lag ------------------------------------------------
         Nothing appears in the LEFT/RIGHT and TO/AWAY boxes until this runs
         out, so the player watches '---' for readoutLagSec and only then gets
         a number. The on-line test is run against that fresh number, because
         that is the instant the player could actually act on it. */
      if (revealPending > 0) {
        revealPending -= dt;
        if (revealPending <= 0) { revealPending = 0; doReveal(); checkOnLine(); }
      }

      /* ---- steering the bubble ---------------------------------------------
         Arrow keys are the keyboard alternative to dragging on the vial, so
         holding one counts as steering exactly the way a cursor on the vial
         does. Both are "active input". */
      const arrowHeld = keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'];
      if (keys['arrowup']) bubbleTarget.y += ARROW_TARGET_SPEED * dt;
      if (keys['arrowdown']) bubbleTarget.y -= ARROW_TARGET_SPEED * dt;
      if (keys['arrowleft']) bubbleTarget.x += ARROW_TARGET_SPEED * dt;
      if (keys['arrowright']) bubbleTarget.x -= ARROW_TARGET_SPEED * dt;

      /* V11's headline behaviour change. "Steering" means a cursor or finger
         is on the vial, or an arrow key is down. With nobody steering:

           HOLD off -> the bubble's resting point becomes its off-centre home,
                       so letting go throws away whatever centring you had.
                       You have to hold it level, actively, right up to the
                       shot. This is the fix for the old behaviour where an
                       abandoned joystick drifted to centre and solved the
                       level on its own.

           HOLD on  -> the vial is clamped outright: velocity zeroed and the
                       physics skipped entirely, so it sits exactly where you
                       left it until you touch it again. Only the BIPOD
                       endgame turns this on.

         The clamp has to be a real freeze and not "aim the target at wherever
         the bubble already is". That version looks equivalent and is not: it
         cancels the spring but leaves the per-frame random jitter with nothing
         pulling against it, so the bubble random-walks off to the rim within a
         couple of seconds. */
      const steering = bubbleGrabbed || arrowHeld || stickHeld;
      const clamped = bubbleHeld && !steering;

      if (clamped) {
        bubble.vx = 0; bubble.vy = 0;
        bubbleTarget.x = bubble.x; bubbleTarget.y = bubble.y;
      } else if (!steering) {
        bubbleTarget.x = bubbleHome.x; bubbleTarget.y = bubbleHome.y;
      }
      clampMag(bubbleTarget, 1);

      if (bubbleActive && !clamped) {
        // V10 personality: is the mouse/arrow-driven target farther off-level
        // than where the bubble currently sits? If so we're "escaping" and
        // the bubble should snap out fast; otherwise we're "returning" and
        // it should feel controlled. Both effects grow on harder levels via
        // bubbleHump, and the whole thing is scaled globally by
        // BUBBLE_PERSONALITY. At BUBBLE_PERSONALITY = 0 this entire block
        // reduces exactly to the old V9 formula below.
        const targetMag = Math.hypot(bubbleTarget.x, bubbleTarget.y);
        const bubbleMag = Math.hypot(bubble.x, bubble.y);
        const escaping  = targetMag > bubbleMag;
        const levelScale = 1 + lvl.bubbleHump * BUBBLE_PERSONALITY;

        const stiffnessMult = 1 + ((escaping ? BUBBLE_ESCAPE_MULT : BUBBLE_RETURN_MULT) - 1) * BUBBLE_PERSONALITY * levelScale;
        const dampMult      = 1 + ((escaping ? BUBBLE_ESCAPE_DAMP_MULT : BUBBLE_RETURN_DAMP_MULT) - 1) * BUBBLE_PERSONALITY * levelScale;
        const sensitivity   = Math.pow(targetMag, BUBBLE_SENSITIVITY_POW) * BUBBLE_SENSITIVITY_GAIN * BUBBLE_PERSONALITY * levelScale;

        // pendulum: pulled toward the inverted mouse-controlled target, low damping so it swings past and oscillates
        const springK = BUBBLE_SPRING_K * (1 + lvl.bubbleHump * 0.5) * stiffnessMult * (1 + sensitivity);
        const damping = (BUBBLE_DAMPING / (1 + lvl.bubbleHump)) * dampMult;
        let ax = (bubbleTarget.x - bubble.x) * springK - bubble.vx * damping;
        let ay = (bubbleTarget.y - bubble.y) * springK - bubble.vy * damping;
        ax += (Math.random() - 0.5) * lvl.bubbleHump * BUBBLE_JITTER;
        ay += (Math.random() - 0.5) * lvl.bubbleHump * BUBBLE_JITTER;

        bubble.vx += ax * dt; bubble.vy += ay * dt;
        const vmag = Math.hypot(bubble.vx, bubble.vy);
        if (vmag > BUBBLE_MAX_VEL) { bubble.vx = bubble.vx / vmag * BUBBLE_MAX_VEL; bubble.vy = bubble.vy / vmag * BUBBLE_MAX_VEL; }
        bubble.x += bubble.vx * dt; bubble.y += bubble.vy * dt;
        clampMag(bubble, 1);
      }
    }

    function getTriangleStates() {
      // ty/tx are the CURRENT offset from the point. We show which way to GO to fix it,
      // which is the opposite of the current offset direction.
      const ty = lastRevealed.y, tx = lastRevealed.x;
      return { up: ty > EPS, down: ty < -EPS, left: tx > EPS, right: tx < -EPS, ty, tx };
    }

    /* ---- rendering -------------------------------------------------------- */
    function drawTriangle(apex, b1, b2, filled) {
      pctx.beginPath();
      pctx.moveTo(apex.x, apex.y); pctx.lineTo(b1.x, b1.y); pctx.lineTo(b2.x, b2.y); pctx.closePath();
      if (filled) { pctx.fillStyle = YELLOW; pctx.fill(); pctx.strokeStyle = '#000'; pctx.lineWidth = 1; pctx.stroke(); }
      else { pctx.fillStyle = '#000'; pctx.fill(); pctx.strokeStyle = YELLOW; pctx.lineWidth = 2; pctx.stroke(); }
    }

    function drawPositionGauge() {
      const { cx, cy, r } = POS_GAUGE;
      const apex = r + r * T_APEX, base = r + r * T_BASE, half = r * T_HALF;
      pctx.save();

      // dial face: dark radial well with faint concentric rings, per the concept art
      const face = pctx.createRadialGradient(cx, cy - r * 0.25, r * 0.1, cx, cy, r);
      face.addColorStop(0, '#2a2a2a'); face.addColorStop(1, '#111');
      pctx.fillStyle = face;
      pctx.beginPath(); pctx.arc(cx, cy, r, 0, Math.PI * 2); pctx.fill();
      pctx.strokeStyle = '#5a5a5a'; pctx.lineWidth = 2;
      pctx.beginPath(); pctx.arc(cx, cy, r, 0, Math.PI * 2); pctx.stroke();
      pctx.strokeStyle = 'rgba(255,255,255,0.09)'; pctx.lineWidth = 1.5;
      [0.66, 0.33].forEach(function (f) { pctx.beginPath(); pctx.arc(cx, cy, r * f, 0, Math.PI * 2); pctx.stroke(); });
      pctx.strokeStyle = 'rgba(255,255,255,0.13)';
      pctx.beginPath(); pctx.moveTo(cx - r, cy); pctx.lineTo(cx + r, cy);
      pctx.moveTo(cx, cy - r); pctx.lineTo(cx, cy + r); pctx.stroke();
      pctx.fillStyle = '#666'; pctx.fillRect(cx - 4, cy - 4, 8, 8);

      const s = getTriangleStates();
      drawTriangle({x:cx,y:cy-apex}, {x:cx-half,y:cy-base}, {x:cx+half,y:cy-base}, s.up);
      drawTriangle({x:cx,y:cy+apex}, {x:cx-half,y:cy+base}, {x:cx+half,y:cy+base}, s.down);
      drawTriangle({x:cx-apex,y:cy}, {x:cx-base,y:cy-half}, {x:cx-base,y:cy+half}, s.left);
      drawTriangle({x:cx+apex,y:cy}, {x:cx+base,y:cy-half}, {x:cx+base,y:cy+half}, s.right);

      /* Display only: the white pip the concept art shows in the dial. It plots
         the SAME reading the LEFT/RIGHT and TO/AWAY boxes are already showing,
         on a compressed radial scale, and hides itself whenever those readouts
         hide.

         V11 turns it from a 6px dot into a PIP_RADIUS blob with a soft edge.
         That is deliberate: you can see roughly which way the point lies and
         you cannot possibly eyeball it to the foot, so the last of the
         precision has to come off the bubble instead of off this dial. The
         soft falloff is a radial gradient, which every browser draws; the
         canvas blur filter on top is a bonus where it is supported and simply
         does nothing where it is not. */
      if (readoutsVisible) {
        const d = Math.hypot(lastRevealed.x, lastRevealed.y);
        if (d > 0.0001) {
          const rr = r * 0.92 * (1 - Math.exp(-d / 4));
          const px = cx + (lastRevealed.x / d) * rr;
          const py = cy + (lastRevealed.y / d) * rr;
          pctx.save();
          // clip to the dial face so the blob cannot smear over the bezel
          pctx.beginPath(); pctx.arc(cx, cy, r, 0, Math.PI * 2); pctx.clip();
          if ('filter' in pctx) pctx.filter = 'blur(' + PIP_BLUR_PX + 'px)';
          const haze = pctx.createRadialGradient(px, py, 0, px, py, PIP_RADIUS);
          haze.addColorStop(0,    'rgba(255,255,255,0.55)');
          haze.addColorStop(0.45, 'rgba(255,255,255,0.26)');
          haze.addColorStop(0.75, 'rgba(255,255,255,0.09)');
          haze.addColorStop(1,    'rgba(255,255,255,0)');
          pctx.fillStyle = haze;
          pctx.beginPath(); pctx.arc(px, py, PIP_RADIUS, 0, Math.PI * 2); pctx.fill();
          pctx.restore();
        }
      }
      pctx.restore();
    }

    function drawBubbleGauge() {
      const { cx, cy, r } = BUBBLE_GAUGE;
      const lvl = LEVELS[levelIndex];
      const live = bubbleActive;
      bctx.save();

      // machined bezel
      const bez = bctx.createLinearGradient(cx, cy - r - 16, cx, cy + r + 16);
      bez.addColorStop(0, '#4a4a4a'); bez.addColorStop(0.5, '#1a1a1a'); bez.addColorStop(1, '#3d3d3d');
      bctx.fillStyle = bez;
      bctx.beginPath(); bctx.arc(cx, cy, r + 16, 0, Math.PI * 2); bctx.fill();

      // silver retaining ring
      bctx.strokeStyle = live ? '#d8d8d8' : '#5c5c5c'; bctx.lineWidth = 7;
      bctx.beginPath(); bctx.arc(cx, cy, r + 6, 0, Math.PI * 2); bctx.stroke();

      // the vial itself
      const vial = bctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
      if (live) { vial.addColorStop(0, '#2f9e2f'); vial.addColorStop(0.62, '#1eae1e'); vial.addColorStop(0.88, '#22d422'); vial.addColorStop(1, '#0d6b0d'); }
      else       { vial.addColorStop(0, '#2b2b2b'); vial.addColorStop(0.88, '#333333'); vial.addColorStop(1, '#1a1a1a'); }
      bctx.fillStyle = vial;
      bctx.beginPath(); bctx.arc(cx, cy, r, 0, Math.PI * 2); bctx.fill();

      // crosshair + centring circle etched on the glass
      bctx.strokeStyle = live ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.2)'; bctx.lineWidth = 2;
      bctx.beginPath();
      bctx.moveTo(cx - r, cy); bctx.lineTo(cx + r, cy);
      bctx.moveTo(cx, cy - r); bctx.lineTo(cx, cy + r);
      bctx.stroke();
      bctx.beginPath(); bctx.arc(cx, cy, r * 0.30, 0, Math.PI * 2); bctx.stroke();

      // dashed yellow ring = this level's bubble PASS tolerance (v7)
      bctx.setLineDash([7, 7]);
      bctx.strokeStyle = live ? YELLOW : '#4a4a3a'; bctx.lineWidth = 2;
      bctx.beginPath(); bctx.arc(cx, cy, r * (lvl.bubbleTolerancePct / 100), 0, Math.PI * 2); bctx.stroke();

      // V11: while BIPOD has handed control to the bubble, a second white ring
      // shows the hand-off gate -- reach inside it and control goes back to
      // the dial. It is a different target from the yellow pass ring above and
      // is drawn only while it is the thing you are actually chasing.
      if (activePanel === 'bub') {
        bctx.strokeStyle = 'rgba(255,255,255,0.85)'; bctx.lineWidth = 2;
        bctx.beginPath(); bctx.arc(cx, cy, r * (BIPOD_FLIP_TOLERANCE_PCT / 100), 0, Math.PI * 2); bctx.stroke();
      }
      bctx.setLineDash([]);

      // yellow index bars at the four cardinals
      bctx.fillStyle = live ? YELLOW : '#5a5227';
      const bw = 12, bl = 26;
      bctx.fillRect(cx - bw / 2, cy - r - bl / 2, bw, bl);
      bctx.fillRect(cx - bw / 2, cy + r - bl / 2, bw, bl);
      bctx.fillRect(cx - r - bl / 2, cy - bw / 2, bl, bw);
      bctx.fillRect(cx + r - bl / 2, cy - bw / 2, bl, bw);

      // the bubble
      const dx = cx + bubble.x * r, dy = cy + bubble.y * r;
      const bub = bctx.createRadialGradient(dx - 6, dy - 7, 1, dx, dy, 21);
      if (live) { bub.addColorStop(0, '#e6ffd0'); bub.addColorStop(0.35, '#8bf05a'); bub.addColorStop(1, '#2ea814'); }
      else       { bub.addColorStop(0, '#6a6a6a'); bub.addColorStop(1, '#333333'); }
      bctx.fillStyle = bub;
      bctx.beginPath(); bctx.arc(dx, dy, 21, 0, Math.PI * 2); bctx.fill();
      bctx.strokeStyle = live ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.15)'; bctx.lineWidth = 2; bctx.stroke();
      if (live) {
        bctx.fillStyle = 'rgba(255,255,255,0.85)';
        bctx.beginPath(); bctx.ellipse(dx - 6, dy - 8, 5, 3.5, -0.6, 0, Math.PI * 2); bctx.fill();
      }

      // glass sheen across the top of the vial
      const sheen = bctx.createLinearGradient(cx, cy - r, cx, cy);
      sheen.addColorStop(0, 'rgba(255,255,255,0.22)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      bctx.save();
      bctx.beginPath(); bctx.arc(cx, cy, r, 0, Math.PI * 2); bctx.clip();
      bctx.fillStyle = sheen; bctx.fillRect(cx - r, cy - r, r * 2, r); bctx.restore();

      /* Caption. V8 hung this below the vial at cy+r+46 and cy+r+68, which in
         art pixels is y=691 and y=712. with_measure_and_clock.png puts the
         TIMESTAMP housing there (it starts at art y=666, and this canvas has
         already drawn the bezel out to y=662), so below is gone. The one band
         still clear inside the panel is above the vial: art y[332,356], which
         is layout y[30,55] here. So the two lines become one compact line at
         layout y=50. Wording and placement only -- the offset reading and the
         tolerance it is compared against are exactly as before. */
      const CAP_Y = 50;
      const offsetPct = (Math.hypot(bubble.x, bubble.y) * 100).toFixed(1);
      bctx.textAlign = 'center';
      if (bubbleHeld) {
        // the BIPOD endgame: nothing is running away from you any more
        bctx.fillStyle = YELLOW; bctx.font = 'bold 17px "Courier New", monospace';
        bctx.fillText('HELD ' + offsetPct + '%   TOL ' + lvl.bubbleTolerancePct + '%', cx, CAP_Y);
      } else if (activePanel === 'bub') {
        // chasing the hand-off gate, so quote that number, not the pass mark
        bctx.fillStyle = YELLOW; bctx.font = 'bold 17px "Courier New", monospace';
        bctx.fillText('OFFSET ' + offsetPct + '%   GATE ' + BIPOD_FLIP_TOLERANCE_PCT + '%', cx, CAP_Y);
      } else if (live) {
        bctx.fillStyle = YELLOW; bctx.font = 'bold 17px "Courier New", monospace';
        bctx.fillText('OFFSET ' + offsetPct + '%   TOL ' + lvl.bubbleTolerancePct + '%', cx, CAP_Y);
      } else {
        bctx.fillStyle = '#8a8a8a'; bctx.font = 'bold 15px "Courier New", monospace';
        bctx.fillText('LOCKED \u2014 WALK, THEN RELEASE', cx, CAP_Y);
      }
      bctx.restore();
    }

    function pushReadouts() {
      const s = getTriangleStates();
      const fmt = function (on, val) { return (readoutsVisible && on) ? Math.abs(val).toFixed(3) : '---'; };
      cfg.onReadouts && cfg.onReadouts({
        left:  fmt(s.left,  s.tx),
        right: fmt(s.right, s.tx),
        to:    fmt(s.up,    s.ty),
        away:  fmt(s.down,  s.ty),
        bubble: bubbleActive ? (Math.hypot(bubble.x, bubble.y) * 100).toFixed(1) : 'LOCKED'
      });
    }

    function draw() {
      pctx.clearRect(0, 0, POS_W, POS_H);
      bctx.clearRect(0, 0, BUB_W, BUB_H);
      drawPositionGauge();
      drawBubbleGauge();
      pushReadouts();
    }

    function loop(t) {
      if (lastT === null) lastT = t;
      const dt = Math.min((t - lastT) / 1000, 0.05);
      lastT = t;
      if (running && !waitingToStart) { update(dt); draw(); }
      rafId = requestAnimationFrame(loop);
    }

    /* ---- measure (v7's window click handler) ------------------------------ */
    function handleClick() {
      if (!active) return;
      if (waitingToStart) { openGate(); return; }
      if (!running || processingClick) return;
      // V11: in BIPOD, MEASURE does nothing at all until you are on line and
      // both gauges have gone live. In POLE it is available from the off, so
      // this never blocks there.
      if (!measureEnabled) return;
      const lvl = LEVELS[levelIndex];
      const hOffsetFt = Math.hypot(pos.x, pos.y);
      const bOffsetPct = Math.hypot(bubble.x, bubble.y) * 100;
      const pass = hOffsetFt <= lvl.posToleranceFt && bOffsetPct <= lvl.bubbleTolerancePct;

      const now = new Date();
      report.push({
        point: pointNum,
        pointLabel: pad3(pointNum),
        time: now.toLocaleTimeString(),
        timestamp: stamp(now),
        hOffset: hOffsetFt.toFixed(3),
        bOffset: bOffsetPct.toFixed(1),
        pass: pass
      });
      cfg.onMessage && cfg.onMessage(
        pass ? '✔ WITHIN TOLERANCE — STAKED' : '✘ OUT OF TOLERANCE — LOGGED ANYWAY',
        pass
      );

      processingClick = true;
      if (pointNum >= lvl.points) {
        running = false;
        later(function () {
          active = false;
          cfg.onRoundComplete && cfg.onRoundComplete({
            level: levelIndex,
            levelName: LEVELS[levelIndex].name,
            mode: currentMode,
            startedAt: roundStartedAt,
            tolerance: lvl.posToleranceFt,
            rows: report.slice()
          });
        }, 600);
      } else {
        pointNum++;
        later(resetPoint, 500);
      }
    }

    function destroy() {
      stop();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      bubbleCanvas.removeEventListener('pointerenter', onBubbleGrab);
      bubbleCanvas.removeEventListener('pointerdown', onBubbleGrab);
      bubbleCanvas.removeEventListener('pointermove', onBubbleMouseMove);
      bubbleCanvas.removeEventListener('pointerleave', onBubbleRelease);
      bubbleCanvas.removeEventListener('pointerup', onBubbleRelease);
      bubbleCanvas.removeEventListener('pointercancel', onBubbleRelease);
    }

    return {
      startLevel: startLevel,
      stop: stop,
      destroy: destroy,
      handleClick: handleClick,
      setDirection: setDirection,
      releaseDirections: releaseDirections,
      setBubbleStick: setBubbleStick,
      releaseBubbleStick: releaseBubbleStick,
      startIfWaiting: startIfWaiting,
      get isActive() { return active; },
      // read-only windows into V11 state, for console poking and headless checks
      get activePanel() { return activePanel; },
      get measureEnabled() { return measureEnabled; },
      get bubbleHeld() { return bubbleHeld; },
      get onLine() { return onLine; },
      get bubbleOffsetPct() { return Math.hypot(bubble.x, bubble.y) * 100; }
    };
  }

  return {
    LEVELS: LEVELS,
    create: create,
    DRIFT_CAP_FT: DRIFT_CAP_FT,
    BASE_SPEED_FT: BASE_SPEED_FT,
    BIPOD_FLIP_TOLERANCE_PCT: BIPOD_FLIP_TOLERANCE_PCT
  };
})();
