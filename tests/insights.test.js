/* The insights engine: every rule fires (or stays quiet) for the right reason. */
'use strict';
const { check, eq, near, ok, finish } = require('./helpers');

const Insights = require('../js/insights.js');

function mkTotals(over) {
  return Object.assign({
    month: '2026-08',
    income: 1000,
    baseIncome: 1000,
    extraIncome: 0,
    budgetTotal: 800,
    allocated: 800,
    unallocated: 200,
    spent: 0,
    remaining: 1000,
    byCategory: [],
    weekly: [0, 0, 0, 0, 0],
    day: 8,
    daysInMonth: 31,
    daysLeft: 23,
    spentPct: 0,
    expectedPct: 26,
    avgPerDay: 0,
    safePerDay: 43,
    count: 0,
    savingsRate: 100
  }, over);
}

function gen(over) {
  return Insights.generate(Object.assign({
    totals: mkTotals(),
    month: '2026-08',
    label: 'August 2026',
    prevTotals: null,
    prevLabel: 'Jul',
    debts: [],
    goals: [],
    currency: '$',
    debtDays: 3,
    today: '2026-08-08',
    isCurrent: true
  }, over));
}

check('no income nudges the user to Plan', () => {
  const out = gen({ totals: mkTotals({ income: 0, remaining: 0 }) });
  ok(out.some(i => i.title.includes('income')), JSON.stringify(out.map(i => i.title)));
});

check('overspend fires the bad alert', () => {
  const out = gen({ totals: mkTotals({ spent: 1100, remaining: -100, spentPct: 110 }) });
  ok(out.some(i => i.tone === 'bad' && i.title === 'Over budget'));
});

check('spending fast warns with a projection', () => {
  const out = gen({ totals: mkTotals({ spent: 500, spentPct: 50, expectedPct: 26, avgPerDay: 62.5 }) });
  const hit = out.find(i => i.title === 'Spending fast');
  ok(hit, 'expected "Spending fast", got: ' + JSON.stringify(out.map(i => i.title)));
  ok(hit.body.includes('$'), 'projection should mention money');
});

check('on-pace month gets the good word', () => {
  const out = gen({ totals: mkTotals({ spent: 250, spentPct: 25, avgPerDay: 31.25 }) });
  ok(out.some(i => i.title === 'On pace' || i.title === 'Comfortably on track'));
});

check('category over budget is flagged by name', () => {
  const out = gen({
    totals: mkTotals({
      spent: 400, spentPct: 40,
      byCategory: [
        { id: 'c1', name: 'Fun', icon: '🎉', budget: 100, spent: 180, remaining: -80, pct: 180 },
        { id: 'c2', name: 'Home', icon: '🏠', budget: 500, spent: 220, remaining: 280, pct: 44 }
      ]
    })
  });
  const hit = out.find(i => i.title.includes('Fun'));
  ok(hit, 'over-budget category should be named');
  ok(hit.tone === 'bad');
});

check('category at 80%+ warns', () => {
  const out = gen({
    totals: mkTotals({
      spent: 400, spentPct: 40,
      byCategory: [
        { id: 'c2', name: 'Groceries', icon: '🛒', budget: 200, spent: 170, remaining: 30, pct: 85 }
      ]
    })
  });
  ok(out.some(i => i.title.includes('Groceries') && i.tone === 'warn'));
});

check('month-on-month jump warns with percentage', () => {
  const out = gen({
    totals: mkTotals({ spent: 600, spentPct: 60, expectedPct: 26, avgPerDay: 75, day: 8 }),
    prevTotals: mkTotals({ spent: 300 }),
    prevLabel: 'Jul'
  });
  ok(out.some(i => i.title.includes('up') && i.title.includes('Jul')), JSON.stringify(out.map(i => i.title)));
});

