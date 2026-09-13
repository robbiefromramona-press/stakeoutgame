# STAKE-OUT — V11

A browser-based total-station staking simulator for
**[TotalStationTech.com](https://totalstationtech.com)**.

You hunt a hidden point with **WASD**, level a pendulum bubble with the
**mouse**, and measure once the instrument lets you. Land inside the level's
position *and* bubble tolerance and the point is staked; miss and it's logged
as a fail anyway — same as real life. Four levels tighten the tolerance from
±0.300 ft down to ±0.020 ft, and two instrument modes change how the rig
behaves.

The two panels are **data collectors that take turns**. Only one is live at a
time in BIPOD, and the live one is the one with the bold coloured border —
yellow for POINT POSITION, green for BUBBLE LEVEL. The other is greyed out and
genuinely dead: no clicks, no keys, no bubble response.

Vanilla HTML/CSS/JS. No framework, no build step, no dependencies — same
conventions as CoordX and QR Point.

---

## Running it locally

The page loads `js/` and `css/` over relative paths, so it needs to be served
rather than opened as a `file://` URL. Any static server works:

```bash
python -m http.server 8080
```

Then open <http://localhost:8080>.

---

## The three screens

| Screen | Element | What's real |
|---|---|---|
| Main menu | `#screen-menu` | Four level buttons, a BIPOD/POLE mode selector, and a START button, positioned over `assets/img/main_menu.png` |
| Player UI | `#screen-player` | Two live canvas gauges, the numeric readouts, the level stopwatch and ten touch hotspots (two D-pads + two MEASURE discs), positioned inside the panel cutouts of `assets/img/with_measure_and_clock.png` |
| Field report | `#screen-report` | Real per-point timestamps, distance errors, pass/fail and totals, drawn over `assets/img/field_report.png` |

Routing is a three-line `showScreen(name)` in `js/app.js` — no router library.

The artwork supplies the static chrome (case frame, hazard stripes, title
lockup, table rules, brand marks). Anything that has to change while you play
is real DOM or canvas layered on top, positioned in percentages measured
directly off the PNGs.

---

## Game modes

**BIPOD** — a hand-off loop, one panel at a time.

1. POINT POSITION is live, BUBBLE LEVEL is dark. Read the dial.
2. Hold a direction to walk, then **let go**.
3. On release control jumps straight to the bubble — no delay, that is the
   one step the lag does not apply to.
4. Get the bubble inside the **10% hand-off gate** (the white dashed ring).
5. Control jumps back to the dial, and the fresh reading takes
   `readoutLagSec` to appear. That wait is the point: it is the round trip
   out to the prism and back.
6. Repeat until LEFT/RIGHT *and* TO/AWAY are both inside the level's foot
   tolerance.
7. Then **both** panels go live at once, both MEASURE discs unlock, and the
   bubble switches to HOLD — it stays exactly where you left it instead of
   running away, so you can take your hand off and shoot.

The position never drifts on its own in BIPOD — a real bipod just holds it.

**POLE** — both panels live from the first frame, MEASURE available
throughout, and no hand-off at all. You have to walk the point in *and* keep
the bubble levelled at the same time. The moment you stop walking the pole
starts to wander; drift accelerates the longer you stand still, capped at
0.200 ft per idle session. Tap any key to stop it dead.

The bubble is **inverted**, like a real vial: move the mouse right and the
bubble runs left. It's a spring-damper pendulum, so it swings past centre and
oscillates before it settles — see the tuning note further down if you want it
calmer.

It also has a **home**. Every point spawns it at a random angle hard against
the rim, and unless HOLD is on, that home is where it returns the instant you
stop steering it. Centring is something you hold, not something that happens
to you while you look away.

The point pip in the position dial is a **big soft blur**, not a dot. It tells
you roughly where the point lies and deliberately nothing more — the last of
the precision has to come off the bubble.

### Levels

| Level | Points | Position tolerance | Bubble tolerance | Bubble reaction (`bubbleHump`) | Readout lag | Pole drift rate | Pole stray cap |
|---|---|---|---|---|---|---|---|
| 1 — Rookie | 3 | ±0.300 ft | 30 % | 0.50 | 0.5 s | 0.30 | 0.100 ft |
| 2 — Journeyman | 4 | ±0.150 ft | 18 % | 0.75 | 1.0 s | 0.75 | 0.150 ft |
| 3 — Foreman | 5 | ±0.060 ft | 9 % | 0.75 | 1.5 s | 1.44 | 0.180 ft |
| 4 — No Room For Error | 6 | ±0.020 ft | 3 % | 1.00 | 2.0 s | 2.40 | 0.200 ft |

The last two columns are **POLE only** — a bipod never drifts. `posDriftAccel`
is how fast the rod starts wandering once you stand still; `driftCapFt` is how
far it may get in one idle session before it stops. Drift pushes the rod
radially away from the point, so it moves *both* axes at once — that is why
nudging TO/AWAY opens up LEFT/RIGHT on its own. Tapping any direction resets
the session and stops it dead.

`bubbleHump` is how violently the bubble reacts to being steered — it scales
the spring stiffness, the damping and the per-frame jitter together, so higher
means faster, twitchier and harder to hold level.

The 10% BIPOD hand-off gate is a single constant (`BIPOD_FLIP_TOLERANCE_PCT`),
not per level, and it is *not* the pass/fail test. On Level 1 the gate is
tighter than the pass mark; on Level 4 it is looser, so getting the hand-off
is not the same as earning the point.

### Controls

| Input | Does |
|---|---|
| **LEFT thumb stick** | Walk, eight-way. Live only while POINT POSITION is |
| **RIGHT thumb stick** | Levels the bubble (inverted). Live only while BUBBLE LEVEL is |
| `W` `A` `S` `D` | Walk — the keyboard equivalent of the left stick |
| Cursor **held on** the bubble vial | Levels the bubble. Take it off and the bubble runs home |
| Arrow keys | Nudge the bubble target, as another alternative |
| `Space` / click | Open the start gate |
| Left-click / MEASURE disc | Measure and log the point — refused until MEASURE is unlocked |
| `Esc` | Abort back to the menu |

### Touch

Play in **landscape**; portrait shows a ROTATE TO PLAY nudge and leaves the
vial too small to work with.

The two round pads painted into the instrument are the sticks, and they do
**different jobs** — left walks, right levels. That split is what makes POLE
playable on a phone at all: POLE needs you to walk and level at the same time,
which is impossible when levelling means parking a thumb on the vial itself.

Three things had to be true before touch worked, and all three are load-bearing:

1. **The vial is `data-nomeasure`.** It is a control surface, not a measure
   surface. Without that flag the stage's tap-to-measure handler counts every
   touch on the vial as a shot — so on a phone each attempt to level the bubble
   logged a point and reset the bubble under your thumb. Invisible on desktop,
   where you steer by hovering and never click it.
2. **The vial and both sticks set `touch-action: none`.** Otherwise the browser
   claims a drag as a page pan and fires `pointercancel` mid-stroke, which the
   engine reads as "let go" and sends the bubble home.
3. **The page is pinned while playing** (`html.is-playing`, `position: fixed`).
   Sizing in `dvh` stops the page overflowing; pinning stops it moving at all,
   so no drag can pan it, rubber-band it, or retract the address bar and shift
   the gauges mid-shot.

Each stick is one round zone covering its whole painted pad — about 97px on a
landscape phone. The previous layout gave each of four arrow tiles 28px, well
under a dependable thumb target, which is why the pads read as unresponsive.

---

## Field report exports

**SAVE / QUIT** downloads two files, then returns to the menu:

1. `stakeout-L<n>-<mode>-<stamp>-report.html` — a styled, print-ready
   recreation of the field-report ticket. Open it and print to PDF for the
   "pretty" copy. It's plain HTML with inline CSS so it stays a single
   dependency-free file.
2. `stakeout-L<n>-<mode>-<stamp>.csv` — raw data for Excel or Sheets:
   `Point,Timestamp,DistanceErrorFt,BubbleOffsetPct,Result,Level,Mode`

**CONTINUE** replays at the next level up in the same mode. After Level 4 it
returns to the menu with a COURSE COMPLETE banner instead of repeating.

---

## Layout

```
stakeoutgame/
├── index.html            three <section> screens
├── css/styles.css        all layout + the overlay coordinates
├── js/game-engine.js     ported v6/v7 physics, tolerances, scoring
├── js/app.js             routing, menu state, report rendering, exports
└── assets/img/           the three concept-art backgrounds (.webp + .png)
```

### About the background art

Each background ships twice: a WebP that browsers actually download, and the
original PNG as a fallback. `css/styles.css` names both, PNG first, then an
`image-set()` that supporting browsers use to pick the WebP:

```css
background-image: url("../assets/img/main_menu.png");
background-image: image-set(url("../assets/img/main_menu.webp") type("image/webp"),
                            url("../assets/img/main_menu.png")  type("image/png"));
```

A browser too old to parse `image-set()` ignores the second declaration and
keeps the PNG. Modern browsers fetch only the WebP — nothing double-downloads.

That takes the art from 5.5 MB to 655 KB (88% smaller):

| File | PNG | WebP |
|---|---|---|
| `main_menu` | 1688 KB | 167 KB |
| `with_measure_and_clock` | 1676 KB | 170 KB |
| `field_report` | 1275 KB | 172 KB |
| `download_menu_only` | 1031 KB | 146 KB |

WebP is quality 92, method 6, at the original resolution — deliberately not
downscaled, because the stage scales to `min(100vw, 100vh × aspect)` and is
already rendered wider than the 1536 px source on a 1440p display.

To re-encode after changing the art (needs Pillow, dev-time only, not a
project dependency):

```bash
python -c "from PIL import Image; import glob, os; [Image.open(p).save(os.path.splitext(p)[0]+'.webp','WEBP',quality=92,method=6) for p in glob.glob('assets/img/*.png')]"
```

### About `js/game-engine.js`

Ported from the tested v7 prototype. `BASE_SPEED_FT`, `EPS`, `DRIFT_CAP_FT`,
the bubble spring constant and the pass/fail test are still v7's and should
not be retuned as a side effect of UI work — they were tuned through
playtesting across six prototype versions.

V11 deliberately changed three things in that table and added one: `bubbleHump`
was raised to the 0.50/0.75/0.75/1.00 ramp, the new `readoutLagSec` column was
added, the bipod lock/unlock cycle was replaced by the `activePanel` hand-off
state machine, and `REVEAL_DELAY` was retired in favour of the per-level lag.

### Tuning the bubble — read this before turning anything

V11.1 chased "it's too hard" through four dials and only one of them worked.
The findings are written up in full above `BUBBLE_JITTER` in the engine; the
short version:

**The bubble is not hard to hold, it is hard to settle.** Park the cursor dead
centre on Level 1 and leave it and the bubble sits at 0.7% offset, inside
tolerance 100% of the time. All the difficulty is the *ringing* after it gets
thrown out to its home — which happens on every new point, every hand-off and
every time you let go.

So **`BUBBLE_DAMPING` is the dial**, and it is the only one. V11.1 raises it
from 0.6 to 0.75. Time to settle and stay inside tolerance:

| Level | before (0.6) | after (0.75) |
|---|---|---|
| 1 | 3.5 s | 2.6 s |
| 2 | — | 4.5 s |
| 3 | ~9 s | 6.6 s |
| 4 | never settled in 18 s | 10.9 s |

Those are worst-case: measured with the cursor parked still, so a player
actively counter-steering beats them. Above roughly 1.0 the bubble stops
behaving like a liquid vial and starts behaving like a needle on a dial.

The three dials that look right and are not: `BUBBLE_MAX_VEL` is a symmetric
speed cap, so it slows the return to centre as much as the escape and barely
moves difficulty. `bubbleHump` is responsiveness, not difficulty — lowering it
weakens the spring that follows your cursor and makes the bubble *harder* to
control (−20% took Level 1 from 62% of the time inside tolerance to 32%).
`BUBBLE_JITTER` barely registers, because the steady state was never the
problem.

The only reshaping was plumbing: v7 held its state in bare module-scope
variables and drew both gauges into a single 900×380 canvas. V8 keeps that
state on a game object and draws into the two separate panel canvases the
shell positions over the artwork. Gauge geometry is expressed as ratios of
v7's own numbers so the dials scale to the concept-art panels without
changing proportions.

The v7 source itself lives at `reference/stake-out-prototype-v7.html` on
disk. It's git-ignored on purpose — it's there to diff against, not to ship.

---

## Deploying

Push to GitHub and point Netlify at the repo. There's no build command and no
publish subdirectory — serve the repo root.

---

## Not in V11

- Accounts or persistent player profiles. JOB / OPERATOR / INSTRUMENT are
  static placeholders.
- Framerate-independent bubble jitter. The noise is injected once per *frame*
  rather than per unit of simulated time, so accumulated jitter scales with
  `dt` and a 120Hz phone gets a measurably calmer bubble than a 60Hz one from
  identical code. Known, not yet fixed; the fix is to scale the kick by
  `sqrt(1/60 / dt)`.
- Drone lidar, survey topo, and the 3D walking map modules.
