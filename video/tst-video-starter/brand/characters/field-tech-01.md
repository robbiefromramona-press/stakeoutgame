# Field Tech 01 -- "Dez"

The recurring TotalStationTech field technician. Appears in any shot that needs a person
running the instrument.

## Prompt block (paste verbatim -- identical wording is what buys consistency)

> a TotalStationTech field technician: late-20s, athletic medium build, short dark hair
> under a backwards charcoal cap, light stubble, safety-yellow hi-vis vest over a plain
> gray long-sleeve tee, dark work pants, tan work boots, a folding rule in the vest
> pocket, no gloves, calm focused expression, competent and unposed

## Rules

- Same wording every time. Do not paraphrase, do not "improve" it. Drift in the wording
  is drift in the face.
- No visible branding on the vest or cap. The negative prompt kills fake logos, but do
  not invite them in.
- Shot at work, never looking at camera, never smiling at camera.
- For true face-lock across episodes you need reference images or a LoRA. Drop stills
  into `brand/characters/ref/` and wire them into the workflow as IPAdapter inputs --
  wording alone gets you "same type of guy", not "same guy".

## Status

No LoRA and no reference images exist yet. This file is currently the only consistency
mechanism, which means: expect a family resemblance, not a twin. Once you have three or
four generations you actually like, save them to `ref/` and train from there.
