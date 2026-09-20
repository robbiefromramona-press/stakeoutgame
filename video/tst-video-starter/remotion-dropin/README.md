# Remotion drop-ins

These are **not** a Remotion project. They are the three source files worth keeping
once you scaffold a real one, so you are not writing a Ken Burns effect from scratch.

`npx create-video@latest` insists on an empty folder, which is why this is called
`remotion-dropin/` and not `remotion/`. Scaffold first, then copy these in — SETUP.md
step 6 has the exact commands.

| File | What it does |
|---|---|
| `src/KenBurns.tsx` | Slow push/pan across a still. Carries images 01 and 03. |
| `src/LineDraw.tsx` | Draws measurement lines on over a still, staggered, with a yellow→red "snap" beat. Carries image 04. |
| `src/Root.tsx` | Registers one Composition per scene at 1920x1080 / 30fps. |
| `src/index.ts` | Entry point. `create-video` generates its own — keep whichever you like, they do the same thing. |

## The coordinates are guesses

`Root.tsx` has line endpoints like `{ x1: 50, y1: 58, x2: 14, y2: 34 }` — percentages
of the frame. I wrote them blind, because the stills don't exist yet. Open
`npx remotion studio`, look at where the lines actually land on your generated image,
and nudge the numbers. Two minutes of work, and there is no way to skip it.

## Why lines are SVG and not baked into the PNG

A line painted into a PNG is a line you are stuck with. An SVG line can be re-timed,
re-colored and re-drawn without regenerating anything. Same reasoning for every text
label: diffusion models cannot spell, and Remotion can.