check('debts: overdue shouts', () => {
  const out = gen({
    totals: mkTotals({ income: 1000, spent: 100, remaining: 900 }),
    debts: [{ id: 'd1', direction: 'owe', person: 'Tenda', amount: 100, paid: 0, dueDate: '2026-08-01' }]
  });
  ok(out.some(i => i.title === 'Overdue debt' && i.tone === 'bad'));
});

check('debts: due within window warns', () => {
  const out = gen({
    totals: mkTotals({ income: 1000, spent: 100, remaining: 900 }),
    debts: [{ id: 'd2', direction: 'owe', person: 'Bank', amount: 80, paid: 0, dueDate: '2026-08-10' }]
  });
  ok(out.some(i => i.title === 'Debt due this week' && i.tone === 'warn'));
});

check('debts: heavy debt load vs income warns with share', () => {
  const out = gen({
    totals: mkTotals({ income: 1000, spent: 100, remaining: 900 }),
    debts: [{ id: 'd3', direction: 'owe', person: 'Steward', amount: 400, paid: 0, dueDate: '2026-12-01' }]
  });
  ok(out.some(i => i.title.includes('40% of income')));
});

check('goals: close goal gets a good nudge', () => {
  const out = gen({
    totals: mkTotals({ income: 1000, spent: 100, remaining: 900, savingsRate: 90 }),
    goals: [{ id: 'g1', name: 'Laptop', target: 1000, saved: 850, deadline: '' }]
  });
  ok(out.some(i => i.title.includes('Laptop') && i.tone === 'good'), JSON.stringify(out.map(i => i.title)));
});

check('reached goal celebrates', () => {
  const out = gen({ goals: [{ id: 'g1', name: 'Laptop', target: 1000, saved: 1000, deadline: '' }] });
  ok(out.some(i => i.title.includes('reached')));
});

check('plan exceeding income warns', () => {
  const out = gen({ totals: mkTotals({ budgetTotal: 1500, unallocated: -500 }) });
  ok(out.some(i => i.title === 'Plan exceeds income'));
});

check('week concentration insight', () => {
  const out = gen({
    totals: mkTotals({ spent: 400, spentPct: 40, weekly: [300, 40, 30, 20, 10], count: 5 })
  });
  ok(out.some(i => i.title.includes('Week 1 carries')), JSON.stringify(out.map(i => i.title)));
});

check('small leaks insight after enough transactions', () => {
  const out = gen({
    totals: mkTotals({
      spent: 400, spentPct: 40, count: 10,
      byCategory: [
        { id: 'a', name: 'Airtime', icon: '📱', budget: 0, spent: 40, remaining: -40, pct: 100 },
        { id: 'b', name: 'Snacks', icon: '🍫', budget: 0, spent: 30, remaining: -30, pct: 100 },
        { id: 'c', name: 'Fares', icon: '🚌', budget: 0, spent: 25, remaining: -25, pct: 100 },
        { id: 'd', name: 'Home', icon: '🏠', budget: 300, spent: 305, remaining: -5, pct: 102 }
      ]
    })
  });
  ok(out.some(i => i.title === 'Small leaks add up'));
});

check('past month gets a one-line review', () => {
  const out = gen({
    isCurrent: false,
    totals: mkTotals({ spent: 700, remaining: 300, savingsRate: 30, day: 31, daysLeft: 1 })
  });
  ok(out.some(i => i.title.includes('in one line')));
});

check('headline picks the most urgent', () => {
  const list = [
    { tone: 'good', title: 'a' },
    { tone: 'warn', title: 'b' },
    { tone: 'bad', title: 'c' }
  ];
  eq(Insights.headline(list).title, 'c');
  eq(Insights.headline([]), null);
});

check('money formatting folds currency through', () => {
  const out = gen({
    totals: mkTotals({ spent: 500, spentPct: 50, expectedPct: 26, avgPerDay: 62.5 }),
    currency: 'ZiG'
  });
  const hit = out.find(i => i.title === 'Spending fast');
  ok(hit.body.includes('ZiG'), 'custom currency symbol should appear');
});

finish();
