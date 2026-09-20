# Episode 001 — "What Is a Setup?" — shot list

Five scenes, six generated stills (scene 5 needs two crops).

| Scene | Still | Use | Animation in Remotion |
|---|---|---|---|
| 1 — Hook / cold open | `01-hook` | Fallback if real job-site footage isn't available | Ken Burns push, ~4% | 
| 2 — Core idea | `02-holodeck-grid` | Real equipment tying into a digital model | Coordinate line draws on, then snaps yellow → red |
| 3 — Type 1: occupy | `03-occupy-diagram` | The simple, direct method | Ken Burns pan + single backsight line draw |
| 4 — Type 2: resection | `04-resection-diagram` | The solving/calculating method | Three lines draw on staggered, then snap |
| 5 — Outro teaser | `05a-occupy-teaser`, `05b-resection-teaser` | Split-screen cards, small under titles | Static, text over the top |

## What is deliberately NOT in the images

Every word. No titles, no point labels, no XYZ text, no captions. All of it is added in
Remotion, because:

- diffusion models render text as convincing-looking gibberish;
- text baked into a PNG can't be re-timed, re-colored or corrected;
- the same still gets reused across scenes with different labels.

## What the animation depends on

Scene 2's coordinate line and scene 4's three measurement lines are generated **in the
still** for composition, then re-drawn as SVG on top so they can animate. That means the
generated line has to be simple enough to sit under a clean SVG line without fighting it.
If a generation comes back with a tangle of lines, it's unusable no matter how good it
looks — reroll it.

## Composition notes that keep biting

- **Scene 4 points must be non-collinear with visibly unequal angles.** Three points in a
  neat symmetric fan reads as decoration, not computation. That difference is the whole
  teaching point of the scene.
- **Scene 5 crops must be tighter than scenes 3 and 4.** They sit small under title text.
  Negative space that looks elegant full-frame turns into mush at thumbnail size.
- **5b must read as visibly busier than 5a** at that small size. The contrast between
  "one line" and "many lines" is what sells the split screen before anyone reads a word.
