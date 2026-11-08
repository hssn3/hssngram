"""Builds the HssNGram icon set from the master artwork.

The master image has pure-white corners outside the squircle; we flood-fill them
to transparency so the icon sits cleanly on dark and light surfaces.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "apps" / "web" / "public" / "icons"
SOURCE = PUBLIC / "logo-source.png"

def cut_corners(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    keyed = rgba.convert("RGB")
    draw = ImageDraw.Draw(keyed)

    width, height = keyed.size
    for corner in [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]:
        if keyed.getpixel(corner) != (255, 0, 255):
            ImageDraw.floodfill(keyed, corner, (255, 0, 255), thresh=60)

    result = keyed.convert("RGBA")
    pixels = result.load()
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            if (r, g, b) == (255, 0, 255):
                pixels[x, y] = (0, 0, 0, 0)
    return result


def squircle(size: int, radius_ratio: float = 0.225) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255
    )
    return mask


def padded(image: Image.Image, size: int, content_ratio: float) -> Image.Image:
    """Maskable icon: keep the artwork inside the safe zone."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * content_ratio)
    resized = image.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    canvas.paste(resized, (offset, offset), resized)
    return canvas


def main() -> None:
    master = cut_corners(Image.open(SOURCE))
    bbox = master.getbbox()
    if bbox:
        master = master.crop(bbox).resize((2000, 2000), Image.LANCZOS)

    master.save(PUBLIC / "logo.png")

    for size in (512, 384, 192, 180, 152, 120, 96, 64, 32, 16):
        icon = master.resize((size, size), Image.LANCZOS)
        icon.save(PUBLIC / f"icon-{size}.png")

    master.resize((180, 180), Image.LANCZOS).save(PUBLIC / "apple-touch-icon.png")

    # Maskable variants for Android adaptive icons.
    padded(master, 512, 0.8).save(PUBLIC / "maskable-512.png")
    padded(master, 192, 0.8).save(PUBLIC / "maskable-192.png")

    # Multi-resolution favicon.
    favicon_sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
    master.save(PUBLIC / "favicon.ico", sizes=favicon_sizes)

    # Social preview card (16:9) on brand gradient.
    og = Image.new("RGB", (1200, 630), "#120c2e")
    glow = Image.new("RGBA", (1200, 630), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    for step in range(90, 0, -1):
        alpha = int(2 + (90 - step) * 0.9)
        radius = step * 6
        gdraw.ellipse(
            (600 - radius, 300 - radius, 600 + radius, 300 + radius),
            fill=(124, 58, 237, min(alpha, 40)),
        )
    og = Image.alpha_composite(og.convert("RGBA"), glow)
    logo = master.resize((320, 320), Image.LANCZOS)
    og.paste(logo, (600 - 160, 300 - 190), logo)
    og.convert("RGB").save(PUBLIC / "og-cover.png")

    print("icons written to", PUBLIC)


if __name__ == "__main__":
    main()
