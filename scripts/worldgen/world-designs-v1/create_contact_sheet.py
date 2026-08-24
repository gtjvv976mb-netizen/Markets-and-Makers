#!/usr/bin/env python3
"""Create a labeled 4K catalog from the individual Full-HD asset renders."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--renders", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    assets = json.loads(args.catalog.read_text(encoding="utf-8"))["assets"]
    width, height = 3840, 2160
    margin, header, gap = 90, 180, 28
    columns, rows = 4, 4
    card_width = (width - margin * 2 - gap * (columns - 1)) // columns
    card_height = (height - header - margin - gap * (rows - 1)) // rows
    canvas = Image.new("RGB", (width, height), (225, 235, 227))
    draw = ImageDraw.Draw(canvas)
    try:
        title_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 70)
        label_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 30)
        small_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 23)
    except OSError:
        title_font = label_font = small_font = ImageFont.load_default()

    draw.text((margin, 54), "Markets & Makers · World Designs v1", fill=(14, 73, 76), font=title_font)
    draw.text((margin, 130), "Full-HD source renders · optimized game assets · 16 approved models", fill=(55, 92, 84), font=small_font)
    for index, asset in enumerate(assets):
        row, column = divmod(index, columns)
        x = margin + column * (card_width + gap)
        y = header + row * (card_height + gap)
        draw.rounded_rectangle((x, y, x + card_width, y + card_height), radius=28, fill=(247, 244, 228), outline=(29, 91, 87), width=4)
        image = Image.open(args.renders / f"{asset['id']}.png").convert("RGB")
        image.thumbnail((card_width - 28, card_height - 94), Image.Resampling.LANCZOS)
        image_x = x + (card_width - image.width) // 2
        image_y = y + 12
        canvas.paste(image, (image_x, image_y))
        draw.text((x + 24, y + card_height - 73), asset["name"], fill=(16, 69, 71), font=label_font)
        draw.text((x + 24, y + card_height - 38), asset["category"].upper(), fill=(169, 111, 35), font=small_font)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output, "PNG", optimize=True)
    print(args.output)


if __name__ == "__main__":
    main()
