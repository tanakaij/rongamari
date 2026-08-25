/* Repo integrity: everything index.html, the manifest and the service worker
   promise must actually exist on disk. The CI staging step runs the same
   checks against www/; this runs them at test time so a missing file fails
   before a build ever starts. */
'use strict';
const fs = require('fs');
const path = require('path');
const { check, eq, ok, finish } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }

const html = read('index.html');
const manifest = JSON.parse(read('rongamari.manifest.json'));
const sw = read('rongamari-sw.js');

check('every css file referenced by index.html exists', () => {
  const refs = [...html.matchAll(/href="(css\/[^"]+)"/g)].map(m => m[1]);
  ok(refs.length >= 1, 'expected at least one stylesheet');
  refs.forEach(f => ok(exists(f), f + ' missing'));
});

check('every js file referenced by index.html exists', () => {
  const refs = [...html.matchAll(/src="(js\/[^"]+)"/g)].map(m => m[1]);
  ok(refs.length >= 6, 'expected the full script set, got: ' + refs.join(','));
  refs.forEach(f => ok(exists(f), f + ' missing'));
  ok(refs.includes('js/app.js'), 'app.js is loaded last-ish');
  eq(refs[refs.length - 1], 'js/app.js', 'app.js must be the last script');
});

check('every resource referenced by index.html exists', () => {
  const refs = [...html.matchAll(/(?:src|href)="(resources\/[^"]+)"/g)].map(m => m[1]);
  ok(refs.length >= 2, 'expected mark + empty-state images');
  refs.forEach(f => ok(exists(f), f + ' missing'));
});

check('manifest icons exist', () => {
  manifest.icons.forEach(i => ok(exists(i.src), i.src + ' missing'));
  eq(manifest.name, 'RongaMari');
});

check('service worker shell list matches disk', () => {
  const m = sw.match(/var SHELL = \[([\s\S]*?)\];/);
  ok(m, 'SHELL array found');
  const files = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  ok(files.length >= 10, 'shell should cover the whole app');
  files.forEach(f => ok(exists(f), 'SHELL lists ' + f + ' but it does not exist'));
  /* every js/css file on disk is cached — an uncached file breaks offline */
  const jsOnDisk = fs.readdirSync(path.join(ROOT, 'js')).map(f => 'js/' + f);
  const cssOnDisk = fs.readdirSync(path.join(ROOT, 'css')).map(f => 'css/' + f);
  jsOnDisk.concat(cssOnDisk).forEach(f => {
    ok(files.includes(f), f + ' exists on disk but is NOT in the service worker shell');
  });
});

check('index.html is wired to the manifest and sw', () => {
  ok(html.includes('rongamari.manifest.json'), 'manifest link');
  ok(html.match(/theme-color" content="#0A4D22"/), 'theme color matches brand');
});

check('all bottom-nav views exist as sections', () => {
  ['home', 'plan', 'save', 'grow'].forEach(v => {
    ok(html.includes('id="view-' + v + '"'), 'view-' + v);
  });
  ['debts', 'more'].forEach(v => {
    ok(html.includes('id="view-' + v + '"'), 'view-' + v);
  });
});

check('every id the app JS touches exists in the HTML', () => {
  const app = read('js/app.js');
  const ids = [...app.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map(m => m[1]);
  ok(ids.length > 30, 'expected plenty of id lookups, got ' + ids.length);
  const missing = [...new Set(ids)].filter(id => !html.includes('id="' + id + '"'));
  eq(missing.join(','), '', 'all ids present');
});

check('android icon assets are committed for the build', () => {
  ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach(d => {
    ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground'].forEach(n => {
      const p = 'resources/android/' + n + '-' + d + '.png';
      ok(exists(p), p + ' missing — run tools/make_assets.py');
    });
  });
  ok(exists('resources/android/splash.png'), 'splash missing');
  ok(exists('resources/ic_notification.png'), 'notification icon missing');
});

check('workflow, scripts and config are all present', () => {
  ['.github/workflows/build-apk.yml', 'capacitor.config.json', 'package.json',
   'scripts/patch-android-icons.py', 'scripts/patch-android-signing.py',
   'scripts/patch-android-theme.py', 'tools/make_assets.py']
    .forEach(p => ok(exists(p), p + ' missing'));
});

check('capacitor config points at www with the right app id', () => {
  const cfg = JSON.parse(read('capacitor.config.json'));
  eq(cfg.appId, 'com.rongamari.app');
  eq(cfg.appName, 'RongaMari');
  eq(cfg.webDir, 'www');
});

check('package.json wires npm test to the runner', () => {
  const pkg = JSON.parse(read('package.json'));
  eq(pkg.scripts.test, 'node tests/run.js');
  ok(pkg.dependencies['@capacitor/android'], 'capacitor android dep');
  ok(pkg.dependencies['@capacitor/local-notifications'], 'notifications dep');
  ok(pkg.dependencies['@capacitor/filesystem'], 'filesystem dep for exports');
});

finish();
