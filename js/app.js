/* RongaMari application controller.
 *
 * Owns the seven views (home, plan, spend, save, grow, debts, more), the
 * month selector shared across them, every create/edit/delete flow, the
 * notification layer (Capacitor LocalNotifications in the APK, the web
 * Notification API in a browser), and the export model that feeds RMExport.
 *
 * Rendering is deliberately boring: re-render the visible view from state
 * after every change. The data set is a single person's month — a few hundred
 * rows at most — so diffing would be complexity with no payoff.
 */
(function (global) {
  'use strict';

  var Store = global.RMStore;
  var UI = global.RMUI;
  var Charts = global.RMCharts;
  var Insights = global.RMInsights;

  var view = 'home';
  var month = null;          // selected month key
  var spendFilter = null;    // categoryId filter
  var debtDir = 'owe';
  var backStack = [];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return UI.esc(s); }

  function cur() {
    var c = Store.peek().settings.currency || '$';
    return function (n, noSign) {
      if (noSign) return Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      var neg = n < 0;
      return (neg ? '-' : '') + c + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     NAVIGATION
     ═══════════════════════════════════════════════════════════════ */
  var NAV_VIEWS = ['home', 'plan', 'spend', 'save', 'grow'];

  function go(name, isBack) {
    if (!isBack && view !== name && NAV_VIEWS.indexOf(view) !== -1) {
      backStack.push(view);
    }
    view = name;
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('is-active', v.id === 'view-' + name);
    });
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-view') === name);
    });
    var fab = $('fabAdd');
    fab.style.display = (name === 'home' || name === 'spend') ? '' : 'none';
    render();
    window.scrollTo({ top: 0 });
  }

  function goBack() {
    var prev = backStack.pop() || 'home';
    go(prev, true);
  }

  /* ═══════════════════════════════════════════════════════════════
     RENDER DISPATCH
     ═══════════════════════════════════════════════════════════════ */
  function render() {
    if (!month) month = Store.currentMonthKey();
    switch (view) {
      case 'home': renderHome(); break;
      case 'plan': renderPlan(); break;
      case 'spend': renderSpend(); break;
      case 'save': renderSave(); break;
      case 'grow': renderGrow(); break;
      case 'debts': renderDebts(); break;
      case 'more': renderMore(); break;
    }
    renderDebtBadge();
  }

  function renderDebtBadge() {
    var open = Store.pendingDebts('owe');
    var overdue = open.filter(function (d) { return Store.debtStatus(d) === 'overdue'; });
    var badge = $('debtBadge');
    badge.hidden = open.length === 0;
    badge.textContent = overdue.length || open.length;
  }

  /* ═══════════════════════════════════════════════════════════════
     HOME
     ═══════════════════════════════════════════════════════════════ */
  function renderHome() {
    var money = cur();
    var t = Store.totals(month);
    var S = Store.peek();

    $('homeMonth').textContent = Store.monthLabel(month);
    $('homePrev').disabled = false;

    /* hero */
    var ringPct = t.income > 0 ? Math.min(100, Math.round(t.spent / t.income * 100)) : (t.spent > 0 ? 100 : 0);
    $('heroRing').innerHTML = Charts.ring(ringPct, { size: 104, stroke: 10, sub: 'of income' });
    var heroAmt = $('heroAmount');
    heroAmt.textContent = money(t.remaining);
    heroAmt.classList.toggle('is-over', t.remaining < 0);
    $('heroSub').textContent = t.income > 0
      ? 'spent ' + money(t.spent) + ' of ' + money(t.income)
      : (t.spent > 0 ? 'spent ' + money(t.spent) : 'No income set yet');
    var dailyChip = $('heroDaily');
    if (t.remaining >= 0 && t.daysLeft > 0 && t.income > 0) {
      dailyChip.className = 'chip chip--safe';
      dailyChip.textContent = money(t.safePerDay) + '/day safe · ' + t.daysLeft + 'd left';
      dailyChip.hidden = false;
    } else if (t.remaining < 0) {
      dailyChip.className = 'chip chip--bad';
      dailyChip.textContent = 'Over budget';
      dailyChip.hidden = false;
    } else {
      dailyChip.hidden = true;
    }

    /* alert banner = headline insight */
    var ins = Insights.generate({
      totals: t, month: month, label: Store.monthLabel(month),
      prevTotals: Store.totals(Store.shiftMonth(month, -1)),
      prevLabel: Store.monthShort(Store.shiftMonth(month, -1)),
      debts: S.debts, goals: S.goals,
      currency: S.settings.currency,
      debtDays: S.settings.notif.debtDays,
      today: Store.todayStr()
    });
    var head = Insights.headline(ins);
    var alertEl = $('homeAlert');
    if (head && (head.tone === 'bad' || head.tone === 'warn')) {
      alertEl.className = 'alert alert--' + (head.tone === 'bad' ? 'bad' : 'warn');
      alertEl.innerHTML = '<span>' + head.icon + '</span><span><strong>' + esc(head.title) +
        '.</strong> ' + esc(head.body) + '</span>';
      alertEl.hidden = false;
    } else {
      alertEl.hidden = true;
    }

    /* stat tiles */
    var openDebts = Store.pendingDebts('owe');
    var oweTotal = openDebts.reduce(function (s, d) { return s + d.amount - d.paid; }, 0);
    var goalsSaved = S.goals.reduce(function (s, g) { return s + g.saved; }, 0);
    $('homeStats').innerHTML =
      stat('Spent', money(t.spent), t.count + ' transactions', 'spend') +
      stat('Budget left', money(Math.max(0, t.budgetTotal - t.spent)), 'of ' + money(t.budgetTotal) + ' planned', 'plan') +
      stat('I owe', money(oweTotal), openDebts.length + ' pending', 'debts') +
      stat('In goals', money(goalsSaved), S.goals.length + ' goals', 'save');

    /* weekly chart */
    $('weekTotal').textContent = money(t.spent);
    $('weekChart').innerHTML = Charts.weeklyBars(t.weekly, { money: money });

    /* category bars */
    var topCats = t.byCategory.slice().sort(function (a, b) { return b.spent - a.spent; }).slice(0, 4);
    $('homeCats').innerHTML = topCats.length ? topCats.map(function (c) {
      var pct = Math.min(100, c.pct);
      return '<div class="catbar" data-cat="' + c.id + '" role="button" tabindex="0">' +
        '<div class="catbar__top"><span>' + esc(c.icon + ' ' + c.name) + '</span>' +
        '<span class="amt">' + money(c.spent) + ' <span class="pct">/ ' + money(c.budget) + '</span></span></div>' +
        '<div class="catbar__track"><div class="catbar__fill' + (c.pct > 100 ? ' is-over' : '') +
        '" style="width:' + pct + '%;background:' + esc(c.color) + '"></div></div></div>';
    }).join('') : '<p class="card__note">Set up category budgets in Plan to see this break down.</p>';

    /* debts card */
    var nextDue = openDebts.slice().filter(function (d) { return d.dueDate; })
      .sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; })[0];
    $('homeDebts').innerHTML = openDebts.length
      ? '<p class="card__note" style="margin:0"><strong style="color:var(--ink)">' + money(oweTotal) +
        '</strong> still to pay across ' + openDebts.length + (openDebts.length === 1 ? ' person' : ' people') +
        (nextDue ? ' · next due ' + fmtDate(nextDue.dueDate) : '') + '</p>'
      : '<p class="card__note" style="margin:0">Nothing borrowed right now. 🙌</p>';

    /* goals card */
    var openGoals = S.goals.filter(function (g) { return g.target > 0 && g.saved < g.target; })
      .sort(function (a, b) { return b.target - b.saved - (a.target - a.saved); });
    $('homeGoals').innerHTML = openGoals.length
      ? openGoals.slice(0, 2).map(function (g) {
          var pct = Math.min(100, Math.round(g.saved / g.target * 100));
          return '<div class="catbar" style="margin-top:8px"><div class="catbar__top"><span>' +
            esc(g.icon + ' ' + g.name) + '</span><span class="pct">' + pct + '%</span></div>' +
            '<div class="catbar__track"><div class="catbar__fill" style="width:' + pct + '%;background:var(--green-500)"></div></div></div>';
        }).join('')
      : '<p class="card__note" style="margin:0">No active goals. Set one in Save and feed it monthly.</p>';

    /* insight card */
    $('homeInsight').innerHTML = head
      ? '<div class="insight insight--' + head.tone + '">' +
        '<span class="insight__ico">' + head.icon + '</span>' +
        '<span><span class="insight__t">' + esc(head.title) + '</span>' +
        '<span class="insight__b">' + esc(head.body) + '</span></span></div>'
      : '<p class="card__note">Log spending to unlock insights.</p>';

    /* recent transactions */
    var recent = Store.transactionsIn(month).slice(0, 5);
    $('homeRecent').innerHTML = recent.length ? recent.map(txRow).join('')
      : '<p class="card__note">Nothing logged yet this month — tap + to start.</p>';

    /* first-run hint */
    var hint = $('homeHint');
    if (t.income === 0 && !Store.anyData()) {
      hint.innerHTML = '👋 Welcome! Start in <strong>Plan</strong>: set your monthly income and ' +
        'give it jobs. Then log spending with the <strong>+</strong> button.';
      hint.hidden = false;
    } else if (t.income === 0) {
      hint.innerHTML = 'Set your monthly income in <strong>Plan</strong> to unlock pacing and safe-to-spend.';
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
  }

  function stat(label, value, sub, target) {
    return '<div class="stat" data-go="' + target + '" role="button" tabindex="0">' +
      '<span class="stat__label">' + esc(label) + '</span>' +
      '<span class="stat__value">' + value + '</span>' +
      '<span class="stat__sub">' + esc(sub) + '</span></div>';
  }

  function fmtDate(d) {
    if (!d) return '';
    var parts = String(d).split('-');
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10);
  }

  function catOf(id) {
    var m = Store.getMonth(month);
    return m.categories.find(function (c) { return c.id === id; }) || null;
  }

  function txRow(t) {
    var money = cur();
    var c = catOf(t.categoryId);
    var ico = c ? c.icon : (t.type === 'income' ? '💸' : '🧾');
    var name = t.note || (c ? c.name : (t.type === 'income' ? 'Income' : 'Expense'));
    var sub = c ? c.name : (t.type === 'income' ? 'Income' : 'Other');
    return '<li><button class="txrow" data-tx="' + t.id + '" type="button">' +
      '<span class="txico">' + ico + '</span>' +
      '<span class="txmain"><span class="txmain__t">' + esc(name) + '</span>' +
      '<span class="txmain__s">' + esc(sub) + ' · ' + fmtDate(t.date) + '</span></span>' +
      '<span class="txamt ' + (t.type === 'income' ? 'is-income' : 'is-expense') + '">' +
      (t.type === 'income' ? '+' : '') + money(t.amount) + '</span></button></li>';
  }

  /* ═══════════════════════════════════════════════════════════════
     PLAN
     ═══════════════════════════════════════════════════════════════ */
  function renderPlan() {
    var money = cur();
    var t = Store.totals(month);
    var m = Store.getMonth(month);

    $('planMonth').textContent = Store.monthLabel(month);
    $('planIncome').textContent = t.income > 0 ? money(t.income) : 'Set income';
    $('planIncome').classList.toggle('is-dim', t.income === 0);

    var pct = t.income > 0 ? Math.min(100, Math.round(t.budgetTotal / t.income * 100)) : 0;
    var over = t.income > 0 && t.budgetTotal > t.income;
    $('planAlloc').innerHTML =
      '<div class="allocbar__fill" style="width:' + (t.income > 0 ? pct : 0) + '%;background:' +
      (over ? 'var(--danger)' : 'linear-gradient(90deg,var(--green-700),var(--green-400))') + '"></div>';
    $('planAlloc').insertAdjacentHTML('afterend', '');
    var legend = document.getElementById('planLegend');
    if (legend) legend.remove();
    $('planAlloc').insertAdjacentHTML('afterend',
      '<div class="alloclegend" id="planLegend"><span>' + money(t.budgetTotal) + ' planned</span>' +
      '<span style="color:' + (over ? 'var(--danger)' : 'var(--good)') + '">' +
      (t.income > 0 ? (over ? money(t.budgetTotal - t.income) + ' over income' : money(t.income - t.budgetTotal) + ' unallocated') : '') +
      '</span></div>');

    $('planCats').innerHTML = m.categories.map(function (c) {
      var ct = t.byCategory.find(function (x) { return x.id === c.id; }) || { spent: 0 };
      return '<li><button class="catrow" data-cat-edit="' + c.id + '" type="button">' +
        '<span class="catrow__ico" style="background:' + esc(c.color) + '1A">' + c.icon + '</span>' +
        '<span class="catrow__main"><span class="catrow__name">' + esc(c.name) + '</span>' +
        '<span class="catrow__sub">' + money(ct.spent) + ' spent</span></span>' +
        '<span class="catrow__amt">' + money(c.budget) + '</span>' +
        '<span class="catrow__chev">›</span></button></li>';
    }).join('');
    $('planCatsEmpty').hidden = m.categories.length > 0;
  }

  function incomeSheet() {
    var m = Store.getMonth(month);
    UI.show({
      title: 'Income · ' + Store.monthLabel(month),
      fields: [
        { name: 'income', label: 'Take-home income this month', type: 'number',
          value: m.income || '', placeholder: '0.00', inputmode: 'decimal', min: 0, step: '0.01' },
        { name: 'note', label: 'Note (optional)', type: 'text', value: m.note || '',
          placeholder: 'e.g. salary + gigs' }
      ],
      onSave: function (v) {
        Store.setIncome(month, v.income);
        var mm = Store.getMonth(month);
        mm.note = String(v.note || '').slice(0, 60);
        Store.save();
        UI.toast('Income saved');
        render();
      }
    });
  }

  function categorySheet(existing) {
    var fields = [
      { name: 'name', label: 'Name', type: 'text', value: existing ? existing.name : '',
        placeholder: 'e.g. Groceries' },
      { name: 'icon', label: 'Icon', type: 'icons', value: existing ? existing.icon : '🧾',
        options: Store.CATEGORY_ICONS },
      { name: 'budget', label: 'Monthly budget', type: 'number',
        value: existing ? existing.budget : '', placeholder: '0.00', inputmode: 'decimal',
        min: 0, step: '0.01' },
      { name: 'color', label: 'Colour', type: 'icons', value: existing ? existing.color : Store.CATEGORY_COLORS[0],
        options: Store.CATEGORY_COLORS }
    ];
    UI.show({
      title: existing ? 'Edit category' : 'New category',
      fields: fields,
      saveLabel: existing ? 'Save' : 'Add',
      onSave: function (v) {
        if (!v.name || !v.name.trim()) { UI.toast('Give it a name'); return false; }
        if (existing) {
          Store.updateCategory(month, existing.id, v);
          UI.toast('Category updated');
        } else {
          Store.addCategory(month, v);
          UI.toast('Category added');
        }
        render();
      }
    });
  }

  function autoPlan() {
    var t = Store.totals(month);
    if (t.income <= 0) { UI.toast('Set your income first'); return; }
    var m = Store.getMonth(month);
    var msg = t.budgetTotal > 0
      ? 'Replace current budgets (' + cur()(t.budgetTotal) + ') with a suggested split of ' + cur()(t.income) + '?'
      : 'Spread ' + cur()(t.income) + ' across your categories as a starting split?';
    UI.confirm({
      title: 'Suggest a split',
      message: msg + ' You can fine-tune each category after.',
      confirmLabel: 'Apply split',
      onYes: function () {
        var weights = {
          'Home': 0.28, 'Groceries': 0.15, 'Transport': 0.10, 'Subscriptions': 0.05,
          'Tithe': 0.10, 'Upkeep': 0.07, 'Fun': 0.05, 'Savings': 0.15
        };
        var known = 0;
        m.categories.forEach(function (c) {
          var w = weights[c.name];
          if (w) { c.budget = Store.round2(t.income * w); known += c.budget; }
        });
        /* any category without a preset weight splits the remainder evenly */
        var rest = m.categories.filter(function (c) { return !weights[c.name]; });
        if (rest.length && t.income > known) {
          var each = Store.round2((t.income - known) / rest.length);
          rest.forEach(function (c) { c.budget = each; });
        } else if (!rest.length && known < t.income && m.categories.length) {
          /* leftover goes to the biggest weight (Home or first category) */
          var biggest = m.categories.slice().sort(function (a, b) { return (weights[b.name] || 0) - (weights[a.name] || 0); })[0];
          biggest.budget = Store.round2(biggest.budget + (t.income - known));
        }
        Store.save();
        UI.toast('Suggested split applied');
        render();
      }
    });
  }

  function copyPrevMonth() {
    var prev = Store.getMonth(Store.shiftMonth(month, -1));
    if (!prev.categories.length) { UI.toast('Last month has no categories to copy'); return; }
    UI.confirm({
      title: 'Copy last month',
      message: 'Replace this month\'s categories and budgets with ' +
        Store.monthLabel(Store.shiftMonth(month, -1)) + '\'s?',
      confirmLabel: 'Copy',
      onYes: function () {
        var m = Store.getMonth(month);
        m.categories = prev.categories.map(function (c) {
          return { id: Store.newId(), name: c.name, icon: c.icon, budget: c.budget, color: c.color };
        });
        Store.save();
        UI.toast('Copied from ' + Store.monthShort(Store.shiftMonth(month, -1)));
        render();
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     SPEND
     ═══════════════════════════════════════════════════════════════ */
  function renderSpend() {
    var money = cur();
    var t = Store.totals(month);
    var m = Store.getMonth(month);

    $('spendMonth').textContent = Store.monthLabel(month);

    $('spendStats').innerHTML =
      stat('Spent', money(t.spent), t.count + ' expenses', null) +
      stat('Income', money(t.income), t.extraIncome > 0 ? '+' + money(t.extraIncome) + ' logged' : 'monthly', null) +
      stat('Avg / day', money(t.avgPerDay), 'day ' + Math.min(t.day, t.daysInMonth) + ' of ' + t.daysInMonth, null) +
      stat('Biggest week', biggestWeek(t), 'of ' + Store.monthShort(month), null);

    /* filter chips */
    var chips = ['<button class="pill' + (spendFilter ? '' : ' is-active') + '" data-filter="" type="button">All</button>']
      .concat(m.categories.map(function (c) {
        return '<button class="pill' + (spendFilter === c.id ? ' is-active' : '') +
          '" data-filter="' + c.id + '" type="button">' + esc(c.icon + ' ' + c.name) + '</button>';
      }));
    $('spendFilters').innerHTML = chips.join('');

    /* grouped by day */
    var txs = Store.transactionsIn(month, spendFilter);
    var groups = {};
    txs.forEach(function (tx) {
      (groups[tx.date] = groups[tx.date] || []).push(tx);
    });
    var days = Object.keys(groups).sort().reverse();
    $('spendGroups').innerHTML = days.map(function (d) {
      var rows = groups[d];
      var total = rows.reduce(function (s, tx) {
        return s + (tx.type === 'expense' ? tx.amount : -tx.amount);
      }, 0);
      return '<div class="daygroup"><div class="daygroup__head"><span>' + fmtDateLong(d) +
        '</span><span class="daygroup__total">' + money(total) + '</span></div>' +
        '<div class="card"><ul class="txlist">' + rows.map(txRow).join('') + '</ul></div></div>';
    }).join('');
    $('spendEmpty').hidden = txs.length > 0;
  }

  function biggestWeek(t) {
    var max = 0;
    t.weekly.forEach(function (v) { if (v > max) max = v; });
    return cur()(max);
  }

  function fmtDateLong(d) {
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var parts = String(d).split('-');
    var dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var today = Store.todayStr();
    var label = names[dt.getDay()] + ', ' + months[dt.getMonth()] + ' ' + parseInt(parts[2], 10);
    if (d === today) label += ' · today';
    return label;
  }

  /* ── add / edit transaction ──────────────────────────────────── */
  function txSheet(existing, presetType) {
    var m = Store.getMonth(month);
    var cats = m.categories;
    var isIncome = existing ? existing.type === 'income' : presetType === 'income';
    var fields = [
      { name: 'type', label: 'Type', type: 'segment', value: isIncome ? 'income' : 'expense',
        options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
      { name: 'amount', label: 'Amount', type: 'number', value: existing ? existing.amount : '',
        placeholder: '0.00', inputmode: 'decimal', min: 0, step: '0.01' },
      { name: 'categoryId', label: 'Category',
        type: 'select', value: existing ? (existing.categoryId || '') : (cats[0] ? cats[0].id : ''),
        options: cats.map(function (c) { return { value: c.id, label: c.icon + ' ' + c.name }; })
          .concat([{ value: '', label: 'Uncategorised' }]) },
      { name: 'date', label: 'Date', type: 'date',
        value: existing ? existing.date : (month === Store.currentMonthKey() ? Store.todayStr() : month + '-01') },
      { name: 'note', label: 'Note (optional)', type: 'text', value: existing ? existing.note : '',
        placeholder: 'e.g. Zupco fare, electricity token' }
    ];
    UI.show({
      title: existing ? 'Edit transaction' : 'Log transaction',
      fields: fields,
      saveLabel: existing ? 'Save' : 'Add',
      onSave: function (v) {
        var amount = parseFloat(v.amount);
        if (!amount || amount <= 0) { UI.toast('Enter an amount'); return false; }
        if (existing) {
          Store.updateTransaction(existing.id, v);
          UI.toast('Updated');
        } else {
          Store.addTransaction(v);
          UI.toast('Logged ' + cur()(amount));
          checkBudgetAlert();
        }
        render();
      }
    });
  }

  function txActions(t) {
    var c = catOf(t.categoryId);
    UI.actions({
      title: (t.type === 'income' ? '+' : '') + cur()(t.amount) + ' · ' + (t.note || (c ? c.name : 'Transaction')),
      message: fmtDateLong(t.date) + (c ? ' · ' + c.name : ''),
      actions: [
        { label: 'Edit', icon: '✏️', kind: 'ghost', onClick: function () { txSheet(t); } },
        { label: 'Delete', icon: '🗑️', kind: 'danger', onClick: function () {
            UI.confirm({
              title: 'Delete transaction?',
              message: (t.note || 'This entry') + ' — ' + cur()(t.amount) + ' will be removed from ' + Store.monthLabel(month) + '.',
              confirmLabel: 'Delete',
              onYes: function () {
                Store.removeTransaction(t.id);
                UI.toast('Deleted');
                render();
              }
            });
          } }
      ]
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     SAVE (goals)
     ═══════════════════════════════════════════════════════════════ */
  function renderSave() {
    var money = cur();
    var S = Store.peek();
    var total = S.goals.reduce(function (s, g) { return s + g.saved; }, 0);
    var target = S.goals.reduce(function (s, g) { return s + g.target; }, 0);

    $('saveTotal').textContent = money(total);
    $('saveSub').textContent = target > 0
      ? 'of ' + money(target) + ' targeted across ' + S.goals.length + (S.goals.length === 1 ? ' goal' : ' goals')
      : 'Set a target and give your savings a destination.';
    $('goalsEmpty').hidden = S.goals.length > 0;
    $('goalList').innerHTML = S.goals.map(function (g) {
      var pct = g.target > 0 ? Math.min(100, Math.round(g.saved / g.target * 100)) : 0;
      var done = g.target > 0 && g.saved >= g.target;
      return '<li><button class="grow-row' + (done ? ' is-done' : '') + '" data-goal="' + g.id + '" type="button">' +
        '<span class="grow-row__top">' +
        '<span class="txico">' + g.icon + '</span>' +
        '<span class="grow-row__main"><span class="grow-row__name">' + esc(g.name) + '</span>' +
        '<span class="grow-row__sub">' + money(g.saved) + ' of ' + money(g.target) +
        (g.deadline ? ' · by ' + fmtDate(g.deadline) : '') + '</span></span>' +
        (done ? '<span class="badge badge--done">DONE</span>' : '<span class="grow-row__amt">' + pct + '%</span>') +
        '</span>' +
        '<span class="grow-row__track"><span class="grow-row__fill" style="display:block;width:' + pct +
        '%;background:' + (done ? 'var(--green-700)' : 'linear-gradient(90deg,var(--green-500),var(--green-400))') + '"></span></span>' +
        '</button></li>';
    }).join('');
  }

  function goalSheet(existing) {
    UI.show({
      title: existing ? 'Edit goal' : 'New goal',
      fields: [
        { name: 'name', label: 'What are you saving for?', type: 'text',
          value: existing ? existing.name : '', placeholder: 'e.g. Emergency fund' },
        { name: 'icon', label: 'Icon', type: 'icons', value: existing ? existing.icon : '🎯',
          options: ['🎯', '🏠', '🚗', '💻', '🎓', '🛠️', '✈️', '💍', '🐄', '💰', '📱', '🛡️'] },
        { name: 'target', label: 'Target amount', type: 'number', value: existing ? existing.target : '',
          placeholder: '0.00', inputmode: 'decimal', min: 0, step: '0.01' },
        { name: 'saved', label: 'Already saved', type: 'number', value: existing ? existing.saved : '',
          placeholder: '0.00', inputmode: 'decimal', min: 0, step: '0.01' },
        { name: 'deadline', label: 'Target date (optional)', type: 'date', value: existing ? existing.deadline : '' },
        { name: 'note', label: 'Note (optional)', type: 'text', value: existing ? existing.note : '' }
      ],
      saveLabel: existing ? 'Save' : 'Create goal',
      onSave: function (v) {
        if (!v.name.trim()) { UI.toast('Name your goal'); return false; }
        if (existing) { Store.updateGoal(existing.id, v); UI.toast('Goal updated'); }
        else { Store.addGoal(v); UI.toast('Goal created'); }
        render();
      }
    });
  }

  function contributeSheet(g) {
    UI.show({
      title: 'Add to ' + g.name,
      fields: [
        { name: 'amount', label: 'Contribution', type: 'number', value: '',
          placeholder: '0.00', inputmode: 'decimal', min: 0, step: '0.01' }
      ],
      saveLabel: 'Add',
      onSave: function (v) {
        var amt = parseFloat(v.amount);
        if (!amt || amt <= 0) { UI.toast('Enter an amount'); return false; }
        Store.contributeGoal(g.id, amt);
        var done = g.saved + amt >= g.target && g.target > 0;
        UI.toast(done ? '🎉 ' + g.name + ' reached!' : 'Added ' + cur()(amt) + ' to ' + g.name);
        render();
      }
    });
  }

  function goalActions(g) {
    var pct = g.target > 0 ? Math.min(100, Math.round(g.saved / g.target * 100)) : 0;
    UI.actions({
      title: g.icon + ' ' + g.name,
      message: cur()(g.saved) + ' of ' + cur()(g.target) + ' (' + pct + '%)' +
        (g.deadline ? ' · target date ' + fmtDate(g.deadline) : ''),
      actions: [
        { label: 'Add contribution', icon: '💰', kind: 'primary', onClick: function () { contributeSheet(g); } },
        { label: 'Edit goal', icon: '✏️', onClick: function () { goalSheet(g); } },
        { label: 'Delete goal', icon: '🗑️', kind: 'danger', onClick: function () {
            UI.confirm({
              title: 'Delete goal?',
              message: g.name + ' and its ' + cur()(g.saved) + ' progress will be removed. Money already logged as spending is not touched.',
              confirmLabel: 'Delete',
              onYes: function () { Store.removeGoal(g.id); UI.toast('Goal deleted'); render(); }
            });
          } }
      ]
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     GROW (insights)
     ═══════════════════════════════════════════════════════════════ */
  function renderGrow() {
    var money = cur();
    var t = Store.totals(month);
    var prevMk = Store.shiftMonth(month, -1);
    var pt = Store.totals(prevMk);
    var S = Store.peek();

    $('growMonth').textContent = Store.monthLabel(month);
    $('trendChart').innerHTML = Charts.trendBars(
      Store.monthRun(month, 6).map(function (mk) {
        return { label: Store.monthShort(mk), value: Store.totals(mk).spent };
      }), { money: money });

    $('growStats').innerHTML =
      stat('Savings rate', t.income > 0 ? t.savingsRate + '%' : '—',
        t.income > 0 ? 'of income kept' : 'set income first', null) +
      stat('Safe / day', t.remaining >= 0 ? money(t.safePerDay) : '—',
        t.daysLeft + ' days left', null) +
      stat('Budget used', t.budgetTotal > 0 ? Math.round(t.spent / t.budgetTotal * 100) + '%' : '—',
        money(t.budgetTotal) + ' planned', null) +
      stat('Vs last month', pt.spent > 0 && t.spent > 0
        ? (t.spent >= pt.spent ? '+' : '') + Math.round((t.spent - pt.spent) / pt.spent * 100) + '%'
        : '—',
        pt.spent > 0 ? money(pt.spent) + ' then' : 'no data yet', null);

    /* review */
    var review = [];
    review.push(reviewLine('Income', money(t.income)));
    review.push(reviewLine('Spent', money(t.spent)));
    review.push(reviewLine('Kept', money(t.remaining), t.remaining < 0 ? 'bad' : 'good'));
    if (t.extraIncome > 0) review.push(reviewLine('Extra income logged', money(t.extraIncome)));
    var overCats = t.byCategory.filter(function (c) { return c.budget > 0 && c.spent > c.budget; });
    review.push(reviewLine('Categories over budget', overCats.length ? overCats.map(function (c) { return c.name; }).join(', ') : 'None', overCats.length ? 'bad' : 'good'));
    var top = t.byCategory.slice().sort(function (a, b) { return b.spent - a.spent; })[0];
    if (top && top.spent > 0) review.push(reviewLine('Biggest category', top.icon + ' ' + top.name + ' — ' + money(top.spent)));
    $('growReview').innerHTML = review.join('');

    /* insights list */
    var ins = Insights.generate({
      totals: t, month: month, label: Store.monthLabel(month),
      prevTotals: pt, prevLabel: Store.monthShort(prevMk),
      debts: S.debts, goals: S.goals,
      currency: S.settings.currency,
      debtDays: S.settings.notif.debtDays,
      today: Store.todayStr(),
      isCurrent: month === Store.currentMonthKey()
    });
    $('growInsights').innerHTML = ins.map(function (i) {
      return '<li class="insight insight--' + i.tone + '">' +
        '<span class="insight__ico">' + i.icon + '</span>' +
        '<span><span class="insight__t">' + esc(i.title) + '</span>' +
        '<span class="insight__b">' + esc(i.body) + '</span></span></li>';
    }).join('');
    $('growEmpty').hidden = ins.length > 0;
  }

  function reviewLine(label, value, tone) {
    return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' +
      '<span style="font-size:13px;color:var(--muted);font-weight:650">' + esc(label) + '</span>' +
      '<span style="font-size:13px;font-weight:750;' +
      (tone === 'bad' ? 'color:var(--danger)' : tone === 'good' ? 'color:var(--good)' : '') + '">' + value + '</span></div>';
  }

  /* ═══════════════════════════════════════════════════════════════
     DEBTS
     ═══════════════════════════════════════════════════════════════ */
  function renderDebts() {
    var money = cur();
    var S = Store.peek();
    var list = S.debts.filter(function (d) { return (d.direction || 'owe') === debtDir; });
    var open = list.filter(function (d) { return Store.debtStatus(d) !== 'paid'; });
    var pending = open.reduce(function (s, d) { return s + (d.amount - d.paid); }, 0);
    var overdue = open.filter(function (d) { return Store.debtStatus(d) === 'overdue'; });
    var today = Store.todayStr();

    document.querySelectorAll('#debtSeg .seg__btn').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-dir') === debtDir);
    });
    $('debtSummaryTitle').textContent = debtDir === 'owe' ? 'Still to pay' : 'Still to receive';
    $('debtPending').textContent = money(pending);
    $('debtSub').textContent = open.length
      ? open.length + (open.length === 1 ? ' obligation' : ' obligations') +
        (overdue.length ? ' · ' + overdue.length + ' OVERDUE' : '') +
        ' · paid so far ' + money(list.reduce(function (s, d) { return s + d.paid; }, 0))
      : (debtDir === 'owe' ? 'You owe nothing. Long may it last.' : 'No one owes you anything here.');

    list.sort(function (a, b) {
      var sa = Store.debtStatus(a, today), sb = Store.debtStatus(b, today);
      var rank = { overdue: 0, pending: 1, partial: 1, paid: 2 };
      if (rank[sa] !== rank[sb]) return rank[sa] - rank[sb];
      return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1;
    });

    $('debtList').innerHTML = list.map(function (d) {
      var status = Store.debtStatus(d, today);
      var remaining = Store.round2(d.amount - d.paid);
      var pct = d.amount > 0 ? Math.min(100, Math.round(d.paid / d.amount * 100)) : 0;
      var badge = status === 'paid' ? '<span class="badge badge--done">PAID</span>'
        : status === 'overdue' ? '<span class="badge badge--over">OVERDUE</span>'
        : status === 'partial' ? '<span class="badge badge--due">PARTIAL</span>'
        : d.dueDate ? dueBadge(d.dueDate, today) : '';
      return '<li><button class="grow-row' + (status === 'paid' ? ' is-done' : '') + '" data-debt="' + d.id + '" type="button">' +
        '<span class="grow-row__top">' +
        '<span class="txico">' + (d.direction === 'lent' ? '📥' : '📤') + '</span>' +
        '<span class="grow-row__main"><span class="grow-row__name">' + esc(d.person) + '</span>' +
        '<span class="grow-row__sub">' + money(remaining) + ' left' +
        (d.dueDate ? ' · due ' + fmtDate(d.dueDate) : '') +
        (d.note ? ' · ' + esc(d.note) : '') + '</span></span>' +
        badge +
        '</span>' +
        '<span class="grow-row__track"><span class="grow-row__fill" style="display:block;width:' + pct +
        '%;background:' + (status === 'overdue' ? 'var(--danger)' : status === 'paid' ? 'var(--green-700)' : 'var(--green-500)') + '"></span></span>' +
        '</button></li>';
    }).join('');
    $('debtsEmpty').hidden = list.length > 0;
  }

  function dueBadge(due, today) {
    var days = Math.round((new Date(due) - new Date(today)) / 86400000);
    if (days <= 7) return '<span class="badge badge--due">DUE ' + (days === 0 ? 'TODAY' : days + 'd') + '</span>';
    return '';
  }

  function debtSheet(existing) {
    UI.show({
      title: existing ? 'Edit record' : (debtDir === 'owe' ? 'Track borrowed money' : 'Track money lent'),
      fields: [
        { name: 'direction', label: 'Direction', type: 'segment',
          value: existing ? existing.direction : debtDir,
          options: [{ value: 'owe', label: 'I owe them' }, { value: 'lent', label: 'They owe me' }] },
        { name: 'person', label: 'Person / place', type: 'text',
          value: existing ? existing.person : '', placeholder: 'e.g. Tenda, Bank, Steward' },
        { name: 'amount', label: 'Amount', type: 'number', value: existing ? existing.amount : '',
          placeholder: '0.00', inputmode: 'decimal', min: 0, step: '0.01' },
        { name: 'paid', label: 'Already paid back', type: 'number', value: existing ? existing.paid : '',
          placeholder: '0.00', inputmode: 'decimal', min: 0, step: '0.01' },
        { name: 'startDate', label: 'Date taken / given', type: 'date',
          value: existing ? existing.startDate : Store.todayStr() },
        { name: 'dueDate', label: 'Due date (for reminders)', type: 'date', value: existing ? existing.dueDate : '' },
        { name: 'note', label: 'Note (optional)', type: 'text', value: existing ? existing.note : '' }
      ],
      saveLabel: existing ? 'Save' : 'Track it',
      onSave: function (v) {
        var amount = parseFloat(v.amount);
        if (!amount || amount <= 0) { UI.toast('Enter the amount'); return false; }
        if (existing) {
          Store.updateDebt(existing.id, v);
          UI.toast('Updated');
        } else {
          Store.addDebt(v);
          UI.toast('Tracked ' + cur()(amount));
          if (v.dueDate) Notifs.scheduleDebtReminder(Store.peek().debts.find(function (d) {
            return d.person === v.person && d.amount === amount && d.dueDate === v.dueDate;
          }));
        }
        render();
      }
    });
  }

  function debtActions(d) {
    var status = Store.debtStatus(d);
    var remaining = Store.round2(d.amount - d.paid);
    UI.actions({
      title: (d.direction === 'lent' ? '📥 ' : '📤 ') + d.person,
      message: cur()(remaining) + ' outstanding of ' + cur()(d.amount) +
        (d.dueDate ? ' · due ' + fmtDate(d.dueDate) : '') + ' · ' + status.toUpperCase(),
      actions: [
        { label: 'Record a payment', icon: '💸', kind: 'primary', onClick: function () { paymentSheet(d); } },
        { label: 'Edit', icon: '✏️', onClick: function () { debtSheet(d); } },
        { label: 'Mark fully ' + (d.direction === 'lent' ? 'received' : 'paid'), icon: '✅', onClick: function () {
            Store.payDebt(d.id, remaining);
            UI.toast('Marked as settled');
            render();
          } },
        { label: 'Delete', icon: '🗑️', kind: 'danger', onClick: function () {
            UI.confirm({
              title: 'Delete this record?',
              message: d.person + ' — ' + cur()(d.amount) + ' will stop being tracked.',
              confirmLabel: 'Delete',
              onYes: function () { Store.removeDebt(d.id); Notifs.cancelDebtReminder(d.id); UI.toast('Deleted'); render(); }
            });
          } }
      ]
    });
  }

  function paymentSheet(d) {
    var remaining = Store.round2(d.amount - d.paid);
    UI.show({
      title: 'Payment · ' + d.person,
      fields: [
        { name: 'amount', label: 'Amount (' + cur()(remaining) + ' outstanding)', type: 'number',
          value: '', placeholder: '0.00', inputmode: 'decimal', min: 0, step: '0.01' }
      ],
      saveLabel: 'Record',
      onSave: function (v) {
        var amt = parseFloat(v.amount);
        if (!amt || amt <= 0) { UI.toast('Enter an amount'); return false; }
        Store.payDebt(d.id, amt);
        var left = Store.round2(d.amount - Store.peek().debts.find(function (x) { return x.id === d.id; }).paid);
        UI.toast(left <= 0 ? '🎉 Settled with ' + d.person : 'Payment recorded — ' + cur()(left) + ' left');
        render();
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     MORE
     ═══════════════════════════════════════════════════════════════ */
  function renderMore() {
    var S = Store.peek();
    $('nameValue').textContent = S.settings.name || 'Add your name';
    $('currencyValue').textContent = S.settings.currency;
    $('notifEnabled').checked = !!S.settings.notif.enabled;
    $('notifTimeValue').textContent = S.settings.notif.time;
    $('thresholdValue').textContent = S.settings.notif.threshold + '%';
    $('debtDaysValue').textContent = S.settings.notif.debtDays + ' days';
    $('pdfMonth').textContent = Store.monthShort(month);
  }

  function nameSheet() {
    var S = Store.peek();
    UI.show({
      title: 'Your name',
      fields: [{ name: 'name', label: 'Shown on the dashboard and exports', type: 'text',
        value: S.settings.name, placeholder: 'e.g. Tanaka' }],
      onSave: function (v) {
        Store.peek().settings.name = String(v.name || '').trim().slice(0, 30);
        Store.save();
        render();
      }
    });
  }

  var CURRENCIES = [
    { value: '$', label: '$ Dollar' },
    { value: 'US$', label: 'US$ US Dollar' },
    { value: 'ZiG', label: 'ZiG Zimbabwe Gold' },
    { value: 'R', label: 'R Rand' },
    { value: '£', label: '£ Pound' },
    { value: '€', label: '€ Euro' },
    { value: 'P', label: 'P Pula' },
    { value: 'K', label: 'K Kwacha' },
    { value: 'N$', label: 'N$ Namibian $' },
    { value: '₦', label: '₦ Naira' },
    { value: 'KSh', label: 'KSh Shilling' },
    { value: '₹', label: '₹ Rupee' }
  ];

  function currencySheet() {
    var S = Store.peek();
    UI.show({
      title: 'Currency',
      fields: [{ name: 'currency', label: 'Symbol used everywhere', type: 'select',
        value: S.settings.currency, options: CURRENCIES }],
      onSave: function (v) {
        Store.peek().settings.currency = v.currency || '$';
        Store.save();
        render();
      }
    });
  }

  function notifTimeSheet() {
    var S = Store.peek();
    UI.show({
      title: 'Daily check-in',
      fields: [{ name: 'time', label: 'Reminder time each day', type: 'time', value: S.settings.notif.time }],
      onSave: function (v) {
        Store.peek().settings.notif.time = v.time || '19:30';
        Store.save();
        Notifs.rescheduleAll();
        render();
      }
    });
  }

  function thresholdSheet() {
    var S = Store.peek();
    UI.show({
      title: 'Budget alert',
      fields: [{ name: 'threshold', label: 'Alert me when spending reaches', type: 'select',
        value: String(S.settings.notif.threshold),
        options: ['50', '60', '70', '80', '90'].map(function (v) { return { value: v, label: v + '% of income' }; }) }],
      onSave: function (v) {
        Store.peek().settings.notif.threshold = parseInt(v.threshold, 10) || 80;
        Store.save();
        render();
      }
    });
  }

  function debtDaysSheet() {
    var S = Store.peek();
    UI.show({
      title: 'Debt reminders',
      fields: [{ name: 'debtDays', label: 'Days before due date', type: 'select',
        value: String(S.settings.notif.debtDays),
        options: ['1', '2', '3', '5', '7'].map(function (v) { return { value: v, label: v + ' day' + (v > 1 ? 's' : '') + ' before' }; }) }],
      onSave: function (v) {
        Store.peek().settings.notif.debtDays = parseInt(v.debtDays, 10) || 3;
        Store.save();
        Notifs.rescheduleAll();
        render();
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     NOTIFICATIONS
     ═══════════════════════════════════════════════════════════════ */
  var Notifs = {
    cap: function () {
      var P = global.Capacitor && global.Capacitor.Plugins;
      return (P && P.LocalNotifications) || null;
    },
    native: function () {
      return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform() && this.cap());
    },
    ensurePermission: function () {
      var self = this;
      if (this.native()) {
        return this.cap().checkPermissions().then(function (r) {
          if (r.display === 'granted') return true;
          return self.cap().requestPermissions().then(function (r2) {
            return r2.display === 'granted';
          });
        }).catch(function () { return false; });
      }
      if (!('Notification' in global)) {
        return Promise.resolve(false);
      }
      if (Notification.permission === 'granted') return Promise.resolve(true);
      if (Notification.permission === 'denied') return Promise.resolve(false);
      return Notification.requestPermission().then(function (r) { return r === 'granted'; });
    },
    /* fire immediately (budget alerts, tests) */
    fire: function (title, body) {
      var S = Store.peek();
      if (!S.settings.notif.enabled) return;
      if (this.native()) {
        this.ensurePermission().then(function (ok) {
          if (!ok) return;
          global.Capacitor.Plugins.LocalNotifications.schedule({
            notifications: [{
              id: Math.floor(Math.random() * 2e9),
              title: title, body: body,
              smallIcon: 'ic_notification',
              iconColor: '#0A4D22'
            }]
          });
        });
        return;
      }
      this.ensurePermission().then(function (ok) {
        if (!ok) { UI.toast(body); return; }
        try {
          var n = new Notification(title, { body: body, icon: 'resources/icon-192x192-any.png', tag: 'rongamari' });
          n.onclick = function () { global.focus(); n.close(); };
        } catch (e) { UI.toast(title + ' — ' + body); }
      });
    },
    /* daily + weekly repeating schedule (native only; web PWA cannot schedule) */
    rescheduleAll: function () {
      var self = this;
      if (!this.native()) return;
      var S = Store.peek();
      var cap = this.cap();
      cap.getPending().then(function (pending) {
        var keep = [];
        pending.notifications.forEach(function (n) {
          if (n.extra && n.extra.debtId) keep.push(n.id);   // debt reminders handled separately
        });
        if (keep.length) cap.cancel({ notifications: keep.map(function (id) { return { id: id }; }) });
        return cap.getPending();
      }).then(function (pending) {
        /* drop every recurring one, then re-add from settings */
        var recurring = pending.notifications.filter(function (n) { return !(n.extra && n.extra.debtId); });
        if (recurring.length) {
          cap.cancel({ notifications: recurring });
        }
        if (!S.settings.notif.enabled) return;
        return self.ensurePermission().then(function (ok) {
          if (!ok) return;
          var notifications = [];
          if (S.settings.notif.daily) {
            var parts = String(S.settings.notif.time || '19:30').split(':');
            notifications.push({
              id: 900001,
              title: 'RongaMari check-in',
              body: 'Take a minute: log what you spent today and keep the month honest.',
              smallIcon: 'ic_notification',
              iconColor: '#0A4D22',
              schedule: { on: { hour: parseInt(parts[0], 10) || 19, minute: parseInt(parts[1], 10) || 30 }, allowWhileIdle: true },
              extra: { kind: 'daily' }
            });
          }
          if (S.settings.notif.weekly) {
            notifications.push({
              id: 900002,
              title: 'Your week in review',
              body: 'Sunday is a good day to look at the week\'s spending and set up the next one.',
              smallIcon: 'ic_notification',
              iconColor: '#0A4D22',
              schedule: { on: { weekday: 7, hour: 18, minute: 0 }, allowWhileIdle: true },
              extra: { kind: 'weekly' }
            });
          }
          if (notifications.length) cap.schedule({ notifications: notifications });
        });
      }).catch(function () {});
    },
    scheduleDebtReminder: function (d) {
      var self = this;
      if (!this.native() || !d || !d.dueDate) return;
      var S = Store.peek();
      if (!S.settings.notif.enabled) return;
      var daysBefore = S.settings.notif.debtDays || 3;
      var when = new Date(d.dueDate + 'T09:00:00');
      when.setDate(when.getDate() - daysBefore);
      if (when.getTime() < Date.now()) return;
      this.ensurePermission().then(function (ok) {
        if (!ok) return;
        self.cap().schedule({
          notifications: [{
            id: hashId(d.id),
            title: 'Debt due soon',
            body: d.person + ' — ' + (d.direction === 'lent' ? 'they should pay you' : 'you planned to pay') +
                  ' ' + (S.settings.currency || '$') + (d.amount - d.paid).toFixed(2) + ' by ' + d.dueDate + '.',
            smallIcon: 'ic_notification',
            iconColor: '#0A4D22',
            schedule: { at: when, allowWhileIdle: true },
            extra: { debtId: d.id }
          }]
        });
      }).catch(function () {});
    },
    cancelDebtReminder: function (id) {
      if (!this.native()) return;
      try { this.cap().cancel({ notifications: [{ id: hashId(id) }] }); } catch (e) {}
    },
    rescheduleAllDebts: function () {
      var self = this;
      if (!this.native()) return;
      Store.peek().debts.forEach(function (d) {
        if (Store.debtStatus(d) !== 'paid' && d.dueDate) self.scheduleDebtReminder(d);
      });
    }
  };

  function hashId(s) {
    var h = 0;
    for (var i = 0; i < String(s).length; i++) h = ((h << 5) - h + String(s).charCodeAt(i)) | 0;
    return 100000 + (Math.abs(h) % 800000);
  }

  /* budget threshold alert: fires once per month per threshold */
  function checkBudgetAlert() {
    var S = Store.peek();
    var n = S.settings.notif;
    if (!n.enabled) return;
    var mk = Store.currentMonthKey();
    var t = Store.totals(mk);
    if (t.income <= 0) return;
    var pct = t.spent / t.income * 100;
    var fired = S.meta.alerts;
    fired[mk] = fired[mk] || {};
    var level = null;
    if (pct >= n.threshold && !fired[mk][n.threshold]) level = n.threshold;
    if (pct >= 100 && !fired[mk][100]) level = 100;
    if (level == null) return;
    fired[mk][level] = true;
    Store.save();
    Notifs.fire(
      level >= 100 ? 'Monthly budget exceeded' : 'Budget alert: ' + level + '%',
      level >= 100
        ? 'You have spent more than your income this month. Check Grow for where it went.'
        : 'You have used ' + Math.round(pct) + '% of this month\'s income with ' +
          t.daysLeft + ' days to go. Safe to spend: ' + (S.settings.currency || '$') + t.safePerDay.toFixed(2) + '/day.'
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     EXPORT MODEL
     ═══════════════════════════════════════════════════════════════ */
  function exportModel() {
    var money = cur();
    var S = Store.peek();
    var t = Store.totals(month);
    var m = Store.getMonth(month);

    /* weeks with rows */
    var txs = Store.transactionsIn(month);
    var weeks = [];
    for (var w = 0; w < 5; w++) weeks.push({ no: w + 1, total: t.weekly[w], rows: [] });
    txs.forEach(function (tx) {
      var c = catOf(tx.categoryId);
      weeks[Store.weekOfMonth(tx.date)].rows.push({
        dateLabel: fmtDate(tx.date),
        label: (tx.note || (c ? c.name : (tx.type === 'income' ? 'Income' : 'Expense'))),
        icon: c ? c.icon : (tx.type === 'income' ? '💸' : '🧾'),
        amount: tx.amount,
        type: tx.type
      });
    });
    weeks.forEach(function (wk) {
      var first = wk.no * 7 - 6;
      var last = Math.min(wk.no * 7, t.daysInMonth);
      wk.range = (first > t.daysInMonth ? '' : 'day ' + first + '–' + last);
    });
    var usedWeeks = weeks.filter(function (wk) { return wk.rows.length; });

    var allTx = txs.map(function (tx) {
      var c = catOf(tx.categoryId);
      return {
        date: tx.date, week: Store.weekOfMonth(tx.date), type: tx.type,
        amount: tx.amount, categoryName: c ? c.name : 'Other', note: tx.note
      };
    });

    var debts = S.debts.map(function (d) {
      var status = Store.debtStatus(d);
      return {
        person: d.person, dirLabel: d.direction === 'lent' ? 'Owed to me' : 'I owe',
        amount: d.amount, paid: d.paid, remaining: Store.round2(d.amount - d.paid),
        startDate: d.startDate, dueDate: d.dueDate, status: status,
        statusLabel: status === 'paid' ? 'PAID' : status === 'overdue' ? 'OVERDUE' : status.toUpperCase(),
        dateLine: 'from ' + d.startDate + (d.note ? ' · ' + d.note : ''),
        note: d.note
      };
    });
    var debtsOutstanding = S.debts.reduce(function (s, d) {
      return s + (Store.debtStatus(d) !== 'paid' ? d.amount - d.paid : 0);
    }, 0);

    var goals = S.goals.map(function (g) {
      return {
        name: g.name, icon: g.icon, target: g.target, saved: g.saved,
        pct: g.target > 0 ? Math.min(100, Math.round(g.saved / g.target * 100)) : 0,
        deadline: g.deadline
      };
    });

    var insights = Insights.generate({
      totals: t, month: month, label: Store.monthLabel(month),
      prevTotals: Store.totals(Store.shiftMonth(month, -1)),
      prevLabel: Store.monthShort(Store.shiftMonth(month, -1)),
      debts: S.debts, goals: S.goals,
      currency: S.settings.currency,
      debtDays: S.settings.notif.debtDays,
      today: Store.todayStr(),
      isCurrent: month === Store.currentMonthKey()
    }).slice(0, 5);

    return {
      period: Store.monthLabel(month),
      monthKey: month,
      currency: S.settings.currency || '$',
      person: S.settings.name || '',
      generated: 'generated ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
      stamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      money: money,
      tot: t,
      subline: t.income > 0
        ? 'Income ' + money(t.income) + ' · ' + t.count + ' expenses · average ' + money(t.avgPerDay) + '/day · safe ' + money(t.safePerDay) + '/day for the rest of the month.'
        : 'No income recorded for this month — totals below cover spending only.',
      weeks: usedWeeks,
      txCount: t.count,
      allTx: allTx,
      debts: debts,
      debtsOutstanding: Store.round2(debtsOutstanding),
      goals: goals,
      goalsTarget: Store.round2(S.goals.reduce(function (s, g) { return s + g.target; }, 0)),
      goalsSaved: Store.round2(S.goals.reduce(function (s, g) { return s + g.saved; }, 0)),
      insights: insights
    };
  }

  function doExport(kind) {
    var model = exportModel();
    if (kind === 'pdf') {
      UI.toast('Building PDF…');
      global.RMExport.pdf(model).then(function (res) {
        UI.toast('Saved to ' + (res && res.where ? res.where : 'downloads'));
      }).catch(function () { UI.toast('Could not save the PDF'); });
    } else {
      UI.toast('Building workbook…');
      global.RMExport.xlsx(model).then(function (res) {
        UI.toast('Saved to ' + (res && res.where ? res.where : 'downloads'));
      }).catch(function () { UI.toast('Could not save the workbook'); });
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     BACKUP / RESTORE / RESET
     ═══════════════════════════════════════════════════════════════ */
  function doBackup() {
    global.RMExport.jsonBackup(Store.backup()).then(function () {
      UI.toast('Backup saved');
    }).catch(function () { UI.toast('Backup failed'); });
  }

  function doRestore(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        Store.restore(String(reader.result));
        month = Store.currentMonthKey();
        UI.toast('Restored');
        Notifs.rescheduleAllDebts();
        go('home', true);
      } catch (e) {
        UI.toast('That file is not a RongaMari backup');
      }
    };
    reader.readAsText(file);
  }

  /* ═══════════════════════════════════════════════════════════════
     EVENT WIRING
     ═══════════════════════════════════════════════════════════════ */
  function monthNav(prevId, nextId, labelId) {
    $(prevId).addEventListener('click', function () { month = Store.shiftMonth(month, -1); render(); });
    $(nextId).addEventListener('click', function () {
      if (month >= Store.currentMonthKey()) { UI.toast('That month has not happened yet'); return; }
      month = Store.shiftMonth(month, 1);
      render();
    });
    $(labelId).addEventListener('click', function () {
      UI.toast(Store.monthLabel(month) + (month === Store.currentMonthKey() ? ' · current month' : ''));
    });
  }

  function wire() {
    /* top bar */
    $('brandBtn').addEventListener('click', function () { go('home'); });
    $('btnDebts').addEventListener('click', function () { go('debts'); });
    $('btnMore').addEventListener('click', function () { go('more'); });

    /* bottom nav */
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () { go(b.getAttribute('data-view')); });
    });

    /* FAB */
    $('fabAdd').addEventListener('click', function () {
      UI.actions({
        title: 'What happened?',
        actions: [
          { label: 'Add an expense', icon: '🛍️', kind: 'primary', onClick: function () { txSheet(null, 'expense'); } },
          { label: 'Add income', icon: '💸', onClick: function () { txSheet(null, 'income'); } },
          { label: 'Pay towards a debt', icon: '🤝', onClick: function () {
              var open = Store.pendingDebts('owe');
              if (!open.length) { UI.toast('No pending debts — add one in Debts'); return; }
              if (open.length === 1) { paymentSheet(open[0]); return; }
              UI.actions({
                title: 'Which debt?',
                actions: open.map(function (d) {
                  return { label: d.person + ' · ' + cur()(d.amount - d.paid), onClick: function () { paymentSheet(d); } };
                })
              });
            } }
        ]
      });
    });

    /* month navs */
    monthNav('homePrev', 'homeNext', 'homeMonth');
    monthNav('planPrev', 'planNext', 'planMonth');
    monthNav('spendPrev', 'spendNext', 'spendMonth');
    monthNav('growPrev', 'growNext', 'growMonth');

    /* home card taps */
    $('cardWeek').addEventListener('click', function () { go('spend'); });
    $('cardCats').addEventListener('click', function () { go('plan'); });
    $('cardDebts').addEventListener('click', function () { go('debts'); });
    $('cardGoals').addEventListener('click', function () { go('save'); });
    $('cardInsight').addEventListener('click', function () { go('grow'); });
    $('cardRecent').addEventListener('click', function () { go('spend'); });
    $('homeStats').addEventListener('click', function (e) {
      var s = e.target.closest('.stat');
      if (s && s.getAttribute('data-go')) go(s.getAttribute('data-go'));
    });
    $('homeCats').addEventListener('click', function (e) {
      var bar = e.target.closest('[data-cat]');
      if (bar) { spendFilter = bar.getAttribute('data-cat'); go('spend'); }
    });
    $('homeRecent').addEventListener('click', txListHandler);

    /* plan */
    $('incomeCard').addEventListener('click', incomeSheet);
    $('btnAddCat').addEventListener('click', function () { categorySheet(null); });
    $('btnCopyPrev').addEventListener('click', copyPrevMonth);
    $('btnAutoPlan').addEventListener('click', autoPlan);
    $('planCats').addEventListener('click', function (e) {
      var row = e.target.closest('[data-cat-edit]');
      if (!row) return;
      var c = Store.getMonth(month).categories.find(function (x) { return x.id === row.getAttribute('data-cat-edit'); });
      if (!c) return;
      UI.actions({
        title: c.icon + ' ' + c.name,
        message: 'Budget ' + cur()(c.budget) + ' · spent ' + cur()(Store.totals(month).byCategory.find(function (x) { return x.id === c.id; }) || { spent: 0 }).spent,
        actions: [
          { label: 'Edit category', icon: '✏️', kind: 'primary', onClick: function () { categorySheet(c); } },
          { label: 'See its spending', icon: '🔍', onClick: function () { spendFilter = c.id; go('spend'); } },
          { label: 'Delete category', icon: '🗑️', kind: 'danger', onClick: function () {
              UI.confirm({
                title: 'Delete ' + c.name + '?',
                message: 'Its budget is removed from the plan. Transactions already logged are kept and shown as Other.',
                confirmLabel: 'Delete',
                onYes: function () { Store.removeCategory(month, c.id); UI.toast('Category deleted'); render(); }
              });
            } }
        ]
      });
    });

    /* spend */
    $('spendFilters').addEventListener('click', function (e) {
      var p = e.target.closest('[data-filter]');
      if (!p) return;
      spendFilter = p.getAttribute('data-filter') || null;
      renderSpend();
    });
    $('spendGroups').addEventListener('click', txListHandler);

    /* save */
    $('btnAddGoal').addEventListener('click', function () { goalSheet(null); });
    $('goalList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-goal]');
      if (!row) return;
      var g = Store.peek().goals.find(function (x) { return x.id === row.getAttribute('data-goal'); });
      if (g) goalActions(g);
    });

    /* grow exports */
    $('btnPdf2').addEventListener('click', function () { doExport('pdf'); });
    $('btnXlsx2').addEventListener('click', function () { doExport('xlsx'); });

    /* debts */
    $('debtSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dir]');
      if (!b) return;
      debtDir = b.getAttribute('data-dir');
      renderDebts();
    });
    $('btnAddDebt').addEventListener('click', function () { debtSheet(null); });
    $('debtList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-debt]');
      if (!row) return;
      var d = Store.peek().debts.find(function (x) { return x.id === row.getAttribute('data-debt'); });
      if (d) debtActions(d);
    });

    /* more */
    $('setName').addEventListener('click', nameSheet);
    $('setCurrency').addEventListener('click', currencySheet);
    $('notifEnabled').addEventListener('change', function (e) {
      var on = e.target.checked;
      Store.peek().settings.notif.enabled = on;
      Store.save();
      if (on) {
        Notifs.ensurePermission().then(function (ok) {
          if (!ok) {
            UI.toast('Notifications are blocked in system settings');
            Store.peek().settings.notif.enabled = false;
            Store.save();
            $('notifEnabled').checked = false;
            return;
          }
          Notifs.rescheduleAll();
          Notifs.rescheduleAllDebts();
          UI.toast('Reminders on — daily ' + Store.peek().settings.notif.time);
        });
      } else {
        Notifs.rescheduleAll();
        UI.toast('Reminders off');
      }
    });
    $('setNotifTime').addEventListener('click', notifTimeSheet);
    $('setThreshold').addEventListener('click', thresholdSheet);
    $('setDebtDays').addEventListener('click', debtDaysSheet);
    $('btnTestNotif').addEventListener('click', function () {
      if (!Store.peek().settings.notif.enabled) {
        UI.toast('Turn on notifications first');
        return;
      }
      Notifs.fire('RongaMari works 🎉', 'This is exactly how your reminders will appear.');
    });
    $('btnPdf').addEventListener('click', function () { doExport('pdf'); });
    $('btnXlsx').addEventListener('click', function () { doExport('xlsx'); });
    $('btnBackup').addEventListener('click', doBackup);
    $('btnRestore').addEventListener('click', function () { $('restoreFile').click(); });
    $('restoreFile').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) doRestore(e.target.files[0]);
      e.target.value = '';
    });
    $('btnReset').addEventListener('click', function () {
      UI.confirm({
        title: 'Erase everything?',
        message: 'All months, transactions, debts and goals on this device will be deleted. This cannot be undone — back up first if in doubt.',
        confirmLabel: 'Erase',
        onYes: function () {
          Store.reset();
          month = Store.currentMonthKey();
          Store.seedMonthFromDefaults(month);
          UI.toast('Fresh start');
          go('home', true);
        }
      });
    });

    /* android hardware back */
    var App = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.App;
    if (App && App.addListener) {
      App.addListener('backButton', function () {
        if (document.getElementById('modal') && !document.getElementById('modal').hidden) { UI.close(); return; }
        if (view !== 'home') { goBack(); return; }
        if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.App) {
          global.Capacitor.Plugins.App.exitApp();
        }
      });
    }
  }

  function txListHandler(e) {
    var row = e.target.closest('[data-tx]');
    if (!row) return;
    var t = Store.peek().transactions.find(function (x) { return x.id === row.getAttribute('data-tx'); });
    if (t) txActions(t);
  }

  /* ═══════════════════════════════════════════════════════════════
     BOOT
     ═══════════════════════════════════════════════════════════════ */
  function boot() {
    Store.load();
    Store.seedMonthFromDefaults(Store.currentMonthKey());
    month = Store.currentMonthKey();
    wire();
    go('home', true);

    /* PWA service worker (browsers only; harmless in the APK) */
    if ('serviceWorker' in navigator && !(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform())) {
      navigator.serviceWorker.register('rongamari-sw.js', { updateViaCache: 'none' }).catch(function () {});
    }

    /* reschedule reminders once a day in case the app is left running */
    Notifs.rescheduleAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* exposed for tests */
  global.RMApp = { go: go, render: render, exportModel: exportModel, Notifs: Notifs };
})(typeof window !== 'undefined' ? window : globalThis);
