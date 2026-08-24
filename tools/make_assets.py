#!/usr/bin/env python3
"""RongaMari icon + splash assets, rendered from the supplied logo.

    python3 tools/make_assets.py

Source of truth is the master artwork at resources/logo-source.png (a copy of
the delivered Logo.png). The mark (the green R holding the wallet) and the
"RongaMari" wordmark are separated automatically, the white matte is removed so
both sit on transparency, and every size the app needs is rendered from there.

Run locally and COMMIT the output under resources/. It is deliberately not part
of the CI build: a release build should not be able to fail over an image
dependency, and pre-rendered PNGs cannot break.

Requires: python3 with Pillow (pip3 install pillow).
"""
import pathlib
import sys

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
RES = ROOT / "resources"
OUT = RES / "android"

WHITE = (255, 255, 255, 255)
GREEN_DARK = (10, 77, 34, 255)      # status bar / theme chrome


# ── white-matte removal ────────────────────────────────────────────────────
# The artwork is green on white. A pixel near white becomes transparent; the
# anti-aliased edge pixels are treated as a blend of the true colour with
# white and un-matted, so edges stay smooth on any background.
def remove_white_matte(img):
    img = img.convert("RGB")
    out = Image.new("RGBA", img.size)
    src = img.load()
    dst = out.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            d = 255 - min(r, g, b)          # 0 for white, high for colour
            if d < 10:
                dst[x, y] = (0, 0, 0, 0)
            elif d > 60:
                dst[x, y] = (r, g, b, 255)
            else:
                a = int((d - 10) * 255 / 50)
                a = max(0, min(255, a))
                if a == 0:
                    dst[x, y] = (0, 0, 0, 0)
                else:
                    af = a / 255.0
                    def un(c):
                        v = (c - (1 - af) * 255) / af
                        return max(0, min(255, int(round(v))))
                    dst[x, y] = (un(r), un(g), un(b), a)
    return out


def bbox_of(img, thresh=10):
    """Bounding box of pixels with meaningful alpha."""
    alpha = img.getchannel("A")
    return alpha.point(lambda a: 255 if a > thresh else 0).getbbox()


def crop_content(img):
    bb = bbox_of(img)
    return img.crop(bb) if bb else img


def split_mark_and_wordmark(logo):
    """The delivered file stacks the R mark above the wordmark with a clear
    band of white between them. Find that band and split there."""
    alpha = logo.getchannel("A")
    w, h = logo.size
    px = alpha.load()
    row_has = [any(px[x, y] > 10 for x in range(0, w, 2)) for y in range(h)]
    # A real break between mark and wordmark is a band of empty rows; a single
    # stray empty row inside the artwork (hairline anti-aliasing) must not
    # split it.
    GAP = 8
    blocks = []
    start = None
    empty = 0
    for y, has in enumerate(row_has):
        if has:
            if start is None:
                start = y
            empty = 0
        elif start is not None:
            empty += 1
            if empty >= GAP:
                blocks.append((start, y - empty))
                start = None
                empty = 0
    if start is not None:
        blocks.append((start, h - 1 - empty))
    if len(blocks) < 2:
        return logo, None
    mark_band = blocks[0]
    rest_band = (blocks[0][1] + 1, blocks[-1][1])
    mark = logo.crop((0, mark_band[0], w, mark_band[1] + 1))
    word = logo.crop((0, rest_band[0], w, rest_band[1] + 1))
    return crop_content(mark), crop_content(word)


def resized(mark, box_px):
    m = mark.copy()
    m.thumbnail((box_px, box_px), Image.LANCZOS)
    return m


