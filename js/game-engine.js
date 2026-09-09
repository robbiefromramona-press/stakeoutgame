/* ==========================================================================
   STAKE-OUT V8 — game engine
   --------------------------------------------------------------------------
   Ported from reference/stake-out-prototype-v7.html. The LEVELS table, every
   tuning constant, the bipod lock/unlock cycle, the pole-mode drift cap and
   the pass/fail test are carried over unchanged. The only reshaping is
   plumbing: v7 kept its state in bare module-scope variables and drew both
   gauges into one 900x380 canvas; V8 keeps state on a game object and draws
   into the two separate panel canvases the shell positions over the artwork.
   Gauge geometry is expressed as ratios of v7's own numbers so the gauges
   scale up to the concept-art panels without changing their proportions.
   ========================================================================== */

const StakeOut = (function () {
  'use strict';

  /* ---- v7 configuration: do not retune ---------------------------------- */
  const LEVELS = [
    { name:"Level 1 — Rookie",            points:3, posToleranceFt:0.30, bubbleTolerancePct:30, bubbleHump:0.15, posDriftAccel:0.6, moveNoisePct:0.05 },
    { name:"Level 2 — Journeyman",        points:4, posToleranceFt:0.15, bubbleTolerancePct:18, bubbleHump:0.30, posDriftAccel:1.0, moveNoisePct:0.12 },
    { name:"Level 3 — Foreman",           points:5, posToleranceFt:0.06, bubbleTolerancePct:9,  bubbleHump:0.50, posDriftAccel:1.6, moveNoisePct:0.20 },
    { name:"Level 4 — No Room For Error", points:6, posToleranceFt:0.02, bubbleTolerancePct:3,  bubbleHump:0.80, posDriftAccel:2.4, moveNoisePct:0.30 },
  ];

  const BASE_SPEED_FT = 2.2;   // ft/sec base WASD speed
  const REVEAL_DELAY = 1.0;    // seconds still before a fresh readout appears
  const EPS = 0.03;            // ft dead-zone before a triangle counts as "reached"
  const DRIFT_CAP_FT = 0.2;    // pole-mode drift can never wander further than this per idle session
  const BUBBLE_SPRING_K = 6, BUBBLE_DAMPING = 0.6, ARROW_TARGET_SPEED = 1.4, BUBBLE_MAX_VEL = 6.0;

  /* ---- gauge geometry ---------------------------------------------------
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
    let readoutsVisible = true, revealTimer = 0, timeNoInput = 0, driftAngle = null;
    let bubbleActive = false;
    let waitingToStart = true;
    let hasMovedThisPoint = false;
    let bipodBubbleUnlocked = false;
    let driftAccumulated = 0;
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
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function doReveal() { lastRevealed = { x: pos.x, y: pos.y }; readoutsVisible = true; }

    function resetPoint() {
      cfg.onMessage && cfg.onMessage('', null);

      const ang = Math.random() * Math.PI * 2;
      const dist = 3 + Math.random() * 9; // hidden start, 3-12 ft
      pos = { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };

      const bang = Math.random() * Math.PI * 2;
      const brad = 0.85 + Math.random() * 0.13; // way off to one side
      bubble = { x: Math.cos(bang) * brad, y: Math.sin(bang) * brad, vx: 0, vy: 0 };

      timeNoInput = 0; driftAngle = null; revealTimer = 0; driftAccumulated = 0;
      hasMovedThisPoint = false; bipodBubbleUnlocked = false;
      doReveal();
      processingClick = false;
      emitHud();
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

    function onBubbleMouseMove(e) {
      if (!active) return;
      const rect = bubbleCanvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (BUB_W / rect.width);
      const my = (e.clientY - rect.top) * (BUB_H / rect.height);
      // v7 only tracked the mouse over the bubble half of its single canvas;
      // here the bubble canvas *is* that half, so every move on it counts.
      let bx = (mx - BUBBLE_GAUGE.cx) / BUBBLE_GAUGE.r;
      let by = (my - BUBBLE_GAUGE.cy) / BUBBLE_GAUGE.r;
      const mag = Math.hypot(bx, by);
      if (mag > 1) { bx /= mag; by /= mag; }
      // inverted: the bubble's resting point sits opposite wherever the mouse is
      bubbleTarget.x = -bx;
      bubbleTarget.y = -by;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    bubbleCanvas.addEventListener('mousemove', onBubbleMouseMove);

    function openGate() {
      waitingToStart = false;
      cfg.onStartGate && cfg.onStartGate(false);
      lastT = null;
    }

    function clampMag(o, max) {
      const mag = Math.hypot(o.x, o.y);
      if (mag > max) { o.x = (o.x / mag) * max; o.y = (o.y / mag) * max; }
    }

    /* ---- simulation (verbatim v7) ---------------------------------------- */
    function update(dt) {
      const lvl = LEVELS[levelIndex];
      const anyKey = keys['w'] || keys['a'] || keys['s'] || keys['d'];

      if (currentMode === 'bipod') {
        if (anyKey) {
          // moving always locks the bubble immediately, no matter what state it was in
          bipodBubbleUnlocked = false;
          hasMovedThisPoint = true;
          readoutsVisible = false;
          const noise = 1 + (Math.random() * 2 - 1) * lvl.moveNoisePct;
          const spd = BASE_SPEED_FT * noise;
          if (keys['w']) pos.y -= spd * dt;
          if (keys['s']) pos.y += spd * dt;
          if (keys['a']) pos.x -= spd * dt;
          if (keys['d']) pos.x += spd * dt;
        } else {
          // just released a key -- only unlock the bubble if they've moved at least once
          if (!bipodBubbleUnlocked && hasMovedThisPoint) { bipodBubbleUnlocked = true; }
          if (bipodBubbleUnlocked) {
            const bOffsetPct = Math.hypot(bubble.x, bubble.y) * 100;
            if (bOffsetPct <= lvl.bubbleTolerancePct) {
              bipodBubbleUnlocked = false; // re-lock immediately on success
              readoutsVisible = true;
              doReveal();
            }
          }
        }
        bubbleActive = bipodBubbleUnlocked;
        // bipod position never drifts on its own -- a real bipod just holds it there
      } else {
        // pole-only mode: bubble always live, position drifts but capped
        bubbleActive = true;
        if (anyKey) {
          revealTimer = 0; readoutsVisible = false;
          const noise = 1 + (Math.random() * 2 - 1) * lvl.moveNoisePct;
          const spd = BASE_SPEED_FT * noise;
          if (keys['w']) pos.y -= spd * dt;
          if (keys['s']) pos.y += spd * dt;
          if (keys['a']) pos.x -= spd * dt;
          if (keys['d']) pos.x += spd * dt;
          timeNoInput = 0; driftAngle = null; driftAccumulated = 0;
        } else {
          revealTimer += dt;
          if (revealTimer >= REVEAL_DELAY) { doReveal(); revealTimer = 0; }

          timeNoInput += dt;
          const dist = Math.hypot(pos.x, pos.y);
          let angle;
          if (dist > 0.02) { angle = Math.atan2(pos.y, pos.x); driftAngle = null; }
          else { if (driftAngle === null) driftAngle = Math.random() * Math.PI * 2; angle = driftAngle; }
          const cappedT = Math.min(timeNoInput, 6);
          const driftSpeed = lvl.posDriftAccel * cappedT;
          const rawStep = driftSpeed * dt;
          const remainingRoom = Math.max(0, DRIFT_CAP_FT - driftAccumulated);
          const appliedStep = Math.min(rawStep, remainingRoom); // never exceeds 0.200 ft total this idle session
          driftAccumulated += appliedStep;
          pos.x += Math.cos(angle) * appliedStep;
          pos.y += Math.sin(angle) * appliedStep;
        }
      }

      // arrow keys nudge the (inverted) target continuously, regardless of lock state
      if (keys['arrowup']) bubbleTarget.y += ARROW_TARGET_SPEED * dt;
      if (keys['arrowdown']) bubbleTarget.y -= ARROW_TARGET_SPEED * dt;
      if (keys['arrowleft']) bubbleTarget.x += ARROW_TARGET_SPEED * dt;
      if (keys['arrowright']) bubbleTarget.x -= ARROW_TARGET_SPEED * dt;
      clampMag(bubbleTarget, 1);

      if (bubbleActive) {
        // pendulum: pulled toward the inverted mouse-controlled target, low damping so it swings past and oscillates
        const springK = BUBBLE_SPRING_K * (1 + lvl.bubbleHump * 0.5);
        const damping = BUBBLE_DAMPING / (1 + lvl.bubbleHump);
        let ax = (bubbleTarget.x - bubble.x) * springK - bubble.vx * damping;
        let ay = (bubbleTarget.y - bubble.y) * springK - bubble.vy * damping;
        ax += (Math.random() - 0.5) * lvl.bubbleHump * 1.5;
        ay += (Math.random() - 0.5) * lvl.bubbleHump * 1.5;

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

      // Display only: the white pip the concept art shows in the dial. It plots the
      // SAME reading the LEFT/RIGHT and TO/AWAY boxes are already showing, on a
      // compressed radial scale, and hides itself whenever those readouts hide.
      if (readoutsVisible) {
        const d = Math.hypot(lastRevealed.x, lastRevealed.y);
        if (d > 0.0001) {
          const rr = r * 0.92 * (1 - Math.exp(-d / 4));
          const px = cx + (lastRevealed.x / d) * rr;
          const py = cy + (lastRevealed.y / d) * rr;
          pctx.fillStyle = '#fff';
          pctx.beginPath(); pctx.arc(px, py, 6, 0, Math.PI * 2); pctx.fill();
          pctx.strokeStyle = 'rgba(0,0,0,0.6)'; pctx.lineWidth = 1; pctx.stroke();
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

      // dashed ring = this level's bubble tolerance (v7)
      bctx.setLineDash([7, 7]);
      bctx.strokeStyle = live ? YELLOW : '#4a4a3a'; bctx.lineWidth = 2;
      bctx.beginPath(); bctx.arc(cx, cy, r * (lvl.bubbleTolerancePct / 100), 0, Math.PI * 2); bctx.stroke();
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

      // caption under the vial
      bctx.textAlign = 'center';
      if (live) {
        bctx.fillStyle = YELLOW; bctx.font = 'bold 21px "Courier New", monospace';
        bctx.fillText('OFFSET ' + (Math.hypot(bubble.x, bubble.y) * 100).toFixed(1) + '%', cx, cy + r + 46);
        bctx.fillStyle = '#777777'; bctx.font = 'bold 14px "Courier New", monospace';
        bctx.fillText('TOLERANCE ' + lvl.bubbleTolerancePct + '%', cx, cy + r + 68);
      } else {
        bctx.fillStyle = '#8a8a8a'; bctx.font = 'bold 20px "Courier New", monospace';
        bctx.fillText('LOCKED', cx, cy + r + 46);
        bctx.fillStyle = '#5f5f5f'; bctx.font = 'bold 13px "Courier New", monospace';
        bctx.fillText('MOVE, THEN RELEASE TO UNLOCK', cx, cy + r + 68);
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
      bubbleCanvas.removeEventListener('mousemove', onBubbleMouseMove);
    }

    return {
      startLevel: startLevel,
      stop: stop,
      destroy: destroy,
      handleClick: handleClick,
      get isActive() { return active; }
    };
  }

  return { LEVELS: LEVELS, create: create, DRIFT_CAP_FT: DRIFT_CAP_FT, BASE_SPEED_FT: BASE_SPEED_FT };
})();
