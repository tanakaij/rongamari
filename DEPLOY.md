# Deploying the PWA (GitHub Pages)

The repo root is the finished app — no build step. Pages serves it as-is.

## One-time setup

```bash
git init
git add .
git commit -m "RongaMari: Plan. Spend. Save. Grow."
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → `main` /
`/(root)`**. (If you use the Actions deploy source instead, add a trivial
pages workflow; branch deploy is the simplest.)

The app is then at:

```
https://<you>.github.io/<repo>/
```

Install it from the browser menu ("Add to Home Screen") for the standalone,
offline PWA — or skip all that and grab the APK from the `latest` release,
which needs no URL at all.

## Offline behaviour

`rongamari-sw.js` caches the shell on first visit. After any change to
`index.html`, `css/` or `js/`, **bump `CACHE_VERSION`** at the top of the
service worker — that is the whole update mechanism. Registration uses
`updateViaCache: 'none'`, so the bump is picked up on the next load.

## Note on scope

The manifest uses relative `start_url: index.html` and `scope: ./`, so the app
works equally at a project page (`/<repo>/`) and at a custom domain root.
