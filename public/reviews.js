AP.boot({
  title: 'Reviews', nav: 'reviews', perm: ['review_quick', 'review_detailed'],
  render: function (me, main) {
    var E = AP.esc;
    var KIND_LABEL = { detailed: 'Detailed reviews', quick: 'Quick sign-offs' };
    var KIND_HELP = {
      detailed: 'Complex, high-value, low-confidence, partial or not-covered assessments. Confirm, override or ask for clarification.',
      quick: 'Clear covered assessments. Confirm, or record a non-binding override or return it for further review.'
    };
    var state = { kind: AP.qs('kind'), show: AP.qs('show') || 'pending', rows: [], kinds: [] };
    main.innerHTML =
      '<div class="page-head"><div><h1>Reviews</h1><div class="sub">Coverage assessments waiting for a claims handler. A review confirms the coverage position only; it never authorises payment.</div></div></div>' +
      '<div class="card"><div class="card-head" style="padding-bottom:0;border-bottom:0"><div class="tabs" id="tabs" style="margin:0;flex:1" role="tablist"></div></div>' +
      '<div class="card-head"><div class="small muted" id="help" style="flex:1;min-width:200px"></div><select id="show" aria-label="Show"><option value="pending">Waiting</option><option value="done">Completed or closed</option><option value="all">All</option></select></div>' +
      '<div id="list"><div class="loading-page"><span class="spinner"></span></div></div></div>';
    var list = document.getElementById('list');
    document.getElementById('show').value = state.show;

    function draw() {
      if (state.kinds.indexOf(state.kind) < 0) state.kind = state.kinds[0];
      document.getElementById('tabs').innerHTML = state.kinds.map(function (k) {
        var n = state.rows.filter(function (r) { return r.kind === k && r.status === 'pending'; }).length;
        return '<button type="button" role="tab" data-k="' + k + '" aria-selected="' + (k === state.kind) + '" class="' + (k === state.kind ? 'active' : '') + '">' + KIND_LABEL[k] + '<span class="count">' + n + '</span></button>';
      }).join('');
      document.querySelectorAll('#tabs button').forEach(function (b) { b.onclick = function () { state.kind = b.dataset.k; sync(); draw(); }; });
      document.getElementById('help').textContent = KIND_HELP[state.kind] || '';
      var rows = state.rows.filter(function (r) {
        if (r.kind !== state.kind) return false;
        if (state.show === 'pending') return r.status === 'pending' || r.status === 'submitting';
        if (state.show === 'done') return r.status !== 'pending' && r.status !== 'submitting';
        return true;
      });
      if (!rows.length) { list.innerHTML = '<div class="empty">' + (state.show === 'pending' ? 'Nothing waiting. New reviews appear here automatically.' : 'No reviews to show.') + '</div>'; return; }
      list.innerHTML = '<div class="table-wrap"><table class="data cards"><thead><tr><th>Claim</th><th>Proposed decision</th><th>Confidence</th><th>' + (state.show === 'pending' ? 'Waiting' : 'Received') + '</th><th>Status</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr class="click" data-id="' + E(r.id) + '"><td data-label="Claim"><div class="primary-cell">' + E(r.claimReference || 'Reference not read') + '</div><div class="sub">' + E([r.insuredName, r.claimTitle].filter(Boolean).join(' · ') || (r.claimId ? '' : 'Not matched to a claim yet')) + '</div></td>' +
            '<td data-label="Proposed decision">' + AP.decisionPill(r.proposedDecision) + '</td>' +
            '<td data-label="Confidence">' + AP.fmtPct(r.confidence) + '</td>' +
            '<td data-label="' + (state.show === 'pending' ? 'Waiting' : 'Received') + '" class="nowrap">' + (state.show === 'pending' ? AP.fmtRel(r.receivedAt) : AP.fmtDate(r.receivedAt)) + '</td>' +
            '<td data-label="Status">' + AP.reviewStatusPill(r.status) + (r.completedByName ? '<div class="sub">' + E(r.outcome || '') + ' · ' + E(r.completedByName) + '</div>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      list.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function () { location.href = '/review.html?id=' + encodeURIComponent(tr.dataset.id); }; });
    }
    function sync() {
      var u = new URL(location.href); u.searchParams.set('kind', state.kind); u.searchParams.set('show', state.show); history.replaceState(null, '', u);
    }
    document.getElementById('show').onchange = function () { state.show = this.value; sync(); draw(); };
    function load() {
      AP.api('GET', '/api/reviews').then(function (j) { state.rows = j.reviews; state.kinds = j.kinds; draw(); AP.refreshBadge(); })
        .catch(function (e) { list.innerHTML = '<div class="card-body"><div class="alert bad">' + E(e.message) + '</div></div>'; });
    }
    load();
    setInterval(function () { if (!document.hidden) load(); }, 10000);
  }
});
