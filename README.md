# STAKE-OUT — V8

A browser-based total-station staking simulator for
**[TotalStationTech.com](https://totalstationtech.com)**.

You hunt a hidden point with **WASD**, level a pendulum bubble with the
**mouse**, and left-click to measure. Land inside the level's position *and*
bubble tolerance and the point is staked; miss and it's logged as a fail
anyway — same as real life. Four levels tighten the tolerance from ±0.300 ft
down to ±0.020 ft, and two instrument modes change how the rig behaves.

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
| Player UI | `#screen-player` | Two live canvas gauges and the numeric readouts, positioned inside the panel cutouts of `assets/img/main_player_UI.png` |
| Field report | `#screen-report` | Real per-point timestamps, distance errors, pass/fail and totals, drawn over `assets/img/field_report.png` |

Routing is a three-line `showScreen(name)` in `js/app.js` — no router library.

The artwork supplies the static chrome (case frame, hazard stripes, title
lockup, table rules, brand marks). Anything that has to change while you play
is real DOM or canvas layered on top, positioned in percentages measured
directly off the PNGs.

---

## Game modes

**BIPOD** — walking locks the bubble and hides your reading. Stop, level the
bubble, and the moment it's inside tolerance a fresh reading appears and the
bubble re-locks. Read, walk, level, repeat. The position never drifts on its
own.

**POLE** — the bubble is always live, but the moment you stop walking the pole
starts to wander. Drift accelerates the longer you stand still, capped at
0.200 ft per idle session; tap any key to stop it dead.

The bubble is **inverted**, like a real vial: move the mouse right and the
bubble runs left. It's a spring-damper pendulum, so it swings past centre and
oscillates before it settles.

### Levels

| Level | Points | Position tolerance | Bubble tolerance |
|---|---|---|---|
| 1 — Rookie | 3 | ±0.300 ft | 30 % |
| 2 — Journeyman | 4 | ±0.150 ft | 18 % |
| 3 — Foreman | 5 | ±0.060 ft | 9 % |
| 4 — No Room For Error | 6 | ±0.020 ft | 3 % |

### Controls

| Input | Does |
|---|---|
| `W` `A` `S` `D` | Walk. Triangles and readouts tell you which way to go |
| Mouse over the bubble vial | Levels the bubble (inverted) |
| Arrow keys | Nudge the bubble target, as an alternative to the mouse |
| `Space` / click | Open the start gate |
| Left-click | Measure and log the point |
| `Esc` | Abort back to the menu |

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

That takes the art from 4.9 MB to 546 KB (89% smaller):

| File | PNG | WebP |
|---|---|---|
| `main_menu` | 1689 KB | 167 KB |
| `main_player_UI` | 1939 KB | 206 KB |
| `field_report` | 1275 KB | 172 KB |

WebP is quality 92, method 6, at the original resolution — deliberately not
downscaled, because the stage scales to `min(100vw, 100vh × aspect)` and is
already rendered wider than the 1536 px source on a 1440p display.

To re-encode after changing the art (needs Pillow, dev-time only, not a
project dependency):

```bash
python -c "from PIL import Image; import glob, os; [Image.open(p).save(os.path.splitext(p)[0]+'.webp','WEBP',quality=92,method=6) for p in glob.glob('assets/img/*.png')]"
```

### About `js/game-engine.js`

Ported from the tested v7 prototype. The `LEVELS` table, `BASE_SPEED_FT`,
`REVEAL_DELAY`, `EPS`, `DRIFT_CAP_FT`, the bubble spring/damping constants,
the bipod lock/unlock cycle and the pass/fail test are carried over unchanged
and should not be retuned as a side effect of UI work — they were tuned
through playtesting across six prototype versions.

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

## Not in V8

- Functional touch / mobile joystick input. The joystick nubs on the player
  UI are decorative artwork this round.
- Accounts or persistent player profiles. JOB / OPERATOR / INSTRUMENT are
  static placeholders.
- Drone lidar, survey topo, and the 3D walking map modules.
