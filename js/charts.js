/* RongaMari charts — hand-rolled SVG, no library, no network.
 *
 * Three shapes cover everything the app shows: a progress ring for the month,
 * seven-day-block bars for weekly spending, and a six-month trend. All return
 * SVG markup strings so tests can assert on them and the DOM code stays thin.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtShort(n) {
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }

  /* ── progress ring ─────────────────────────────────────────────── */
  function ring(pct, opts) {
    opts = opts || {};
    var size = opts.size || 96;
    var stroke = opts.stroke || 9;
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    var dash = c * p / 100;
    var color = opts.color;
    if (!color) color = p > 100 ? '#C94F4F' : p >= 80 ? '#B97F1C' : '#3F9C35';
    var label = opts.label != null ? opts.label : Math.round(p) + '%';
    var sub = opts.sub || '';
    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + esc(label) + ' used">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#EDF2EB" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '"' +
      ' stroke-linecap="round" stroke-dasharray="' + dash.toFixed(1) + ' ' + c.toFixed(1) + '"' +
      ' transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="50%" y="' + (sub ? '46%' : '54%') + '" text-anchor="middle" font-size="' + (size * 0.21) + '" font-weight="800" fill="#15251B">' + esc(label) + '</text>' +
      (sub ? '<text x="50%" y="63%" text-anchor="middle" font-size="' + (size * 0.115) + '" font-weight="650" fill="#66756B">' + esc(sub) + '</text>' : '') +
      '</svg>'
    );
  }

  /* ── weekly bars (five fixed blocks) ───────────────────────────── */
  function weeklyBars(values, opts) {
    opts = opts || {};
    var labels = opts.labels || ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', 'Wk 5'];
    var W = 320, H = 120, padB = 22, padT = 18;
    var max = Math.max.apply(null, values.concat([1]));
    var n = values.length;
    var gap = 10;
    var bw = (W - gap * (n - 1)) / n;
    var parts = [];

    values.forEach(function (v, i) {
      var h = Math.max(v > 0 ? 5 : 2, (H - padB - padT) * (v / max));
      var x = i * (bw + gap);
      var y = H - padB - h;
      var isMax = v > 0 && v === max;
      parts.push(
        '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="6" fill="' +
        (v > 0 ? (isMax ? '#157A3C' : '#7FBF6A') : '#E4E9E3') + '"/>'
      );
      parts.push(
        '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" font-size="9.5" font-weight="700" fill="' +
        (v > 0 ? '#15251B' : '#93A299') + '">' + (v > 0 ? esc(opts.money ? opts.money(v) : fmtShort(v)) : '–') + '</text>'
      );
      parts.push(
        '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="9.5" font-weight="650" fill="#66756B">' + esc(labels[i]) + '</text>'
      );
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Weekly spending">' + parts.join('') + '</svg>';
  }

  /* ── six-month trend ───────────────────────────────────────────── */
  function trendBars(points, opts) {
    opts = opts || {};
    var W = 320, H = 150, padB = 22, padT = 20;
    var max = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([1]));
    var n = points.length;
    var gap = 12;
    var bw = (W - gap * (n - 1)) / n;
    var parts = [];

    points.forEach(function (p, i) {
      var h = Math.max(p.value > 0 ? 5 : 2, (H - padB - padT) * (p.value / max));
      var x = i * (bw + gap);
      var y = H - padB - h;
      var isCur = i === n - 1;
      parts.push(
        '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="6" fill="' +
        (p.value > 0 ? (isCur ? '#0A4D22' : '#8CC63F') : '#E4E9E3') + '"/>'
      );
      if (p.value > 0) {
        parts.push(
          '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#15251B">' +
          esc(opts.money ? opts.money(p.value) : fmtShort(p.value)) + '</text>'
        );
      }
      parts.push(
        '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="9" font-weight="650" fill="' +
        (isCur ? '#0A4D22' : '#66756B') + '">' + esc(p.label) + '</text>'
      );
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Six month spending trend">' + parts.join('') + '</svg>';
  }

  global.RMCharts = { ring: ring, weeklyBars: weeklyBars, trendBars: trendBars, fmtShort: fmtShort };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports !== undefined) module.exports = globalThis.RMCharts;
