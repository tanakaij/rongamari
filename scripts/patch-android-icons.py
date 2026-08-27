#!/usr/bin/env python3
"""Replace Capacitor's default launcher icon with RongaMari's.

    python3 scripts/patch-android-icons.py

The icons in resources/ feed the web manifest; they have nothing to do with
the APK. `npx cap add android` generates a fresh Android project carrying
Capacitor's own default launcher icon — without this step the app sits in the
drawer under someone else's logo.

Assets are pre-rendered by tools/make_assets.py (from the delivered logo) and
committed under resources/android/. Nothing is rendered here, because a
release build should not be able to fail over an image dependency.

Run AFTER `npx cap add android`.
"""
import pathlib
import shutil
import sys

# The brand's premium tile is deep forest green with a white silhouette of
# the mark — matches the app icon set rendered by tools/make_assets.py.
BACKGROUND = "#0B3D22"

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "resources" / "android"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]

ADAPTIVE = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
'''

BACKGROUND_COLOR = f'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{BACKGROUND}</color>
</resources>
'''


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def main():
    print("=== RONGAMARI-ICONS ===")

    if not RES.exists():
        fail(f"{RES} not found — run `npx cap add android` first")

    if not SRC.exists():
        fail(
            f"{SRC} not found. Run `python3 tools/make_assets.py` "
            f"locally and commit the result."
        )

    copied = 0
    for d in DENSITIES:
        target = RES / f"mipmap-{d}"
        target.mkdir(parents=True, exist_ok=True)

        for name in ("ic_launcher", "ic_launcher_round", "ic_launcher_foreground"):
            src = SRC / f"{name}-{d}.png"
            if not src.exists():
                fail(f"missing {src} — regenerate with tools/make_assets.py")
            shutil.copy(src, target / f"{name}.png")
            copied += 1

    print(f"copied {copied} icon files across {len(DENSITIES)} densities")

    anydpi = RES / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(ADAPTIVE)
    (anydpi / "ic_launcher_round.xml").write_text(ADAPTIVE)
    print("wrote adaptive icon definitions")

    values = RES / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(BACKGROUND_COLOR)
    print(f"launcher background set to {BACKGROUND}")

    splash_src = SRC / "splash.png"
    if splash_src.exists():
        for name in ("drawable", "drawable-port-xxxhdpi", "drawable-land-xxxhdpi"):
            d = RES / name
            if d.exists():
                shutil.copy(splash_src, d / "splash.png")
        print("splash replaced where the template provides one")

    # Notification small icon: Android requires a white-on-transparent glyph it
    # can tint. tools/make_assets.py renders it from the mark; without this it
    # lands only in the web payload and reminders show the stock icon.
    notif_src = ROOT / "resources" / "ic_notification.png"
    if notif_src.exists():
        for name in ("drawable", "drawable-xxxhdpi"):
            d = RES / name
            d.mkdir(parents=True, exist_ok=True)
            shutil.copy(notif_src, d / "ic_notification.png")
        print("notification icon installed (ic_notification)")

    check = RES / "mipmap-xxxhdpi" / "ic_launcher.png"
    if not check.exists() or check.stat().st_size < 1000:
        fail("launcher icon did not land — the APK would ship the default logo")
    print("verified: launcher icon replaced")


if __name__ == "__main__":
    main()
