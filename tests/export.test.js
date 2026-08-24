/* Export bytes: the PDF is a parseable PDF, the xlsx is a parseable ZIP with
   the OOXML parts inside. If either regresses, the export buttons ship junk. */
'use strict';
const { check, eq, near, ok, finish } = require('./helpers');
const zlib = require('zlib');

const RMExport = require('../js/export.js');

function model() {
  return {
    period: 'August 2026',
    monthKey: '2026-08',
    currency: '$',
    person: 'Tanaka',
    generated: 'generated 24 Aug 2026',
    stamp: '2026-08-24T08:00:00Z',
    money: n => '$' + Math.abs(n).toFixed(2),
    tot: {
      income: 1200, baseIncome: 1000, extraIncome: 200,
      budgetTotal: 900, unallocated: -300,
      spent: 400, remaining: 800, spentPct: 33,
      byCategory: [
        { id: 'c1', name: 'Home', icon: '🏠', color: '#3F9C35', budget: 500, spent: 300, remaining: 200, pct: 60 },
        { id: 'c2', name: 'Fun', icon: '🎉', color: '#C94F4F', budget: 100, spent: 100, remaining: 0, pct: 100 }
      ],
      weekly: [120, 90, 100, 90, 0],
      day: 24, daysInMonth: 31, daysLeft: 7,
      avgPerDay: 16.67, safePerDay: 114.29, count: 12, savingsRate: 67
    },
    subline: 'Income $1,200.00 · 12 expenses.',
    weeks: [
      { no: 1, range: 'day 1–7', total: 120, rows: [
        { dateLabel: 'Aug 2', label: 'Groceries', icon: '🛒', amount: 80, type: 'expense' },
        { dateLabel: 'Aug 5', label: 'gig', icon: '💸', amount: 200, type: 'income' }
      ] }
    ],
    txCount: 12,
    allTx: [
      { date: '2026-08-02', week: 0, type: 'expense', amount: 80, categoryName: 'Groceries', note: 'monthly shop' },
      { date: '2026-08-05', week: 0, type: 'income', amount: 200, categoryName: 'Other', note: 'gig' }
    ],
    debts: [
      { person: 'Tenda', dirLabel: 'I owe', amount: 100, paid: 40, remaining: 60,
        startDate: '2026-07-01', dueDate: '2026-09-01', status: 'partial',
        statusLabel: 'PARTIAL', dateLine: 'from 2026-07-01', note: '' }
    ],
    debtsOutstanding: 60,
    goals: [
      { name: 'Emergency', icon: '🛡️', target: 1000, saved: 250, pct: 25, deadline: '2026-12-31' }
    ],
    goalsTarget: 1000,
    goalsSaved: 250,
    insights: [
      { tone: 'warn', icon: '⚠️', title: 'Fun almost done', body: '100% of the Fun budget is spent.' }
    ]
  };
}

/* ── PDF ── */
const pdf = RMExport.pdfBytes(model());

check('pdf starts with the magic header', () => {
  const head = Buffer.from(pdf.slice(0, 8)).toString('latin1');
  ok(head.startsWith('%PDF-1.4'), 'got: ' + head);
});

check('pdf ends with EOF', () => {
  const tail = Buffer.from(pdf.slice(-8)).toString('latin1');
  ok(tail.includes('%%EOF'), 'got: ' + tail);
});

check('pdf has a valid xref pointing at objects', () => {
  const text = Buffer.from(pdf).toString('latin1');
  const m = text.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
  ok(m, 'startxref present at end');
  const pos = parseInt(m[1], 10);
  ok(text.slice(pos, pos + 4) === 'xref', 'xref table at the stated offset');
  ok(/trailer[\s\S]*\/Root 1 0 R/.test(text), 'trailer references the catalog');
});

check('pdf carries the statement content', () => {
  const text = Buffer.from(pdf).toString('latin1');
  ok(text.includes('Monthly Budget Statement'), 'title');
  ok(text.includes('BUDGET VS ACTUAL'), 'budget section');
  ok(text.includes('TRANSACTIONS'), 'transactions section');
  ok(text.includes('BORROWED'), 'debts section');
  ok(text.includes('SAVINGS GOALS'), 'goals section');
  ok(text.includes('RongaMari'), 'brand');
  ok(text.includes('Tanaka'), 'person');
});

