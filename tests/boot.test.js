/* Boot smoke test: loads the real index.html into jsdom, evaluates the real
   scripts in order, and exercises the app the way a finger would — nav taps,
   the FAB, a logged transaction, a modal, month switching. Catches the wiring
   bugs that pure-unit tests cannot see: a listener on an id that doesn't
   exist, a render that throws, a view that never activates. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { check, eq, ok, finish } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'https://rongamari.test/index.html',
  pretendToBeVisual: true,
  runScripts: 'outside-only'
});
const win = dom.window;
win.scrollTo = function () {};   // jsdom has no layout; the call is a no-op anyway

const SCRIPTS = ['js/store.js', 'js/charts.js', 'js/insights.js', 'js/ui.js',
                 'js/export.js', 'js/app.js'];

let bootError = null;

(async () => {
  try {
    SCRIPTS.forEach(f => {
      win.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    });
  } catch (e) {
    bootError = e;
  }
  /* jsdom reports readyState 'loading' right after construction; app.js defers
     boot() to DOMContentLoaded, which fires on the next tick. Wait for it. */
  if (win.document.readyState === 'loading') {
    await new Promise(r => win.document.addEventListener('DOMContentLoaded', r));
  }

  check('the whole app boots without throwing', () => {
    if (bootError) throw bootError;
  });

const doc = win.document;

check('home is the active view after boot', () => {
  ok(doc.getElementById('view-home').classList.contains('is-active'));
  eq(doc.querySelectorAll('.view.is-active').length, 1);
});

check('hero rendered with seeded defaults', () => {
  ok(doc.getElementById('heroRing').querySelector('svg'), 'ring svg rendered');
  ok(doc.getElementById('homeMonth').textContent.length > 3, 'month label: ' + doc.getElementById('homeMonth').textContent);
});

check('bottom nav switches views', () => {
  doc.querySelector('.navbtn[data-view="plan"]').click();
  ok(doc.getElementById('view-plan').classList.contains('is-active'), 'plan active');
  ok(!doc.getElementById('view-home').classList.contains('is-active'), 'home inactive');
  doc.querySelector('.navbtn[data-view="grow"]').click();
  ok(doc.getElementById('view-grow').classList.contains('is-active'), 'grow active');
  doc.querySelector('.navbtn[data-view="home"]').click();
  ok(doc.getElementById('view-home').classList.contains('is-active'));
});

check('top bar reaches debts and more', () => {
  doc.getElementById('btnDebts').click();
  ok(doc.getElementById('view-debts').classList.contains('is-active'));
  doc.getElementById('btnMore').click();
  ok(doc.getElementById('view-more').classList.contains('is-active'));
  doc.getElementById('brandBtn').click();
  ok(doc.getElementById('view-home').classList.contains('is-active'));
});

check('logging a transaction shows it on home and plan', () => {
  const Store = win.RMStore;
  const mk = Store.currentMonthKey();
  const cat = Store.getMonth(mk).categories[0];
  Store.addTransaction({ date: mk + '-03', type: 'expense', amount: 42.5, categoryId: cat.id, note: 'test entry' });
  win.RMApp.render();
  const home = doc.getElementById('homeRecent').textContent;
  ok(home.includes('test entry'), 'home recent: ' + home.slice(0, 120));

  doc.querySelector('.navbtn[data-view="plan"]').click();
  const spend = doc.getElementById('spendGroups').textContent;
  ok(spend.includes('test entry'), 'activity list shows it');
  ok(spend.includes('$42.50'), 'amount formatted');
});

check('transaction row opens the action sheet', () => {
  const row = doc.querySelector('[data-tx]');
  ok(row, 'a transaction row exists');
  row.click();
  const title = doc.getElementById('modalTitle').textContent;
  ok(title.includes('$42.50'), 'action sheet title shows amount: ' + title);
  ok(title.includes('·'), 'title separates amount and note');
  const editBtn = [...doc.querySelectorAll('.modal__body .btn')]
    .find(b => b.textContent.includes('Edit'));
  ok(editBtn, 'Edit action present');
  editBtn.click();
});

/* actions() closes the sheet first, then fires the chosen action after the
   close transition — wait that out before asserting the edit sheet opened */
await new Promise(r => setTimeout(r, 150));
check('edit action opens the transaction form', () => {
  ok(doc.getElementById('modalTitle').textContent === 'Edit transaction',
     'title is: ' + doc.getElementById('modalTitle').textContent);
  ok(doc.querySelector('#modalBody input[data-name="amount"]'), 'amount field present');
  win.RMUI.close();
});

/* close any sheet left open by the previous check, and let the hide timer run */
win.RMUI.close();
await new Promise(r => setTimeout(r, 320));

check('modal cancel closes the sheet', () => {
  win.RMUI.show({ title: 'X', fields: [{ name: 'a', label: 'A', type: 'text' }] });
  ok(!doc.getElementById('modal').hidden, 'open');
  doc.getElementById('modalCancel').click();
  ok(!doc.getElementById('modal').classList.contains('is-open'), 'is-open removed on cancel');
});

check('FAB offers expense/income/debt actions', () => {
  doc.getElementById('fabAdd').click();
  const labels = [...doc.querySelectorAll('.modal__body .btn')].map(b => b.textContent);
  ok(labels.some(l => l.includes('expense')), 'expense action: ' + labels.join('|'));
  ok(labels.some(l => l.includes('income')), 'income action');
  win.RMUI.close();
});

check('month switcher moves back and forward', () => {
  const before = doc.getElementById('homeMonth').textContent;
  doc.getElementById('homePrev').click();
  doc.querySelector('.navbtn[data-view="home"]').click();   // home is where the label lives
  const after = doc.getElementById('homeMonth').textContent;
  ok(before !== after, before + ' -> ' + after);
  doc.getElementById('homeNext').click();
  eq(doc.getElementById('homeMonth').textContent, before, 'back to current');
  doc.getElementById('homeNext').click();
  eq(doc.getElementById('homeMonth').textContent, before, 'future month refused');
});

check('plan renders categories with budgets', () => {
  doc.querySelector('.navbtn[data-view="plan"]').click();
  const rows = doc.querySelectorAll('[data-cat-edit]');
  ok(rows.length >= 6, 'seeded categories rendered: ' + rows.length);
});

check('save and grow render without errors', () => {
  doc.querySelector('.navbtn[data-view="save"]').click();
  ok(doc.getElementById('saveTotal').textContent.length > 0);
  doc.querySelector('.navbtn[data-view="grow"]').click();
  ok(doc.getElementById('trendChart').querySelector('svg'), 'trend chart svg');
  ok(doc.getElementById('growInsights').children.length >= 0);
});

check('export model builds from live data', () => {
  const m = win.RMApp.exportModel();
  ok(m.tot.spent >= 42.5, 'model sees the logged transaction');
  ok(m.weeks.length >= 1, 'weeks present');
  ok(typeof m.money === 'function', 'money formatter attached');
});

check('pdf and xlsx bytes generate from the live model', () => {
  const m = win.RMApp.exportModel();
  const pdf = win.RMExport.pdfBytes(m);
  ok(Buffer.from(pdf.slice(0, 5)).toString('latin1') === '%PDF-', 'pdf magic');
  const x = win.RMExport.xlsxBytes(m);
  ok(x[0] === 0x50 && x[1] === 0x4b, 'xlsx zip magic');
});

  finish();
})();
