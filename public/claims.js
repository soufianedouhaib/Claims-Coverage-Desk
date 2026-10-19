AP.boot({
  title: 'Claims', nav: 'claims',
  render: function (me, main) {
    var E = AP.esc;
    var FILTERS = [['all', 'All'], ['processing', 'In progress'], ['awaiting', 'Awaiting review'], ['completed', 'Completed'], ['problems', 'Need attention']];
    var status = AP.qs('status') || 'all';
    if (!FILTERS.some(function (f) { return f[0] === status; })) status = 'all';
    main.innerHTML =
      '<div class="page-head"><div><h1>Claims</h1><div class="sub">Every claim submitted for coverage assessment.</div></div><div class="actions">' +
      (AP.can(me, 'export') ? '<a class="btn" href="/api/claims.csv">Export CSV</a>' : '') +
      (AP.can(me, 'submit') ? '<a class="btn primary" href="/new-claim.html">New claim</a>' : '') + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="toolbar" style="flex:1">' +
      '<input type="search" id="q" placeholder="Search claims" aria-label="Search claims">' +
      '<select id="st" aria-label="Filter by status">' + FILTERS.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === status ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select>' +
      '</div></div><div id="list"><div class="loading-page"><span class="spinner"></span></div></div></div>';
    var rows = [];
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
      if (!rows.length) { list.innerHTML = '<div class="empty">No claims yet.</div>'; return; }
      if (!shown.length) { list.innerHTML = '<div class="empty">No claims match these filters.</div>'; return; }
      list.innerHTML = '<div class="table-wrap"><table class="data cards"><thead><tr><th>Claim</th><th>Policy</th><th>Status</th><th>Coverage decision</th><th>Submitted</th></tr></thead><tbody>' +
        shown.map(function (r) {
          var prog = '';
          if ((r.status === 'processing' || r.status === 'queued') && r.progress) {
            prog = '<div class="sub">' + E(r.progress.running || 'Starting') + '</div>';
          }
          if (r.error && ['failed', 'cancelled', 'timed_out'].indexOf(r.status) >= 0) prog = '<div class="sub">' + E(r.error) + '</div>';
          return '<tr class="click" data-id="' + E(r.id) + '">' +
            '<td data-label="Claim"><div class="primary-cell">' + E(r.claimReference || 'Reference pending') + (r.sampleId ? ' <span class="pill plain">Test sample</span>' : '') + '</div><div class="sub">' + E([r.insuredName, r.title].filter(Boolean).join(' · ')) + '</div></td>' +
            '<td data-label="Policy">' + (r.policyNumber ? '<span class="id">' + E(r.policyNumber) + '</span>' : '<span class="muted">—</span>') + '</td>' +
            '<td data-label="Status">' + AP.casePill(r) + prog + '</td>' +
            '<td data-label="Coverage decision">' + AP.decisionPill(r.decision, r.decision ? r.decisionConfirmed : undefined) + '</td>' +
            '<td data-label="Submitted" class="nowrap">' + AP.fmtDate(r.createdAt) + '<div class="sub">' + E(r.createdByName || '') + '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
      list.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function () { location.href = '/claim.html?id=' + encodeURIComponent(tr.dataset.id); }; });
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
