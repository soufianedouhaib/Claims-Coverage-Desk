AP.boot({
  title: 'Dashboard', nav: 'dashboard',
  render: function (me, main) {
    var E = AP.esc;
    main.innerHTML =
      '<div class="page-head"><div><h1>Good to see you, ' + E(me.name.split(' ')[0]) + '</h1><div class="sub">Claims moving through coverage assessment.</div></div>' +
      '<div class="actions">' + (AP.can(me, 'submit') ? '<a class="btn primary" href="/new-claim.html">New claim</a>' : '') + '</div></div>' +
      (me.storageReady ? '' : '<div class="alert warn" style="margin-bottom:16px">Storage is not connected yet, so claims and reviews will not be kept. ' + (AP.can(me, 'system') ? 'Connect a Redis store in the hosting settings and redeploy.' : 'Please tell your administrator.') + '</div>') +
      '<div id="body"><div class="loading-page"><span class="spinner"></span></div></div>';
    var body = document.getElementById('body');

    function load() {
      AP.api('GET', '/api/dashboard').then(function (d) {
        var c = d.counts, q = d.queues;
        var tiles = [
          ['In progress', c.processing, '/claims.html?status=processing'],
          ['Awaiting review', c.awaiting, '/claims.html?status=awaiting'],
          ['Completed (7 days)', c.completed7d, '/claims.html?status=completed'],
          ['Need attention', c.problems, '/claims.html?status=problems']
        ];
        var queues = '';
        if (q.quick != null || q.detailed != null) {
          queues = '<div class="card card-pad" style="margin-bottom:16px"><div class="page-head" style="margin:0 0 10px"><h2>Your review queues</h2><a class="btn small" href="/reviews.html">Open reviews</a></div><div class="grid-2">' +
            (q.detailed != null ? '<a class="card kpi" href="/reviews.html?kind=detailed" style="text-decoration:none;color:inherit"><div class="label">Detailed reviews waiting</div><div class="value">' + q.detailed + '</div><div class="small muted">Complex, high-value, low-confidence or not-covered assessments</div></a>' : '') +
            (q.quick != null ? '<a class="card kpi" href="/reviews.html?kind=quick" style="text-decoration:none;color:inherit"><div class="label">Quick sign-offs waiting</div><div class="value">' + q.quick + '</div><div class="small muted">Clear covered assessments to confirm</div></a>' : '') +
            '</div></div>';
        }
        body.innerHTML =
          '<div class="grid-4" style="margin-bottom:16px">' + tiles.map(function (t) {
            return '<a class="card kpi" href="' + t[2] + '" style="text-decoration:none;color:inherit"><div class="label">' + t[0] + '</div><div class="value">' + t[1] + '</div></a>';
          }).join('') + '</div>' + queues +
          '<div class="card"><div class="card-head"><h2>Recent claims</h2><a class="small" href="/claims.html">All claims</a></div>' +
          (d.recent.length ? '<div class="table-wrap"><table class="data cards"><thead><tr><th>Claim</th><th>Status</th><th>Decision</th><th>Submitted</th></tr></thead><tbody>' +
            d.recent.map(function (r) {
              return '<tr class="click" data-id="' + E(r.id) + '"><td data-label="Claim"><div class="primary-cell">' + E(r.claimReference || r.title) + '</div><div class="sub">' + E(r.insuredName || (r.claimReference ? r.title : '')) + '</div></td>' +
                '<td data-label="Status">' + AP.casePill(r) + '</td><td data-label="Decision">' + AP.decisionPill(r.decision, r.decision ? r.decisionConfirmed : undefined) + '</td>' +
                '<td data-label="Submitted" class="nowrap">' + AP.fmtRel(r.createdAt) + '<div class="sub">' + E(r.createdByName || '') + '</div></td></tr>';
            }).join('') + '</tbody></table></div>'
            : '<div class="empty">No claims yet.' + (AP.can(me, 'submit') ? ' <a href="/new-claim.html">Submit the first one</a>.' : '') + '</div>') +
          '</div>';
        AP.animateIn(body, 'dashboard');
        body.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function () { location.href = '/claim.html?id=' + encodeURIComponent(tr.dataset.id); }; });
      }).catch(function (e) { body.innerHTML = '<div class="alert bad">' + E(e.message) + '</div>'; });
    }
    load();
    setInterval(function () { if (!document.hidden) load(); }, 20000);
  }
});