check('pdf paginates under a heavy model', () => {
  const m = model();
  m.weeks = [];
  for (let w = 1; w <= 5; w++) {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      rows.push({ dateLabel: 'Aug ' + i, label: 'Transaction number ' + i + ' with a longer note', icon: '🧾', amount: 10 + i, type: 'expense' });
    }
    m.weeks.push({ no: w, range: 'day 1-7', total: 1000, rows: rows });
  }
  m.allTx = [];
  m.weeks.forEach(wk => wk.rows.forEach(r => m.allTx.push({ date: '2026-08-01', week: 0, type: 'expense', amount: r.amount, categoryName: 'X', note: r.label })));
  const bytes = RMExport.pdfBytes(m);
  const text = Buffer.from(bytes).toString('latin1');
  ok(/\/Count [2-9]/.test(text), 'expected multiple pages');
  ok(/Page 2 of/.test(text), 'footer stamps page 2');
});

/* ── XLSX ── */
const xlsx = RMExport.xlsxBytes(model());

check('xlsx is a ZIP with the right signature', () => {
  eq(xlsx[0], 0x50, 'P');
  eq(xlsx[1], 0x4b, 'K');
});

check('xlsx contains the OOXML parts', () => {
  const names = zipEntries(xlsx).map(e => e.name);
  ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml',
   'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet5.xml', 'docProps/core.xml']
    .forEach(n => ok(names.includes(n), 'missing ' + n + ' in: ' + names.join(', ')));
});

check('xlsx CRCs verify for every entry', () => {
  const table = crcTable();
  zipEntries(xlsx).forEach(e => {
    eq(e.crc, crc32(e.data, table), 'crc for ' + e.name);
  });
});

check('xlsx sheets inflate to real sheet XML', () => {
  const entries = zipEntries(xlsx);
  const sheet2 = entries.find(e => e.name === 'xl/worksheets/sheet2.xml');
  const xml = zlib.inflateRawSync
    ? null // stored entries are not deflated; data is raw already
    : null;
  const text = Buffer.from(sheet2.data).toString('utf8');
  ok(text.includes('<worksheet'), 'worksheet root');
  ok(text.includes('Budget'), 'Budget header text');
  ok(text.includes('TOTAL'), 'total row');
  const sheet3 = entries.find(e => e.name === 'xl/worksheets/sheet3.xml');
  const t3 = Buffer.from(sheet3.data).toString('utf8');
  ok(t3.includes('Category'), 'transactions sheet content');
  ok(t3.includes('monthly shop'), 'transaction note carried through');
});

check('xlsx workbook registers all five sheets', () => {
  const wb = zipEntries(xlsx).find(e => e.name === 'xl/workbook.xml');
  const text = Buffer.from(wb.data).toString('utf8');
  ['Summary', 'Budget', 'Transactions', 'Debts', 'Goals'].forEach(s => {
    ok(text.includes('name="' + s + '"'), 'sheet ' + s);
  });
});

check('xlsx styles define the header fill and money format', () => {
  const st = zipEntries(xlsx).find(e => e.name === 'xl/styles.xml');
  const text = Buffer.from(st.data).toString('utf8');
  ok(text.includes('FF0A4D22'), 'brand green fill');
  ok(text.includes('#,##0.00'), 'money format');
});

check('xml escaping survives hostile notes', () => {
  const m = model();
  m.allTx = [{ date: '2026-08-02', week: 0, type: 'expense', amount: 5, categoryName: 'A', note: '<b>&"\'</b>' }];
  const bytes = RMExport.xlsxBytes(m);
  const sheet3 = zipEntries(bytes).find(e => e.name === 'xl/worksheets/sheet3.xml');
  const text = Buffer.from(sheet3.data).toString('utf8');
  ok(text.includes('&lt;b&gt;&amp;&quot;&apos;&lt;/b&gt;'), 'escaped note');
  ok(!text.includes('<b>'), 'no raw markup leaked');
});

/* ── zip helpers ── */
function crcTable() {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
}
function crc32(bytes, table) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zipEntries(bytes) {
  const out = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i < bytes.length - 4) {
    if (dv.getUint32(i, true) !== 0x04034b50) { i++; continue; }
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const size = dv.getUint32(i + 18, true);
    const crc = dv.getUint32(i + 14, true);
    const name = Buffer.from(bytes.slice(i + 30, i + 30 + nameLen)).toString('utf8');
    const data = bytes.slice(i + 30 + nameLen + extraLen, i + 30 + nameLen + extraLen + size);
    out.push({ name, crc, data });
    i = i + 30 + nameLen + extraLen + size;
  }
  return out;
}

finish();