def center_composite(tile, art):
    tile.alpha_composite(art, ((tile.width - art.width) // 2,
                               (tile.height - art.height) // 2))
    return tile


def legacy_launcher(mark, size):
    """Pre-Android-8 icon: the mark on a white tile with rounded corners."""
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = max(2, int(size * 0.18))
    shape = Image.new("L", (size, size), 0)
    ImageDraw.Draw(shape).rounded_rectangle((0, 0, size - 1, size - 1),
                                            radius=radius, fill=255)
    bg = Image.new("RGBA", (size, size), WHITE)
    tile.paste(bg, (0, 0), shape)
    return center_composite(tile, resized(mark, int(size * 0.62)))


def legacy_round(mark, size):
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shape = Image.new("L", (size, size), 0)
    ImageDraw.Draw(shape).ellipse((0, 0, size - 1, size - 1), fill=255)
    bg = Image.new("RGBA", (size, size), WHITE)
    tile.paste(bg, (0, 0), shape)
    return center_composite(tile, resized(mark, int(size * 0.56)))


def adaptive_foreground(mark, size):
    """Android 8+ adaptive foreground: 108dp canvas, only the middle 72dp is
    guaranteed visible. Keep the mark inside roughly the middle half."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return center_composite(layer, resized(mark, int(size * 0.42)))


def splash(wordmark_full, w, h):
    img = Image.new("RGBA", (w, h), WHITE)
    art = wordmark_full.copy()
    art.thumbnail((int(w * 0.42), int(w * 0.42)), Image.LANCZOS)
    return center_composite(img, art).convert("RGB")


def white_silhouette(mark, size):
    """Notification small icons must be white-on-transparent to tint properly."""
    m = resized(mark, size)
    out = Image.new("RGBA", m.size, (0, 0, 0, 0))
    alpha = m.getchannel("A")
    out.putdata([(255, 255, 255, a) for a in alpha.getdata()])
    return out


def on_white(mark, size, pad=0.0):
    tile = Image.new("RGBA", (size, size), WHITE)
    return center_composite(tile, resized(mark, int(size * (1 - pad * 2))))


def main():
    src = RES / "logo-source.png"
    if not src.exists():
        sys.exit(f"ERROR: {src} not found — copy the master Logo.png there first.")
    RES.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)

    logo = remove_white_matte(Image.open(src))
    mark, wordmark = split_mark_and_wordmark(logo)
    if wordmark is None:
        mark = crop_content(logo)
        wordmark_full = crop_content(logo)
    else:
        wordmark_full = crop_content(logo)
    print(f"mark: {mark.size}, wordmark: {wordmark.size if wordmark else 'n/a'}")

    # ── web / PWA ──
    on_white(mark, 512).convert("RGB").save(RES / "icon-512x512-any.png")
    on_white(mark, 192).convert("RGB").save(RES / "icon-192x192-any.png")
    on_white(mark, 512, pad=0.14).convert("RGB").save(RES / "icon-512x512-maskable.png")
    on_white(mark, 180).convert("RGB").save(RES / "apple-touch-icon-180.png")
    on_white(mark, 128).convert("RGB").save(RES / "favicon-128.png")
    mark.copy().resize((256, 256), Image.LANCZOS).save(RES / "mark.png")
    print("web icons written")

    # full lockup for the About card and the in-app splash
    full = wordmark_full.copy()
    full.thumbnail((768, 768), Image.LANCZOS)
    full.save(RES / "logo-full.png")

    # ── android ──
    DENSITIES = {
        "mdpi":    (48, 108),
        "hdpi":    (72, 162),
        "xhdpi":   (96, 216),
        "xxhdpi":  (144, 324),
        "xxxhdpi": (192, 432),
    }
    for name, (sq, fg) in DENSITIES.items():
        legacy_launcher(mark, sq).save(OUT / f"ic_launcher-{name}.png")
        legacy_round(mark, sq).save(OUT / f"ic_launcher_round-{name}.png")
        adaptive_foreground(mark, fg).save(OUT / f"ic_launcher_foreground-{name}.png")
        print(f"{name}: launcher {sq}px, foreground {fg}px")

    splash(wordmark_full, 1920, 1920).save(OUT / "splash.png")
    white_silhouette(mark, 96).save(RES / "ic_notification.png")
    print("splash + notification icon written")
    print("\nwritten under", RES)


if __name__ == "__main__":
    main()
