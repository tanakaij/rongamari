#!/usr/bin/env python3
"""Make the native Android chrome match RongaMari.

    python3 scripts/patch-android-theme.py

<meta name="theme-color"> styles the status bar for a Chrome-installed PWA and
does nothing in the APK — there the status bar comes from the Android theme,
and Capacitor's default is a stock blue-grey band above the green header.

RongaMari's header is the deep brand green (#0A4D22) with white icons, and the
app background is a light green-tinted grey, so the window behind the WebView
is set to match and first paint never flashes white.

NOT EDGE-TO-EDGE, ON PURPOSE
----------------------------
The WebView sits below the status bar rather than drawing under it, so
env(safe-area-inset-top) is 0 inside the APK — correct, because there is
nothing to inset past. The CSS insets still do their job for the
browser-installed PWA. Capacitor 6 targets SDK 34, so this holds; at 35+
Android forces edge-to-edge and the app would need native inset handling.

Run AFTER `npx cap add android`, before `npx cap sync`.
"""
import pathlib
import re
import sys

STATUS = "#FF0A4D22"   # --green-900, with alpha. Matches theme-color meta.
WINDOW = "#FFF2F4F0"   # --bg, so first paint is app-coloured, not white.

ANDROID = pathlib.Path("android")
VALUES = ANDROID / "app" / "src" / "main" / "res" / "values"
STYLES = VALUES / "styles.xml"
COLORS = VALUES / "colors.xml"


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


EMPTY_RESOURCES = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n'


def patch_colors():
    if not VALUES.exists():
        fail(f"{VALUES} not found — `npx cap add android` did not produce an Android project.")

    if not COLORS.exists():
        COLORS.write_text(EMPTY_RESOURCES)
        print("colors.xml did not exist (normal for Capacitor) — created it")

    text = COLORS.read_text()
    if "</resources>" not in text:
        text = EMPTY_RESOURCES

    wanted = {
        "rongamari_status": STATUS,
        "rongamari_nav": STATUS,
        "rongamari_window": WINDOW,
    }

    for name, value in wanted.items():
        pattern = re.compile(rf'<color name="{name}">[^<]*</color>')
        entry = f'<color name="{name}">{value}</color>'
        if pattern.search(text):
            text = pattern.sub(entry, text)
        else:
            text = text.replace("</resources>", f"    {entry}\n</resources>")

    COLORS.write_text(text)
    print(f"colors.xml: status/nav {STATUS}, window {WINDOW}")


def patch_styles():
    if not STYLES.exists():
        listing = "\n".join(sorted(p.name for p in VALUES.iterdir())) or "(empty)"
        fail(f"{STYLES} not found. Files actually present in {VALUES}:\n{listing}")

    text = STYLES.read_text()

    match = re.search(
        r'(<style name="AppTheme\.NoActionBar"[^>]*>)(.*?)(</style>)',
        text,
        re.DOTALL,
    )
    if not match:
        for m in re.finditer(r'(<style name="([^"]+)"[^>]*>)(.*?)(</style>)', text, re.DOTALL):
            name = m.group(2)
            if "NoActionBar" in name and "Launch" not in name:
                match = re.match(
                    r'(<style name="[^"]+"[^>]*>)(.*?)(</style>)', m.group(0), re.DOTALL
                )
                print(f"note: AppTheme.NoActionBar absent, using {name} instead")
                break

    if not match:
        names = re.findall(r'<style name="([^"]+)"', text)
        fail(
            "No usable NoActionBar theme in styles.xml. Styles present: "
            + (", ".join(names) or "(none)")
            + ". Capacitor changed its template — update this script."
        )

    head, body, tail = match.groups()

    items = {
        "android:statusBarColor": "@color/rongamari_status",
        "android:navigationBarColor": "@color/rongamari_nav",
        "android:windowBackground": "@color/rongamari_window",
        # The header is deep green, so status bar icons must stay light.
        "android:windowLightStatusBar": "false",
    }

    for name, value in items.items():
        pattern = re.compile(rf'<item name="{re.escape(name)}">[^<]*</item>')
        entry = f'<item name="{name}">{value}</item>'
        if pattern.search(body):
            body = pattern.sub(entry, body)
        else:
            body = body.rstrip() + f"\n        {entry}\n    "

    original = match.group(0)
    text = text.replace(original, head + body + tail, 1)
    STYLES.write_text(text)

    print("styles.xml: statusBarColor, navigationBarColor, windowBackground, "
          "windowLightStatusBar=false")


def verify():
    styles = STYLES.read_text()
    colors = COLORS.read_text()
    problems = []
    if "rongamari_status" not in styles:
        problems.append("styles.xml is not referencing the status bar colour")
    if STATUS not in colors:
        problems.append(f"colors.xml is missing {STATUS}")
    if problems:
        fail("; ".join(problems))
    print("verified: native chrome matches the brand green")


if __name__ == "__main__":
    print("=== RONGAMARI-THEME ===")
    patch_colors()
    patch_styles()
    verify()
