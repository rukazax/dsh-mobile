"""Trim uniform background margins from the diagram images and normalise them to PNG."""
import os
import sys

from PIL import Image, ImageChops

DIAGRAMS = os.path.join(os.path.dirname(__file__), "diagram_crop_target.txt")


def trim(path: str, background=(15, 18, 24)) -> None:
    image = Image.open(path).convert("RGB")
    bg = Image.new("RGB", image.size, background)
    diff = ImageChops.difference(image, bg)
    bbox = diff.getbbox()
    if bbox is None:
        return
    left, top, right, bottom = bbox
    margin = 24
    box = (
        max(0, left - margin),
        max(0, top - margin),
        min(image.width, right + margin),
        min(image.height, bottom + margin),
    )
    cropped = image.crop(box)
    cropped.save(path, format="PNG", optimize=True)
    print(f"{os.path.basename(path):16} {image.size} -> {cropped.size}")


if __name__ == "__main__":
    for argument in sys.argv[1:]:
        trim(argument)
