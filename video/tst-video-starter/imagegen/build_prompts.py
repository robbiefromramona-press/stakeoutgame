#!/usr/bin/env python3
"""
Assemble the final image-generation prompts for one episode.

WHY THIS EXISTS
---------------
The base directive is ~200 words and it has to appear, word for word, in front of
every single prompt. Copy-pasting it six times means six chances to drop a clause --
and the clause you drop is the one holding the style together. So the directive lives
in exactly one file, each image stores only its own scene description, and this script
staples them together.

USAGE
    python imagegen/build_prompts.py 001-what-is-a-setup
    python imagegen/build_prompts.py 001-what-is-a-setup --only 03-occupy-diagram
    python imagegen/build_prompts.py 001-what-is-a-setup --print

OUTPUT
    episodes/<episode>/prompts/build/<id>.positive.txt
    episodes/<episode>/prompts/build/<id>.negative.txt
    episodes/<episode>/prompts/build/prompts.json   <- what run_comfy.py reads

build/ is git-ignored. It is generated, never hand-edited: edit the manifest instead.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def read(rel):
    p = ROOT / rel
    if not p.is_file():
        die(f"missing file: {rel}")
    return p.read_text(encoding="utf-8")


def squash(text):
    """Collapse hard-wrapped text into one line. Generators want a single blob."""
    return re.sub(r"\s+", " ", text).strip()


def character_block(md_path):
    """Pull the blockquote out of a character sheet -- the '> ' lines under 'Prompt block'."""
    quoted = [
        line.lstrip("> ").rstrip()
        for line in read(md_path).splitlines()
        if line.startswith(">")
    ]
    if not quoted:
        die(f"no '> ' prompt block found in {md_path}")
    return squash(" ".join(quoted))


def build(episode, only=None):
    ep_dir = Path("episodes") / episode / "prompts"
    manifest = json.loads(read(ep_dir / "manifest.json"))

    directive = squash(read(manifest["base_directive"]))
    negative = squash(read(manifest["negative"]))
    chars = {
        key: character_block(path)
        for key, path in manifest.get("character_blocks", {}).items()
    }
    defaults = manifest.get("defaults", {})

    out_dir = ROOT / ep_dir / "build"
    out_dir.mkdir(parents=True, exist_ok=True)

    built = []
    for img in manifest["images"]:
        if only and img["id"] != only:
            continue

        scene = squash(img["scene"])
        try:
            scene = scene.format(**chars)
        except KeyError as exc:
            die(f"{img['id']}: scene references unknown character block {exc}")
        if img.get("needs_character") and not any(c in scene for c in chars.values()):
            die(f"{img['id']}: needs_character is true but no character block was injected")

        positive = f"{directive} SCENE: {scene}"
        neg = negative
        if img.get("extra_negative"):
            neg = f"{neg}, {squash(img['extra_negative'])}"

        (out_dir / f"{img['id']}.positive.txt").write_text(positive + "\n", encoding="utf-8")
        (out_dir / f"{img['id']}.negative.txt").write_text(neg + "\n", encoding="utf-8")

        entry = dict(defaults)
        entry.pop("_note", None)
        entry.update(
            id=img["id"],
            use=img["use"],
            notes=img.get("notes", ""),
            positive=positive,
            negative=neg,
        )
        for key in ("width", "height", "steps", "cfg", "seed", "batch"):
            if key in img:
                entry[key] = img[key]
        built.append(entry)

    if only and not built:
        die(f"no image with id {only!r} in {ep_dir/'manifest.json'}")

    (out_dir / "prompts.json").write_text(
        json.dumps({"episode": episode, "images": built}, indent=2) + "\n",
        encoding="utf-8",
    )
    return built, out_dir


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("episode", help="folder name under episodes/, e.g. 001-what-is-a-setup")
    ap.add_argument("--only", metavar="ID", help="build a single image id")
    ap.add_argument("--print", dest="show", action="store_true", help="echo the prompts")
    args = ap.parse_args()

    built, out_dir = build(args.episode, args.only)

    for entry in built:
        print(f"  {entry['id']:<22} {len(entry['positive']):>4} chars  -> {entry['width']}x{entry['height']}")
        if args.show:
            print(f"\n    POSITIVE: {entry['positive']}\n")
            print(f"    NEGATIVE: {entry['negative']}\n")
    print(f"\n{len(built)} prompt(s) written to {out_dir.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
