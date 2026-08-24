/* RongaMari UI kit: bottom sheet, confirm, toast, small form builder.
 *
 * Every edit happens in a bottom sheet that is height-capped (88dvh) with a
 * scrollable body — long forms scroll, the Cancel/Save bar stays reachable,
 * and nothing is ever clipped off screen. The sheet only closes by button,
 * drag-dismiss is not offered: accidental dismissal mid-form is worse than an
 * extra tap on Cancel.
 */
(function (global) {
  'use strict';

  var modal = null, sheet = null, body = null, titleEl = null,
      foot = null, cancelBtn = null, saveBtn = null, scrim = null;
  var onSave = null, onClose = null, open = false;
  var closeTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ensure() {
    if (modal) return;
    modal = document.getElementById('modal');
    sheet = modal.querySelector('.modal__sheet');
    body = document.getElementById('modalBody');
    titleEl = document.getElementById('modalTitle');
    foot = document.getElementById('modalFoot');
    cancelBtn = document.getElementById('modalCancel');
    saveBtn = document.getElementById('modalSave');
    scrim = document.getElementById('modalScrim');

    cancelBtn.addEventListener('click', close);
    document.getElementById('modalX').addEventListener('click', close);
    scrim.addEventListener('click', close);
    saveBtn.addEventListener('click', function () {
      if (onSave && onSave(collect()) === false) return;
      close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) close();
    });
  }

  /* fields: [{name,label,type:'text'|'number'|'date'|'time'|'textarea'|'select'|'icons'|'static',value,options,placeholder,min,step,hint,pair}] */
  function formHTML(fields) {
    return fields.map(fieldHTML).join('');
  }

  function fieldHTML(f) {
    if (f.pair) {
      return '<div class="field__pair">' + f.pair.map(fieldHTML).join('') + '</div>';
    }
    var id = 'rmf_' + f.name;
    var label = f.label ? '<span class="field__label">' + esc(f.label) + '</span>' : '';
    var common = ' id="' + id + '" data-name="' + esc(f.name) + '" autocomplete="off"';
    var bodyHtml;

    switch (f.type) {
      case 'select':
        bodyHtml = '<select' + common + '>' +
          (f.options || []).map(function (o) {
            var v = typeof o === 'string' ? o : o.value;
            var l = typeof o === 'string' ? o : o.label;
            return '<option value="' + esc(v) + '"' +
              (String(v) === String(f.value == null ? '' : f.value) ? ' selected' : '') +
              '>' + esc(l) + '</option>';
          }).join('') + '</select>';
        break;
      case 'textarea':
        bodyHtml = '<textarea' + common + ' rows="' + (f.rows || 3) + '" placeholder="' +
          esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>';
        break;
      case 'icons':
        bodyHtml = '<div class="iconpick"' + common + ' data-iconpick="' + esc(f.name) + '">' +
          (f.options || []).map(function (ic) {
            /* hex values render as swatches, not as their own text */
            var isColor = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(ic);
            return '<button type="button" data-icon="' + esc(ic) + '" class="' +
              (ic === f.value ? 'is-active' : '') + '"' +
              (isColor ? ' style="background:' + esc(ic) + ';box-shadow:inset 0 0 0 1px rgba(21,37,27,0.14)" aria-label="colour ' + esc(ic) + '"' : '') +
              '>' + (isColor ? '' : esc(ic)) + '</button>';
          }).join('') + '</div>';
        break;
      case 'static':
        bodyHtml = '<div class="card__note" style="margin-top:2px">' + esc(f.value || '') + '</div>';
        break;
      case 'segment':
        bodyHtml = '<div class="typeseg"' + common + ' data-segment="' + esc(f.name) + '">' +
          (f.options || []).map(function (o) {
            var v = typeof o === 'string' ? o : o.value;
            var l = typeof o === 'string' ? o : o.label;
            return '<button type="button" data-val="' + esc(v) + '" class="' +
              (String(v) === String(f.value) ? 'is-active' : '') + '">' + esc(l) + '</button>';
          }).join('') + '</div>';
        break;
      default:
        bodyHtml = '<input' + common + ' type="' + (f.type || 'text') + '" value="' +
          esc(f.value == null ? '' : f.value) + '"' +
          (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') +
          (f.min != null ? ' min="' + f.min + '"' : '') +
          (f.step != null ? ' step="' + f.step + '"' : '') +
          (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') + '>';
    }
    return '<label class="field">' + label + bodyHtml +
           (f.hint ? '<span class="card__note" style="margin-top:4px">' + esc(f.hint) + '</span>' : '') +
           '</label>';
  }

  function wireExtras(root) {
    root.querySelectorAll('[data-iconpick] button').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-iconpick] button').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
      });
    });
    root.querySelectorAll('[data-segment] button').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('[data-segment="' + b.parentNode.getAttribute('data-segment') + '"] button')
          .forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
      });
    });
    /* amount fields get quick-add chips */
    root.querySelectorAll('input[type="number"]').forEach(function (inp) {
      if (inp.getAttribute('data-noquick')) return;
      var wrap = document.createElement('div');
      wrap.className = 'quickamt';
      [1, 5, 10, 20, 50, 100].forEach(function (v) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = '+' + v;
        b.addEventListener('click', function () {
          inp.value = String((parseFloat(inp.value) || 0) + v);
        });
        wrap.appendChild(b);
      });
      inp.parentNode.appendChild(wrap);
    });
  }

  function collect() {
    var data = {};
    body.querySelectorAll('[data-name]').forEach(function (el) {
      var name = el.getAttribute('data-name');
      if (el.tagName === 'DIV') {
        if (el.hasAttribute('data-iconpick')) {
          var act = el.querySelector('.is-active');
          data[name] = act ? act.getAttribute('data-icon') : '';
        } else if (el.hasAttribute('data-segment')) {
          var act2 = el.querySelector('.is-active');
          data[name] = act2 ? act2.getAttribute('data-val') : '';
        }
        return;
      }
      data[name] = el.value;
    });
    return data;
  }

  /* opts: {title, fields, saveLabel, hideSave, onSave(values), onClose} */
  function show(opts) {
    ensure();
    /* Cancel any pending hide/cleanup from a sheet that is still animating
     * closed (e.g. an action button that closes this sheet and immediately
     * opens another one). Without this, the earlier close()'s deferred
     * `modal.hidden = true` fires after the new sheet has already opened,
     * making it look like the new sheet flashes open then closes itself. */
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    titleEl.textContent = opts.title || '';
    body.innerHTML = formHTML(opts.fields || []);
    wireExtras(body);
    onSave = opts.onSave || null;
    onClose = opts.onClose || null;
    saveBtn.textContent = opts.saveLabel || 'Save';
    saveBtn.hidden = !!opts.hideSave;
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';
    foot.style.display = opts.hideSave ? 'none' : '';
    modal.hidden = false;
    /* force reflow so the transition runs */
    void sheet.offsetHeight;
    modal.classList.add('is-open');
    open = true;
    var first = body.querySelector('input, select, textarea');
    if (first) setTimeout(function () { first.focus(); }, 260);
  }

  function close() {
    if (!open) return;
    open = false;
    modal.classList.remove('is-open');
    var cb = onClose;
    onClose = null;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      closeTimer = null;
      modal.hidden = true;
      body.innerHTML = '';
    }, 240);
    if (cb) cb();
  }

  /* Non-form action sheet: rows of buttons. actions: [{label, kind:'primary'|'ghost'|'danger', onClick}] */
  function actions(opts) {
    show({
      title: opts.title || 'Choose',
      hideSave: true,
      cancelLabel: opts.cancelLabel || 'Close',
      fields: [{
        type: 'static',
        name: '_desc',
        value: opts.message || ''
      }],
      onClose: opts.onClose
    });
    var host = document.createElement('div');
    host.className = 'actions';
    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--' + (a.kind || 'ghost');
      b.innerHTML = (a.icon ? '<span style="margin-right:8px">' + a.icon + '</span>' : '') + esc(a.label);
      if (a.center) b.classList.add('btn--center');
      b.addEventListener('click', function () { close(); setTimeout(a.onClick, 60); });
      host.appendChild(b);
    });
    if (opts.danger) {
      var dz = document.createElement('div');
      dz.className = 'dangerzone';
      dz.appendChild(host.querySelector('.btn--danger'));
      host.appendChild(dz);
    }
    body.innerHTML = '';
    body.appendChild(host);
  }

  /* Confirmation dialog. onYes gets nothing; you already know what they chose. */
  function confirm(opts) {
    actions({
      title: opts.title || 'Are you sure?',
      message: opts.message || '',
      cancelLabel: 'Cancel',
      actions: [
        { label: opts.confirmLabel || 'Confirm', kind: 'primary', center: true, onClick: opts.onYes },
        { label: 'Cancel', kind: 'ghost', center: true, onClick: opts.onNo }
      ]
    });
  }

  /* ── toast ───────────────────────────────────────────────────── */
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) toastEl = document.getElementById('toast');
    toastEl.textContent = msg;
    toastEl.hidden = false;
    void toastEl.offsetHeight;
    toastEl.classList.add('is-in');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-in');
      setTimeout(function () { toastEl.hidden = true; }, 260);
    }, 2400);
  }

  global.RMUI = {
    show: show, close: close, actions: actions, confirm: confirm,
    toast: toast, esc: esc
  };
})(typeof window !== 'undefined' ? window : globalThis);
