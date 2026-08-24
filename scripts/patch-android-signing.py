#!/usr/bin/env python3
"""Give every build the SAME signing identity and an INCREASING versionCode.

    python3 scripts/patch-android-signing.py

WHY THIS EXISTS
---------------
`android/` is not committed; `npx cap add android` regenerates it on every CI
run, and Gradle signs a release with whatever key the build config names. On a
fresh runner there is no stable key — so without this patch every APK carries a
different signature, and Android refuses updates with
INSTALL_FAILED_UPDATE_INCOMPATIBLE. The only way forward is uninstall, which
deletes the app's WebView storage: every month of budgets, transactions, debts
and goals on the device.

The keystore is committed at signing/rongamari-release.keystore. If it does not
exist yet (fresh repo), the WORKFLOW generates it once and commits it back, so
every later build reuses the same identity. Repository secrets
(RONGAMARI_KEYSTORE_B64 etc.) override the committed copy for people who
prefer not to keep a key on GitHub.

Also fixes versionCode: `cap add android` always writes 1, which Android reads
as a downgrade against any installed build. The CI run number, offset above a
floor of 1000, is monotonic across builds AND across a repo being recreated.

Safe to run more than once; it is a no-op if already applied.
"""
import os
import pathlib
import re
import sys

GRADLE = pathlib.Path("android/app/build.gradle")
MARKER = "// RONGAMARI-SIGNING"


def resolve_keystore() -> pathlib.Path | None:
    """The keystore the APK will be signed with, in priority order."""
    env = os.environ.get("RONGAMARI_KEYSTORE_PATH", "").strip()
    if env and pathlib.Path(env).exists():
        return pathlib.Path(env).resolve()
    local = pathlib.Path("signing/rongamari-release.keystore")
    if local.exists():
        return local.resolve()
    return None


VERSION_CODE_FLOOR = 1000


def version_code() -> int:
    raw = os.environ.get("RONGAMARI_VERSION_CODE", "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    run = os.environ.get("GITHUB_RUN_NUMBER", "").strip()
    if run.isdigit() and int(run) > 0:
        return VERSION_CODE_FLOOR + int(run)
    return VERSION_CODE_FLOOR + 1


def version_name(code: int) -> str:
    override = os.environ.get("RONGAMARI_VERSION_NAME", "").strip()
    if override:
        return override
    build = code - VERSION_CODE_FLOOR if code > VERSION_CODE_FLOOR else code
    return f"1.0.{build}"


def patch_gradle(keystore: pathlib.Path, code: int, name: str) -> int:
    if not GRADLE.exists():
        print(f"ERROR: {GRADLE} not found — run this after `npx cap add android`.")
        return 1

    text = GRADLE.read_text(encoding="utf-8")
    if MARKER in text:
        print("  already patched; skipping")
        return 0

    # GitHub Actions sets env vars from `env:` even when the secret is absent —
    # as "" — so `or` (not os.environ.get's default) is the correct fallback.
    store_pass = os.environ.get("RONGAMARI_KEYSTORE_PASSWORD") or "rongamari"
    key_alias = os.environ.get("RONGAMARI_KEY_ALIAS") or "rongamari"
    key_pass = os.environ.get("RONGAMARI_KEY_PASSWORD") or store_pass

    before = text
    text = re.sub(r"versionCode\s+\d+", f"versionCode {code}", text, count=1)
    text = re.sub(r'versionName\s+"[^"]*"', f'versionName "{name}"', text, count=1)
    if text == before:
        print("  WARNING: versionCode/versionName not found in defaultConfig")

    signing_block = f"""
    {MARKER} — stable identity so Android accepts in-place updates.
    signingConfigs {{
        rongamari {{
            storeFile file('{keystore.as_posix()}')
            storePassword '{store_pass}'
            keyAlias '{key_alias}'
            keyPassword '{key_pass}'
        }}
    }}
"""

    m = re.search(r"^android\s*\{", text, flags=re.MULTILINE)
    if not m:
        print("ERROR: no `android {` block in build.gradle")
        return 1
    text = text[: m.end()] + signing_block + text[m.end():]

    def attach(block_name: str, body: str) -> str:
        bt = re.search(r"buildTypes\s*\{", body)
        if not bt:
            m2 = re.search(r"^android\s*\{", body, flags=re.MULTILINE)
            body = body[: m2.end()] + "\n    buildTypes {\n    }\n" + body[m2.end():]
            bt = re.search(r"buildTypes\s*\{", body)
        idx = bt.end()
        existing = re.compile(r"\b" + block_name + r"\s*\{")
        em = existing.search(body[idx:])
        if em:
            insert_at = idx + em.end()
            return (
                body[:insert_at]
                + f"\n            signingConfig signingConfigs.rongamari {MARKER}"
                + body[insert_at:]
            )
        return (
            body[:idx]
            + f"\n        {block_name} {{\n            signingConfig signingConfigs.rongamari {MARKER}\n        }}"
            + body[idx:]
        )

    text = attach("debug", text)
    text = attach("release", text)

    GRADLE.write_text(text, encoding="utf-8")
    print(f"  signed with: {keystore}")
    print(f"  versionCode: {code}   versionName: {name}")
    return 0


def main() -> int:
    keystore = resolve_keystore()
    if keystore is None:
        print(
            "ERROR: no keystore found.\n"
            "  Expected signing/rongamari-release.keystore in the repo (the workflow\n"
            "  generates and commits it on the first run), or the RONGAMARI_KEYSTORE_B64\n"
            "  secret decoded to RONGAMARI_KEYSTORE_PATH.\n"
            "  Refusing to build: an APK signed with a throwaway key cannot update the\n"
            "  installed app, and the forced uninstall deletes all saved budgets."
        )
        return 1
    code = version_code()
    return patch_gradle(keystore, code, version_name(code))


if __name__ == "__main__":
    sys.exit(main())
