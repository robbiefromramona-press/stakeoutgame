# Setting up a Remotion + Stable Diffusion repo, from zero

Follow this top to bottom and you'll end up with a private GitHub repo you can launch
a Claude Code session against, with the "What Is a Setup?" prompt pack already in it.

Budget 45 minutes, most of it waiting on downloads.

---

## Step 0 — The one thing to understand before you start

**A Claude Code web session has no GPU.** None. Stable Diffusion needs one, so image
generation can only ever happen on your desktop. That single fact decides how this repo
is laid out:

| Half of the repo | Runs where | Who does the work |
|---|---|---|
| Prompts, brand rules, Remotion code | Anywhere, cloud included | Claude |
| Actual image generation | Your desktop only | Your GPU, driven by a script Claude wrote |

So the loop is: Claude writes and commits prompts in the cloud → you pull and run them
locally → you commit the keeper images → Claude wires them into Remotion. The repo is
the handoff point between the two halves. It is not a limitation to work around, it is
the shape of the thing.

Second thing: **the generator is not in the repo.** ComfyUI is its own install with its
own multi-gigabyte model files. It lives somewhere else on your disk entirely. The repo
holds prompts and code, which are kilobytes.

---

## Step 1 — Create the repo on GitHub

Browser, not terminal:

1. <https://github.com/new>
2. Owner: **robbiefromramona-press**
3. Name: **`totalstationtech-video`**
4. **Private**
5. Leave "Add a README", .gitignore and license **unchecked** — you're bringing your own
6. Create repository

Leave the tab open, you'll want the URL.

---

## Step 2 — Install the three tools

Skip any you already have. Open a **new** terminal after installing, so PATH updates.

```powershell
git --version        # need git. https://git-scm.com/download/win
node --version       # need v18+. https://nodejs.org  (LTS is fine)
python --version     # need 3.9+. https://python.org  (tick "Add to PATH")
git lfs version      # need Git LFS. https://git-lfs.com
```

Then, once per machine, ever:

```powershell
git lfs install
```

Do not skip that. See step 5.

---

## Step 3 — Clone it locally

Same spot as your other repos:

```powershell
cd C:\Users\robbi\Documents
git clone https://github.com/robbiefromramona-press/totalstationtech-video.git
cd totalstationtech-video
```

An empty repo warning here is normal and correct — it *is* empty.

---

## Step 4 — Drop in the starter kit

Everything in `video/tst-video-starter/` (from the stakeoutgame branch
`claude/totalstationtech-setup-images-rocq9o`) goes into the root of the new repo.

Copy it in, then **rename the two dotfile templates** — they ship with a `dot-` prefix
so they don't accidentally take effect inside stakeoutgame:

```powershell
git mv dot-gitignore .gitignore
git mv dot-gitattributes .gitattributes
```

```
totalstationtech-video/
├── .gitignore              <- renamed from dot-gitignore
├── .gitattributes          <- renamed from dot-gitattributes
├── CLAUDE.md               house rules; every Claude session reads this
├── README.md
├── SETUP.md                this file
├── brand/                  base directive, palette, character sheets
├── episodes/001-what-is-a-setup/
├── imagegen/               build_prompts.py, run_comfy.py, workflows/
└── remotion-dropin/        three source files for step 6
```

Sanity check that the prompt pack works before you commit anything:

```powershell
python imagegen\build_prompts.py 001-what-is-a-setup
```

Six lines of output, six files in `episodes\001-what-is-a-setup\prompts\build\`. Add
`--print` if you want to read the assembled prompts. That folder is gitignored — it's
generated, so it never gets committed.

---

## Step 5 — Why LFS mattered in step 2

A 1920×1080 PNG is 2–4 MB, you'll generate hundreds, and **GitHub hard-rejects any
single file over 100 MB.** Worse, git stores every version of a binary forever, so a
repo like this bloats until cloning it takes ten minutes.

`.gitattributes` already routes PNG/WebP/JPG/PSD through LFS. But LFS only catches files
committed *after* it's installed. Commit a pile of PNGs first and you have to rewrite
history to fix it. That's why step 2 came before step 7.

Confirm it took, any time:

```powershell
git lfs status
```

---

## Step 6 — Scaffold Remotion

`create-video` demands an empty folder, which is why the drop-ins aren't already called
`remotion/`:

```powershell
npx create-video@latest remotion
```

When it asks, pick **Blank** and **TypeScript**. Then swap in the components:

```powershell
copy remotion-dropin\src\KenBurns.tsx remotion\src\
copy remotion-dropin\src\LineDraw.tsx remotion\src\
copy remotion-dropin\src\Root.tsx     remotion\src\
```

Answer yes to overwriting `Root.tsx` — that's the point. Delete the `HelloWorld` folder
it generated, you don't need it.

Remotion reads images from `remotion/public/`, so that's where your keepers go:

```powershell
mkdir remotion\public
```

Fire it up:

```powershell
cd remotion
npx remotion studio
```

Three compositions — `Scene1-Hook`, `Scene3-Occupy`, `Scene4-Resection`. They'll show
broken-image icons until step 7 produces actual stills. Expected, not broken.

---

## Step 7 — Install ComfyUI (outside the repo)

```powershell
cd C:\Users\robbi\Documents
git clone https://github.com/comfyanonymous/ComfyUI.git
```

Note the path: `Documents\ComfyUI`, a **sibling** of the repo, never inside it. Follow
ComfyUI's own README for install — it's the part that depends on your specific GPU, and
it changes often enough that any commands I write here would be stale by the time you
read them.

Then grab a checkpoint. SDXL base is the safe first pick: download
`sd_xl_base_1.0.safetensors` from Hugging Face into `ComfyUI\models\checkpoints\`.
It's ~6.9 GB. Go make coffee.

Start ComfyUI, wait for `To see the GUI go to: http://127.0.0.1:8188`, and **leave that
window open.** Then, in a second terminal:

