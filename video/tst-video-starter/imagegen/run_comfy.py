#!/usr/bin/env python3
"""
Send this episode's built prompts to a LOCAL ComfyUI and save the stills.

THIS ONLY RUNS ON YOUR OWN MACHINE. ComfyUI needs the GPU, and a Claude Code web
session doesn't have one -- there is no cloud shortcut here. Claude writes the
prompts; your desktop makes the pictures.

BEFORE YOU RUN IT
  1. Start ComfyUI and leave it running (default http://127.0.0.1:8188).
  2. python imagegen/build_prompts.py 001-what-is-a-setup
  3. Check --ckpt matches a checkpoint actually sitting in ComfyUI/models/checkpoints.

USAGE
    python imagegen/run_comfy.py 001-what-is-a-setup --ckpt sd_xl_base_1.0.safetensors
    python imagegen/run_comfy.py 001-what-is-a-setup --only 04-resection-diagram --seed 12345
    python imagegen/run_comfy.py 001-what-is-a-setup --dry-run

Stdlib only -- nothing to pip install.
"""
import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HOST = "http://127.0.0.1:8188"
POLL_SECONDS = 2
POLL_TIMEOUT = 900


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def api(host, path, payload=None):
    url = f"{host.rstrip('/')}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")[:600]
        die(f"ComfyUI rejected {path} ({exc.code}).\n{body}\n\n"
            f"A 400 here is almost always a checkpoint name that doesn't exist, or a node "
            f"your ComfyUI install doesn't have. Check --ckpt first.")
    except urllib.error.URLError as exc:
        die(f"cannot reach ComfyUI at {host} ({exc.reason}).\n"
            f"Is it running? Start it, wait for 'To see the GUI go to...', then retry.")


def fill(node_tree, values):
    """Replace __TOKENS__ in a parsed workflow. Exact-match strings become typed values."""
    if isinstance(node_tree, dict):
        return {k: fill(v, values) for k, v in node_tree.items() if k != "_comment"}
    if isinstance(node_tree, list):
        return [fill(v, values) for v in node_tree]
    if isinstance(node_tree, str):
        if node_tree in values:
            return values[node_tree]
        for token, value in values.items():
            if token in node_tree:
                node_tree = node_tree.replace(token, str(value))
        return node_tree
    return node_tree


def fetch_image(host, meta, dest):
    query = urllib.parse.urlencode({
        "filename": meta["filename"],
        "subfolder": meta.get("subfolder", ""),
        "type": meta.get("type", "output"),
    })
    with urllib.request.urlopen(f"{host.rstrip('/')}/view?{query}", timeout=60) as resp:
        dest.write_bytes(resp.read())


def wait_for(host, prompt_id, label):
    waited = 0
    while waited < POLL_TIMEOUT:
        history = api(host, f"/history/{prompt_id}")
        if prompt_id in history:
            return history[prompt_id]
        time.sleep(POLL_SECONDS)
        waited += POLL_SECONDS
        if waited % 30 == 0:
            print(f"      still rendering {label} ({waited}s)...")
    die(f"{label}: gave up after {POLL_TIMEOUT}s. Check the ComfyUI console for the real error.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("episode")
    ap.add_argument("--ckpt", default="sd_xl_base_1.0.safetensors",
                    help="checkpoint filename as ComfyUI sees it")
    ap.add_argument("--workflow", default="imagegen/workflows/sdxl-base.api.json")
    ap.add_argument("--host", default=DEFAULT_HOST)
    ap.add_argument("--only", metavar="ID", help="render a single image id")
    ap.add_argument("--seed", type=int, help="fixed seed for every image (reproducible reruns)")
    ap.add_argument("--dry-run", action="store_true", help="print the job payloads, send nothing")
    args = ap.parse_args()

    built = ROOT / "episodes" / args.episode / "prompts" / "build" / "prompts.json"
    if not built.is_file():
        die(f"{built.relative_to(ROOT)} not found -- run build_prompts.py first:\n"
            f"    python imagegen/build_prompts.py {args.episode}")

    workflow = json.loads((ROOT / args.workflow).read_text(encoding="utf-8"))
    images = json.loads(built.read_text(encoding="utf-8"))["images"]
    if args.only:
        images = [i for i in images if i["id"] == args.only]
        if not images:
            die(f"no image with id {args.only!r} in {built.relative_to(ROOT)}")

    out_dir = ROOT / "episodes" / args.episode / "stills"
    out_dir.mkdir(parents=True, exist_ok=True)

    for img in images:
        seed = args.seed if args.seed is not None else (img.get("seed") or random.randint(0, 2**31 - 1))
        job = fill(workflow, {
            "__POSITIVE__": img["positive"],
            "__NEGATIVE__": img["negative"],
            "__CKPT__": args.ckpt,
            "__WIDTH__": int(img["width"]),
            "__HEIGHT__": int(img["height"]),
            "__BATCH__": int(img.get("batch", 1)),
            "__STEPS__": int(img["steps"]),
            "__CFG__": float(img["cfg"]),
            "__SAMPLER__": img["sampler"],
            "__SCHEDULER__": img["scheduler"],
            "__SEED__": seed,
            "__PREFIX__": f"{args.episode}/{img['id']}",
        })

        print(f"  {img['id']}  seed={seed}  {img['width']}x{img['height']}  batch={img.get('batch',1)}")
        if args.dry_run:
            print(json.dumps(job, indent=2)[:900] + "\n      ... (truncated)\n")
            continue

        prompt_id = api(args.host, "/prompt", {"prompt": job}).get("prompt_id")
        if not prompt_id:
            die(f"{img['id']}: ComfyUI accepted the request but returned no prompt_id")

        result = wait_for(args.host, prompt_id, img["id"])
        saved = 0
        for node_output in result.get("outputs", {}).values():
            for n, meta in enumerate(node_output.get("images", []), start=1):
                dest = out_dir / f"{img['id']}_s{seed}_{n:02d}.png"
                fetch_image(args.host, meta, dest)
                print(f"      -> episodes/{args.episode}/stills/{dest.name}")
                saved += 1
        if not saved:
            print(f"      WARNING: {img['id']} finished with no images. "
                  f"Does your workflow have a SaveImage node?")

    if args.dry_run:
        print("\ndry run -- nothing was sent to ComfyUI")
    else:
        print(f"\ndone. Pick your keepers, delete the rest, then point Remotion at "
              f"episodes/{args.episode}/stills/")


if __name__ == "__main__":
    main()
