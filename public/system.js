// Admin-only setup page. Not linked in the menu: open /system.html directly.
AP.boot({
  title: 'System', nav: null, perm: 'system',
  render: function (me, main) {
    var E = AP.esc;
    main.innerHTML = '<div id="body"><div class="loading-page"><span class="spinner"></span></div></div>';
    var body = document.getElementById('body');
    function yes(b) { return b ? '<span class="pill ok">Set</span>' : '<span class="pill bad">Missing</span>'; }
    function load() {
      AP.api('GET', '/api/system').then(function (s) {
        body.innerHTML =
          '<div class="page-head"><div><h1>System</h1><div class="sub">Deployment settings. Only administrators can open this page.</div></div></div>' +
          (s.missing.length ? '<div class="alert warn" style="margin-bottom:16px"><strong>Still to set:</strong> ' + s.missing.map(E).join(', ') + '. Redeploy after changing environment variables.</div>' : '<div class="alert ok" style="margin-bottom:16px">All required settings are in place.</div>') +
          '<div class="grid-2" style="margin-bottom:16px">' +
          '<section class="card"><div class="card-head"><h2>Review steps webhook</h2></div><div class="card-body stack">' +
          '<p class="small muted" style="margin:0">In the workflow builder, set <strong>both</strong> handler review steps to run off-platform and point them here. Add the header below with the value of REVIEW_WEBHOOK_SECRET.</p>' +
          AP.kv([
            ['Webhook URL', '<code class="wrap-any" style="display:block;margin-bottom:6px">' + E(s.reviewWebhook.url) + '</code><button class="btn small" type="button" id="cpUrl">Copy</button>', true],
            ['Header name', '<code>' + E(s.reviewWebhook.header) + '</code>', true],
            ['Header value', yes(s.reviewWebhook.secretSet) + ' <span class="small muted">REVIEW_WEBHOOK_SECRET</span>', true],
            ['Last review received', s.reviewWebhook.lastReceivedAt ? AP.fmtDate(s.reviewWebhook.lastReceivedAt) : '<span class="muted">Never</span>', true],
            ['Last delivery attempt', s.reviewWebhook.lastAttempt ? AP.fmtDate(s.reviewWebhook.lastAttempt.at) + ' · <strong>' + E(s.reviewWebhook.lastAttempt.status) + '</strong> ' + E(s.reviewWebhook.lastAttempt.note) + (s.reviewWebhook.lastAttempt.kind ? ' · ' + E(s.reviewWebhook.lastAttempt.kind) : '') : '<span class="muted">None yet</span>', true]
          ]) + '</div></section>' +
          '<section class="card"><div class="card-head"><h2>Connection</h2></div><div class="card-body">' + AP.kv([
            ['Workflow ID', '<code class="wrap-any">' + E(s.workflowId) + '</code>', true],
            ['Service URL', '<code class="wrap-any">' + E(s.serviceBaseUrl) + '</code>', true],
            ['Service key', yes(s.serviceKeySet) + ' <span class="small muted">OPUS_SERVICE_KEY</span>', true],
            ['Session secret', yes(s.sessionSecretSet) + ' <span class="small muted">SESSION_SECRET</span>', true],
            ['Storage', (s.storage.kind === 'memory' ? '<span class="pill bad">Not connected</span>' : '<span class="pill ok">' + E(s.storage.kind) + '</span>') + (s.storage.envNames.length ? ' <span class="small muted">' + s.storage.envNames.map(E).join(', ') + '</span>' : ''), true],
            ['Case-finished callback', E(s.caseCallback), true],
            ['Evidence input type', '<code>' + E(s.evidenceInputType) + '</code>', true],
            ['Totals', s.counts.claims + ' claims, ' + s.counts.reviews + ' reviews (' + s.counts.pendingReviews + ' waiting)', true]
          ]) + '</div></section></div>' +
          '<section class="card"><div class="card-head"><h2>Reviews not matched to a claim</h2></div>' +
          (s.unlinked.length ? '<div class="table-wrap"><table class="data cards"><thead><tr><th>Review</th><th>Claim reference</th><th>Received</th><th>Link to claim</th><th></th></tr></thead><tbody>' +
            s.unlinked.map(function (r) {
              return '<tr><td data-label="Review">' + E(r.kindLabel) + '<div class="sub">' + AP.reviewStatusPill(r.status) + '</div></td><td data-label="Claim reference">' + E(r.claimReference || '—') + '</td><td data-label="Received">' + AP.fmtDate(r.receivedAt) + '</td>' +
                '<td data-label="Link to claim"><select data-link="' + E(r.id) + '"><option value="">Choose a claim…</option>' + s.recentClaims.map(function (c) { return '<option value="' + E(c.id) + '">' + E((c.claimReference || c.title) + ' · ' + AP.fmtDate(c.createdAt, false)) + '</option>'; }).join('') + '</select></td>' +
                '<td class="right"><button class="btn small danger" type="button" data-dismiss="' + E(r.id) + '">Dismiss</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '<div class="empty">Every review is matched to a claim.</div>') + '</section>';
        var cp = document.getElementById('cpUrl');
        cp.onclick = function () { navigator.clipboard && navigator.clipboard.writeText(s.reviewWebhook.url).then(function () { AP.toast('Copied'); }); };
        body.querySelectorAll('[data-link]').forEach(function (sel) {
          sel.onchange = function () { if (!sel.value) return; AP.api('POST', '/api/reviews/' + encodeURIComponent(sel.dataset.link) + '/link', { claimId: sel.value }).then(function () { AP.toast('Linked'); load(); }).catch(function (e) { AP.toast(e.message); }); };
        });
        body.querySelectorAll('[data-dismiss]').forEach(function (b) {
          b.onclick = function () { AP.api('POST', '/api/reviews/' + encodeURIComponent(b.dataset.dismiss) + '/dismiss').then(function () { AP.toast('Dismissed'); load(); }).catch(function (e) { AP.toast(e.message); }); };
        });
      }).catch(function (e) { body.innerHTML = '<div class="alert bad">' + E(e.message) + '</div>'; });
    }
    load();
  }
});
