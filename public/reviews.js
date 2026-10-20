AP.boot({
  title: 'Reviews', nav: 'reviews', perm: ['review_quick', 'review_detailed'],
  render: function (me, main) {
    var E = AP.esc;
    var KIND_LABEL = { detailed: 'Detailed reviews', quick: 'Quick sign-offs' };
    var KIND_HELP = {
      detailed: 'Complex, high-value, low-confidence, partial or not-covered assessments. Confirm, override or ask for clarification.',
      quick: 'Clear covered assessments. Confirm, or record a non-binding override or return it for further review.'
    };
    var state = { kind: AP.qs('kind'), rows: [], kinds: [] };
    var PENDING = ['pending', 'submitting'];
    main.innerHTML =
      '<div class="page-head"><div><h1 id="title">Reviews</h1><div class="sub">Assessments routed to you. A review confirms the coverage position only; it never authorises payment.</div></div></div>' +
      '<div class="tabs" id="tabs" role="tablist" hidden></div>' +
      '<div class="small muted" id="help" style="margin:-4px 0 14px"></div>' +
      '<section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Waiting for review <span class="count-pill" id="nPending">0</span></h2></div><div id="pendingList"><div class="loading-page"><span class="spinner"></span></div></div></section>' +
      '<section class="card"><div class="card-head"><h2>Previous reviews <span class="count-pill" id="nDone">0</span></h2></div><div id="doneList"></div></section>';

    function table(rows, pending) {
      return '<div class="table-wrap"><table class="data cards"><thead><tr><th>Claim</th><th>Proposed decision</th><th>Confidence</th><th>' + (pending ? 'Waiting' : 'Reviewed') + '</th><th>' + (pending ? 'Status' : 'Outcome') + '</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var when = pending ? AP.fmtRel(r.receivedAt) : AP.fmtDate(r.completedAt || r.receivedAt);
          var last = pending ? AP.reviewStatusPill(r.status)
            : (r.confirmedDecision ? AP.decisionPill(r.confirmedDecision, true) : AP.reviewStatusPill(r.status)) +
              '<div class="sub">' + E([r.outcome, r.completedByName].filter(Boolean).join(' · ')) + '</div>';
          return '<tr class="click" data-id="' + E(r.id) + '"><td data-label="Claim"><div class="primary-cell">' + E(r.claimReference || 'Reference not read') + '</div><div class="sub">' + E([r.insuredName, r.claimTitle].filter(Boolean).join(' · ') || (r.claimId ? '' : 'Not matched to a claim yet')) + '</div></td>' +
            '<td data-label="Proposed decision">' + AP.decisionPill(r.proposedDecision) + '</td>' +
            '<td data-label="Confidence">' + AP.fmtPct(r.confidence) + '</td>' +
            '<td data-label="' + (pending ? 'Waiting' : 'Reviewed') + '" class="nowrap">' + when + '</td>' +
            '<td data-label="' + (pending ? 'Status' : 'Outcome') + '">' + last + '</td>' + AP.actionCell(r, me) + '</tr>';
        }).join('') + '</tbody></table></div>';
    }

    function draw() {
      if (state.kinds.indexOf(state.kind) < 0) state.kind = state.kinds[0];
      var tabs = document.getElementById('tabs');
      // Reviewers only ever have their own review type, so no tabs; the administrator can switch.
      tabs.hidden = state.kinds.length < 2;
      tabs.innerHTML = state.kinds.map(function (k) {
        var n = state.rows.filter(function (r) { return r.kind === k && PENDING.indexOf(r.status) >= 0; }).length;
        return '<button type="button" role="tab" data-k="' + k + '" aria-selected="' + (k === state.kind) + '" class="' + (k === state.kind ? 'active' : '') + '">' + KIND_LABEL[k] + '<span class="count">' + n + '</span></button>';
      }).join('');
      tabs.querySelectorAll('button').forEach(function (b) { b.onclick = function () { state.kind = b.dataset.k; sync(); draw(); }; });
      document.getElementById('title').textContent = state.kinds.length < 2 ? (KIND_LABEL[state.kind] || 'Reviews') : 'Reviews';
      document.getElementById('help').textContent = KIND_HELP[state.kind] || '';
      var mine = state.rows.filter(function (r) { return r.kind === state.kind; });
      var pending = mine.filter(function (r) { return PENDING.indexOf(r.status) >= 0; })
        .sort(function (a, b) { return String(a.receivedAt).localeCompare(String(b.receivedAt)); }); // oldest waiting first
      var done = mine.filter(function (r) { return PENDING.indexOf(r.status) < 0; })
        .sort(function (a, b) { return String(b.completedAt || b.receivedAt).localeCompare(String(a.completedAt || a.receivedAt)); });
      document.getElementById('nPending').textContent = pending.length;
      document.getElementById('nDone').textContent = done.length;
      var pl = document.getElementById('pendingList'), dl = document.getElementById('doneList');
      pl.innerHTML = pending.length ? table(pending, true) : '<div class="empty">Nothing waiting. New reviews appear here automatically.</div>';
      dl.innerHTML = done.length ? table(done, false) : '<div class="empty">No previous reviews yet.</div>';
      main.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('.row-action a')) return; location.href = '/review.html?id=' + encodeURIComponent(tr.dataset.id); }; });
    }
    function sync() {
      var u = new URL(location.href); u.searchParams.set('kind', state.kind); u.searchParams.delete('show'); history.replaceState(null, '', u);
    }
    function load() {
      AP.api('GET', '/api/reviews').then(function (j) { state.rows = j.reviews; state.kinds = j.kinds; draw(); AP.refreshBadge(); })
        .catch(function (e) { document.getElementById('pendingList').innerHTML = '<div class="card-body"><div class="alert bad">' + E(e.message) + '</div></div>'; });
    }
    load();
    setInterval(function () { if (!document.hidden) load(); }, 10000);
  }
});
