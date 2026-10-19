/* Shared helpers and page chrome. Exposes window.AP. */
(function () {
  'use strict';
  var APP_NAME = 'Claims Coverage Desk';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Read as text first so platform error pages still show a useful status.
  function api(method, url, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : {}; } catch (e) { j = null; }
        if (r.status === 401 && url !== '/api/auth/login') { goSignIn(); throw new Error('Please sign in.'); }
        if (!r.ok) {
          var msg = (j && j.error) || ('The server returned ' + r.status + (r.status === 413 ? ' (file too large)' : r.status >= 500 ? ' (server problem)' : '') + '.');
          var err = new Error(msg); err.status = r.status; throw err;
        }
        if (j === null) throw new Error('Unexpected response from the server (' + r.status + ').');
        return j;
      });
    });
  }

  function goSignIn() {
    var next = location.pathname + location.search;
    location.href = '/?next=' + encodeURIComponent(next);
  }

  function fmtDate(iso, withTime) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    var o = { day: '2-digit', month: 'short', year: 'numeric' };
    if (withTime !== false) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleString(undefined, o);
  }
  function fmtRel(iso) {
    if (!iso) return '—';
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (isNaN(s)) return '—';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function fmtNum(n, dp) {
    if (n == null || n === '' || isNaN(Number(n))) return n == null || n === '' ? '—' : esc(n);
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
  }
  function fmtPct(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    var v = Number(n); if (v <= 1) v = v * 100;
    return Math.round(v) + '%';
  }

  var LABELS = {
    fnol: 'FNOL', pds: 'PDS', id: 'ID', url: 'URL', pdf: 'PDF', dob: 'Date of birth'
  };
  function humanize(k) {
    var s = String(k || '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
    s = s.split(' ').map(function (w) { return LABELS[w] || w; }).join(' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------- status ----------
  var STATUS = {
    queued:            ['Queued', ''],
    processing:        ['Processing', 'info'],
    awaiting_detailed: ['Awaiting detailed review', 'violet'],
    awaiting_quick:    ['Awaiting quick sign-off', 'violet'],
    awaiting_review:   ['Awaiting review', 'violet'],
    completed:         ['Completed', 'ok'],
    failed:            ['Failed', 'bad'],
    cancelled:         ['Cancelled', 'bad'],
    timed_out:         ['Timed out', 'bad']
  };
  function statusLabel(s) { return (STATUS[s] || [humanize(s)])[0]; }
  function casePill(c) {
    var st = STATUS[c.status] || [humanize(c.status), ''];
    return '<span class="pill ' + st[1] + '">' + esc(st[0]) + '</span>';
  }
  function decisionClass(d) {
    var s = String(d || '').toLowerCase().replace(/[_-]+/g, ' ');
    if (!s) return '';
    if (/partial/.test(s)) return 'warn';
    if (/more info|information|pending|insufficient|refer/.test(s)) return 'info';
    if (/not covered|no cover|declin|uncovered|unavailable|excluded|reject/.test(s)) return 'bad';
    if (/cover|full|accept/.test(s)) return 'ok';
    return '';
  }
  function decisionText(d) {
    if (!d) return '';
    var s = String(d).replace(/_/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function decisionPill(d, confirmed) {
    if (!d) return '<span class="muted">—</span>';
    return '<span class="pill plain ' + decisionClass(d) + '">' + esc(decisionText(d)) + '</span>' +
      (confirmed === false ? ' <span class="small muted">proposed</span>' : '');
  }
  function reviewStatusPill(s) {
    var m = { pending: ['Waiting', 'violet'], submitting: ['Submitting', 'info'], completed: ['Completed', 'ok'], expired: ['No longer open', 'bad'], failed: ['Failed', 'bad'] }[s] || [humanize(s), ''];
    return '<span class="pill ' + m[1] + '">' + esc(m[0]) + '</span>';
  }

  // ---------- generic value rendering ----------
  function isScalar(v) { return v == null || typeof v !== 'object'; }
  function scalar(v, key) {
    if (v == null || v === '') return '<span class="muted">—</span>';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') {
      if (/confidence|score/i.test(key || '') && v <= 1) return fmtPct(v);
      return esc(v.toLocaleString());
    }
    var s = String(v);
    if (/^https?:\/\//.test(s)) return '<span class="muted">file</span>';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return esc(fmtDate(s));
    return '<span class="pre">' + esc(s) + '</span>';
  }
  function renderValue(v, key, depth) {
    depth = depth || 0;
    if (isScalar(v)) return scalar(v, key);
    if (Array.isArray(v)) {
      if (!v.length) return '<span class="muted">None</span>';
      if (v.every(isScalar)) return '<ul class="plain">' + v.map(function (x) { return '<li>' + scalar(x, key) + '</li>'; }).join('') + '</ul>';
      if (v.every(function (x) { return x && typeof x === 'object' && !Array.isArray(x); }) && depth < 2) {
        var cols = [];
        v.forEach(function (row) { Object.keys(row).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
        cols = cols.slice(0, 8);
        return '<div class="value-scroll"><table class="mini-table"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(humanize(c)) + '</th>'; }).join('') +
          '</tr></thead><tbody>' + v.map(function (row) {
            return '<tr>' + cols.map(function (c) { return '<td>' + renderValue(row[c], c, depth + 1) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>';
      }
      return '<ul class="plain">' + v.map(function (x) { return '<li>' + renderValue(x, key, depth + 1) + '</li>'; }).join('') + '</ul>';
    }
    var keys = Object.keys(v);
    if (!keys.length) return '<span class="muted">None</span>';
    return '<dl class="kv">' + keys.map(function (k) { return '<dt>' + esc(humanize(k)) + '</dt><dd>' + renderValue(v[k], k, depth + 1) + '</dd>'; }).join('') + '</dl>';
  }
  function kv(pairs) {
    return '<dl class="kv">' + pairs.filter(function (p) { return p; }).map(function (p) {
      return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : renderValue(p[1], p[0])) + '</dd>';
    }).join('') + '</dl>';
  }

  // ---------- toast / modal ----------
  var toastTimer;
  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function modal(title, bodyHtml, buttons) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="card-head"><h2>' + esc(title) + '</h2></div><div class="card-body">' + bodyHtml + '</div><div class="foot"></div></div>';
    var foot = back.querySelector('.foot');
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    (buttons || [{ label: 'Close' }]).forEach(function (b) {
      var el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      el.onclick = function () { if (!b.onClick || b.onClick(back, close) !== false) close(); };
      foot.appendChild(el);
    });
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    var f = back.querySelector('input, select, textarea, .foot .btn.primary'); if (f) f.focus();
    return { el: back, close: close };
  }

  // ---------- chrome ----------
  var ICONS = {
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.6 3 2.3 3.5 5.2"/></svg>',
    menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  };
  var LOGO = '<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#2f6fd6"/><path d="M16 6l8 3v6.2c0 5-3.4 9.2-8 10.8-4.6-1.6-8-5.8-8-10.8V9l8-3z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M12.3 15.8l2.6 2.6 4.8-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function can(me, p) { return me && me.can && me.can.indexOf(p) >= 0; }

  function shell(me, active) {
    var nav = [];
    nav.push(['dashboard', '/dashboard.html', 'Dashboard', ICONS.dash]);
    if (can(me, 'submit')) nav.push(['new', '/new-claim.html', 'New claim', ICONS.plus]);
    nav.push(['claims', '/claims.html', 'Claims', ICONS.list]);
    if (can(me, 'review_quick') || can(me, 'review_detailed')) nav.push(['reviews', '/reviews.html', 'Reviews', ICONS.check, 'reviewBadge']);
    if (can(me, 'users')) nav.push(['users', '/users.html', 'Users', ICONS.users]);
    var navHtml = nav.map(function (n) {
      return '<a href="' + n[1] + '"' + (n[0] === active ? ' class="active" aria-current="page"' : '') + '>' + n[3] + '<span>' + n[2] + '</span>' + (n[4] ? '<span class="badge" id="' + n[4] + '" hidden></span>' : '') + '</a>';
    }).join('');
    var app = document.getElementById('app');
    var content = app.innerHTML;
    app.innerHTML =
      '<div class="topbar"><button type="button" id="navToggle" aria-label="Open menu">' + ICONS.menu + '</button>' + LOGO + '<span>' + APP_NAME + '</span></div>' +
      '<div class="shell"><aside class="side" aria-label="Main menu">' +
      '<div class="brand">' + LOGO + '<div>' + APP_NAME + '<small>Coverage assessment</small></div></div>' +
      '<nav class="nav">' + navHtml + '</nav>' +
      '<div class="side-foot"><div class="who" title="' + esc(me.email) + '">' + esc(me.name) + '</div><div class="role">' + esc(me.roleLabel) + '</div>' +
      '<div class="links"><a href="/account.html">Account</a><button type="button" class="linkish" id="themeBtn">Theme</button><button type="button" class="linkish" id="signOut">Sign out</button></div></div>' +
      '</aside><main class="main" id="main">' + content + '</main></div>';
    app.hidden = false;
    document.getElementById('signOut').onclick = function () {
      api('POST', '/api/auth/logout').finally(function () { location.href = '/'; });
    };
    document.getElementById('themeBtn').onclick = cycleTheme;
    document.getElementById('navToggle').onclick = function () { document.body.classList.toggle('nav-open'); };
    document.addEventListener('click', function (e) {
      if (document.body.classList.contains('nav-open') && !e.target.closest('.side') && !e.target.closest('#navToggle')) document.body.classList.remove('nav-open');
    });
    if (can(me, 'review_quick') || can(me, 'review_detailed')) refreshBadge();
  }

  function refreshBadge() {
    api('GET', '/api/reviews').then(function (j) {
      var n = j.reviews.filter(function (r) { return r.status === 'pending'; }).length;
      var b = document.getElementById('reviewBadge');
      if (b) { b.textContent = n; b.hidden = !n; }
    }).catch(function () {});
  }

  function applyTheme() {
    var t = null;
    try { t = localStorage.getItem('ccd-theme'); } catch (e) {}
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function cycleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : cur === 'light' ? 'system' : 'dark';
    try { if (next === 'system') localStorage.removeItem('ccd-theme'); else localStorage.setItem('ccd-theme', next); } catch (e) {}
    applyTheme();
    toast('Theme: ' + (next === 'system' ? 'match device' : next));
  }
  applyTheme();

  // Every page: ask who is signed in before rendering anything.
  function boot(opts) {
    api('GET', '/api/me').then(function (me) {
      var ok = !opts.perm || [].concat(opts.perm).some(function (p) { return can(me, p); });
      if (!ok) { location.replace('/dashboard.html'); return; }
      document.title = (opts.title ? opts.title + ' · ' : '') + APP_NAME;
      shell(me, opts.nav);
      opts.render(me, document.getElementById('main'));
    }).catch(function (e) {
      if (e.status !== 401) {
        var app = document.getElementById('app');
        app.hidden = false;
        app.innerHTML = '<div class="loading-page"><div class="alert bad" style="max-width:520px;margin:0 auto">' + esc(e.message) + '</div></div>';
      }
    });
  }

  function qs(name) { return new URLSearchParams(location.search).get(name); }

  window.AP = {
    APP_NAME: APP_NAME, esc: esc, api: api, boot: boot, qs: qs, can: can,
    fmtDate: fmtDate, fmtRel: fmtRel, fmtNum: fmtNum, fmtPct: fmtPct, humanize: humanize,
    casePill: casePill, statusLabel: statusLabel, decisionPill: decisionPill, decisionText: decisionText, decisionClass: decisionClass,
    reviewStatusPill: reviewStatusPill, renderValue: renderValue, kv: kv, toast: toast, modal: modal, refreshBadge: refreshBadge, LOGO: LOGO
  };
})();
