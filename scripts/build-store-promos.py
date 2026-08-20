#!/usr/bin/env python3
"""Build store promo tiles from the current BrowseLoom logo and UI capture."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "store-assets"
LOGO = ROOT / "brand" / "browseloom-mark.png"
SCREENSHOT = ASSETS / "browseloom-2-bookmarks.jpg"
BOLD_FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REGULAR_FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"


def gradient(size, top, bottom):
    width, height = size
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        ratio = y / max(1, height - 1)
        color = tuple(round(top[i] * (1 - ratio) + bottom[i] * ratio) for i in range(3))
        draw.line((0, y, width, y), fill=color)
    return image


def contain(image, size):
    copy = image.copy()
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    return copy


def cover(image, size):
    target_width, target_height = size
    scale = max(target_width / image.width, target_height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - target_width) // 2
    top = (resized.height - target_height) // 2
    return resized.crop((left, top, left + target_width, top + target_height))


def paste_rounded(canvas, image, position, radius, shadow=20):
    x, y = position
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width, image.height), radius=radius, fill=255)
    if shadow:
        shadow_mask = mask.filter(ImageFilter.GaussianBlur(shadow))
        shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        shadow_layer.paste((0, 7, 20, 145), (x, y + 10), shadow_mask)
        canvas.alpha_composite(shadow_layer)
    canvas.paste(image.convert("RGBA"), (x, y), mask)


def build_top(logo, screenshot):
    canvas = gradient((1400, 560), (15, 24, 43), (28, 52, 75)).convert("RGBA")
    glow = screenshot.resize(canvas.size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(55))
    glow.putalpha(55)
    canvas.alpha_composite(glow)

    draw = ImageDraw.Draw(canvas)
    mark = contain(logo, (104, 104))
    canvas.alpha_composite(mark.convert("RGBA"), (78, 72))
    draw.text((78, 200), "BrowseLoom", font=ImageFont.truetype(BOLD_FONT, 58), fill=(247, 250, 255))
    draw.text((80, 282), "Tabs and bookmarks,", font=ImageFont.truetype(REGULAR_FONT, 28), fill=(202, 219, 234))
    draw.text((80, 320), "woven into one calm workspace.", font=ImageFont.truetype(REGULAR_FONT, 28), fill=(202, 219, 234))
    draw.rounded_rectangle((80, 402, 330, 453), radius=25, fill=(232, 244, 255, 235))
    draw.text((111, 415), "LOCAL-FIRST", font=ImageFont.truetype(BOLD_FONT, 20), fill=(30, 76, 105))

    shot = cover(screenshot, (790, 494))
    paste_rounded(canvas, shot, (570, 42), 28, shadow=22)
    canvas.convert("RGB").save(ASSETS / "promo-top-1400x560.jpg", quality=94, optimize=True)


def build_small(logo, screenshot):
    canvas = gradient((440, 280), (16, 26, 45), (31, 65, 84)).convert("RGBA")
    glow = screenshot.resize(canvas.size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(32))
    glow.putalpha(48)
    canvas.alpha_composite(glow)

    mark = contain(logo, (58, 58))
    canvas.alpha_composite(mark.convert("RGBA"), (24, 22))
    draw = ImageDraw.Draw(canvas)
    draw.text((94, 27), "BrowseLoom", font=ImageFont.truetype(BOLD_FONT, 32), fill=(247, 250, 255))
    draw.text((25, 99), "Tabs + bookmarks.", font=ImageFont.truetype(BOLD_FONT, 21), fill=(232, 242, 251))
    draw.text((25, 130), "One calm workspace.", font=ImageFont.truetype(REGULAR_FONT, 19), fill=(192, 215, 231))

    shot = cover(screenshot, (210, 108))
    paste_rounded(canvas, shot, (210, 156), 12, shadow=10)
    canvas.convert("RGB").save(ASSETS / "promo-small-440x280.jpg", quality=94, optimize=True)


def main():
    logo = Image.open(LOGO).convert("RGBA")
    screenshot = Image.open(SCREENSHOT).convert("RGB")
    build_top(logo, screenshot)
    build_small(logo, screenshot)
    print("Built current BrowseLoom store promo assets.")


if __name__ == "__main__":
    main()
