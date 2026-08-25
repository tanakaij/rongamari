/* RongaMari document export.
 *
 * window.print() does nothing inside Capacitor's WebView — no print handler is
 * wired up — so the app writes real files itself, fully offline, with no
 * libraries:
 *
 *   - a real PDF, byte by byte against the PDF 1.4 spec using the 14 base
 *     fonts (Helvetica metrics are embedded below so text wraps honestly);
 *   - a real .xlsx — an OOXML package inside a ZIP, written with a stored
 *     (uncompressed) ZIP writer. Excel, Numbers and Google Sheets all open it.
 *
 * On Android the files are saved through Capacitor's Filesystem plugin into
 * Documents/RongaMari/ (visible in Files and over USB), with an offer to share
 * straight from the save dialog. Everywhere else: a normal blob download.
 */
(function (global) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     1. TEXT — WinAnsi encoding, Helvetica metrics, greedy wrap
     ═══════════════════════════════════════════════════════════════ */
  var WINANSI = {
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
    0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85, 0x2022: 0x95,
    0x00B7: 0xB7, 0x20AC: 0x80
  };
  var FOLD = { 0x2192: '->', 0x2190: '<-', 0x00A0: ' ', 0x2212: '-' };

  function toWinAnsi(str) {
    var out = '';
    str = String(str == null ? '' : str);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) { out += str[i]; continue; }
      if (FOLD[c]) { out += FOLD[c]; continue; }
      if (WINANSI[c]) { out += String.fromCharCode(WINANSI[c]); continue; }
      if (c <= 255) { out += String.fromCharCode(c); continue; }
      /* Emoji and symbols the base-14 fonts cannot draw (the category icons)
         vanish rather than printing as "??" — a label that reads "Home"
         beats one that reads "?? Home". */
      if (c >= 0xD800 && c <= 0xDFFF) { out += ''; continue; }  // surrogate half
      out += '';
    }
    return out;
  }

  /* collapse the whitespace an emptied icon leaves behind */
  function tidy(str) {
    return String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
  }

  var W_HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
    667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    278,278,278,469,556,333,
    556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
    334,260,334,584];
  var W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
    722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    333,278,333,584,556,333,
    556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
    389,280,389,584];

  function widthOf(text, font, size) {
    text = toWinAnsi(text);
    if (font === 'mono' || font === 'monob') return text.length * 0.6 * size;
    var table = font === 'bold' ? W_BOLD : W_HELV;
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      var w = (c >= 32 && c <= 126) ? table[c - 32] : (c === 32 ? 278 : 556);
      total += w == null ? 556 : w;
    }
    return total * size / 1000;
  }

  function wrap(text, font, size, maxWidth) {
    var lines = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(function (w) { return w.length; });
      if (!words.length) { lines.push(''); return; }
      var line = '';
      words.forEach(function (word) {
        while (widthOf(word, font, size) > maxWidth) {
          var cut = word.length;
          while (cut > 1 && widthOf(word.slice(0, cut), font, size) > maxWidth) cut--;
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        var probe = line ? line + ' ' + word : word;
        if (widthOf(probe, font, size) <= maxWidth) line = probe;
        else { if (line) lines.push(line); line = word; }
      });
      if (line) lines.push(line);
    });
    return lines;
  }

  function clip(text, font, size, maxWidth) {
    var t = String(text == null ? '' : text);
    if (widthOf(t, font, size) <= maxWidth) return t;
    while (t.length > 1 && widthOf(t + '…', font, size) > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  /* ═══════════════════════════════════════════════════════════════
     2. PDF DOCUMENT
     ═══════════════════════════════════════════════════════════════ */
  var FONT_RES = { reg: '/F1', bold: '/F2', obl: '/F3', mono: '/F4', monob: '/F5' };
  var INK = [0.082, 0.145, 0.106];
  var MUTED = [0.40, 0.46, 0.42];
  var FAINT = [0.58, 0.64, 0.60];
  var RULE = [0.87, 0.90, 0.87];
  var GREEN = [0.039, 0.302, 0.133];     // #0A4D22
  var GREEN2 = [0.243, 0.612, 0.208];    // #3F9C35
  var WASH = [0.949, 0.973, 0.937];      // #F2F8EF
  var RED = [0.788, 0.310, 0.310];
  var AMBER = [0.725, 0.498, 0.110];

  function pdfString(s) {
    return toWinAnsi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
  function n(v) { return (Math.round(v * 100) / 100).toString(); }

  function Doc(opts) {
    opts = opts || {};
    this.W = 595.28; this.H = 841.89; this.M = 46;
    this.footerText = opts.footer || '';
    this.pages = [];
    this.buf = null;
    this.newPage();
  }
  Doc.prototype.newPage = function () {
    if (this.buf) this.pages.push(this.buf.join('\n'));
    this.buf = [];
    this.y = this.M;
  };
  Doc.prototype.right = function () { return this.W - this.M; };
  Doc.prototype.cw = function () { return this.W - this.M * 2; };
  Doc.prototype.limit = function () { return this.H - this.M - 26; };
  Doc.prototype.room = function (h) { return this.y + h <= this.limit(); };
  Doc.prototype.ensure = function (h) { if (!this.room(h)) this.newPage(); };
  Doc.prototype.op = function (s) { this.buf.push(s); };
  Doc.prototype.fill = function (c) { this.op(n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]) + ' rg'); };
  Doc.prototype.textAt = function (text, x, yTop, o) {
    o = o || {};
    var size = o.size || 10, font = o.font || 'reg';
    this.fill(o.color || INK);
    var baseline = this.H - yTop - size;
    var extra = o.tracking ? ' ' + n(o.tracking) + ' Tc' : '';
    this.op('BT ' + FONT_RES[font] + ' ' + n(size) + ' Tf' + extra +
            ' 1 0 0 1 ' + n(x) + ' ' + n(baseline) + ' Tm (' + pdfString(text) + ') Tj ET');
    if (o.tracking) this.op('BT 0 Tc ET');
  };
  Doc.prototype.textRight = function (text, right, yTop, o) {
    o = o || {};
    var w = widthOf(text, o.font || 'reg', o.size || 10);
    this.textAt(text, right - w, yTop, o);
  };
  Doc.prototype.rect = function (x, yTop, w, h, color) {
    this.fill(color);
    this.op(n(x) + ' ' + n(this.H - yTop - h) + ' ' + n(w) + ' ' + n(h) + ' re f');
  };
  Doc.prototype.hline = function (x1, x2, yTop, color, width) {
    this.op(n((color || RULE)[0]) + ' ' + n((color || RULE)[1]) + ' ' + n((color || RULE)[2]) + ' RG');
    this.op(n(width || 0.6) + ' w ' + n(x1) + ' ' + n(this.H - yTop) + ' m ' + n(x2) + ' ' + n(this.H - yTop) + ' l S');
  };
  Doc.prototype.para = function (text, x, width, o) {
    o = o || {};
    var size = o.size || 10;
    var lead = o.lead || size * 1.35;
    var lines = wrap(text, o.font || 'reg', size, width);
    for (var i = 0; i < lines.length; i++) {
      if (!this.room(lead)) this.newPage();
      this.textAt(lines[i], x, this.y, o);
      this.y += lead;
    }
  };
  Doc.prototype.mark = function (x, yTop, s) {
    /* the brand block: rounded square + R, drawn as vectors */
    this.rect(x, yTop, s, s, GREEN);
    var r = s * 0.62;
    this.fill([1, 1, 1]);
    this.op('BT ' + FONT_RES.bold + ' ' + n(r) + ' Tf 1 0 0 1 ' +
            n(x + s * 0.26) + ' ' + n(this.H - yTop - s * 0.72) + ' Tm (R) Tj ET');
  };
  Doc.prototype.section = function (title, sub) {
    this.ensure(40);
    this.y += 10;
    this.textAt(title.toUpperCase(), this.M, this.y, { size: 9.5, font: 'bold', color: GREEN, tracking: 1.2 });
    if (sub) this.textRight(sub, this.right(), this.y, { size: 8.5, color: FAINT });
    this.y += 16;
    this.hline(this.M, this.right(), this.y, GREEN2, 1.1);
    this.y += 8;
  };
  Doc.prototype.stampFooters = function () {
    this.pages.push(this.buf.join('\n'));
    this.buf = null;
    var total = this.pages.length;
    var self = this;
    return this.pages.map(function (content, i) {
      var parts = [content];
      var y = 32;
      parts.push(n(RULE[0]) + ' ' + n(RULE[1]) + ' ' + n(RULE[2]) + ' RG');
      parts.push('0.6 w ' + n(self.M) + ' ' + (y + 13) + ' m ' + n(self.right()) + ' ' + (y + 13) + ' l S');
      parts.push(n(FAINT[0]) + ' ' + n(FAINT[1]) + ' ' + n(FAINT[2]) + ' rg');
      parts.push('BT /F1 7.5 Tf 1 0 0 1 ' + n(self.M) + ' ' + y + ' Tm (' +
                 pdfString(self.footerText) + ') Tj ET');
      var label = 'Page ' + (i + 1) + ' of ' + total;
      parts.push('BT /F1 7.5 Tf 1 0 0 1 ' + n(self.right() - widthOf(label, 'reg', 7.5)) + ' ' + y +
                 ' Tm (' + pdfString(label) + ') Tj ET');
      return parts.join('\n');
    });
  };
  Doc.prototype.build = function (meta) {
    meta = meta || {};
    var pages = this.stampFooters();
    var objects = [];
    var FONT_BASE = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Courier', 'Courier-Bold'];
    var firstPageObj = 3 + FONT_BASE.length + 1;
    var kids = [];
    for (var p = 0; p < pages.length; p++) kids.push((firstPageObj + p * 2) + ' 0 R');

    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + '] >>');
    objects.push('<< /Title (' + pdfString(meta.title || 'RongaMari Budget Statement') + ')' +
                 ' /Author (RongaMari) /Creator (RongaMari) /Producer (RongaMari) >>');
    FONT_BASE.forEach(function (base) {
      objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /' + base + ' /Encoding /WinAnsiEncoding >>');
    });
    var fontDict = FONT_BASE.map(function (_, i) { return '/F' + (i + 1) + ' ' + (4 + i) + ' 0 R'; }).join(' ');

    var self = this;
    pages.forEach(function (content, i) {
      var pageObj = firstPageObj + i * 2;
      objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + n(self.W) + ' ' + n(self.H) + ']' +
                   ' /Resources << /Font << ' + fontDict + ' >> >>' +
                   ' /Contents ' + (pageObj + 1) + ' 0 R >>');
      objects.push({ stream: content });
    });

    var out = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
    var offsets = [];
    var pos = out[0].length;
    objects.forEach(function (obj, i) {
      var body;
      if (typeof obj === 'object' && obj.stream != null) {
        body = (i + 1) + ' 0 obj\n<< /Length ' + obj.stream.length + ' >>\nstream\n' + obj.stream + '\nendstream\nendobj\n';
      } else {
        body = (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
      }
      offsets.push(pos);
      out.push(body);
      pos += body.length;
    });
    var xrefPos = pos;
    var xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) {
      xref += String(o).padStart(10, '0') + ' 00000 n \n';
    });
    xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Info 3 0 R >>\n' +
            'startxref\n' + xrefPos + '\n%%EOF\n';
    out.push(xref);
    return latin1Bytes(out.join(''));
  };

  function latin1Bytes(str) {
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xFF;
    return bytes;
  }
  function utf8Bytes(str) {
    if (global.TextEncoder) return new global.TextEncoder().encode(str);
    return latin1Bytes(unescape(encodeURIComponent(str)));
  }

  /* ═══════════════════════════════════════════════════════════════
     3. THE STATEMENT (PDF)
     ═══════════════════════════════════════════════════════════════ */
  function buildStatementPdf(m) {
    var doc = new Doc({ footer: 'RongaMari · Plan. Spend. Save. Grow.' + (m.person ? '  ·  ' + m.person : '') });
    var M = doc.M, R = doc.right();

    /* masthead */
    doc.mark(M, M - 6, 26);
    doc.textAt(m.eyebrow, M + 34, M - 4, { size: 8, color: MUTED, font: 'bold', tracking: 1.1 });
    doc.textAt('Monthly Budget Statement', M + 34, M + 6, { size: 17, font: 'bold' });
    doc.textRight(m.generated, R, M - 4, { size: 8, color: FAINT });
    doc.textRight(m.period, R, M + 8, { size: 11, font: 'bold', color: GREEN });
    doc.y = M + 40;
    doc.hline(M, R, doc.y, INK, 1.3);
    doc.y += 10;

    /* summary strip — the invoice header block */
    var stripH = 44;
    doc.rect(M, doc.y, R - M, stripH, WASH);
    var cells = [
      { label: 'INCOME', value: m.money(m.tot.income) },
      { label: 'SPENT', value: m.money(m.tot.spent) },
      { label: 'REMAINING', value: m.money(m.tot.remaining), color: m.tot.remaining < 0 ? RED : GREEN },
      { label: 'SAVINGS RATE', value: m.tot.savingsRate + '%' }
    ];
    var cellW = (R - M) / 4;
    cells.forEach(function (c, i) {
      var cx = M + cellW * i + 12;
      doc.textAt(c.label, cx, doc.y + 9, { size: 6.8, color: FAINT, font: 'bold', tracking: 0.8 });
      doc.textAt(clip(c.value, 'bold', 11.5, cellW - 18), cx, doc.y + 21,
                 { size: 11.5, font: 'bold', color: c.color || INK });
      if (i) {
        doc.op('0.85 0.88 0.85 RG 0.6 w ' + n(M + cellW * i) + ' ' + n(doc.H - doc.y - 8) +
               ' m ' + n(M + cellW * i) + ' ' + n(doc.H - doc.y - stripH + 8) + ' l S');
      }
    });
    doc.y += stripH + 6;
    doc.para(m.subline, M, doc.cw(), { size: 9, color: MUTED, font: 'obl', lead: 12 });

    /* budget vs actual */
    if (m.tot.byCategory.length) {
      doc.section('Budget vs actual', 'planned · spent · left');
      var cols = [
        { x: M + 6, w: 0.34, label: 'Category' },
        { x: M + 6 + (R - M) * 0.34, w: 0.155, label: 'Budget', right: true },
        { x: M + 6 + (R - M) * 0.495, w: 0.155, label: 'Spent', right: true },
        { x: M + 6 + (R - M) * 0.65, w: 0.155, label: 'Left', right: true },
        { x: M + 6 + (R - M) * 0.805, w: 0.19, label: 'Used', right: true }
      ];
      doc.y += 2;
      cols.forEach(function (c) {
        doc.textAt(c.label, c.right ? c.x - widthOf(c.label, 'bold', 8) : c.x, doc.y,
                   { size: 8, font: 'bold', color: FAINT, tracking: 0.5 });
      });
      doc.y += 13;
      doc.hline(M, R, doc.y, RULE, 0.7);
      doc.y += 7;

      var rows = m.tot.byCategory.slice().sort(function (a, b) { return b.spent - a.spent; });
      rows.forEach(function (c, idx) {
        if (!doc.room(24)) doc.newPage();
        if (idx % 2 === 1) doc.rect(M, doc.y - 3, R - M, 20, WASH);
        var colW = (R - M) * 0.155;
        doc.textAt(clip(tidy(c.icon + ' ' + c.name), 'bold', 9.5, (R - M) * 0.32), cols[0].x, doc.y, { size: 9.5, font: 'bold' });
        doc.textRight(m.money(c.budget), cols[1].x, doc.y, { size: 9.5, color: MUTED });
        doc.textRight(m.money(c.spent), cols[2].x, doc.y, { size: 9.5, font: 'bold' });
        doc.textRight(m.money(c.remaining), cols[3].x, doc.y,
                      { size: 9.5, color: c.remaining < 0 ? RED : MUTED });

        /* usage bar */
        var bx = cols[4].x - 62, bw2 = 62;
        doc.rect(bx, doc.y + 2, bw2, 5, [0.90, 0.92, 0.89]);
        var pct = Math.min(100, c.pct);
        doc.rect(bx, doc.y + 2, Math.max(pct > 0 ? 3 : 0, bw2 * pct / 100), 5,
                 c.pct > 100 ? RED : c.pct >= 80 ? AMBER : GREEN2);
        doc.textRight(c.pct + '%', cols[4].x, doc.y - 1, { size: 8, font: 'mono', color: c.pct > 100 ? RED : FAINT });
        doc.y += 20;
      });

      doc.y += 2;
      doc.hline(M, R, doc.y, RULE, 0.7);
      doc.y += 7;
      doc.textAt('TOTAL', M + 6, doc.y, { size: 9.5, font: 'bold' });
      doc.textRight(m.money(m.tot.budgetTotal), cols[1].x, doc.y, { size: 9.5, font: 'bold' });
      doc.textRight(m.money(m.tot.spent), cols[2].x, doc.y, { size: 9.5, font: 'bold' });
      doc.textRight(m.money(m.tot.budgetTotal - m.tot.spent), cols[3].x, doc.y,
                    { size: 9.5, font: 'bold', color: m.tot.budgetTotal - m.tot.spent < 0 ? RED : GREEN });
      doc.y += 14;
    }

    /* transactions by week */
    if (m.weeks.length) {
      doc.section('Transactions', m.txCount + ' logged');
      m.weeks.forEach(function (wk) {
        if (!doc.room(30 + Math.min(wk.rows.length, 40) * 14)) doc.newPage();
        doc.textAt('WEEK ' + wk.no + '  ·  ' + wk.range, M + 6, doc.y,
                   { size: 8, font: 'bold', color: GREEN2, tracking: 0.8 });
        doc.textRight(m.money(wk.total), R - 6, doc.y, { size: 8.5, font: 'monob', color: INK });
        doc.y += 14;
        wk.rows.forEach(function (t) {
          if (!doc.room(15)) doc.newPage();
          doc.textAt(t.dateLabel, M + 6, doc.y, { size: 8, font: 'mono', color: FAINT });
          doc.textAt(clip(tidy((t.icon ? t.icon + ' ' : '') + t.label), 'reg', 9, (R - M) * 0.62), M + 48, doc.y, { size: 9 });
          doc.textRight((t.type === 'income' ? '+' : '') + m.money(t.amount), R - 6, doc.y,
                        { size: 9, font: 'bold', color: t.type === 'income' ? GREEN2 : INK });
          doc.y += 14;
        });
        doc.y += 4;
      });
    }

    /* debts */
    if (m.debts.length) {
      doc.section('Borrowed & lent', 'outstanding');
      m.debts.forEach(function (d) {
        if (!doc.room(26)) doc.newPage();
        var tone = d.status === 'overdue' ? RED : d.status === 'paid' ? GREEN2 : INK;
        doc.textAt(clip(d.person, 'bold', 9.5, (R - M) * 0.4), M + 6, doc.y, { size: 9.5, font: 'bold' });
        doc.textAt(d.dirLabel, M + 6 + (R - M) * 0.30, doc.y, { size: 8.5, color: MUTED });
        doc.textRight(m.money(d.remaining) + '  ' + d.statusLabel, R - 6, doc.y,
                      { size: 9, font: 'bold', color: tone });
        doc.y += 12;
        doc.textAt(d.dateLine, M + 6, doc.y, { size: 8, color: FAINT });
        doc.textRight(m.money(d.paid) + ' paid of ' + m.money(d.amount), R - 6, doc.y, { size: 8, color: FAINT });
        doc.y += 15;
      });
    }

    /* goals */
    if (m.goals.length) {
      doc.section('Savings goals');
      m.goals.forEach(function (g) {
        if (!doc.room(26)) doc.newPage();
        doc.textAt(clip(tidy(g.icon + ' ' + g.name), 'bold', 9.5, (R - M) * 0.5), M + 6, doc.y, { size: 9.5, font: 'bold' });
        doc.textRight(money2(g.saved, m.currency) + ' / ' + money2(g.target, m.currency) +
                      '  (' + g.pct + '%)', R - 6, doc.y, { size: 9, font: 'bold', color: GREEN2 });
        doc.y += 10;
        var bw2 = R - M - 12;
        doc.rect(M + 6, doc.y, bw2, 4.5, [0.90, 0.92, 0.89]);
        doc.rect(M + 6, doc.y, Math.max(g.pct > 0 ? 3 : 0, bw2 * Math.min(100, g.pct) / 100), 4.5, GREEN2);
        doc.y += 14;
      });
    }

    /* insights */
    if (m.insights.length) {
      doc.section('What RongaMari noticed');
      m.insights.forEach(function (ins) {
        var lines = wrap(ins.title + ' — ' + ins.body, 'reg', 9.5, doc.cw() - 14);
        if (!doc.room(lines.length * 12.5 + 8)) doc.newPage();
        doc.rect(M + 3, doc.y + 1, 3, lines.length * 12.5 + 2,
                 ins.tone === 'bad' ? RED : ins.tone === 'warn' ? AMBER : GREEN2);
        lines.forEach(function (ln) {
          doc.textAt(ln, M + 14, doc.y, { size: 9.5, color: INK });
          doc.y += 12.5;
        });
        doc.y += 6;
      });
    }

    return doc.build({ title: 'RongaMari Budget Statement ' + m.period });
  }

  function money2(v, cur) {
    var neg = v < 0;
    var s = cur + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return neg ? '-' + s : s;
  }

  /* ═══════════════════════════════════════════════════════════════
     4. ZIP (stored) + XLSX
     ═══════════════════════════════════════════════════════════════ */
  var CRC_TABLE = (function () {
    var t = new Int32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = -1;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function zip(entries) {
    var chunks = [];
    var central = [];
    var offset = 0;
    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

    entries.forEach(function (e) {
      var nameBytes = utf8Bytes(e.name);
      var data = e.data;
      var sum = crc32(data);
      /* 0x21 = 1 Jan 1980 — a zeroed DOS date is rejected by strict unzippers */
      var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x0021),
                            u32(sum), u32(data.length), u32(data.length),
                            u16(nameBytes.length), u16(0));
      chunks.push(new Uint8Array(local), nameBytes, data);
      central.push({ name: nameBytes, crc: sum, size: data.length, offset: offset });
      offset += local.length + nameBytes.length + data.length;
    });

    var centralStart = offset;
    var centralSize = 0;
    central.forEach(function (c) {
      var head = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x0021),
                           u32(c.crc), u32(c.size), u32(c.size),
                           u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset));
      chunks.push(new Uint8Array(head), c.name);
      centralSize += head.length + c.name.length;
    });
    chunks.push(new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(centralSize), u32(centralStart), u16(0))));

    var total = chunks.reduce(function (t, c) { return t + c.length; }, 0);
    var out = new Uint8Array(total);
    var at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  function xml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      /* strip control characters XML cannot carry */
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  /* cell types: s=string, n=number, f=formula */
  function cell(ref, v, style) {
    if (v == null || v === '') return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '/>';
    if (typeof v === 'number' && isFinite(v)) {
      return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '><v>' + v + '</v></c>';
    }
    if (typeof v === 'string' && v[0] === '=') {
      return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '><f>' + xml(v.slice(1)) + '</f></c>';
    }
    return '<c r="' + ref + '" t="inlineStr"' + (style ? ' s="' + style + '"' : '') +
           '><is><t>' + xml(v) + '</t></is></c>';
  }

  function colName(i) {
    var s = '';
    i++;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; }
    return s;
  }

  function sheetXml(rows, widths, freeze) {
    var cols = widths ? '<cols>' + widths.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('') + '</cols>' : '';
    var body = rows.map(function (row, r) {
      return '<row r="' + (r + 1) + '">' +
        row.map(function (v, c) {
          var style = null;
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            style = v.s; v = v.v;
          }
          return cell(colName(c) + (r + 1), v, style);
        }).join('') + '</row>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><outlinePr/></sheetPr>' +
      '<sheetViews><sheetView' + (freeze ? ' ySplit="' + freeze + '" topLeftCell="A' + (freeze + 1) + '" pane="bottomLeft" state="frozen"' : '') +
      ' workbookViewId="0"><selection pane="bottomLeft" activeCell="A1" sqref="A1"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' + cols +
      '<sheetData>' + body + '</sheetData></worksheet>';
  }

  /* styles: 0 default · 1 header · 2 money · 3 money-bold · 4 bold · 5 title · 6 int · 7 good · 8 bad · 9 muted */
  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="6">' +
        '<font><sz val="11"/><color rgb="FF15251B"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="14"/><color rgb="FF0A4D22"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FF15251B"/><name val="Calibri"/></font>' +
        '<font><sz val="10"/><color rgb="FF66756B"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FF0A4D22"/><name val="Calibri"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF0A4D22"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F8EF"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="10">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                   /* 0 */
        '<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +        /* 1 header */
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +            /* 2 money */
        '<xf numFmtId="164" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' + /* 3 money bold */
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                      /* 4 bold */
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                      /* 5 title */
        '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +              /* 6 int */
        '<xf numFmtId="164" fontId="5" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' + /* 7 money green */
        '<xf numFmtId="164" fontId="3" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' + /* 8 money on wash */
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                      /* 9 muted */
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function buildWorkbookXlsx(m) {
    var M2 = { s: 2 };
    var M3 = { s: 3 };
    var M8 = { s: 8 };
    var MU = { s: 9 };
    var I6 = { s: 6 };

    /* ── Summary ── */
    var sum = [
      [{ v: 'RongaMari — Monthly Budget', s: 5 }],
      [{ v: m.period, s: 4 }, '', { v: 'Generated ' + m.generated, s: 9 }],
      [''],
      ['INCOME', { v: m.tot.income, s: 3 }],
      ['Spent', { v: m.tot.spent, s: 3 }],
      ['Remaining', { v: m.tot.remaining, s: m.tot.remaining < 0 ? { s: 3 } : { s: 7 } }],
      ['Savings rate', { v: m.tot.savingsRate / 100 }],
      [''],
      ['Budgeted across categories', { v: m.tot.budgetTotal, s: 2 }],
      ['Unallocated income', { v: m.tot.unallocated, s: 2 }],
      ['Transactions logged', { v: m.txCount, s: 6 }],
      ['Safe extra spending per day (rest of month)', { v: m.tot.safeExtraPerDay || 0, s: 2 }],
      ['Average spend per day', { v: m.tot.avgPerDay, s: 2 }],
      [''],
      ['Week 1', { v: m.tot.weekly[0], s: 2 }],
      ['Week 2', { v: m.tot.weekly[1], s: 2 }],
      ['Week 3', { v: m.tot.weekly[2], s: 2 }],
      ['Week 4', { v: m.tot.weekly[3], s: 2 }],
      ['Week 5', { v: m.tot.weekly[4], s: 2 }],
      [''],
      ['Plan. Spend. Save. Grow.', MU]
    ];

    /* ── Budget ── */
    var bud = [['Category', 'Icon', 'Budget', 'Spent', 'Remaining', '% used'].map(function (h) { return { v: h, s: 1 }; })];
    m.tot.byCategory.forEach(function (c) {
      bud.push([c.name, c.icon, { v: c.budget, s: 2 }, { v: c.spent, s: 2 },
                { v: c.remaining, s: 2 }, { v: c.pct / 100 }]);
    });
    bud.push(['TOTAL', '', { v: m.tot.budgetTotal, s: 3 }, { v: m.tot.spent, s: 3 },
              { v: m.tot.budgetTotal - m.tot.spent, s: 3 }]);

    /* ── Transactions ── */
    var txs = [['Date', 'Week', 'Type', 'Category', 'Note', 'Amount'].map(function (h) { return { v: h, s: 1 }; })];
    m.allTx.forEach(function (t) {
      txs.push([t.date, t.week + 1, t.type, t.categoryName, t.note || '',
                { v: t.type === 'income' ? t.amount : -t.amount, s: 2 }]);
    });
    if (m.allTx.length) {
      txs.push(['', '', '', '', 'NET', { v: m.tot.income - m.tot.spent, s: 3 }]);
    }

    /* ── Debts ── */
    var dts = [['Direction', 'Person', 'Amount', 'Paid', 'Remaining', 'Started', 'Due', 'Status', 'Note'].map(function (h) { return { v: h, s: 1 }; })];
    m.debts.forEach(function (d) {
      dts.push([d.dirLabel, d.person, { v: d.amount, s: 2 }, { v: d.paid, s: 2 },
                { v: d.remaining, s: 2 }, d.startDate, d.dueDate || '', d.statusLabel, d.note || '']);
    });
    dts.push(['', 'TOTAL OUTSTANDING', '', '', { v: m.debtsOutstanding, s: 3 }]);

    /* ── Goals ── */
    var gls = [['Goal', 'Icon', 'Target', 'Saved', 'Remaining', '% done', 'Deadline'].map(function (h) { return { v: h, s: 1 }; })];
    m.goals.forEach(function (g) {
      gls.push([g.name, g.icon, { v: g.target, s: 2 }, { v: g.saved, s: 2 },
                { v: g.target - g.saved, s: 2 }, { v: g.pct / 100 }, g.deadline || '']);
    });
    gls.push(['TOTAL', '', { v: m.goalsTarget, s: 3 }, { v: m.goalsSaved, s: 3 }]);

    var sheets = [
      { name: 'Summary', rows: sum },
      { name: 'Budget', rows: bud, freeze: 1 },
      { name: 'Transactions', rows: txs, freeze: 1 },
      { name: 'Debts', rows: dts, freeze: 1 },
      { name: 'Goals', rows: gls, freeze: 1 }
    ];

    var entries = [];
    var sheetXmls = sheets.map(function (sh, i) {
      return sheetXml(sh.rows, [22, 14, 12, 18, 14, 12, 14], sh.freeze);
    });

    entries.push({ name: '[Content_Types].xml', data: utf8Bytes(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (_, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>') });

    entries.push({ name: '_rels/.rels', data: utf8Bytes(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>') });

    entries.push({ name: 'docProps/core.xml', data: utf8Bytes(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + xml('RongaMari Budget ' + m.period) + '</dc:title>' +
      '<dc:creator>RongaMari</dc:creator><cp:lastModifiedBy>RongaMari</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + m.stamp + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + m.stamp + '</dcterms:modified>' +
      '</cp:coreProperties>') });

    entries.push({ name: 'xl/workbook.xml', data: utf8Bytes(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheets.map(function (sh, i) {
        return '<sheet name="' + xml(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>') });

    entries.push({ name: 'xl/_rels/workbook.xml.rels', data: utf8Bytes(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (_, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>') });

    entries.push({ name: 'xl/styles.xml', data: utf8Bytes(stylesXml()) });
    sheetXmls.forEach(function (sx, i) {
      entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: utf8Bytes(sx) });
    });

    return zip(entries);
  }

  /* ═══════════════════════════════════════════════════════════════
     5. SAVING — Capacitor Filesystem first, blob download fallback
     ═══════════════════════════════════════════════════════════════ */
  function plugins() {
    return (global.Capacitor && global.Capacitor.Plugins) || {};
  }
  function isNative() {
    return !!(global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' &&
              global.Capacitor.isNativePlatform() && plugins().Filesystem);
  }
  function toBase64(bytes) {
    var chunk = 0x8000, parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return global.btoa(parts.join(''));
  }
  function askPermission(FS) {
    if (!FS.checkPermissions) return Promise.resolve();
    return FS.checkPermissions().then(function (res) {
      if (res && res.publicStorage === 'granted') return;
      if (!FS.requestPermissions) return;
      return FS.requestPermissions();
    }).catch(function () {});
  }
  function saveNative(filename, bytes) {
    var FS = plugins().Filesystem;
    var data = toBase64(bytes);
    var attempts = [
      { directory: 'DOCUMENTS', label: 'Documents/RongaMari', path: 'RongaMari/' + filename },
      { directory: 'EXTERNAL_STORAGE', label: 'Documents/RongaMari', path: 'Documents/RongaMari/' + filename },
      { directory: 'EXTERNAL', label: 'RongaMari', path: 'RongaMari/' + filename },
      { directory: 'DATA', label: 'app storage', path: 'RongaMari/' + filename }
    ];
    return askPermission(FS).then(function () {
      var chain = Promise.reject();
      attempts.forEach(function (a) {
        chain = chain.catch(function () {
          return FS.writeFile({ path: a.path, data: data, directory: a.directory, recursive: true })
            .then(function (res) { return { where: a.label, uri: (res && res.uri) || '', filename: filename }; });
        });
      });
      return chain;
    });
  }
  function openAfterSave(uri, mime, title) {
    var p = plugins();
    if (p.Share && uri) {
      return p.Share.share({ files: [uri], title: title || 'RongaMari export' }).catch(function () {});
    }
    return Promise.resolve();
  }
  function saveBrowser(filename, bytes, mime) {
    return new Promise(function (resolve, reject) {
      try {
        var blob = new Blob([bytes], { type: mime });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 4000);
        resolve({ where: 'your downloads', uri: '', filename: filename });
      } catch (e) { reject(e); }
    });
  }
  function save(filename, bytes, mime, title) {
    if (!isNative()) return saveBrowser(filename, bytes, mime);
    return saveNative(filename, bytes).then(function (res) {
      openAfterSave(res.uri, mime, title);
      return res;
    }).catch(function () {
      return saveBrowser(filename, bytes, mime);
    });
  }

  function safeName(s) {
    return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  /* ═══════════════════════════════════════════════════════════════
     6. PUBLIC API — model in, file out.

     model: {
       period, monthKey, currency, person, generated,
       tot: RMStore.totals(),
       weeks: [{no, range, total, rows:[{dateLabel, label, icon, amount, type}]}],
       allTx: [{date, week, type, amount, categoryName, note}],
       debts: [{person, dirLabel, amount, paid, remaining, startDate, dueDate, status, statusLabel, dateLine}],
       debtsOutstanding,
       goals: [{name, icon, target, saved, pct, deadline}], goalsTarget, goalsSaved,
       insights: [{tone, icon, title, body}]
     }
     ═══════════════════════════════════════════════════════════════ */
  global.RMExport = {
    pdfBytes: function (model) { return buildStatementPdf(model); },
    xlsxBytes: function (model) { return buildWorkbookXlsx(model); },

    pdf: function (model) {
      var name = safeName('RongaMari Budget ' + model.period) + '.pdf';
      return save(name, buildStatementPdf(model), 'application/pdf', 'RongaMari budget statement');
    },
    xlsx: function (model) {
      var name = safeName('RongaMari Budget ' + model.period) + '.xlsx';
      return save(name, buildWorkbookXlsx(model),
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'RongaMari budget workbook');
    },
    jsonBackup: function (text) {
      var name = safeName('RongaMari backup ' + new Date().toISOString().slice(0, 10)) + '.json';
      return save(name, utf8Bytes(text), 'application/json', 'RongaMari backup');
    },
    isNative: isNative
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports !== undefined) module.exports = globalThis.RMExport;
