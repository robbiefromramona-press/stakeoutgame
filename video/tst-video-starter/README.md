# totalstationtech-video

Video pipeline for the [TotalStationTech](https://totalstationtech.com) YouTube channel.
Prompts and brand rules in, Remotion frames out.

**New here? Read [SETUP.md](SETUP.md) first.** It walks the whole thing from an empty
GitHub repo to generated stills.

## The shape of it

```
brand/      one copy of the visual-style base directive, the palette, character sheets
episodes/   per-episode script, shot list, prompt manifest and stills
imagegen/   scripts that turn a manifest into prompts, and prompts into images
remotion/   the video project (created by you in SETUP step 6)
```

## The two halves

Image generation needs a GPU, so it only runs on a local machine. Everything else —
prompts, brand rules, Remotion components — is text and runs anywhere, including a
Claude Code web session. The repo is where those two halves meet.

## Everyday commands

```bash
# assemble the full prompts for an episode (base directive + scene + negatives)
python imagegen/build_prompts.py 001-what-is-a-setup --print

# check what would be sent, without spending GPU time
python imagegen/run_comfy.py 001-what-is-a-setup --dry-run

# generate (needs ComfyUI running locally)
python imagegen/run_comfy.py 001-what-is-a-setup --ckpt sd_xl_base_1.0.safetensors

# re-roll one image
python imagegen/run_comfy.py 001-what-is-a-setup --only 04-resection-diagram

# preview the video
cd remotion && npx remotion studio
```

## Three rules that save the most time

1. **The base directive lives in one file.** `brand/base-directive.txt`. It gets stapled
   onto every scene by `build_prompts.py`. Never paste a copy of it anywhere.
2. **Words go in Remotion, never in the image.** Diffusion models cannot spell. Point
   labels, XYZ markers and titles are SVG and DOM, added on top.
3. **Seeds are the only undo button.** Every filename carries its seed. When an image
   comes out great, save that number in the episode's manifest.

## Episodes

| # | Title | Stills | Status |
|---|---|---|---|
| 001 | What Is a Setup? | 6 | prompts written, nothing generated yet |

Episode 001's `script.md` isn't in here yet — the prompt pack was built from the shot
list and the visual style bible. Drop the script in when you have it.
