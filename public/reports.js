AP.boot({
  title: 'Reports', nav: 'reports', perm: 'reports',
  render: function (me, main) {
    var E = AP.esc;
    var SCOPE = { all: 'All claims', mine: 'Claims you submitted', quick: 'Claims routed to quick sign-off', detailed: 'Claims routed to detailed review' };
    var days = Number(AP.qs('days')) || 30;
    main.innerHTML =
      '<div class="page-head"><div><h1>Reports</h1><div class="sub" id="scope">Loading…</div></div>' +
      '<div class="actions"><label class="small muted" for="days" style="align-self:center">Period</label><select id="days" style="width:auto">' +
      [7, 30, 90].map(function (d) { return '<option value="' + d + '"' + (d === days ? ' selected' : '') + '>Last ' + d + ' days</option>'; }).join('') + '</select>' +
      (AP.can(me, 'export') ? '<a class="btn" href="/api/claims.csv">Export CSV</a>' : '') + '</div></div>' +
      '<div id="body" class="viz-root"><div class="loading-page"><span class="spinner"></span></div></div>' +
      '<div class="chart-tip" id="tip" role="status" hidden></div>';
    var body = document.getElementById('body'), tip = document.getElementById('tip');
    // Draw the line chart at the width it is shown, so its text stays at its real size.
    var chartW = 720;

    function dur(m) {
      if (m == null) return '—';
      if (m < 60) return Math.round(m) + ' min';
      if (m < 1440) return (m / 60).toFixed(1) + ' h';
      return (m / 1440).toFixed(1) + ' d';
    }
    function showTip(e, html) {
      tip.innerHTML = html; tip.hidden = false;
      var x = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14), y = e.clientY + 14;
      if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - 10;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }
    function hideTip() { tip.hidden = true; }
    function tableToggle(id) {
      return '<button type="button" class="btn small" data-table="' + id + '">Show table</button>';
    }

    // Line chart: submitted vs completed per day (two series, one axis).
    function lineChart(rows) {
      var W = chartW, H = 240, L = 36, R = 12, T = 14, B = 28;
      var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return Math.max(r.submitted, r.completed); })));
      var step = Math.max(1, Math.ceil(max / 4)); max = step * 4;
      var x = function (i) { return L + (rows.length === 1 ? 0 : i * (W - L - R) / (rows.length - 1)); };
      var y = function (v) { return T + (H - T - B) * (1 - v / max); };
      var grid = '', labels = '';
      for (var g = 0; g <= 4; g++) { var gy = y(g * step); grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" class="grid"/>'; labels += '<text x="' + (L - 8) + '" y="' + (gy + 4) + '" text-anchor="end" class="tick">' + g * step + '</text>'; }
      var every = Math.ceil(rows.length / Math.max(3, Math.floor(W / 110)));
      rows.forEach(function (r, i) { var last = rows.length - 1; if ((i % every === 0 && (i === last || last - i >= every / 2)) || i === last) labels += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle') + '" class="tick">' + E(r.day.slice(5)) + '</text>'; });
      var path = function (k) { return rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r[k]).toFixed(1); }).join(' '); };
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Claims submitted and completed per day" id="lineSvg">' + grid + labels +
        '<path d="' + path('submitted') + '" class="ln s1"/><path d="' + path('completed') + '" class="ln s2"/>' +
        '<line id="xhair" class="xhair" y1="' + T + '" y2="' + (H - B) + '" x1="0" x2="0" visibility="hidden"/>' +
        '<circle id="d1" r="4.5" class="dot s1" visibility="hidden"/><circle id="d2" r="4.5" class="dot s2" visibility="hidden"/>' +
        '<rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent" id="hit"/></svg>';
    }

    // Grouped horizontal bars: proposed vs confirmed decision.
    function decisionBars(rows) {
      var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return Math.max(r.proposed, r.confirmed); })));
      return '<div class="hbars">' + rows.map(function (r) {
        return '<div class="hbar-row"><div class="hbar-label">' + E(r.decision) + '</div><div class="hbar-pair">' +
          ['proposed', 'confirmed'].map(function (k, i) {
            var w = r[k] / max * 100;
            return '<div class="hbar-line" data-tip="' + E(r.decision) + '|' + (i ? 'Confirmed by handler' : 'Proposed by assessment') + '|' + r[k] + '">' +
              '<span class="hbar s' + (i + 1) + '" style="width:' + (r[k] ? Math.max(w, 1.5) : 0) + '%"></span><span class="hbar-val">' + r[k] + '</span></div>';
          }).join('') + '</div></div>';
      }).join('') + '</div>';
    }

    function barList(rows, labelKey) {
      var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.count; })));
      if (!rows.length) return '<div class="empty">No completed reviews in this period.</div>';
      return '<div class="hbars">' + rows.map(function (r) {
        return '<div class="hbar-row"><div class="hbar-label">' + E(r[labelKey]) + '</div><div class="hbar-pair"><div class="hbar-line" data-tip="' + E(r[labelKey]) + '|Reviews|' + r.count + '">' +
          '<span class="hbar s1" style="width:' + Math.max(r.count / max * 100, 1.5) + '%"></span><span class="hbar-val">' + r.count + '</span></div></div></div>';
      }).join('') + '</div>';
    }

    function table(id, head, rows) {
      return '<div class="table-wrap" id="' + id + '" hidden><table class="mini-table" style="margin-top:12px"><thead><tr>' + head.map(function (h) { return '<th>' + E(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + E(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    }

    function load() {
      body.style.opacity = body.children.length > 1 ? .5 : 1;
      AP.api('GET', '/api/reports?days=' + days).then(function (d) {
        body.style.opacity = 1;
        chartW = Math.max(300, Math.round(body.clientWidth - 42));
        document.getElementById('scope').textContent = (SCOPE[d.scope] || '') + ' · last ' + d.days + ' days';
        var t = d.totals;
        var tiles = [
          ['Claims', t.claims, null], ['Completed', t.completed, null], ['Awaiting review', t.awaiting, null], ['Did not finish', t.problems, null],
          ['Avg. submit to position', dur(t.avgTurnaroundMin), 'From submission to the finished coverage position'],
          ['Avg. review wait', dur(t.avgReviewWaitMin), 'From the review reaching the console to the handler\'s decision'],
          ['Handler overrides', t.reviewsDone ? t.overrides + ' of ' + t.reviewsDone : '—', 'Reviews where the handler changed the proposed decision']
        ];
        if (d.scope === 'all' || d.scope === 'mine') tiles.splice(4, 0, ['Quick / detailed', t.quick + ' / ' + t.detailed, 'Claims routed to quick sign-off / detailed review']);
        body.innerHTML =
          '<div class="grid-4" style="margin-bottom:16px">' + tiles.map(function (x) {
            return '<div class="card kpi"' + (x[2] ? ' title="' + E(x[2]) + '"' : '') + '><div class="label">' + E(x[0]) + '</div><div class="value">' + E(x[1]) + '</div>' + (x[2] ? '<div class="small muted">' + E(x[2]) + '</div>' : '') + '</div>';
          }).join('') + '</div>' +
          '<section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Claims per day</h2><div class="legend"><span class="key"><i class="ln-key s1"></i>Submitted</span><span class="key"><i class="ln-key s2"></i>Completed</span></div></div>' + tableToggle('t1') + '</div><div class="card-body">' +
            lineChart(d.perDay) + table('t1', ['Day', 'Submitted', 'Completed'], d.perDay.map(function (r) { return [r.day, r.submitted, r.completed]; })) + '</div></section>' +
          '<div class="grid-2">' +
          '<section class="card"><div class="card-head"><div><h2>Coverage decisions</h2><div class="legend"><span class="key"><i class="bar-key s1"></i>Proposed by assessment</span><span class="key"><i class="bar-key s2"></i>Confirmed by handler</span></div></div>' + tableToggle('t2') + '</div><div class="card-body">' +
            decisionBars(d.decisions) + table('t2', ['Decision', 'Proposed', 'Confirmed'], d.decisions.map(function (r) { return [r.decision, r.proposed, r.confirmed]; })) + '</div></section>' +
          '<section class="card"><div class="card-head"><div><h2>Review outcomes</h2><div class="small muted">Completed handler reviews</div></div>' + tableToggle('t3') + '</div><div class="card-body">' +
            barList(d.outcomes, 'outcome') + table('t3', ['Outcome', 'Reviews'], d.outcomes.map(function (r) { return [r.outcome, r.count]; })) + '</div></section>' +
          '</div>';
        wire(d);
        AP.animateIn(body, 'reports-' + days);
      }).catch(function (e) { body.innerHTML = '<div class="alert bad">' + E(e.message) + '</div>'; });
    }

    function wire(d) {
      body.querySelectorAll('[data-table]').forEach(function (b) {
        b.onclick = function () { var t = document.getElementById(b.dataset.table); t.hidden = !t.hidden; b.textContent = t.hidden ? 'Show table' : 'Hide table'; };
      });
      body.querySelectorAll('.hbar-line').forEach(function (el) {
        el.tabIndex = 0;
        var p = el.dataset.tip.split('|');
        var html = '<strong>' + E(p[2]) + '</strong> <span class="muted">' + E(p[1]) + '</span><div class="small">' + E(p[0]) + '</div>';
        el.addEventListener('pointermove', function (e) { showTip(e, html); });
        el.addEventListener('pointerleave', hideTip);
        el.addEventListener('focus', function () { var r = el.getBoundingClientRect(); showTip({ clientX: r.left + 40, clientY: r.top }, html); });
        el.addEventListener('blur', hideTip);
      });
      var svg = document.getElementById('lineSvg'); if (!svg) return;
      var rows = d.perDay, hit = document.getElementById('hit'), xh = document.getElementById('xhair'), d1 = document.getElementById('d1'), d2 = document.getElementById('d2');
      var W = chartW, L = 36, R = 12, H = 240, T = 14, B = 28;
      var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return Math.max(r.submitted, r.completed); }))); var step = Math.max(1, Math.ceil(max / 4)); max = step * 4;
      function at(e) {
        var box = svg.getBoundingClientRect(), px = (e.clientX - box.left) / box.width * W;
        var i = Math.round((px - L) / ((W - L - R) / Math.max(1, rows.length - 1))); i = Math.max(0, Math.min(rows.length - 1, i));
        var cx = L + (rows.length === 1 ? 0 : i * (W - L - R) / (rows.length - 1));
        var y = function (v) { return T + (H - T - B) * (1 - v / max); };
        xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
        d1.setAttribute('cx', cx); d1.setAttribute('cy', y(rows[i].submitted)); d1.setAttribute('visibility', 'visible');
        d2.setAttribute('cx', cx); d2.setAttribute('cy', y(rows[i].completed)); d2.setAttribute('visibility', 'visible');
        showTip(e, '<div class="small muted">' + E(AP.fmtDate(rows[i].day + 'T12:00:00', false)) + '</div><div><i class="ln-key s1"></i><strong>' + rows[i].submitted + '</strong> submitted</div><div><i class="ln-key s2"></i><strong>' + rows[i].completed + '</strong> completed</div>');
      }
      hit.addEventListener('pointermove', at);
      hit.addEventListener('pointerleave', function () { hideTip(); [xh, d1, d2].forEach(function (x) { x.setAttribute('visibility', 'hidden'); }); });
    }

    document.getElementById('days').onchange = function () {
      days = Number(this.value);
      var u = new URL(location.href); u.searchParams.set('days', days); history.replaceState(null, '', u);
      load();
    };
    load();
  }
});
