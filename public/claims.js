AP.boot({
  title: 'Claims', nav: 'claims',
  render: function (me, main) {
    var E = AP.esc;
    var FILTERS = [['all', 'All'], ['processing', 'In progress'], ['awaiting', 'Awaiting review'], ['completed', 'Completed'], ['problems', 'Need attention']];
    var status = AP.qs('status') || 'all';
    if (!FILTERS.some(function (f) { return f[0] === status; })) status = 'all';
    main.innerHTML =
      '<div class="page-head"><div><h1>' + (AP.can(me, 'view_all') ? 'All claims' : me.role === 'intake' ? 'My claims' : 'My claims to review') + '</h1><div class="sub">' +
      (AP.can(me, 'view_all') ? 'Every claim submitted for coverage assessment.' : me.role === 'intake' ? 'The claims you submitted for coverage assessment.' :
        AP.can(me, 'review_quick') ? 'Claims the assessment routed to quick sign-off.' : 'Claims the assessment routed to detailed review.') + '</div></div><div class="actions">' +
      (AP.can(me, 'users') ? '<button class="btn danger" id="clearAll" type="button">Clear claims</button>' : '') +
      (AP.can(me, 'export') ? '<a class="btn" href="/api/claims.csv">Export CSV</a>' : '') +
      (AP.can(me, 'submit') ? '<a class="btn primary" href="/new-claim.html">New claim</a>' : '') + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="toolbar" style="flex:1">' +
      '<input type="search" id="q" placeholder="Search claims" aria-label="Search claims">' +
      '<select id="st" aria-label="Filter by status">' + FILTERS.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === status ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select>' +
      '</div>' + (AP.can(me, 'users') ? '<div class="select-bar" id="selBar" hidden><span id="selCount"></span><button class="btn small" id="selNone" type="button">Clear selection</button><button class="btn small danger" id="selRemove" type="button">Remove selected</button></div>' : '') +
      '</div><div id="list"><div class="loading-page"><span class="spinner"></span></div></div></div>';
    var rows = [];
    var admin = AP.can(me, 'users'), picked = {};
    var list = document.getElementById('list');
    function match(r) {
      var s = document.getElementById('st').value;
      if (s === 'processing' && !(r.status === 'processing' || r.status === 'queued')) return false;
      if (s === 'awaiting' && r.status.indexOf('awaiting') !== 0) return false;
      if (s === 'completed' && r.status !== 'completed') return false;
      if (s === 'problems' && ['failed', 'cancelled', 'timed_out'].indexOf(r.status) < 0) return false;
      var q = document.getElementById('q').value.trim().toLowerCase();
      if (!q) return true;
      return [r.claimReference, r.insuredName, r.policyNumber, r.title, r.createdByName].join(' ').toLowerCase().indexOf(q) >= 0;
    }
    function draw() {
      var shown = rows.filter(match);
      if (!rows.length) { list.innerHTML = '<div class="empty">No claims yet.</div>'; selBar(); return; }
      if (!shown.length) { list.innerHTML = '<div class="empty">No claims match these filters.</div>'; selBar(); return; }
      var allOn = shown.length && shown.every(function (r) { return picked[r.id]; });
      list.innerHTML = '<div class="table-wrap"><table class="data cards"><thead><tr>' +
        (admin ? '<th class="pick"><input type="checkbox" id="pickAll" aria-label="Select all shown claims"' + (allOn ? ' checked' : '') + '></th>' : '') + '<th>Claim</th><th>Policy</th><th>Status</th><th>Coverage decision</th><th>Submitted</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>' +
        shown.map(function (r) {
          var prog = '';
          if ((r.status === 'processing' || r.status === 'queued') && r.progress) {
            prog = '<div class="sub">' + E(r.progress.running || 'Starting') + '</div>';
          }
          if (r.error && ['failed', 'cancelled', 'timed_out'].indexOf(r.status) >= 0) prog = '<div class="sub">' + E(r.error) + '</div>';
          return '<tr class="click' + (picked[r.id] ? ' picked' : '') + '" data-id="' + E(r.id) + '">' +
            (admin ? '<td class="pick"><input type="checkbox" class="pick-one" data-id="' + E(r.id) + '" aria-label="Select ' + E(r.claimReference || r.title || 'claim') + '"' + (picked[r.id] ? ' checked' : '') + '></td>' : '') +
            '<td data-label="Claim"><div class="primary-cell">' + E(r.claimReference || 'Reference pending') + (r.sampleId ? ' <span class="pill plain">Sample</span>' : '') + '</div><div class="sub">' + E([r.insuredName, r.title].filter(Boolean).join(' · ')) + '</div><div class="sub mono">Case ' + E(r.id) + '</div></td>' +
            '<td data-label="Policy">' + (r.policyNumber ? '<span class="id">' + E(r.policyNumber) + '</span>' : '<span class="muted">—</span>') + '</td>' +
            '<td data-label="Status">' + AP.casePill(r) + prog + AP.repeatNote(r) + '</td>' +
            '<td data-label="Coverage decision">' + AP.decisionPill(r.decision, r.decision ? r.decisionConfirmed : undefined) + '</td>' +
            '<td data-label="Submitted" class="nowrap">' + AP.fmtDate(r.createdAt) + '<div class="sub">' + E(r.createdByName || '') + '</div></td>' + AP.actionCell(r, me) + '</tr>';
        }).join('') + '</tbody></table></div>';
      list.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('.pick') || e.target.closest('.row-action a')) return; location.href = '/claim.html?id=' + encodeURIComponent(tr.dataset.id); }; });
      if (admin) {
        list.querySelectorAll('td.pick').forEach(function (td) { td.onclick = function (e) { if (e.target.tagName !== 'INPUT') { var cb = td.querySelector('input'); cb.checked = !cb.checked; cb.onchange(); } }; });
        list.querySelectorAll('.pick-one').forEach(function (cb) { cb.onchange = function () { if (cb.checked) picked[cb.dataset.id] = 1; else delete picked[cb.dataset.id]; draw(); }; });
        var pa = document.getElementById('pickAll');
        if (pa) pa.onchange = function () { shown.forEach(function (r) { if (pa.checked) picked[r.id] = 1; else delete picked[r.id]; }); draw(); };
      }
      selBar();
    }
    function selBar() {
      if (!admin) return;
      Object.keys(picked).forEach(function (id) { if (!rows.some(function (r) { return r.id === id; })) delete picked[id]; });
      var n = Object.keys(picked).length;
      document.getElementById('selBar').hidden = !n;
      document.getElementById('selCount').textContent = n + ' selected';
    }
    var KEEP = 3;
    function removeClaims(body, n) {
      var title, text, go;
      if (body.all) {
        var going = rows.length - KEEP;
        if (going <= 0) {
          AP.modal('Nothing to clear', '<p>' + (rows.length ? 'Clearing always keeps the ' + KEEP + ' most recent claims, and there ' + (rows.length === 1 ? 'is only 1 claim.' : 'are only ' + rows.length + ' claims.') : 'There are no claims to clear.') + '</p>', [{ label: 'Close' }]);
          return;
        }
        title = 'Clear claims?';
        text = 'Remove ' + going + ' of the ' + rows.length + ' claims, keeping the ' + KEEP + ' most recent? This ignores the search and filter above.';
        go = 'Clear ' + going;
      } else {
        title = 'Remove ' + (n === 1 ? 'claim' : n + ' claims') + '?';
        text = 'Remove ' + (n === 1 ? 'this claim' : 'these ' + n + ' claims') + '?';
        go = 'Remove';
      }
      AP.modal(title, '<p>' + text + ' Their reviews are removed too. The documents and the assessment records are not deleted, and this cannot be undone here.</p>', [
        { label: 'Cancel' },
        { label: go, danger: true, onClick: function () {
          AP.api('POST', '/api/claims/remove', body).then(function (j) { picked = {}; AP.toast(j.removed + (j.removed === 1 ? ' claim' : ' claims') + ' removed'); load(); })
            .catch(function (e) { AP.toast(e.message); });
        } }
      ]);
    }
    if (admin) {
      document.getElementById('selNone').onclick = function () { picked = {}; draw(); };
      document.getElementById('selRemove').onclick = function () { var ids = Object.keys(picked); removeClaims({ ids: ids }, ids.length); };
      document.getElementById('clearAll').onclick = function () { removeClaims({ all: true }, rows.length); };
    }
    function load() {
      AP.api('GET', '/api/claims').then(function (j) { rows = j.claims; draw(); })
        .catch(function (e) { list.innerHTML = '<div class="card-body"><div class="alert bad">' + E(e.message) + '</div></div>'; });
    }
    document.getElementById('q').addEventListener('input', draw);
    document.getElementById('st').addEventListener('change', function () {
      var u = new URL(location.href); u.searchParams.set('status', this.value); history.replaceState(null, '', u); draw();
    });
    load();
    setInterval(function () { if (!document.hidden) load(); }, 15000);
  }
});
