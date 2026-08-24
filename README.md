# RongaMari 🌱

**Plan. Spend. Save. Grow.**

A personal monthly budget app — one person's money, on one device, with no
account and no server. Works fully offline as a PWA and ships as a signed
Android APK built by GitHub Actions with **Capacitor** (not Bubblewrap).

<p align="center"><img src="resources/logo-full.png" width="220" alt="RongaMari logo"></p>

## What it does

| Tab | What you get |
| --- | --- |
| **Home** | Month at a glance: budget ring, safe-to-spend per day, weekly spending bars, top categories, borrowed-money total, goals, the single most urgent insight, recent activity |
| **Plan** | Monthly income, category budgets (add / edit / delete), copy last month, an auto-suggested split |
| **Spend** | Log expenses and income, grouped by day, weekly totals, category filters, edit/delete everything |
| **Save** | Savings goals with progress, contributions, deadlines |
| **Grow** | Six-month trend, savings rate, month review, and rule-based **insights** — pacing warnings, category pressure, month-on-month movers, debt alerts, small-leak detection |
| **Debts** | Money you owe **and** money owed to you: due dates, part-payments, overdue flags, reminders |
| **More** | Name, currency (USD, ZiG, ZAR, GBP…), notification settings, **PDF statement**, **Excel workbook**, JSON backup/restore |

- **Notifications** — daily check-in at a time you choose, weekly review,
  budget-threshold alert (default 80% of income), debt due reminders. Native
  scheduled notifications in the APK, web Notifications in the browser.
- **Exports** — an invoice-style PDF statement and a real multi-sheet `.xlsx`
  workbook, generated **entirely offline with zero libraries** (the PDF is
  written byte-by-byte against the PDF spec; the xlsx is a hand-rolled OOXML
  ZIP). Saved to `Documents/RongaMari/` on Android, downloads in a browser.
- **Private by design** — everything lives in the app's own storage. No sign-in,
  no analytics, no network calls. Back up to a JSON file whenever you like.

## The two builds, one repo

1. **PWA** — the repo root *is* the app. GitHub Pages serves it; the service
   worker (`rongamari-sw.js`) caches the shell for offline use. See DEPLOY.md.
2. **APK** — `.github/workflows/build-apk.yml` stages the same files into
   `www/`, adds the Android platform, patches in the stable signing identity,
   the brand-green status bar and the launcher icon, then builds a **signed
   release APK** and publishes it to the GitHub Release tagged `latest`:

   ```
   https://github.com/<you>/<repo>/releases/download/latest/RongaMari.apk
   ```

Why Capacitor and not Bubblewrap: a TWA verifies domain ownership at the
**domain root** via `/.well-known/assetlinks.json`, which a GitHub project page
(`<you>.github.io/<repo>/`) can never satisfy. Capacitor bundles the web assets
into the APK — no domain needed, and the app works on a phone that has never
seen the Pages URL. Details in BUILD_APK.md.

## Development

```bash
npm install        # capacitor + jsdom
npm test           # 76 tests: store math, insights rules, PDF/xlsx bytes, boot smoke
npm run serve      # python3 -m http.server 8000 → http://localhost:8000
npm run assets     # regenerate icons/splash from resources/logo-source.png
```

The test suite is the CI gate: a red test means no APK.

## Repo layout

```
index.html               the whole app (7 views, bottom sheet, FAB)
css/app.css              light green theme, mobile-first
js/store.js              localStorage data layer + totals/weekly math
js/insights.js           rule-based intelligence (pure functions)
js/charts.js             SVG ring / weekly bars / 6-month trend
js/ui.js                 bottom-sheet modals, toasts, forms
js/export.js             PDF + XLSX writers, Capacitor Filesystem save
js/app.js                views, CRUD, navigation, notifications
rongamari-sw.js          PWA offline cache  (bump CACHE_VERSION on changes!)
rongamari.manifest.json  PWA manifest
resources/               icons + splash, generated from logo-source.png
tools/make_assets.py     renders all icons/splash from the master logo
scripts/patch-android-*  signing / theme / icon fixes applied in CI
signing/                 release keystore (auto-generated on first CI build)
tests/                   the gate
```

## Changing the app

Edit `index.html`, `css/`, or `js/`, **bump `CACHE_VERSION` in
`rongamari-sw.js`**, and push. The workflow rebuilds the APK and refreshes the
`latest` release; phones that installed the old APK update in place — the
signing key is stable, so no uninstall and no data loss.
