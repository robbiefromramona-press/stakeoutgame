# STAKE-OUT — Sandbox Test Containers

Isolated rigs for testing **one Stake-Out screen mechanic at a time**, away
from the full game. Nothing in here ships. Nothing in here is loaded by the
game at `/index.html`.

The rule for this folder: **reuse, don't re-implement.** Every container loads
`../js/game-engine.js` — the exact file the real game loads — so a fix proven
here is a fix to the real engine, not to a copy that has to be re-derived
later.

---

## Running it

Same as the main game: it needs to be served, not opened as `file://`,
because it reaches up one level for the engine.

```bash
python -m http.server 8080
```

Then open <http://localhost:8080/sandbox-test/>.

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

## Build order

1. **Container 1** — left screen. ← *you are here*
2. **Container 2** — right screen (bubble level, inverse joystick). Not started.
3. **Combined** — both halves on one screen, as they'll appear in-game.
4. **Port back** into the main build. Only after step 3 is confirmed.
