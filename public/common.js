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
  // Money as the rest of the app shows it: $8,680 (cents only when there are any).
  function fmtMoney(n) {
    if (n == null || n === '' || isNaN(Number(n))) return n == null || n === '' ? '—' : esc(n);
    var v = Number(n), whole = Math.round(v * 100) % 100 === 0;
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  }
  var MONEY_KEY = /(amount|limit|excess|settlement|sum_insured|sums_insured|premium|cost|price|value|payable|claimed)/i;
  // Raw numbers in text from the assessment ("16450.0") read as 16,450.
  function tidyNumbers(s) {
    return String(s).replace(/(^|[^\w.\-\/])(\d{4,})\.(\d{1,2})(?!\d)(?!\.\d)/g, function (m, pre, int, dec) {
      if (int.length === 4 && /^(19|20)/.test(int) && dec.length === 2 && Number(dec) > 0) return m; // looks like a year/section, leave it
      var n = Number(int + '.' + dec), whole = Number(dec) === 0;
      return pre + n.toLocaleString('en-AU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
    });
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
      if (MONEY_KEY.test(key || '') && !/count|number|items/i.test(key || '')) return '<span class="num">' + esc(fmtMoney(v)) + '</span>';
      return '<span class="num">' + esc(v.toLocaleString('en-AU')) + '</span>';
    }
    var s = String(v);
    if (/^https?:\/\//.test(s)) return '<span class="muted">file</span>';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return esc(fmtDate(s));
    return '<span class="pre">' + esc(tidyNumbers(s)) + '</span>';
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
        // Wide tables (3+ columns) turn into stacked rows when their column is too narrow, so long
        // wording (quoted clauses, rationale) always wraps inside the column instead of overflowing.
        return '<div class="value-scroll"><table class="mini-table' + (cols.length >= 3 ? ' stackable' : '') + '"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(humanize(c)) + '</th>'; }).join('') +
          '</tr></thead><tbody>' + v.map(function (row) {
            return '<tr>' + cols.map(function (c) { return '<td data-label="' + esc(humanize(c)) + '">' + renderValue(row[c], c, depth + 1) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>';
      }
      return '<ul class="plain">' + v.map(function (x) { return '<li>' + renderValue(x, key, depth + 1) + '</li>'; }).join('') + '</ul>';
    }
    var keys = Object.keys(v);
    if (!keys.length) return '<span class="muted">None</span>';
    // Amounts keyed by name inside a money field (sums insured: { Buildings: 650000 }) are money too.
    return '<dl class="kv">' + keys.map(function (k) { return '<dt>' + esc(humanize(k)) + '</dt><dd>' + renderValue(v[k], (typeof v[k] === 'number' && MONEY_KEY.test(key || '')) ? key : k, depth + 1) + '</dd>'; }).join('') + '</dl>';
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

  // ---------- chrome: the sidebar ----------
  // Open and labelled by default, with the review count beside the queue. The chevron folds it to
  // an icon strip (remembered per browser); while folded, hovering opens it over the page and blurs
  // what is behind. On phones it is a drawer behind the menu button.
  function svg(d) { return '<svg class="side-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
  var ICONS = {
    dash: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    plus: svg('<path d="M12 16V4m0 0L8 8m4-4 4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
    check: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'),
    chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.6 3 2.3 3.5 5.2"/>'),
    theme: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor"/>'),
    support: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 17h.01"/>'),
    account: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
    signout: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    chevron: svg('<path d="M15 6l-6 6 6 6"/>')
  };
  var LOGO = '<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#ffffff" fill-opacity=".16"/><path d="M16 6l8 3v6.2c0 5-3.4 9.2-8 10.8-4.6-1.6-8-5.8-8-10.8V9l8-3z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M12.3 15.8l2.6 2.6 4.8-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function can(me, p) { return me && me.can && me.can.indexOf(p) >= 0; }

  function shell(me, active) {
    var groups = [
      { title: 'Claims', links: [
        ['dashboard', '/dashboard.html', 'Dashboard', ICONS.dash],
        can(me, 'submit') ? ['new', '/new-claim.html', 'New claim', ICONS.plus] : null,
        ['claims', '/claims.html', can(me, 'view_all') ? 'All claims' : me.role === 'intake' ? 'My claims' : 'My claims to review', ICONS.list]
      ] },
      (can(me, 'review_quick') || can(me, 'review_detailed')) ? { title: 'Reviews', links: [
        ['reviews', '/reviews.html', can(me, 'review_quick') && can(me, 'review_detailed') ? 'Review queues' : can(me, 'review_quick') ? 'Quick sign-offs' : 'Detailed reviews', ICONS.check, 'reviewBadge']
      ] } : null,
      can(me, 'reports') ? { title: 'Insights', links: [['reports', '/reports.html', 'Reports', ICONS.chart]] } : null,
      can(me, 'users') ? { title: 'Administration', links: [['users', '/users.html', 'Users', ICONS.users]] } : null
    ].filter(Boolean);
    var navHtml = groups.map(function (g) {
      return '<div class="side-group"><div class="side-heading">' + esc(g.title) + '</div>' + g.links.filter(Boolean).map(function (n) {
        return '<a class="side-link' + (n[0] === active ? ' is-current' : '') + '" href="' + n[1] + '" title="' + esc(n[2]) + '"' + (n[0] === active ? ' aria-current="page"' : '') + '>' +
          n[3] + '<span class="side-label">' + esc(n[2]) + '</span>' + (n[4] ? '<span class="side-badge" id="' + n[4] + '" hidden></span>' : '') + '</a>';
      }).join('') + '</div>';
    }).join('');
    var initials = String(me.name || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    var app = document.getElementById('app');
    var content = app.innerHTML;
    app.innerHTML =
      '<div class="topbar"><button type="button" class="side-btn" id="navToggle" aria-label="Open menu" aria-expanded="false">' + ICONS.menu + '</button>' + LOGO + '<span>' + APP_NAME + '</span></div>' +
      '<aside class="side" id="side" aria-label="Main menu">' +
        '<div class="side-top">' + LOGO + '<div class="side-brand"><strong>' + APP_NAME + '</strong><small>Coverage assessment</small></div>' +
          '<button type="button" class="side-toggle" id="sideToggle" aria-controls="side" aria-expanded="true" aria-label="Collapse the menu" title="Collapse the menu">' + ICONS.chevron + '</button></div>' +
        '<nav class="side-nav">' + navHtml + '</nav>' +
        '<div class="side-foot">' +
          '<button type="button" class="side-link side-action" id="themeBtn" title="Light / dark">' + ICONS.theme + '<span class="side-label">Light / dark</span></button>' +
          '<button type="button" class="side-link side-action" id="supportBtn" title="Contact support">' + ICONS.support + '<span class="side-label">Contact support</span></button>' +
          '<a class="side-link side-action' + (active === 'account' ? ' is-current' : '') + '" href="/account.html" title="Account">' + ICONS.account + '<span class="side-label">Account</span></a>' +
          '<div class="side-user" title="' + esc(me.email) + '"><span class="avatar">' + esc(initials) + '</span><span class="side-label"><strong>' + esc(me.name) + '</strong><small>' + esc(me.roleLabel) + '</small></span></div>' +
          '<button type="button" class="side-link side-action danger" id="signOut" title="Sign out">' + ICONS.signout + '<span class="side-label">Sign out</span></button>' +
        '</div>' +
      '</aside>' +
      '<div class="side-scrim" id="sideScrim"></div>' +
      '<main class="main" id="main">' + content + '</main>';
    app.hidden = false;
    document.body.classList.add('has-rail');
    document.getElementById('signOut').onclick = function () {
      api('POST', '/api/auth/logout').finally(function () { location.href = '/'; });
    };
    var side = document.getElementById('side');
    function blurSide() { if (document.activeElement && side.contains(document.activeElement)) document.activeElement.blur(); }
    function setCollapsed(next) {
      document.body.classList.toggle('side-collapsed', !!next);
      var t = document.getElementById('sideToggle');
      t.setAttribute('aria-expanded', next ? 'false' : 'true');
      t.setAttribute('aria-label', next ? 'Expand the menu' : 'Collapse the menu');
      t.title = next ? 'Expand the menu' : 'Collapse the menu';
      try { localStorage.setItem('ccd-sidebar', next ? 'collapsed' : 'open'); } catch (e) {}
    }
    var saved = null; try { saved = localStorage.getItem('ccd-sidebar'); } catch (e) {}
    setCollapsed(saved === 'collapsed');
    document.getElementById('sideToggle').onclick = function () { setCollapsed(!document.body.classList.contains('side-collapsed')); blurSide(); };
    document.getElementById('themeBtn').onclick = function () { cycleTheme(); };
    document.getElementById('supportBtn').onclick = function () { blurSide(); setDrawer(false); openSupport(me); };
    function setDrawer(open) {
      document.body.classList.toggle('nav-open', open);
      document.getElementById('navToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    document.getElementById('navToggle').onclick = function () { setDrawer(!document.body.classList.contains('nav-open')); };
    document.getElementById('sideScrim').onclick = function () { setDrawer(false); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setDrawer(false); });
    if (can(me, 'review_quick') || can(me, 'review_detailed')) refreshBadge();
  }

  function refreshBadge() {
    api('GET', '/api/reviews').then(function (j) {
      var n = j.reviews.filter(function (r) { return r.status === 'pending'; }).length;
      var b = document.getElementById('reviewBadge');
      if (b) { b.textContent = n; b.hidden = false; b.classList.toggle('zero', !n); b.title = n + (n === 1 ? ' review' : ' reviews') + ' waiting'; }
    }).catch(function () {});
  }

  // Light unless the person picked dark with the toggle (the device setting is not followed).
  function applyTheme() {
    var t = null;
    try { t = localStorage.getItem('ccd-theme'); } catch (e) {}
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  }
  function cycleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ccd-theme', next); } catch (e) {}
    applyTheme();
    toast(next === 'dark' ? 'Dark theme' : 'Light theme');
  }
  applyTheme();

  // ---------- Contact support ----------
  // Writes the email to Opus support with everything they need (workflow, org, workspace and
  // case ids, status, where it stopped), and offers a screenshot of the page to attach,
  // because a mailto link cannot attach files. A page may add its own details with setSupportContext.
  var supportContext = null;
  function setSupportContext(fn) { supportContext = fn; }
  function getSupportInfo(me) {
    if (me && me.support) return Promise.resolve(me.support);
    return fetch('/api/support-info').then(function (r) { return r.json(); }).catch(function () { return { email: 'support@opus.com', product: APP_NAME }; });
  }
  function line(label, value) { return value ? label + ': ' + value : null; }
  function supportEmail(me, info, d, shotName) {
    var subject = APP_NAME + (d.caseId ? ' – case ' + d.caseId : '') +
      (d.failed ? ' did not finish' + (d.failedAt ? ' at ' + d.failedAt : '') : d.status ? ' (' + String(d.status).toLowerCase().replace(/_/g, ' ') + ')' : ', question');
    var parts = [
      'Hello support team,', '',
      d.reason ? 'What went wrong: ' + d.reason : 'Describe the issue here:',
      d.failedAt ? 'Stopped at step: ' + d.failedAt : null,
      '',
      line('Product', info.product || APP_NAME),
      line('Workflow ID', info.workflowId ? info.workflowId + (d.workflowVersion ? ' (version ' + d.workflowVersion + ')' : '') : null),
      'Org ID: ' + (info.orgId || 'not set'),
      line('Workspace ID', info.workspaceId),
      line('Case ID', d.caseId ? d.caseId + (d.reference ? ' (claim ' + d.reference + ')' : '') : null),
      line('Review execution ID', d.reviewExecutionId),
      line('Review type', d.reviewType),
      line('Status', d.status),
      line('Submitted', d.submittedAt ? new Date(d.submittedAt).toISOString() + (d.submittedBy ? ' by ' + d.submittedBy : '') : null),
      line('Finished', d.finishedAt ? new Date(d.finishedAt).toISOString() : null),
      '',
      'Reported by: ' + (me ? me.name + ' <' + me.email + '> (' + me.roleLabel + ')' : 'not signed in'),
      'Page: ' + location.href,
      'When: ' + new Date().toISOString(),
      'Browser: ' + navigator.userAgent,
      shotName ? 'Screenshot: attached (' + shotName + ')' : 'Screenshot: please see attachment'
    ].filter(function (x) { return x !== null; });
    var body = parts.join('\n');
    if (body.length > 1800) body = body.slice(0, 1790) + '\n…';
    return 'mailto:' + (info.email || 'support@opus.com') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.html2canvas) return resolve();
      var sc = document.createElement('script');
      sc.src = src; sc.onload = resolve; sc.onerror = function () { reject(new Error('The screenshot tool could not load.')); };
      document.head.appendChild(sc);
    });
  }
  function takeScreenshot(name) {
    document.body.classList.remove('nav-open');
    return loadScript('/vendor/html2canvas.min.js').then(function () {
      return window.html2canvas(document.body, {
        scale: Math.min(2, window.devicePixelRatio || 1),
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        ignoreElements: function (el) { return el.id === 'support-modal' || el.classList.contains('side-scrim') || el.classList.contains('toast'); },
        windowWidth: document.documentElement.clientWidth
      });
    }).then(function (canvas) {
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = name;
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          resolve();
        }, 'image/png');
      });
    });
  }
  function openSupport(me) {
    var old = document.getElementById('support-modal'); if (old) old.remove();
    var back = document.createElement('div');
    back.className = 'modal-back'; back.id = 'support-modal';
    back.innerHTML = '<div class="modal support-modal" role="dialog" aria-modal="true" aria-labelledby="support-title">' +
      '<div class="card-head"><h2 id="support-title">Contact support</h2><button type="button" class="btn small" id="support-x" aria-label="Close">Close</button></div>' +
      '<div class="card-body"><p class="muted small" style="margin:0 0 14px">The email to the support team is written for you, with the technical details they need. A mail link cannot attach files, so download the screenshot first and attach it to the email.</p>' +
      '<dl class="kv" id="support-details"><dt>Details</dt><dd>Gathering…</dd></dl>' +
      '<div class="alert bad" id="support-error" hidden style="margin-top:12px"></div>' +
      '<div class="support-steps">' +
        '<button type="button" class="btn" id="support-shot"><span class="step-n">1</span>Download screenshot</button>' +
        '<a class="btn primary" id="support-mail" href="#"><span class="step-n">2</span>Open email</a>' +
      '</div>' +
      '<div class="support-foot"><button type="button" class="btn small" id="support-copy">Copy details</button><span class="small muted" id="support-to"></span></div></div>' +
      '</div>';
    document.body.appendChild(back);
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.getElementById('support-x').onclick = close;
    var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    var mail = document.getElementById('support-mail');
    var info = { email: 'support@opus.com' }, details = {}, shotName = 'claims-desk-' + stamp + '.png';
    function render() {
      shotName = 'claims-desk-' + (details.caseId ? 'case-' + details.caseId + '-' : '') + stamp + '.png';
      var rows = [['What went wrong', details.reason], ['Stopped at', details.failedAt], ['Claim', details.reference], ['Case', details.caseId], ['Status', details.status]]
        .filter(function (r) { return r[1]; });
      if (!rows.length) rows.push(['Details', 'Describe the problem in the email. The workflow, org and workspace IDs and your details are added for you.']);
      document.getElementById('support-details').innerHTML = rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd' + (r[0] === 'Case' ? ' class="mono"' : '') + '>' + esc(r[1]) + '</dd>'; }).join('');
      mail.href = supportEmail(me, info, details, shotName);
      document.getElementById('support-to').textContent = 'To: ' + (info.email || 'support@opus.com');
    }
    render();
    getSupportInfo(me).then(function (i) { info = i || info; render(); });
    (supportContext ? Promise.resolve(supportContext()) : Promise.resolve(null)).then(function (d) { if (d) { details = d; render(); } }, function () {});
    document.getElementById('support-shot').onclick = function () {
      var b = this, label = b.innerHTML;
      b.disabled = true; b.textContent = 'Capturing…';
      takeScreenshot(shotName).then(function () {
        b.innerHTML = '<span class="step-n">✓</span>Screenshot saved'; b.disabled = false;
      }, function (err) {
        b.innerHTML = label; b.disabled = false;
        var x = document.getElementById('support-error'); x.textContent = err.message + ' Use your own screenshot tool instead.'; x.hidden = false;
      });
    };
    document.getElementById('support-copy').onclick = function () {
      var text = decodeURIComponent(mail.href.split('&body=')[1] || ''), b = this;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Copy failed'; });
    };
  }


  // Motion for numbers and charts: numbers count up, bars grow, lines draw, cards rise in.
  // First view animates from zero; later refreshes animate only what changed.
  var lastValues = {};
  function reducedMotion() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function countTo(el, key) {
    var text = el.textContent, nums = text.match(/\d+(?:\.\d+)?/g);
    if (!nums) return;
    var prev = lastValues[key], first = prev == null;
    lastValues[key] = text;
    if (!first && prev === text) return;
    var from = first ? nums.map(function () { return 0; }) : ((prev.match(/\d+(?:\.\d+)?/g) || []).map(Number));
    if (from.length !== nums.length) from = nums.map(function () { return 0; });
    var parts = text.split(/\d+(?:\.\d+)?/), dec = nums.map(function (n) { return (n.split('.')[1] || '').length; });
    var to = nums.map(Number), t0 = performance.now(), dur = 900;
    var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
    if (el._anim) cancelAnimationFrame(el._anim);
    (function step(now) {
      var t = Math.min(1, (now - t0) / dur), e = ease(t), out = parts[0];
      for (var i = 0; i < to.length; i++) out += (from[i] + (to[i] - from[i]) * e).toFixed(dec[i]) + parts[i + 1];
      el.textContent = out;
      if (t < 1) el._anim = requestAnimationFrame(step); else el.textContent = text;
    })(t0);
  }
  function animateIn(root, page) {
    if (!root) return;
    var first = !lastValues['__seen_' + page];
    lastValues['__seen_' + page] = true;
    var still = reducedMotion();
    root.querySelectorAll('.kpi .value').forEach(function (el) {
      var lab = el.parentNode.querySelector('.label');
      var key = page + '|' + (lab ? lab.textContent : '');
      if (still) { lastValues[key] = el.textContent; return; }
      countTo(el, key);
    });
    if (still || !first) return;
    root.querySelectorAll('.card').forEach(function (c, i) { c.style.animationDelay = Math.min(i * 45, 400) + 'ms'; c.classList.add('rise-in'); });
    root.querySelectorAll('.hbar').forEach(function (b, i) {
      var w = b.style.width; b.style.transition = 'none'; b.style.width = '0';
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        b.style.transition = 'width .7s cubic-bezier(.2,.7,.3,1) ' + (i * 40) + 'ms'; b.style.width = w;
      }); });
    });
    root.querySelectorAll('.hbar-val').forEach(function (v, i) { countTo(v, page + '|bar' + i); });
    root.querySelectorAll('svg.chart path.ln').forEach(function (p, i) {
      var len = p.getTotalLength ? p.getTotalLength() : 0; if (!len) return;
      p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        p.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.2,.7,.3,1) ' + (i * 120) + 'ms'; p.style.strokeDashoffset = '0';
        setTimeout(function () { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; p.style.transition = ''; }, 1400 + i * 120);
      }); });
    });
  }

  // Every page: ask who is signed in before rendering anything.
  function boot(opts) {
    api('GET', '/api/me').then(function (me) {
      var ok = !opts.perm || [].concat(opts.perm).some(function (p) { return can(me, p); });
      if (!ok) { location.replace('/dashboard.html'); return; }
      document.title = (opts.title ? opts.title + ' · ' : '') + APP_NAME;
      AP.me = me;
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

  // Which review a claim goes to, and who completes it.
  var ROUTES = {
    quick:    { label: 'Quick sign-off', who: 'Claims Handler' },
    detailed: { label: 'Detailed review', who: 'Senior Claims Handler' }
  };
  function routeChip(kind, big) {
    var r = ROUTES[kind]; if (!r) return '';
    return '<span class="route-chip ' + kind + (big ? ' big' : '') + '"><span class="route-arrow" aria-hidden="true">→</span>' +
      (big ? '<span class="route-label">Goes to</span>' : '') + '<strong>' + r.label + '</strong><span class="route-who">' + r.who + '</span></span>';
  }

  // Both review types use the same words on screen. The value sent back to the workflow is still
  // the one each review step expects (e.g. "Non-binding override" for a quick sign-off).
  var OUTCOME_LABEL = { 'Confirmed': 'Confirmed', 'Overridden': 'Overridden', 'Non-binding override': 'Overridden',
    'Clarification requested': 'Returned for clarification', 'Returned for further review': 'Returned for clarification' };
  function outcomeLabel(o) { return o ? (OUTCOME_LABEL[o] || o) : ''; }
  function isOverride(o) { return outcomeLabel(o) === 'Overridden'; }

  // Every row ends on a verb: Confirm (quick sign-off waiting for you), Review (detailed review
  // waiting for you) or Open.
  function rowAction(r, me) {
    var kind = r.reviewKind || r.kind;
    var pending = r.reviewStatus ? (r.reviewStatus === 'pending') : (r.status === 'pending');
    var reviewId = r.reviewId || (r.kind ? r.id : null);
    if (pending && reviewId && kind && can(me, kind === 'quick' ? 'review_quick' : 'review_detailed')) {
      return { label: kind === 'quick' ? 'Confirm' : 'Review', href: '/review.html?id=' + encodeURIComponent(reviewId), primary: true };
    }
    return { label: 'Open', href: r.kind ? '/review.html?id=' + encodeURIComponent(r.id) : '/claim.html?id=' + encodeURIComponent(r.id), primary: false };
  }
  function actionCell(r, me) {
    var a = rowAction(r, me);
    return '<td class="row-action" data-label=""><a class="btn small' + (a.primary ? ' primary' : '') + '" href="' + a.href + '">' + esc(a.label) + '</a></td>';
  }
  // Same claim reference submitted more than once: say so, like a duplicate notice.
  function repeatNote(r) {
    if (!r.repeat) return '';
    var first = r.repeat.run === 1;
    return '<div class="sub dup-note" title="The same claim reference was submitted ' + r.repeat.of + ' times. Each run is assessed on its own, so outcomes can differ.">' +
      (first ? 'First of ' + r.repeat.of + ' runs of this claim' : 'Run ' + r.repeat.run + ' of ' + r.repeat.of + ' · repeat of the claim first sent ' + esc(fmtDate(r.repeat.firstAt))) + '</div>';
  }

  window.AP = {
    routeChip: routeChip, ROUTES: ROUTES,
    APP_NAME: APP_NAME, esc: esc, api: api, boot: boot, qs: qs, can: can,
    fmtDate: fmtDate, fmtRel: fmtRel, fmtNum: fmtNum, fmtMoney: fmtMoney, tidyNumbers: tidyNumbers, fmtPct: fmtPct, humanize: humanize,
    casePill: casePill, statusLabel: statusLabel, decisionPill: decisionPill, decisionText: decisionText, decisionClass: decisionClass,
    reviewStatusPill: reviewStatusPill, renderValue: renderValue, kv: kv, toast: toast, modal: modal, refreshBadge: refreshBadge, LOGO: LOGO,
    openSupport: openSupport, setSupportContext: setSupportContext, cycleTheme: cycleTheme, ICONS: ICONS, animateIn: animateIn, rowAction: rowAction, actionCell: actionCell, repeatNote: repeatNote, outcomeLabel: outcomeLabel, isOverride: isOverride
  };
})();
