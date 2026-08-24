/* RongaMari insights engine.
 *
 * Rule-based intelligence over the user's own numbers — no network, no model,
 * just the arithmetic a good accountant would do out loud. Every insight is
 * deterministic from the data, which makes it testable and trustworthy: the
 * same month always tells the same story.
 *
 * Pure functions only; runs in the browser and in node tests.
 */
(function (global) {
  'use strict';

  function pick(list) { return list; }

  /* The heart: everything we can honestly say about one month. */
  function generate(input) {
    var t = input.totals;
    var prev = input.prevTotals || null;
    var mk = input.month;
    var label = input.label || mk;
    var debts = input.debts || [];
    var goals = input.goals || [];
    var cur = input.currency || '$';
    var isCurrent = input.isCurrent !== false;
    var out = [];
    var today = input.today;

    function money(n) {
      var neg = n < 0;
      var v = Math.abs(Math.round(n * 100) / 100);
      var s = cur + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return neg ? '-' + s : s;
      }

    function add(tone, icon, title, body) {
      out.push({ tone: tone, icon: icon, title: title, body: body });
    }

    if (!t) return out;

    /* ── 1. pacing ─────────────────────────────────────────────── */
    if (isCurrent && t.income > 0 && t.day <= t.daysInMonth) {
      var drift = t.spentPct - t.expectedPct;
      if (t.remaining < 0) {
        add('bad', '🚨', 'Over budget',
            'You have spent ' + money(-t.remaining) + ' more than your ' +
            money(t.income) + ' income this month. Time to pause non-essentials.');
      } else if (drift > 12 && t.spent > 0) {
        var proj = t.avgPerDay * t.daysInMonth;
        add('warn', '⏱️', 'Spending fast',
            'By day ' + t.day + ' a steady month would be ' + t.expectedPct +
            '% gone — you are at ' + t.spentPct + '%. At this pace the month ends around ' +
            money(proj) + ' against ' + money(t.income) + ' in.');
      } else if (drift < -10 && t.spent > 0) {
        add('good', '🌿', 'Comfortably on track',
            'Only ' + t.spentPct + '% of your income used by day ' + t.day +
            ' (expected ' + t.expectedPct + '%). ' + money(t.safePerDay) +
            '/day is your safe space for the rest of ' + label + '.');
      } else if (t.spent > 0) {
        add('good', '✅', 'On pace',
            t.spentPct + '% of income used on day ' + t.day + ' of ' + t.daysInMonth +
            '. Keep roughly ' + money(t.safePerDay) + '/day and you finish the month whole.');
      }
    }

    /* ── 2. category pressure ──────────────────────────────────── */
    var over = t.byCategory.filter(function (c) { return c.budget > 0 && c.spent > c.budget; });
    var near = t.byCategory.filter(function (c) {
      return c.budget > 0 && c.spent <= c.budget && c.pct >= 80;
    });
    if (over.length) {
      var worst = over.slice().sort(function (a, b) { return b.spent - b.budget - (a.spent - a.budget); })[0];
      add('bad', '📈', worst.name + ' burst its budget',
          worst.name + ' is ' + money(worst.spent - worst.budget) + ' over its ' +
          money(worst.budget) + '. ' +
          (over.length > 1 ? over.length + ' categories are over in total. ' : '') +
          'Move money in Plan or hold back for the rest of the month.');
    }
    near.forEach(function (c) {
      if (over.indexOf(c) !== -1) return;
      add('warn', '⚠️', c.name + ' almost done',
          c.pct + '% of the ' + c.name + ' budget is spent — ' +
          money(c.budget - c.spent) + ' left for the rest of ' + label + '.');
    });

    /* ── 3. concentration ──────────────────────────────────────── */
    if (t.spent > 0 && t.byCategory.length) {
      var top = t.byCategory.slice().sort(function (a, b) { return b.spent - a.spent; })[0];
      var share = Math.round(top.spent / t.spent * 100);
      if (share >= 35 && top.spent > 0) {
        add('info', '🔍', top.name + ' dominates your spending',
            top.name + ' takes ' + share + '% of everything you spent in ' + label +
            ' (' + money(top.spent) + '). If it can be trimmed even 10%, that is ' +
            money(top.spent * 0.10) + ' back.');
      }
    }

    /* ── 4. month-on-month movers ──────────────────────────────── */
    if (prev && prev.spent > 0 && t.spent > 0) {
      var delta = t.spent - prev.spent;
      var pct = Math.round(delta / prev.spent * 100);
      if (Math.abs(pct) >= 15) {
        var dirWord = delta > 0 ? 'up' : 'down';
        var tone = delta > 0 ? 'warn' : 'good';
        add(tone, delta > 0 ? '📊' : '📉',
            'Spending ' + dirWord + ' ' + Math.abs(pct) + '% vs ' + (input.prevLabel || 'last month'),
            money(prev.spent) + ' → ' + money(t.spent) + '. ' +
            (delta > 0 ? 'Worth knowing which category moved before it becomes a habit.'
                       : 'Whatever you changed, keep doing it.'));
      }
      /* biggest category mover */
      var movers = [];
      t.byCategory.forEach(function (c) {
        var p = prev.byCategory.find(function (x) { return x.name === c.name; });
        if (p && p.spent > 0 && c.budget >= 0) {
          var d = c.spent - p.spent;
          if (Math.abs(d) >= Math.max(10, prev.spent * 0.05)) {
            movers.push({ name: c.name, d: d });
          }
        }
      });
      if (movers.length) {
        movers.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
        var mv = movers[0];
        if (Math.abs(mv.d) > Math.max(20, prev.spent * 0.08)) {
          add(mv.d > 0 ? 'warn' : 'info', '🔁', mv.name + ' moved most',
              mv.name + ' is ' + money(Math.abs(mv.d)) + ' ' +
              (mv.d > 0 ? 'heavier' : 'lighter') + ' than ' + (input.prevLabel || 'last month') + '.');
        }
      }
    }

    /* ── 5. savings rate ───────────────────────────────────────── */
    if (t.income > 0 && t.remaining >= 0) {
      if (t.savingsRate >= 20) {
        add('good', '🏆', 'Strong savings rate',
            t.savingsRate + '% of your income is still unspent. Anything above 20% each month compounds fast — a goal could absorb it.');
      } else if (!isCurrent && t.savingsRate < 5) {
        add('warn', '🪤', 'Nothing left over',
            label + ' closed with under 5% of income spare. Even a small fixed "pay yourself first" line in Plan protects the next month.');
      }
    }

    /* ── 6. debts ──────────────────────────────────────────────── */
    var owe = debts.filter(function (d) { return (d.direction || 'owe') === 'owe'; });
    var oweOpen = owe.filter(function (d) { return d.amount - d.paid > 0.004; });
    if (oweOpen.length) {
      var oweTotal = oweOpen.reduce(function (s, d) { return s + (d.amount - d.paid); }, 0);
      var overdue = oweOpen.filter(function (d) { return d.dueDate && today && d.dueDate < today; });
      var soon = oweOpen.filter(function (d) {
        if (!d.dueDate || !today) return false;
        var days = Math.round((new Date(d.dueDate) - new Date(today)) / 86400000);
        return days >= 0 && days <= (input.debtDays || 3);
      });
      if (overdue.length) {
        add('bad', '🔴', 'Overdue debt',
            money(overdue.reduce(function (s, d) { return s + (d.amount - d.paid); }, 0)) +
            ' to ' + overdue[0].person + (overdue.length > 1 ? ' and ' + (overdue.length - 1) + ' more' : '') +
            ' is past its due date. Clearing it protects your name — and your credit.');
      } else if (soon.length) {
        add('warn', '📅', 'Debt due this week',
            money(soon.reduce(function (s, d) { return s + (d.amount - d.paid); }, 0)) +
            ' to ' + soon[0].person + ' is due ' + soon[0].dueDate +
            '. Set it aside today so it does not collide with bills.');
      }
      if (t.income > 0) {
        var shareOwe = Math.round(oweTotal / t.income * 100);
        if (shareOwe > 25) {
          add('warn', '🧾', 'Debts eat ' + shareOwe + '% of income',
              money(oweTotal) + ' is still owed against ' + money(t.income) +
              ' this month. If you can, freeze new borrowing until this halves.');
        } else {
          add('info', '🤝', 'Borrowed money tracked',
              money(oweTotal) + ' still to repay across ' + oweOpen.length +
              (oweOpen.length === 1 ? ' person' : ' people') + '. It is counted, so it cannot sneak up on you.');
        }
      }
    }

    /* ── 7. goals ──────────────────────────────────────────────── */
    var openGoals = goals.filter(function (g) { return g.target > 0 && g.saved < g.target; });
    if (openGoals.length && t.remaining > 0) {
      var g0 = openGoals.slice().sort(function (a, b) { return (b.target - b.saved) - (a.target - a.saved); })[0];
      var need = g0.target - g0.saved;
      var monthsNeed = Math.ceil(need / Math.max(1, t.remaining));
      if (monthsNeed <= 3) {
        add('good', '🎯', g0.name + ' is close',
            money(need) + ' to go. At this month\'s leftover pace it lands in about ' +
            monthsNeed + (monthsNeed === 1 ? ' month.' : ' months.'));
      } else if (isCurrent) {
        add('info', '🌱', 'Feed ' + g0.name,
            money(t.remaining) + ' is still unspent this month — even ' +
            money(Math.min(need, Math.max(t.remaining * 0.2, 5))) + ' moves ' + g0.name + ' forward.');
      }
    }
    var doneGoals = goals.filter(function (g) { return g.target > 0 && g.saved >= g.target; });
    if (doneGoals.length) {
      add('good', '🎉', doneGoals[0].name + ' reached',
          doneGoals.length === 1 ? 'Goal hit — take the win, then set the next one.'
                                 : doneGoals.length + ' goals reached. That is the Grow part of the tagline working.');
    }

    /* ── 8. weekly shape ───────────────────────────────────────── */
    var wk = t.weekly;
    var active = wk.map(function (v, i) { return { v: v, i: i }; }).filter(function (x) { return x.v > 0; });
    if (active.length >= 2) {
      var maxW = active.reduce(function (a, b) { return b.v > a.v ? b : a; });
      var totalW = wk.reduce(function (s, v) { return s + v; }, 0);
      if (maxW.v / totalW > 0.45) {
        add('info', '🗓️', 'Week ' + (maxW.i + 1) + ' carries the month',
            (Math.round(maxW.v / totalW * 100)) + '% of this month\'s spending landed in week ' +
            (maxW.i + 1) + '. If that is rent-week, fine — if not, it is the week to watch.');
      }
    }

    /* ── 9. quiet nudges ───────────────────────────────────────── */
    if (t.income === 0 && isCurrent) {
      add('info', '✏️', 'Set your income first',
          'Everything — pace, safe-to-spend, savings rate — is measured against income. Add it in Plan.');
    }
    if (t.income > 0 && t.budgetTotal === 0) {
      add('info', '📋', 'No category budgets yet',
          'You have an income but no plan. Give every dollar a job in Plan — start with the big four: Home, Groceries, Transport, Tithe.');
    }
    if (t.income > 0 && t.budgetTotal > t.income) {
      add('warn', '⚖️', 'Plan exceeds income',
          'Your categories add up to ' + money(t.budgetTotal) + ' but income is ' + money(t.income) +
          '. Trim ' + money(t.budgetTotal - t.income) + ' somewhere, or the month decides for you.');
    }
    if (isCurrent && t.count >= 8 && t.spent > 0) {
      var small = t.byCategory.slice().sort(function (a, b) { return b.spent - a.spent; })
        .filter(function (c) { return c.spent > 0 && c.spent / t.spent < 0.12; });
      if (small.length >= 3) {
        var drip = small.reduce(function (s, c) { return s + c.spent; }, 0);
        add('info', '💧', 'Small leaks add up',
            money(drip) + ' is spread across ' + small.length +
            ' small categories (' + small.slice(0, 3).map(function (c) { return c.name; }).join(', ') +
            '…). Individually nothing — together a goal payment.');
      }
    }

    /* ── 10. month review (past months / late month) ───────────── */
    if (!isCurrent && t.spent >= 0 && t.income > 0) {
      var verdict = t.remaining >= t.income * 0.2 ? 'A strong month — you finished with real margin.'
                  : t.remaining >= 0 ? 'A safe month — everything stayed covered.'
                  : 'A hard month — spending outran income.';
      add(t.remaining >= 0 ? 'good' : 'bad', '🧮', label + ' in one line',
          verdict + ' Income ' + money(t.income) + ', spent ' + money(t.spent) +
          ', ' + (t.remaining >= 0 ? 'kept' : 'over by') + ' ' + money(Math.abs(t.remaining)) + '.');
    }

    return pick(out);
  }

  /* The single most urgent insight, for the dashboard card. */
  function headline(insights) {
    if (!insights || !insights.length) return null;
    var rank = { bad: 0, warn: 1, info: 2, good: 3 };
    return insights.slice().sort(function (a, b) { return rank[a.tone] - rank[b.tone]; })[0];
  }

  global.RMInsights = { generate: generate, headline: headline };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports !== undefined) module.exports = globalThis.RMInsights;
