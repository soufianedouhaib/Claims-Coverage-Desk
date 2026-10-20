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
          '<p class="small muted" style="margin:0">In the workflow builder, connect each handler review step off-platform with its own URL below, replacing &lt;secret&gt; with the value of REVIEW_WEBHOOK_SECRET. No custom header is needed.</p>' +
          '<div class="note-box small mono">Detailed review: ' + E(s.reviewWebhook.url).replace(/\//g, '/<wbr>') + '/<wbr>detailed/<wbr>&lt;secret&gt;<br>Quick sign-off: ' + E(s.reviewWebhook.url).replace(/\//g, '/<wbr>') + '/<wbr>quick/<wbr>&lt;secret&gt;</div>' +
          AP.kv([
            ['Webhook URL', '<code class="wrap-any" style="display:block;margin-bottom:6px">' + E(s.reviewWebhook.url) + '</code><button class="btn small" type="button" id="cpUrl">Copy</button>', true],
            ['Header name', '<code>' + E(s.reviewWebhook.header) + '</code>', true],
            ['Header value', yes(s.reviewWebhook.secretSet) + ' <span class="small muted">REVIEW_WEBHOOK_SECRET</span>', true],
            ['Last review received', s.reviewWebhook.lastReceivedAt ? AP.fmtDate(s.reviewWebhook.lastReceivedAt) : '<span class="muted">Never</span>', true],
            ['Last delivery attempt', s.reviewWebhook.lastAttempt ? AP.fmtDate(s.reviewWebhook.lastAttempt.at) + ' · <strong>' + E(s.reviewWebhook.lastAttempt.status) + '</strong> ' + E(s.reviewWebhook.lastAttempt.note) + (s.reviewWebhook.lastAttempt.kind ? ' · ' + E(s.reviewWebhook.lastAttempt.kind) : '') : '<span class="muted">None yet</span>', true]
          ]) + '</div></section>' +
          '<section class="card"><div class="card-head"><h2>Connection</h2></div><div class="card-body">' + AP.kv([
            ['Workflow ID', yes(s.workflowSet) + ' <span class="small muted">hidden</span>', true],
            ['Service URL', yes(s.serviceBaseUrlSet) + ' <span class="small muted">hidden</span>', true],
            ['Service key', yes(s.serviceKeySet) + ' <span class="small muted">OPUS_SERVICE_KEY</span>', true],
            ['Session secret', yes(s.sessionSecretSet) + ' <span class="small muted">SESSION_SECRET</span>', true],
            ['Storage', (s.storage.kind === 'memory' ? '<span class="pill bad">Not connected</span>' : '<span class="pill ok">' + E(s.storage.kind) + '</span>') + (s.storage.envNames.length ? ' <span class="small muted">' + s.storage.envNames.map(E).join(', ') + '</span>' : ''), true],
            ['Case-finished callback', E(s.caseCallback), true],
            ['Evidence input type', '<code>' + E(s.evidenceInputType) + '</code>', true],
            ['Totals', s.counts.claims + ' claims, ' + s.counts.reviews + ' reviews (' + s.counts.pendingReviews + ' waiting)', true]
          ]) + '</div></section></div>' +
          '<section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Reviews not matched to a claim</h2><div class="small muted">Shown as "Not matched to a claim yet" in review history and left out of Reports. Link one to its claim, or clear them.</div></div>' +
            (s.unlinked.length ? '<button class="btn small danger" type="button" id="clearUnmatched">Clear all ' + s.unlinked.length + '</button>' : '') + '</div>' +
          (s.unlinked.length ? '<div class="table-wrap"><table class="data cards"><thead><tr><th>Review</th><th>Claim reference</th><th>Received</th><th>Link to claim</th><th></th></tr></thead><tbody>' +
            s.unlinked.map(function (r) {
              return '<tr><td data-label="Review">' + E(r.kindLabel) + '<div class="sub">' + AP.reviewStatusPill(r.status) + '</div></td><td data-label="Claim reference">' + E(r.claimReference || '—') + '</td><td data-label="Received">' + AP.fmtDate(r.receivedAt) + '</td>' +
                '<td data-label="Link to claim"><select data-link="' + E(r.id) + '"><option value="">Choose a claim…</option>' + s.recentClaims.map(function (c) { return '<option value="' + E(c.id) + '">' + E((c.claimReference || c.title) + ' · ' + AP.fmtDate(c.createdAt, false)) + '</option>'; }).join('') + '</select></td>' +
                '<td class="right"><button class="btn small danger" type="button" data-dismiss="' + E(r.id) + '">Clear</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '<div class="empty">Every review is matched to a claim.</div>') + '</section>' +
          '<section class="card"><div class="card-head"><div><h2>Claims finished without a handler review</h2><div class="small muted">Completed with only the proposed decision, because their review never matched. Remove them before recording, or link a review above.</div></div></div>' +
          (s.noReview.length ? '<div class="table-wrap"><table class="data cards"><thead><tr><th>Claim</th><th>Proposed decision</th><th>Submitted</th><th></th></tr></thead><tbody>' +
            s.noReview.map(function (c) {
              return '<tr><td data-label="Claim"><div class="primary-cell">' + E(c.claimReference || 'Reference not read') + '</div><div class="sub">' + E(c.title || '') + ' · Case ' + E(c.id) + '</div></td><td data-label="Proposed decision">' + AP.decisionPill(c.decision, false) + '</td>' +
                '<td data-label="Submitted">' + AP.fmtDate(c.createdAt) + '</td><td class="right nowrap"><a class="btn small" href="/claim.html?id=' + encodeURIComponent(c.id) + '">Open</a> <button class="btn small danger" type="button" data-rmclaim="' + E(c.id) + '">Remove</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '<div class="empty">Every finished claim has a handler review.</div>') + '</section>';
        var cp = document.getElementById('cpUrl');
        cp.onclick = function () { navigator.clipboard && navigator.clipboard.writeText(s.reviewWebhook.url).then(function () { AP.toast('Copied'); }); };
        body.querySelectorAll('[data-link]').forEach(function (sel) {
          sel.onchange = function () { if (!sel.value) return; AP.api('POST', '/api/reviews/' + encodeURIComponent(sel.dataset.link) + '/link', { claimId: sel.value }).then(function () { AP.toast('Linked'); load(); }).catch(function (e) { AP.toast(e.message); }); };
        });
        body.querySelectorAll('[data-dismiss]').forEach(function (b) {
          b.onclick = function () { AP.api('POST', '/api/reviews/' + encodeURIComponent(b.dataset.dismiss) + '/dismiss').then(function () { AP.toast('Cleared'); load(); }).catch(function (e) { AP.toast(e.message); }); };
        });
        var cu = document.getElementById('clearUnmatched');
        if (cu) cu.onclick = function () {
          AP.modal('Clear unmatched reviews?', '<p>This clears all ' + s.unlinked.length + ' reviews that are not matched to a claim. They leave the review history; claims are not touched.</p>', [
            { label: 'Cancel' },
            { label: 'Clear all', danger: true, onClick: function () { AP.api('POST', '/api/reviews/dismiss-unmatched').then(function (j) { AP.toast(j.cleared + ' cleared'); load(); }).catch(function (e) { AP.toast(e.message); }); } }
          ]);
        };
        body.querySelectorAll('[data-rmclaim]').forEach(function (b) {
          b.onclick = function () {
            AP.modal('Remove this claim?', '<p>This removes the claim from the console for everyone. The documents and the assessment record are not deleted.</p>', [
              { label: 'Cancel' },
              { label: 'Remove', danger: true, onClick: function () { AP.api('POST', '/api/claims/remove', { ids: [b.dataset.rmclaim] }).then(function () { AP.toast('Removed'); load(); }).catch(function (e) { AP.toast(e.message); }); } }
            ]);
          };
        });
      }).catch(function (e) { body.innerHTML = '<div class="alert bad">' + E(e.message) + '</div>'; });
    }
    load();
  }
});
