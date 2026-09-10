# STAKE-OUT — Sandbox Test Containers

Isolated rigs for testing **one Stake-Out screen mechanic at a time**, away
from the full game. Nothing in here ships. Nothing in here is loaded by the
game at `/index.html`.

The rule for this folder: **reuse, don't re-implement.** The physics is the
main build's engine, not a rewrite — so a fix proven here is a fix to the real
engine, not to a copy that has to be re-derived later.

One deployment compromise sits on top of that rule. See
[Known port-back cleanup](#known-port-back-cleanup) before you edit anything
in `js/`.

---

## Running it

Same as the main game: it needs to be served, not opened as a `file://` URL.

```bash
python -m http.server 8080
```

Then open <http://localhost:8080/sandbox-test/>.

To reproduce the **deployed** layout exactly — Netlify publishes this folder
as the site root — serve from inside it instead:

```bash
cd sandbox-test && python -m http.server 8080
```

Then open <http://localhost:8080/>. Anything that only works from the repo
root is broken on the deployed site.

---

## Container 1 — LEFT SCREEN (pole / walk movement)

**Status: built, awaiting playtest feedback.**

Isolates exactly six things:

| In | Out |
|---|---|
| Round "map" dial | Bubble vial |
| Yellow directional arrows | Clock / stopwatch |
| White point pip that hides while a direction is held | Field report + exports |
| Live TO/AWAY and LEFT/RIGHT readout cards | Menu artwork / concept-art backgrounds |
| Discrete 4-way D-pad (no smoothing) | Second D-pad, second MEASURE disc |
| MEASURE button | Everything on the right screen |

### Rig options on the START screen

Not part of the shipping shell — they exist so tolerances and both movement
modes can be felt back to back without a redeploy.

- **Level 1–4** — picks the position tolerance (±0.300 ft down to ±0.020 ft)
  and the number of points in the round.
- **BIPOD / POLE** — how the readout hides and returns:
  - *BIPOD*: readings hide the instant a direction goes down and return the
    instant it lifts. Position never moves on its own.
  - *POLE*: readings return ~1 s after you stop, and the position drifts
    while you stand still, capped at 0.200 ft per idle session.

### Reading the cards

The engine sends `---` both when a reading is hidden and when that axis is
inside the 0.03 ft dead zone, so the rig separates them:

| Card shows | Means |
|---|---|
| Dim `---` | You're walking. No reading while you move. |
| `ON LINE` | That axis is within the dead zone — you're on it. |
| A number, with the direction lit | Walk that way, that far. |

---

## Container 2 — RIGHT SCREEN (bubble level)

**Status: first pass built, awaiting playtest feedback.** Lives at
`container2/`, deployed to `/container2/`. Container 1 is untouched by it.

Isolates the vial, an analog joystick and MEASURE. No position map, no
directional arrows, no readout cards, no clock.

### The bug it exists to fix

In V10 the on-screen pads have **no effect on the bubble**. That was never a
physics problem — it is a missing wire. `bubbleTarget` in `game-engine.js`
has exactly two writers:

1. `onBubbleMouseMove()` — a real mouse moving over the vial canvas
2. the **arrow** keys, in `update()`

The pads call `setDirection()`, which writes `keys['w'|'a'|'s'|'d']`, and
`update()` only ever applies those four to `pos.x` / `pos.y`. So the pads
drive the player's *position*. Nothing reachable by a thumb was ever
connected to the bubble.

### The fix attempted

Rather than edit the engine — shared byte-for-byte with Container 1 and the
main game — the shell feeds the joystick through the engine's one existing
analog bubble input: the vial's own `mousemove` handler. Each frame it
synthesises a mousemove at the canvas coordinate the stick points at, which
is exactly what a desktop mouse already does.

That yields the inverse for free, because the engine already inverts:

```js
bubbleTarget.x = -bx;   // "the bubble's resting point sits
bubbleTarget.y = -by;   //  opposite wherever the mouse is"
```

Push the stick toward the bubble and the bubble is driven away from that
side. Verified empirically by frame-differencing the vial canvas: correct on
all four axes.

### Rig options

- **Level 1–4** — bubble tolerance (30% → 3%) and, via `bubbleHump`,
  how twitchy the vial is.
- **Stick gain** SOFT / NORMAL / SHARP — how far a full push asks the
  bubble to travel. Shell-side only.
- **Stick return** HOLD / SPRING — HOLD leaves the tilt where you put it,
  matching the mouse in the real game. SPRING recentres on release, which
  also commands the bubble back to level.

`NEW TILT` re-randomises the bubble to 0.85–0.98 off centre for a fresh
correction to make.

Mode is hard-wired to **POLE**. In BIPOD the vial only unlocks after the
player walks and then releases, and this container has no walking — the
bubble would stay locked and dead forever.

---

## The global measure fix

The full game's `js/app.js` carries a stage-wide click listener that fires a
measurement from a tap anywhere that isn't a control:

```js
playerStage.addEventListener('click', function (e) {
  if (e.target && e.target.closest && e.target.closest('[data-nomeasure]')) return;
  game.handleClick();
});
```

**This folder has no equivalent, by design and permanently.** `onMeasureUp()`
in `js/container1.js` is the only path to `game.handleClick()`. The desktop
click-anywhere fallback is deliberately dropped rather than replaced — a
proper desktop input scheme gets mapped once mobile is settled.

**Still to do in the main game:** delete that listener from `js/app.js` and
the `data-nomeasure` attribute it depends on in `index.html`. Not done yet —
the port back to the main build happens only after both containers, and then
the combined split screen, are confirmed working.

---

## What changed in the shared engine

`../js/game-engine.js` picked up three additive, default-off changes so a
position-only rig is possible at all. The full game passes none of them, so
its behaviour is unchanged:

1. **`cfg.bubbleCanvas` is now optional.** Omit it and no vial is drawn, no
   mouse listener is bound, and no bubble is scored.
2. **`positionOnly`** — implied by omitting `bubbleCanvas`, or forced with
   `cfg.positionOnly`. Scoring and the BIPOD reveal run on position alone.
   Without it, a rig with no visible vial would still be graded on a bubble
   the player cannot see or reach, and every shot would fail at Level 4.
3. **`onReadouts` gained a `visible` field** so a shell can tell "hidden
   while walking" apart from "dead on line". The shipping shell ignores it.

The `LEVELS` table, `BASE_SPEED_FT`, `REVEAL_DELAY`, `EPS`, `DRIFT_CAP_FT`,
every bubble spring constant, the bipod lock cycle, the pole drift cap and the
position tolerance test are all **untouched**.

---

## Known port-back cleanup

**`sandbox-test/js/game-engine.js` is a duplicate of `js/game-engine.js`.**

Netlify publishes this folder **as the site root**, so on the deployed site
nothing above `sandbox-test/` exists. The original `<script src="../js/…">`
resolved to `/js/game-engine.js`, returned 404, and left `StakeOut` undefined
— which threw `ReferenceError: StakeOut is not defined` on every START press
and looked like a mobile freeze rather than a clean failure. The folder now
carries its own copy so it is self-contained for deploy.

This is a deliberate, temporary trade against the reuse rule above.

**The risk:** edit `js/game-engine.js` and forget this copy, and the sandbox
silently tests stale physics while appearing to work. Guard against it:

```bash
sh sandbox-test/sync-engine.sh                    # re-copy after any engine edit
diff js/game-engine.js sandbox-test/js/game-engine.js   # must be empty
```

**Before merging back into the main game — do not skip:**

1. `diff` the two files and reconcile any drift. The main build's copy wins
   unless the sandbox's changes are the fix being ported.
2. Delete `sandbox-test/js/game-engine.js` and `sandbox-test/sync-engine.sh`.
3. The main game loads `js/game-engine.js` from the repo root and never needed
   the duplicate; nothing in the shipping build should reference it.

The cleaner long-term fix is to set Netlify's publish directory to the repo
root and serve the sandbox at `/sandbox-test/`, which removes the need for a
copy entirely. Left alone for now so the sandbox keeps its own site.

`container2/` loads `../js/game-engine.js` — that reaches up to the *same*
vendored copy Container 1 uses, which is still inside the published root. It
is not a second duplicate, and it must not become one.

### Container 2's debts

Both exist only because the engine is shared and could not be edited on this
pass. Both should be paid before the port back:

1. **The synthetic-mousemove adapter should become a real engine method.**
   `driveBubble()` in `container2/js/container2.js` fakes a mouse event to
   reach `bubbleTarget`. The clean version is a first-class
   `setBubbleVector(x, y)` on the engine, mirroring `setDirection()` — that
   is the actual fix the main game needs, and it deletes both the adapter
   and the `GAUGE_R_RATIO` constant that currently mirrors `BUBBLE_GAUGE`.
2. **Bubble-only scoring should become a `bubbleOnly` flag**, mirroring
   `positionOnly`. Container 2 currently does its own one-line tolerance
   test in the shell because the engine's `handleClick()` also grades
   horizontal position, and this rig starts the player 3–12 ft away with no
   way to walk — every shot would fail for a reason you cannot see.

---

## Build order

1. **Container 1** — left screen. Confirmed working.
2. **Container 2** — right screen (bubble level, inverse joystick).
   ← *you are here*: bubble responds correctly, feel still needs tuning.
3. **Combined** — both halves on one screen, as they'll appear in-game.
4. **Port back** into the main build. Only after step 3 is confirmed.
