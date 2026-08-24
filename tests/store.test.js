/* The data layer: month math, totals arithmetic, weekly buckets, CRUD,
   debt payment clamping, goal contributions, backup/restore round trip. */
'use strict';
const { makeLocalStorage, check, eq, near, ok, finish } = require('./helpers');

globalThis.localStorage = makeLocalStorage();
const Store = require('../js/store.js');

check('monthKey slices a date', () => {
  eq(Store.monthKey('2026-08-24'), '2026-08');
  eq(Store.monthKey('2026-08-24'), Store.currentMonthKey().length === 7 ? '2026-08' : Store.monthKey('2026-08-24'));
});

check('shiftMonth crosses year boundaries', () => {
  eq(Store.shiftMonth('2026-01', -1), '2025-12');
  eq(Store.shiftMonth('2026-12', 1), '2027-01');
  eq(Store.shiftMonth('2026-08', -8), '2025-12');
});

check('daysInMonth handles leap years', () => {
  eq(Store.daysInMonth('2024-02'), 29);
  eq(Store.daysInMonth('2026-02'), 28);
  eq(Store.daysInMonth('2026-08'), 31);
});

check('weekOfMonth uses fixed 7-day blocks', () => {
  eq(Store.weekOfMonth('2026-08-01'), 0);
  eq(Store.weekOfMonth('2026-08-07'), 0);
  eq(Store.weekOfMonth('2026-08-08'), 1);
  eq(Store.weekOfMonth('2026-08-28'), 3);
  eq(Store.weekOfMonth('2026-08-31'), 4);
});

check('fresh store seeds the current month with default categories', () => {
  Store.load();
  const mk = Store.currentMonthKey();
  Store.seedMonthFromDefaults(mk);   // what app.js boot() does
  const m = Store.getMonth(mk);
  ok(m.categories.length >= 6, 'expected seeded categories, got ' + m.categories.length);
  ok(m.categories.every(c => c.id && c.name && c.icon && c.color), 'categories malformed');
});

check('setIncome and totals: income = base + logged income transactions', () => {
  const mk = Store.currentMonthKey();
  Store.setIncome(mk, 1000);
  const cat = Store.getMonth(mk).categories[0];
  Store.addTransaction({ date: mk + '-05', type: 'income', amount: 200, categoryId: null, note: 'gig' });
  const t = Store.totals(mk);
  near(t.income, 1200, 0.001, 'income');
  near(t.baseIncome, 1000, 0.001, 'base');
  near(t.extraIncome, 200, 0.001, 'extra');
  ok(cat.id);
});

check('totals: spent, remaining, spentPct', () => {
  const mk = Store.currentMonthKey();
  const cat = Store.getMonth(mk).categories[0];
  Store.addTransaction({ date: mk + '-06', type: 'expense', amount: 150.5, categoryId: cat.id, note: 'electricity' });
  Store.addTransaction({ date: mk + '-07', type: 'expense', amount: 49.5, categoryId: cat.id, note: 'token' });
  const t = Store.totals(mk);
  near(t.spent, 200, 0.001, 'spent');
  near(t.remaining, 1000, 0.001, 'remaining');
  eq(t.spentPct, 17, 'spentPct'); // 200/1200 = 16.7 -> 17
});

check('totals: weekly buckets land in the right block', () => {
  const mk = '2026-07';   // its own month — the shared current month already has spend
  Store.addTransaction({ date: mk + '-02', type: 'expense', amount: 10, categoryId: null });
  Store.addTransaction({ date: mk + '-15', type: 'expense', amount: 40, categoryId: null });
  Store.addTransaction({ date: mk + '-31', type: 'expense', amount: 5, categoryId: null });
  const t = Store.totals(mk);
  near(t.weekly[0], 10, 0.001, 'week1');
  near(t.weekly[2], 40, 0.001, 'week3');
  near(t.weekly[4], 5, 0.001, 'week5');
});

check('totals: safePerDay divides remaining across days left', () => {
  const t = Store.totals(Store.currentMonthKey());
  ok(t.safePerDay >= 0, 'safePerDay should not be negative here');
  ok(t.daysLeft >= 1 && t.daysLeft <= 31, 'daysLeft sane: ' + t.daysLeft);
});

