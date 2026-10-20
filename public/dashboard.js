AP.boot({
  title: 'Dashboard', nav: 'dashboard',
  render: function (me, main) {
    var E = AP.esc;
    main.innerHTML =
      '<div class="page-head"><div><h1>Good to see you, ' + E(me.name === me.roleLabel || me.name.split(' ').length < 2 ? me.name : me.name.split(' ')[0]) + '</h1><div class="sub">' + (AP.can(me, 'view_all') ? 'Every claim moving through coverage assessment.' : AP.can(me, 'submit') ? 'The claims you submitted for coverage assessment.' : 'The claims routed to you for review.') + '</div></div>' +
      '<div class="actions" id="headActions"></div></div>' +
      (me.storageReady ? '' : '<div class="alert warn" style="margin-bottom:16px">Storage is not connected yet, so claims and reviews will not be kept. ' + (AP.can(me, 'system') ? 'Connect a Redis store in the hosting settings and redeploy.' : 'Please tell your administrator.') + '</div>') +
      '<div id="body"><div class="loading-page"><span class="spinner"></span></div></div>';
    var body = document.getElementById('body');

    var reviewer = AP.can(me, 'review_quick') || AP.can(me, 'review_detailed');
    var KIND_NOUN = { quick: ['quick sign-off', 'quick sign-offs'], detailed: ['detailed review', 'detailed reviews'] };
    function waited(iso) { var m = (Date.now() - Date.parse(iso)) / 60000; return m < 60 ? Math.max(1, Math.round(m)) + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' days'; }

    // One banner on top: the most important thing for this person, with the action that clears it.
    function banner(d) {
      var c = d.counts, n = d.next;
      if (n && reviewer) {
        var words = AP.can(me, 'review_quick') && AP.can(me, 'review_detailed') ? (n.count === 1 ? 'review' : 'reviews') : KIND_NOUN[n.kind][n.count === 1 ? 0 : 1];
        return '<div class="attn warn" role="status"><div><strong>' + n.count + ' ' + words + ' waiting for you.</strong> The oldest has waited ' + waited(n.receivedAt) + '.</div>' +
          '<a class="btn primary" href="/review.html?id=' + encodeURIComponent(n.id) + '">' + (n.kind === 'quick' ? 'Confirm next' : 'Review next') + '</a></div>';
      }
      if (c.problems) {
        return '<div class="attn bad" role="status"><div><strong>' + c.problems + (c.problems === 1 ? ' claim' : ' claims') + ' did not finish.</strong> Open ' + (c.problems === 1 ? 'it' : 'them') + ' to see where the assessment stopped.</div>' +
          '<a class="btn" href="/claims.html?status=problems">See ' + (c.problems === 1 ? 'it' : 'them') + '</a></div>';
      }
      if (c.awaiting && !reviewer) {
        return '<div class="attn info" role="status"><div><strong>' + c.awaiting + (c.awaiting === 1 ? ' claim is' : ' claims are') + ' waiting for a handler.</strong> Nothing to do on your side; ' + (c.awaiting === 1 ? 'it moves' : 'they move') + ' on once reviewed.</div>' +
          '<a class="btn" href="/claims.html?status=awaiting">See ' + (c.awaiting === 1 ? 'it' : 'them') + '</a></div>';
      }
      return '<div class="attn ok" role="status"><div><strong>Nothing needs your attention.</strong> ' + (reviewer ? 'New reviews appear in your queue automatically.' : 'Every claim is either moving or finished.') + '</div></div>';
    }

    function load() {
      AP.api('GET', '/api/dashboard').then(function (d) {
        var c = d.counts, q = d.queues;
        // Primary action in the page header, by role.
        var act = document.getElementById('headActions'), html = '';
        if (AP.can(me, 'submit')) html += '<a class="btn primary" href="/new-claim.html">New claim</a>';
        if (reviewer) {
          if (d.next && !AP.can(me, 'submit')) html += '<a class="btn primary" href="/review.html?id=' + encodeURIComponent(d.next.id) + '">' + (d.next.kind === 'quick' ? 'Confirm next' : 'Review next') + '</a>';
          html += '<a class="btn' + (!d.next && !AP.can(me, 'submit') ? ' primary' : '') + '" href="/reviews.html">' + (AP.can(me, 'review_quick') && AP.can(me, 'review_detailed') ? 'Review queues' : 'My review queue') + '</a>';
        }
        act.innerHTML = html;
        var tiles = [
          ['In progress', c.processing, '/claims.html?status=processing', 'Being read and assessed right now'],
          ['Awaiting review', c.awaiting, '/claims.html?status=awaiting', 'Assessed, waiting for a handler to confirm'],
          ['Completed (7 days)', c.completed7d, '/claims.html?status=completed', 'Coverage position finished in the last 7 days'],
          ['Need attention', c.problems, '/claims.html?status=problems', 'Stopped before finishing; open one to see where']
        ];
        var queues = '';
        if (q.quick != null || q.detailed != null) {
          var qcard = function (kind, n, label, help) {
            return '<a class="card kpi" href="/reviews.html?kind=' + kind + '" style="text-decoration:none;color:inherit"><div class="label">' + label + '</div><div class="value">' + n + '</div><div class="small muted">' + help + '</div></a>';
          };
          queues = '<div class="card card-pad" style="margin-bottom:16px"><div class="page-head" style="margin:0 0 10px"><h2>Your review queue' + (q.quick != null && q.detailed != null ? 's' : '') + '</h2></div><div class="grid-2">' +
            (q.detailed != null ? qcard('detailed', q.detailed, 'Detailed reviews waiting', 'Complex, high-value, low-confidence, partial or not-covered assessments') : '') +
            (q.quick != null ? qcard('quick', q.quick, 'Quick sign-offs waiting', 'Clear covered assessments to confirm') : '') +
            '</div></div>';
        }
        body.innerHTML = banner(d) +
          '<div class="grid-4" style="margin-bottom:16px">' + tiles.map(function (t) {
            return '<a class="card kpi" href="' + t[2] + '" style="text-decoration:none;color:inherit"><div class="label">' + t[0] + '</div><div class="value">' + t[1] + '</div><div class="small muted">' + t[3] + '</div></a>';
          }).join('') + '</div>' + queues +
          '<div class="card"><div class="card-head"><h2>Recent claims</h2><a class="btn small" href="/claims.html">' + (AP.can(me, 'view_all') ? 'All claims' : 'All my claims') + '</a></div>' +
          (d.recent.length ? '<div class="table-wrap"><table class="data cards"><thead><tr><th>Claim</th><th>Status</th><th>Decision</th><th>Submitted</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>' +
            d.recent.map(function (r) {
              return '<tr class="click" data-id="' + E(r.id) + '"><td data-label="Claim"><div class="primary-cell">' + E(r.claimReference || r.title) + '</div><div class="sub">' + E(r.insuredName || (r.claimReference ? r.title : '')) + '</div></td>' +
                '<td data-label="Status">' + AP.casePill(r) + AP.repeatNote(r) + '</td><td data-label="Decision">' + AP.decisionPill(r.decision, r.decision ? r.decisionConfirmed : undefined) + '</td>' +
                '<td data-label="Submitted" class="nowrap">' + AP.fmtRel(r.createdAt) + '<div class="sub">' + E(r.createdByName || '') + '</div></td>' + AP.actionCell(r, me) + '</tr>';
            }).join('') + '</tbody></table></div>'
            : '<div class="empty">No claims yet.' + (AP.can(me, 'submit') ? ' <a href="/new-claim.html">Submit the first one</a>.' : '') + '</div>') +
          '</div>';
        AP.animateIn(body, 'dashboard');
        body.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('.row-action a')) return; location.href = '/claim.html?id=' + encodeURIComponent(tr.dataset.id); }; });
      }).catch(function (e) { body.innerHTML = '<div class="alert bad">' + E(e.message) + '</div>'; });
    }
    load();
    setInterval(function () { if (!document.hidden) load(); }, 20000);
  }
});
