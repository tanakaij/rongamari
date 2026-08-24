/* RongaMari data layer.
 *
 * One personal budget, one device, no account. localStorage is deliberate:
 * the whole state is a few kilobytes, writes are synchronous and atomic, and
 * it survives inside the Capacitor WebView exactly like it does in a browser.
 *
 * Everything computational (totals, weekly buckets, month math) lives here as
 * pure functions so tests can exercise the real arithmetic the app ships with.
 */
(function (global) {
  'use strict';

  var KEY = 'rongamari.v1';

  var CATEGORY_ICONS = ['🏠','🛒','🚌','💡','📺','⛪','🧰','🎉','🍔','🚕','💊','🎓','👕','📱','💰','🎁','🐾','☕','🛠️','⚽','✈️','🧾'];
  var CATEGORY_COLORS = ['#3F9C35','#70B010','#157A3C','#0A4D22','#E8A13A','#C94F4F','#2C5D8F','#7A5BA8','#C9714F','#4F8FC9'];

  var DEFAULT_CATEGORIES = [
    { name: 'Home',          icon: '🏠', budget: 0 },
    { name: 'Groceries',     icon: '🛒', budget: 0 },
    { name: 'Transport',     icon: '🚌', budget: 0 },
    { name: 'Subscriptions', icon: '📺', budget: 0 },
    { name: 'Tithe',         icon: '⛪', budget: 0 },
    { name: 'Upkeep',        icon: '🧰', budget: 0 },
    { name: 'Fun',           icon: '🎉', budget: 0 },
    { name: 'Savings',       icon: '💰', budget: 0 }
  ];

  /* ── month math ──────────────────────────────────────────────── */
  function monthKey(dateStr) {
    return String(dateStr || '').slice(0, 7);
  }
  function currentMonthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function shiftMonth(mk, delta) {
    var parts = mk.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1 + delta;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  }
  function daysInMonth(mk) {
    var parts = mk.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10), 0).getDate();
  }
  function monthLabel(mk) {
    var names = ['January','February','March','April','May','June','July',
                 'August','September','October','November','December'];
    var parts = mk.split('-');
    return names[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
  }
  function monthShort(mk) {
    var names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var parts = mk.split('-');
    return names[parseInt(parts[1], 10) - 1] + ' ' + String(parseInt(parts[0], 10)).slice(2);
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayOfMonth(dateStr) {
    return parseInt(String(dateStr).slice(8, 10), 10) || 1;
  }
  /* Weeks are fixed seven-day blocks: 1–7, 8–14, 15–21, 22–28, 29–end. */
  function weekOfMonth(dateStr) {
    return Math.min(4, Math.floor((dayOfMonth(dateStr) - 1) / 7));
  }

  /* ── state ───────────────────────────────────────────────────── */
  var state = null;
  var listeners = [];

  function newId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function defaults() {
    return {
      v: 1,
      settings: {
        name: '',
        currency: '$',
        notif: {
          enabled: false,
          daily: true,
          time: '19:30',
          weekly: true,
          threshold: 80,
          debtDays: 3
        }
      },
      months: {},
      transactions: [],
      debts: [],
      goals: [],
      meta: { alerts: {}, notifiedDebts: {} }
    };
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : defaults();
    } catch (e) {
      state = defaults();
    }
    if (!state || typeof state !== 'object' || !state.settings) state = defaults();
    if (!state.meta) state.meta = { alerts: {}, notifiedDebts: {} };
    if (!state.meta.alerts) state.meta.alerts = {};
    if (!state.meta.notifiedDebts) state.meta.notifiedDebts = {};
    ensureMonth(currentMonthKey());
    return state;
  }

  function save() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* storage full or blocked — app still works in memory */ }
    listeners.forEach(function (fn) { fn(); });
  }

  function onChange(fn) { listeners.push(fn); }

  /* ── months & categories ─────────────────────────────────────── */
  function ensureMonth(mk) {
    if (!state.months[mk]) {
      state.months[mk] = { income: 0, note: '', categories: [] };
    }
    var m = state.months[mk];
    if (!m.categories) m.categories = [];
    if (typeof m.income !== 'number') m.income = 0;
    return m;
  }

  function seedMonthFromDefaults(mk) {
    var m = ensureMonth(mk);
    if (m.categories.length) return m;
    m.categories = DEFAULT_CATEGORIES.map(function (c, i) {
      return {
        id: newId(),
        name: c.name,
        icon: c.icon,
        budget: c.budget,
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]
      };
    });
    save();
    return m;
  }

  function getMonth(mk) { return ensureMonth(mk); }

  function setIncome(mk, income) {
    var m = ensureMonth(mk);
    m.income = Math.max(0, Number(income) || 0);
    save();
  }

  function addCategory(mk, cat) {
    var m = ensureMonth(mk);
    var c = {
      id: newId(),
      name: String(cat.name || 'Category').trim().slice(0, 24),
      icon: cat.icon || '🧾',
      budget: Math.max(0, Number(cat.budget) || 0),
      color: cat.color || CATEGORY_COLORS[m.categories.length % CATEGORY_COLORS.length]
    };
    m.categories.push(c);
    save();
    return c;
  }

  function updateCategory(mk, id, patch) {
    var m = ensureMonth(mk);
    var c = m.categories.find(function (x) { return x.id === id; });
    if (!c) return null;
    if (patch.name != null) c.name = String(patch.name).trim().slice(0, 24) || c.name;
    if (patch.icon != null) c.icon = patch.icon;
    if (patch.budget != null) c.budget = Math.max(0, Number(patch.budget) || 0);
    if (patch.color != null) c.color = patch.color;
    save();
    return c;
  }

  function removeCategory(mk, id) {
    var m = ensureMonth(mk);
    m.categories = m.categories.filter(function (x) { return x.id !== id; });
    /* Transactions keep their categoryId; they render as "Other" if the
       category is gone. Deleting history would be worse. */
    save();
  }

  /* ── transactions ────────────────────────────────────────────── */
  function addTransaction(tx) {
    var t = {
      id: newId(),
      date: tx.date || todayStr(),
      type: tx.type === 'income' ? 'income' : 'expense',
      amount: round2(Number(tx.amount) || 0),
      categoryId: tx.categoryId || null,
      note: String(tx.note || '').trim().slice(0, 80),
      createdAt: Date.now()
    };
    state.transactions.push(t);
    save();
    return t;
  }

  function updateTransaction(id, patch) {
    var t = state.transactions.find(function (x) { return x.id === id; });
    if (!t) return null;
    if (patch.date) t.date = patch.date;
    if (patch.type) t.type = patch.type === 'income' ? 'income' : 'expense';
    if (patch.amount != null) t.amount = round2(Math.max(0, Number(patch.amount) || 0));
    if (patch.categoryId !== undefined) t.categoryId = patch.categoryId;
    if (patch.note !== undefined) t.note = String(patch.note || '').trim().slice(0, 80);
    save();
    return t;
  }

  function removeTransaction(id) {
    state.transactions = state.transactions.filter(function (x) { return x.id !== id; });
    save();
  }

  function transactionsIn(mk, categoryId) {
    return state.transactions
      .filter(function (t) { return monthKey(t.date) === mk; })
      .filter(function (t) { return !categoryId || t.categoryId === categoryId; })
      .sort(function (a, b) {
        return a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0)
                                 : (a.date < b.date ? 1 : -1);
      });
  }

  /* ── debts ───────────────────────────────────────────────────── */
  function addDebt(d) {
    var rec = {
      id: newId(),
      direction: d.direction === 'lent' ? 'lent' : 'owe',
      person: String(d.person || '').trim().slice(0, 40) || 'Someone',
      amount: round2(Math.max(0, Number(d.amount) || 0)),
      paid: round2(Math.min(Math.max(0, Number(d.amount) || 0), Math.max(0, Number(d.paid) || 0))),
      startDate: d.startDate || todayStr(),
      dueDate: d.dueDate || '',
      note: String(d.note || '').trim().slice(0, 80)
    };
    state.debts.push(rec);
    save();
    return rec;
  }

  function updateDebt(id, patch) {
    var d = state.debts.find(function (x) { return x.id === id; });
    if (!d) return null;
    ['person', 'note', 'dueDate', 'startDate'].forEach(function (k) {
      if (patch[k] !== undefined) d[k] = String(patch[k] || '').trim().slice(0, 80);
    });
    if (patch.direction) d.direction = patch.direction === 'lent' ? 'lent' : 'owe';
    if (patch.amount != null) d.amount = round2(Math.max(0, Number(patch.amount) || 0));
    if (patch.paid != null) d.paid = clamp(d.paid, 0, d.amount, Number(patch.paid));
    save();
    return d;
  }

  function payDebt(id, amount) {
    var d = state.debts.find(function (x) { return x.id === id; });
    if (!d) return null;
    d.paid = round2(clamp(d.paid, 0, d.amount, d.paid + (Number(amount) || 0)));
    save();
    return d;
  }

  function removeDebt(id) {
    state.debts = state.debts.filter(function (x) { return x.id !== id; });
    save();
  }

  function debtStatus(d, today) {
    today = today || todayStr();
    var remaining = round2(d.amount - d.paid);
    if (remaining <= 0.004) return 'paid';
    if (d.dueDate && d.dueDate < today) return 'overdue';
    if (d.paid > 0) return 'partial';
    return 'pending';
  }

  function pendingDebts(direction, today) {
    today = today || todayStr();
    return state.debts.filter(function (d) {
      return (d.direction || 'owe') === direction && debtStatus(d, today) !== 'paid';
    });
  }

  /* ── goals ───────────────────────────────────────────────────── */
  function addGoal(g) {
    var rec = {
      id: newId(),
      name: String(g.name || '').trim().slice(0, 40) || 'Goal',
      icon: g.icon || '🎯',
      target: round2(Math.max(0, Number(g.target) || 0)),
      saved: round2(Math.max(0, Number(g.saved) || 0)),
      deadline: g.deadline || '',
      note: String(g.note || '').trim().slice(0, 80)
    };
    state.goals.push(rec);
    save();
    return rec;
  }

  function updateGoal(id, patch) {
    var g = state.goals.find(function (x) { return x.id === id; });
    if (!g) return null;
    if (patch.name != null) g.name = String(patch.name).trim().slice(0, 40) || g.name;
    if (patch.icon != null) g.icon = patch.icon;
    if (patch.target != null) g.target = round2(Math.max(0, Number(patch.target) || 0));
    if (patch.deadline !== undefined) g.deadline = patch.deadline || '';
    if (patch.note !== undefined) g.note = String(patch.note || '').trim().slice(0, 80);
    if (patch.saved != null) g.saved = clamp(g.saved, 0, Infinity, Number(patch.saved));
    g.saved = Math.min(g.saved, Math.max(g.target, g.saved));
    save();
    return g;
  }

  function contributeGoal(id, amount) {
    var g = state.goals.find(function (x) { return x.id === id; });
    if (!g) return null;
    g.saved = round2(Math.max(0, g.saved + (Number(amount) || 0)));
    save();
    return g;
  }

  function removeGoal(id) {
    state.goals = state.goals.filter(function (x) { return x.id !== id; });
    save();
  }

  /* ── totals ──────────────────────────────────────────────────── */
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function clamp(current, min, max, v) {
    v = Number(v);
    if (isNaN(v)) v = current;
    return Math.min(max, Math.max(min, v));
  }

  function totals(mk, today) {
    today = today || todayStr();
    var m = ensureMonth(mk);
    var txs = transactionsIn(mk);

    var spent = 0, extraIncome = 0;
    var byCat = {}, weekly = [0, 0, 0, 0, 0];
    txs.forEach(function (t) {
      if (t.type === 'income') { extraIncome += t.amount; return; }
      spent += t.amount;
      var cid = t.categoryId || 'other';
      byCat[cid] = round2((byCat[cid] || 0) + t.amount);
      weekly[weekOfMonth(t.date)] += t.amount;
    });

    var budgetTotal = round2(m.categories.reduce(function (s, c) { return s + c.budget; }, 0));
    var income = round2(m.income + extraIncome);
    spent = round2(spent);
    var day = mk === currentMonthKey() ? dayOfMonth(today) : daysInMonth(mk);
    var dim = daysInMonth(mk);

    var cats = m.categories.map(function (c) {
      var s = round2(byCat[c.id] || 0);
      return {
        id: c.id, name: c.name, icon: c.icon, color: c.color,
        budget: round2(c.budget), spent: s,
        remaining: round2(c.budget - s),
        pct: c.budget > 0 ? Math.round(s / c.budget * 100) : (s > 0 ? 100 : 0)
      };
    });
    /* spending in deleted categories */
    var knownIds = {};
    m.categories.forEach(function (c) { knownIds[c.id] = true; });
    var orphan = 0;
    Object.keys(byCat).forEach(function (cid) {
      if (!knownIds[cid]) orphan += byCat[cid];
    });
    if (orphan > 0) {
      cats.push({
        id: 'other', name: 'Other', icon: '🧾', color: '#93A299',
        budget: 0, spent: round2(orphan), remaining: round2(-orphan), pct: 100
      });
    }

    weekly = weekly.map(round2);
    var remaining = round2(income - spent);
    var daysLeft = Math.max(0, dim - day + (mk === currentMonthKey() ? 1 : 0));
    return {
      month: mk,
      income: income,
      baseIncome: round2(m.income),
      extraIncome: round2(extraIncome),
      budgetTotal: budgetTotal,
      allocated: budgetTotal,
      unallocated: round2(income - budgetTotal),
      spent: spent,
      remaining: remaining,
      byCategory: cats,
      weekly: weekly,
      day: day,
      daysInMonth: dim,
      daysLeft: daysLeft,
      spentPct: income > 0 ? Math.round(spent / income * 100) : (spent > 0 ? 100 : 0),
      expectedPct: Math.round(day / dim * 100),
      avgPerDay: round2(spent / Math.max(1, day)),
      safePerDay: round2(remaining / Math.max(1, daysLeft || 1)),
      count: txs.filter(function (t) { return t.type === 'expense'; }).length,
      savingsRate: income > 0 ? Math.round(remaining / income * 100) : 0
    };
  }

  /* Last n months, oldest first, ending at mk. */
  function monthRun(mk, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(shiftMonth(mk, -i));
    return out;
  }

  function anyData() {
    return state.transactions.length > 0 || state.debts.length > 0 ||
           state.goals.length > 0;
  }

  /* ── backup / restore ────────────────────────────────────────── */
  function backup() {
    return JSON.stringify(state, null, 2);
  }

  function restore(json) {
    var parsed = JSON.parse(json);
    if (!parsed || !parsed.settings || !parsed.months) {
      throw new Error('Not a RongaMari backup file');
    }
    state = parsed;
    if (!state.meta) state.meta = { alerts: {}, notifiedDebts: {} };
    save();
  }

  function reset() {
    state = defaults();
    ensureMonth(currentMonthKey());
    save();
  }

  /* expose state for tests without letting the UI mutate it directly */
  function peek() { return state; }

  global.RMStore = {
    KEY: KEY,
    CATEGORY_ICONS: CATEGORY_ICONS,
    CATEGORY_COLORS: CATEGORY_COLORS,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    load: load, save: save, peek: peek, onChange: onChange,
    monthKey: monthKey, currentMonthKey: currentMonthKey, shiftMonth: shiftMonth,
    daysInMonth: daysInMonth, monthLabel: monthLabel, monthShort: monthShort,
    todayStr: todayStr, dayOfMonth: dayOfMonth, weekOfMonth: weekOfMonth,
    ensureMonth: ensureMonth, seedMonthFromDefaults: seedMonthFromDefaults,
    getMonth: getMonth, setIncome: setIncome,
    addCategory: addCategory, updateCategory: updateCategory, removeCategory: removeCategory,
    addTransaction: addTransaction, updateTransaction: updateTransaction,
    removeTransaction: removeTransaction, transactionsIn: transactionsIn,
    addDebt: addDebt, updateDebt: updateDebt, payDebt: payDebt,
    removeDebt: removeDebt, debtStatus: debtStatus, pendingDebts: pendingDebts,
    addGoal: addGoal, updateGoal: updateGoal, contributeGoal: contributeGoal, removeGoal: removeGoal,
    totals: totals, monthRun: monthRun, anyData: anyData,
    backup: backup, restore: restore, reset: reset,
    newId: newId, round2: round2
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports !== undefined) module.exports = globalThis.RMStore;