```powershell
cd C:\Users\robbi\Documents\totalstationtech-video
python imagegen\run_comfy.py 001-what-is-a-setup --dry-run
```

Dry run first, always — it prints exactly what it would send without spending a minute
of GPU time. When that looks right:

```powershell
python imagegen\run_comfy.py 001-what-is-a-setup --ckpt sd_xl_base_1.0.safetensors
```

Four variants of each of the six images land in `episodes\001-what-is-a-setup\stills\`.
Keep the good ones, delete the rest, copy your picks into `remotion\public\`.

To re-roll a single image without redoing all six:

```powershell
python imagegen\run_comfy.py 001-what-is-a-setup --only 04-resection-diagram
```

Every filename carries its seed (`04-resection-diagram_s1847263_02.png`). When one comes
out great, that seed is how you get it back. Write it down.

---

## Step 8 — First commit and push

```powershell
cd C:\Users\robbi\Documents\totalstationtech-video
git add .
git status
```

**Read that status output** before committing. You are looking for: no `.safetensors`,
no `node_modules`, no `prompts/build/`. If any of those show up, the `.gitignore` rename
in step 4 didn't happen.

```powershell
git commit -m "Initial video pipeline: brand directive, episode 001 prompt pack, Remotion scaffold"
git push -u origin main
```

---

## Step 9 — Launch a Claude Code session on it

1. <https://claude.ai/code>
2. Pick **totalstationtech-video**
3. If it isn't listed, GitHub access needs to include it —
   <https://claude.ai/connect-github>

The session reads `CLAUDE.md` automatically, so it'll already know about the GPU split,
the one-copy-of-the-base-directive rule, and that text belongs in Remotion rather than
in the image.

A first prompt worth pasting:

> Read CLAUDE.md. Then set up episode 002 following the same structure as 001 — I want
> to cover the occupy method in depth. Interview me about the script before you write
> any prompts.

---

## When it breaks

| Symptom | What's actually wrong |
|---|---|
| `cannot reach ComfyUI at http://127.0.0.1:8188` | ComfyUI isn't running, or you closed its window. It has to stay open. |
| `ComfyUI rejected /prompt (400)` | Nine times in ten: `--ckpt` doesn't match a real filename in `models\checkpoints\`. Check the spelling, including `.safetensors`. |
| `prompts.json not found` | Run `build_prompts.py` before `run_comfy.py`. Build, then render. |
| `this exceeds GitHub's file size limit` | A model file got staged. LFS doesn't cover 6 GB checkpoints — nothing does. Confirm `.gitignore` exists with a leading dot. |
| Remotion shows broken images | Stills aren't in `remotion\public\`, or the filename in `Root.tsx` doesn't match. |
| Lines land in the wrong place | Expected — the coordinates in `Root.tsx` are guesses. Nudge them in the studio. |
| Generated text is gibberish | Working as designed. Never ask the generator for words; put them in Remotion. |

## Where the seams are, honestly

- The Remotion line coordinates are invented. They need one pass of eyeballing against
  real stills.
- `sdxl-base.api.json` is a deliberately minimal workflow — no refiner, no upscaler, no
  IPAdapter. It will produce images; it will not produce your best images. Build a
  better workflow in the ComfyUI GUI, export it with **Save (API Format)**, and replace
  the literal values with the same `__TOKENS__`. The runner won't care.
- The recurring character is a text description, not a LoRA. That buys you "same type of
  guy", not "same guy". Once you have four generations you like, those become the
  training set.