check('category CRUD and orphan spend shows as Other', () => {
  const mk = Store.currentMonthKey();
  const c = Store.addCategory(mk, { name: 'Coffee', icon: '☕', budget: 30 });
  Store.addTransaction({ date: mk + '-09', type: 'expense', amount: 5, categoryId: c.id });
  Store.removeCategory(mk, c.id);
  const t = Store.totals(mk);
  const other = t.byCategory.find(x => x.id === 'other');
  ok(other, 'orphan spend should surface as Other');
  near(other.spent, 5, 0.001, 'orphan amount');
});

check('updateCategory clamps budget at zero and renames', () => {
  const mk = Store.currentMonthKey();
  const c = Store.addCategory(mk, { name: 'Fun', budget: 50 });
  Store.updateCategory(mk, c.id, { budget: -10, name: 'Fun money' });
  const m = Store.getMonth(mk);
  const updated = m.categories.find(x => x.id === c.id);
  eq(updated.budget, 0, 'negative budget clamped');
  eq(updated.name, 'Fun money');
});

check('debts: payDebt clamps to amount, status transitions', () => {
  const d = Store.addDebt({ direction: 'owe', person: 'Tenda', amount: 100, dueDate: '2026-09-01' });
  eq(Store.debtStatus(d, '2026-08-24'), 'pending');
  Store.payDebt(d.id, 40);
  eq(Store.debtStatus(d, '2026-08-24'), 'partial');
  Store.payDebt(d.id, 500); // overpay attempt
  const after = Store.peek().debts.find(x => x.id === d.id);
  near(after.paid, 100, 0.001, 'paid clamped to amount');
  eq(Store.debtStatus(after, '2026-08-24'), 'paid');
});

check('debts: overdue detection and pending list', () => {
  const d = Store.addDebt({ direction: 'owe', person: 'Bank', amount: 50, dueDate: '2026-08-01' });
  eq(Store.debtStatus(d, '2026-08-24'), 'overdue');
  const open = Store.pendingDebts('owe', '2026-08-24');
  ok(open.some(x => x.id === d.id), 'overdue debt is pending');
  const lent = Store.pendingDebts('lent', '2026-08-24');
  ok(!lent.some(x => x.id === d.id), 'owe debt not in lent list');
});

check('goals: contribute and completion', () => {
  const g = Store.addGoal({ name: 'Emergency', target: 500, saved: 400 });
  Store.contributeGoal(g.id, 150);
  const after = Store.peek().goals.find(x => x.id === g.id);
  near(after.saved, 550, 0.001, 'saved');
  ok(after.saved >= after.target, 'goal reached');
});

check('transactions: update and remove', () => {
  const t = Store.addTransaction({ date: Store.currentMonthKey() + '-10', type: 'expense', amount: 12, note: 'snack' });
  Store.updateTransaction(t.id, { amount: 20, note: 'big snack' });
  const after = Store.peek().transactions.find(x => x.id === t.id);
  near(after.amount, 20, 0.001);
  eq(after.note, 'big snack');
  Store.removeTransaction(t.id);
  ok(!Store.peek().transactions.some(x => x.id === t.id), 'removed');
});

check('backup/restore round trip preserves data', () => {
  const before = Store.backup();
  const count = Store.peek().transactions.length;
  Store.restore(before);
  eq(Store.peek().transactions.length, count, 'transaction count preserved');
});

check('restore rejects junk', () => {
  let threw = false;
  try { Store.restore('{"hello":1}'); } catch (e) { threw = true; }
  ok(threw, 'junk backup should throw');
});

check('monthRun returns oldest-first run ending at mk', () => {
  const run = Store.monthRun('2026-08', 6);
  eq(run.length, 6);
  eq(run[0], '2026-03');
  eq(run[5], '2026-08');
});

check('totals for a past month uses full month for day/daysLeft', () => {
  const t = Store.totals('2025-01');
  eq(t.day, 31, 'day = daysInMonth for past months');
  eq(t.daysLeft, 0, 'no days left in a past month');
});

finish();
