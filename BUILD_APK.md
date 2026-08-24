# Building the RongaMari APK

`.github/workflows/build-apk.yml` builds a signed release APK on every push to
`main` and publishes it to a GitHub Release tagged `latest`. One stable link:

```
https://github.com/<you>/<repo>/releases/download/latest/RongaMari.apk
```

## First build: what to expect

1. Push the repo to GitHub (see the commands at the bottom of README.md).
2. The Actions tab shows **Build RongaMari APK** running.
3. On the very first run the workflow **generates the signing keystore and
   commits it** to `signing/rongamari-release.keystore`. This triggers one
   extra build; that is normal. From then on every build signs with the same
   key.
4. Download from the release page (or the workflow artifact). Install, allow
   "install from this source" once, done. Updates install straight over the
   old version — same signature, no uninstall, no data loss.

## Why Capacitor and not Bubblewrap

A Bubblewrap/TWA wrapper proves domain ownership by fetching
`/.well-known/assetlinks.json` from the **domain root**. A GitHub project page
lives at `<you>.github.io/<repo>/` — the root belongs to a different repo, so
verification fails and the app opens with a browser address bar across the top.

Capacitor bundles the web assets into the APK instead. No assetlinks, no
custom domain needed, and the app works on a phone that has never once reached
the Pages URL.

## The keystore — read this before deleting anything

`signing/rongamari-release.keystore` is committed on purpose and is **not** in
`.gitignore`.

Android refuses to update an installed app whose signature doesn't match the
incoming APK. Without a stable key, every CI run would sign with a fresh random
key, the update would be refused as `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, and
the only way forward is uninstall — which deletes the app's storage, and with
it every month of budgets, transactions, debts and goals on that device.

- Password: `rongamari`, alias: `rongamari` (fine for a self-signed sideload
  key; its only job is to stay byte-identical between builds)
- Keep an off-GitHub copy. To rotate, set repository secrets
  `RONGAMARI_KEYSTORE_B64` (base64 of the file), `RONGAMARI_KEYSTORE_PASSWORD`,
  `RONGAMARI_KEY_ALIAS`, `RONGAMARI_KEY_PASSWORD` — but rotating breaks
  updates for anyone already installed, forcing uninstall + data loss.
- This is a sideload key, not a Play Store upload key.

If you prefer the key never to live in the repo: generate one locally with
`keytool`, base64 it into the `RONGAMARI_KEYSTORE_B64` secret, and delete the
committed file. The workflow prefers the secret when present.

## versionCode

`scripts/patch-android-signing.py` derives versionCode from
`GITHUB_RUN_NUMBER + 1000`. The floor exists because deleting and recreating
the repo resets the run counter to 1, while the phone still holds an APK at a
higher number — Android then reads the new build as a downgrade and refuses it.

## The test gate

The workflow runs `npm test` (76 checks: budget arithmetic, insight rules,
PDF/xlsx byte validity, a full jsdom boot of the real UI) before it builds.
A red test means no APK. That is deliberate: a broken APK installs over a
working one, and takes the month's data down with it if uninstall ever becomes
the only way out.

## Building locally (optional)

You need JDK 17 and the Android SDK:

```bash
npm install
rm -rf www && mkdir www
cp index.html rongamari-sw.js rongamari.manifest.json www/
cp -r css js www/
mkdir -p www/resources
find resources -maxdepth 1 -type f ! -name 'logo-source.png' -exec cp {} www/resources/ \;
npx cap add android
python3 scripts/patch-android-signing.py
python3 scripts/patch-android-theme.py
python3 scripts/patch-android-icons.py
npx cap sync android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

## Regenerating icons and splash

After changing the logo, replace `resources/logo-source.png` and run:

```bash
python3 tools/make_assets.py     # needs Pillow: pip3 install pillow
```

It re-crops the mark, re-renders every PWA icon, every Android launcher
density, the adaptive foreground and the splash. Commit the output — CI only
copies pre-rendered PNGs so a release build can never fail over an image
dependency.

## Saving PDFs and Excel files

The export buttons write real files rather than calling `window.print()`:
Capacitor's WebView has no print handler, so print does nothing at all in the
APK. `js/export.js` generates the PDF and the `.xlsx` itself, offline, with no
libraries. Files land in `Documents/RongaMari/` (via the committed
`@capacitor/filesystem` plugin) with a share prompt; in a browser they download
normally.
