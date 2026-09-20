# House rules for this repo

Read this before touching anything. It exists so every Claude session behaves the
same way instead of reinventing the pipeline each time.

## What this repo is

A two-halves video pipeline for the TotalStationTech YouTube channel:

- **Prompts + Remotion** (`brand/`, `episodes/`, `remotion/`) — text and code. Any
  session, local or cloud, can work here.
- **Image generation** (`imagegen/`) — scripts that drive a **local** ComfyUI.

## The hard constraint: no GPU in the cloud

A Claude Code web session has no GPU. Stable Diffusion cannot run in it. Do not try,
do not install ComfyUI in a cloud session, and do not tell Robbie an image was
generated when no image was generated. Write the prompts, commit them, and say plainly
that generation has to run on his desktop.

Remotion *does* render in a cloud session — headless Chromium is preinstalled.

## Rules that are not negotiable

1. **The base directive lives in exactly one file** (`brand/base-directive.txt`).
   Never paste it into a prompt file. Never edit a copy of it under `build/`.
   `imagegen/build_prompts.py` staples it onto every scene.
2. **`episodes/*/prompts/build/` is generated.** Edit `manifest.json` and rebuild.
   Anyone hand-editing build output is about to lose their work.
3. **Text goes in Remotion, not in the image.** Diffusion models cannot spell.
   Point labels, XYZ markers, titles and callouts are DOM/SVG in Remotion.
4. **No models in git.** Checkpoints, LoRAs and VAEs are gitignored for a reason.
5. **Character wording is verbatim.** Copy the blockquote from the character sheet
   exactly. "Improving" the wording changes the character's face.
6. **Never commit a binary over ~10 MB without LFS.** Check `git lfs status` first.

## Repo layout

```
brand/                     style bible, base directive, palette, character sheets
episodes/<nnn>-<slug>/
  script.md                the spoken script
  shotlist.md              scene -> asset mapping
  prompts/manifest.json    scene descriptions + generation settings  <- the source of truth
  prompts/build/           generated full prompts (gitignored)
  stills/                  generated images you decided to keep (LFS)
imagegen/
  build_prompts.py         manifest -> full prompts
  run_comfy.py             full prompts -> stills, via local ComfyUI
  workflows/*.api.json     ComfyUI API-format workflows with __TOKENS__
remotion/                  the video project
```

## Commands

```bash
python imagegen/build_prompts.py 001-what-is-a-setup --print     # assemble prompts
python imagegen/run_comfy.py 001-what-is-a-setup --dry-run       # check before burning GPU time
python imagegen/run_comfy.py 001-what-is-a-setup --ckpt <name>   # generate (LOCAL ONLY)
cd remotion && npx remotion studio                               # preview
```

## Talking to Robbie

He is new at this and says so. Explain the why, not just the command. If he sends a
screenshot of an error right after you gave him instructions, it is entirely fair to
ask whether he actually read them before pasting — he has asked to be asked.
