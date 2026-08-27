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
  var CATEGORY_COLORS = ['#1B7A42','#C9A227','#0B3D22','#B5563C','#3A6EA5','#6B5B95','#2F8F8F','#C77B3B','#4A5D8F','#7A8C3F'];

  /* cadence: 'monthly' = one lump payment for the whole month, confirmed once.
     'weekly' = paid in up to five weekly instalments, each confirmed on its own
     (this is how upkeep — bread, eggs, weekly top-ups — actually works). */
  var DEFAULT_CATEGORIES = [
    { name: 'Home',          icon: '🏠', budget: 0, cadence: 'monthly' },
    { name: 'Groceries',     icon: '🛒', budget: 0, cadence: 'monthly' },
    { name: 'Transport',     icon: '🚌', budget: 0, cadence: 'monthly' },
    { name: 'Subscriptions', icon: '📺', budget: 0, cadence: 'monthly' },
    { name: 'Tithe',         icon: '⛪', budget: 0, cadence: 'monthly' },
    { name: 'Upkeep',        icon: '🧰', budget: 0, cadence: 'weekly' },
    { name: 'Fun',           icon: '🎉', budget: 0, cadence: 'monthly' },
    { name: 'Projects',      icon: '🏗️', budget: 0, cadence: 'monthly' }
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
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
        cadence: c.cadence || 'monthly',
        note: ''
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
      color: cat.color || CATEGORY_COLORS[m.categories.length % CATEGORY_COLORS.length],
      cadence: cat.cadence === 'weekly' ? 'weekly' : 'monthly',
      note: String(cat.note || '').trim().slice(0, 60)
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
    if (patch.cadence != null) c.cadence = patch.cadence === 'weekly' ? 'weekly' : 'monthly';
    if (patch.note !== undefined) c.note = String(patch.note || '').trim().slice(0, 60);
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

  /* ── category payments ──────────────────────────────────────────
   * A category is "paid" for the month once you've confirmed you've handed
   * the money over — that confirmation IS the transaction: confirming
   * writes a single auto-generated expense (tagged `auto: true`) so every
   * other calculation (totals, insights, exports, charts) keeps working
   * unchanged. Un-confirming removes it. Weekly-cadence categories get up
   * to five of these, one per week-of-month bucket. */
  function findAutoTx(mk, categoryId, weekIndex) {
    var wk = weekIndex == null ? null : weekIndex;
    return state.transactions.find(function (t) {
      return t.auto && t.autoCategory === categoryId && monthKey(t.date) === mk &&
        (t.autoWeek == null ? null : t.autoWeek) === wk;
    }) || null;
  }

  function markCategoryPaid(mk, categoryId, paid, opts) {
    opts = opts || {};
    var m = ensureMonth(mk);
    var c = m.categories.find(function (x) { return x.id === categoryId; });
    if (!c) return null;
    var weekIndex = opts.week != null ? opts.week : null;
    var existing = findAutoTx(mk, categoryId, weekIndex);
    if (paid) {
      var defaultAmt = weekIndex != null ? round2(c.budget / 5) : c.budget;
      var amount = opts.amount != null ? Math.max(0, Number(opts.amount) || 0) :
        (existing ? existing.amount : defaultAmt);
      var date = opts.date || (existing ? existing.date : todayStr());
      if (existing) {
        existing.amount = round2(amount);
        existing.date = date;
      } else {
        state.transactions.push({
          id: newId(), date: date, type: 'expense', amount: round2(amount),
          categoryId: categoryId,
          note: weekIndex != null ? c.name + ' · week ' + (weekIndex + 1) : c.name + ' · paid',
          createdAt: Date.now(), auto: true, autoCategory: categoryId, autoWeek: weekIndex
        });
      }
    } else if (existing) {
      state.transactions = state.transactions.filter(function (x) { return x !== existing; });
    }
    save();
    return true;
  }

  function categoryPaymentInfo(mk, categoryId) {
    var m = ensureMonth(mk);
    var c = m.categories.find(function (x) { return x.id === categoryId; });
    if (!c) return null;
    var cadence = c.cadence === 'weekly' ? 'weekly' : 'monthly';
    if (cadence === 'monthly') {
      var tx = findAutoTx(mk, categoryId, null);
      var paidAmt = tx ? tx.amount : 0;
      return {
        cadence: cadence, paid: !!tx, amount: tx ? tx.amount : c.budget, date: tx ? tx.date : null,
        remaining: round2(c.budget - paidAmt), over: paidAmt > c.budget + 0.004
      };
    }
    var weeks = [];
    for (var i = 0; i < 5; i++) {
      var wtx = findAutoTx(mk, categoryId, i);
      weeks.push({ paid: !!wtx, amount: wtx ? wtx.amount : round2(c.budget / 5), date: wtx ? wtx.date : null });
    }
    var paidTotal = round2(weeks.reduce(function (s, w) { return s + (w.paid ? w.amount : 0); }, 0));
    var allPaid = weeks.every(function (w) { return w.paid; });
    return {
      cadence: cadence, weeks: weeks, paidTotal: paidTotal, allPaid: allPaid,
      remaining: round2(c.budget - paidTotal), over: paidTotal > c.budget + 0.004
    };
  }

  function categoryPayments(mk) {
    var m = ensureMonth(mk);
    var out = {};
    m.categories.forEach(function (c) { out[c.id] = categoryPaymentInfo(mk, c.id); });
    return out;
  }

  /* How much a proposed payment would push a category over its budget, before
   * it's actually saved — used to warn (not block) at confirm time. Returns a
   * positive number if it goes over, zero or negative otherwise. */
  function categoryOverBy(mk, categoryId, weekIndex, amount) {
    var m = ensureMonth(mk);
    var c = m.categories.find(function (x) { return x.id === categoryId; });
    if (!c) return 0;
    var already = 0;
    if (c.cadence === 'weekly') {
      var info = categoryPaymentInfo(mk, categoryId);
      already = info.weeks.reduce(function (s, w, i) {
        return s + ((w.paid && i !== weekIndex) ? w.amount : 0);
      }, 0);
    }
    var prospective = round2(already + (Number(amount) || 0));
    return round2(prospective - c.budget);
  }

  /* Carry-over: a monthly-cadence category left unpaid at month end (e.g.
   * still saving toward a purchase) can roll its whole budget into next
   * month rather than silently vanishing into "spent". Matched by name
   * since each month owns its own copy of the category list. */
  function carryOverAvailable(mk, categoryId) {
    var m = ensureMonth(mk);
    var c = m.categories.find(function (x) { return x.id === categoryId; });
    if (!c || c.cadence === 'weekly') return 0;
    var prevMk = shiftMonth(mk, -1);
    var pm = state.months[prevMk];
    if (!pm) return 0;
    var prevCat = pm.categories.find(function (x) { return x.name === c.name; });
    if (!prevCat || prevCat.carriedOut || prevCat.budget <= 0) return 0;
    var info = categoryPaymentInfo(prevMk, prevCat.id);
    if (info.paid) return 0;
    return round2(prevCat.budget);
  }

  function applyCarryOver(mk, categoryId) {
    var amt = carryOverAvailable(mk, categoryId);
    if (amt <= 0) return 0;
    var m = ensureMonth(mk);
    var c = m.categories.find(function (x) { return x.id === categoryId; });
    var prevMk = shiftMonth(mk, -1);
    var pm = state.months[prevMk];
    var prevCat = pm.categories.find(function (x) { return x.name === c.name; });
    c.budget = round2(c.budget + amt);
    c.carriedIn = round2((c.carriedIn || 0) + amt);
    prevCat.carriedOut = true;
    save();
    return amt;
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

    var spent = 0, extraIncome = 0, plannedPaid = 0, extraSpent = 0;
    var byCat = {}, weekly = [0, 0, 0, 0, 0];
    txs.forEach(function (t) {
      if (t.type === 'income') { extraIncome += t.amount; return; }
      spent += t.amount;
      if (t.auto) plannedPaid += t.amount; else extraSpent += t.amount;
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
        id: 'other', name: 'Other', icon: '🧾', color: '#97A28E',
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
      plannedPaid: round2(plannedPaid),
      extraSpent: round2(extraSpent),
      stillToPay: round2(Math.max(0, budgetTotal - plannedPaid)),
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
      /* Extra-spend pacing: how the discretionary/unplanned money is being
         used, scoped to the part of income that isn't already assigned to a
         category budget. Planned categories are typically paid in full near
         the start of the month, so pacing that money like a daily allowance
         would be misleading — only the unallocated portion behaves that way. */
      extraPct: (income - budgetTotal) > 0 ? Math.round(extraSpent / (income - budgetTotal) * 100) : 0,
      avgExtraPerDay: round2(extraSpent / Math.max(1, day)),
      safeExtraPerDay: round2(Math.max(0, (income - budgetTotal) - extraSpent) / Math.max(1, daysLeft || 1)),
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
    markCategoryPaid: markCategoryPaid, categoryPaymentInfo: categoryPaymentInfo,
    categoryPayments: categoryPayments, carryOverAvailable: carryOverAvailable,
    applyCarryOver: applyCarryOver, categoryOverBy: categoryOverBy,
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
