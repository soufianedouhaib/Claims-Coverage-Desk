AP.boot({
  title: 'Claim', nav: 'claims',
  render: function (me, main) {
    var E = AP.esc, R = AP.renderValue;
    var id = AP.qs('id');
    var timer = null, lastJson = '';
    main.innerHTML = '<div id="body"><div class="loading-page"><span class="spinner"></span></div></div>';
    var body = document.getElementById('body');
    if (!id) { body.innerHTML = '<div class="alert bad">No claim selected. <a href="/claims.html">Back to claims</a></div>'; return; }

    function out(d, node) {
      var o = d.outputs || {};
      var k = Object.keys(o).find(function (x) { return x.toLowerCase() === node.toLowerCase(); });
      return k ? o[k] : null;
    }
    function has(o) { return o && Object.keys(o).length; }
    function yesNo(v, goodWhenTrue) {
      if (v == null) return '<span class="muted">—</span>';
      var good = goodWhenTrue ? v === true : v === false;
      return '<span class="pill plain ' + (good ? 'ok' : 'bad') + '">' + (v ? 'Yes' : 'No') + '</span>';
    }
    function section(title, inner, extra) {
      return '<section class="card"><div class="card-head"><h2>' + E(title) + '</h2>' + (extra || '') + '</div><div class="card-body">' + inner + '</div></section>';
    }
    function auditBlock(title, items) {
      items = items.filter(function (x) { return x[1] != null && !(Array.isArray(x[1]) && !x[1].length); });
      if (!items.length) return '';
      return '<details class="more"><summary>' + E(title) + '</summary><div class="inner stack">' +
        items.map(function (x) { return '<div><h3 style="margin-bottom:6px">' + E(x[0]) + '</h3>' + R(x[1], x[0]) + '</div>'; }).join('') + '</div></details>';
    }
    function money(v) { return v == null || v === '' ? '<span class="muted">—</span>' : AP.fmtNum(v); }

    function render(d) {
      var c = d.claim;
      document.title = (c.claimReference || c.title) + ' · ' + AP.APP_NAME;
      var fnol = out(d, 'Extract FNOL Details'), sched = out(d, 'Extract Policy Schedule'), ev = out(d, 'Preserve Claim Evidence'),
          val = out(d, 'Validate Policy'), tri = out(d, 'Triage Claim'), interp = out(d, 'Interpret Policy Clauses'),
          cov = out(d, 'Determine Coverage'), gen = out(d, 'Generate Coverage Position'), rec = out(d, 'Create Claims System Record'),
          det = out(d, 'Claims Handler Review'), quick = out(d, 'Quick Handler Sign-Off');
      var res = d.results || {};
      var hd = res.handler_decision && typeof res.handler_decision === 'object' ? res.handler_decision : (has(det) ? det : has(quick) ? quick : null);

      var head = '<div class="page-head"><div><div class="crumb"><a href="/claims.html">Claims</a> / ' + E(c.claimReference || 'Claim') + '</div>' +
        '<h1 class="wrap-any">' + E(c.claimReference || c.title) + '</h1>' +
        '<div class="sub">' + [c.insuredName ? E(c.insuredName) : null, c.policyNumber ? 'Policy <span class="id">' + E(c.policyNumber) + '</span>' : null, c.claimReference ? E(c.title) : null].filter(Boolean).join(' · ') + '</div>' +
        '<div class="toolbar" style="margin-top:10px">' + AP.casePill(c) + (c.decision ? AP.decisionPill(c.decision, c.decisionConfirmed) : '') + '</div></div>' +
        '<div class="actions"><button class="btn" id="refresh" type="button">Refresh</button>' + (AP.can(me, 'users') ? '<button class="btn danger" id="remove" type="button">Remove</button>' : '') + '</div></div>';

      var left = [];

      if (AP.qs('new') === '1' && (c.status === 'processing' || c.status === 'queued')) {
        left.push('<div class="alert ok">Claim submitted. The assessment usually takes a few minutes; this page updates by itself.</div>');
      }
      // Test sample: show what should happen and whether it did.
      var smp = c.sampleId && SAMPLES ? SAMPLES.find(function (x) { return x.id === c.sampleId; }) : null;
      if (smp) {
        var routeNow = c.reviewKind || null;
        var routeTxt = routeNow ? (routeNow === smp.route ? '<span class="match ok">✓ Went to the expected review</span>' : '<span class="match bad">≠ Went to ' + E(AP.ROUTES[routeNow].label) + ' instead</span>') : '<span class="muted small">Review not reached yet</span>';
        left.push('<section class="card card-pad"><div class="sample-num" style="margin-bottom:4px">Test sample ' + smp.number + '</div>' +
          '<div class="expect"><div><div class="small muted">Expected decision</div>' + AP.decisionPill(smp.expectedDecision) + '</div>' +
          '<div><div class="small muted">Expected review</div>' + AP.routeChip(smp.route) + '</div><div>' + routeTxt + '</div></div>' +
          '<p class="small muted" style="margin:10px 0 0">' + E(smp.why) + '</p></section>');
      }
      if (c.error && ['failed', 'cancelled', 'timed_out'].indexOf(c.status) >= 0) {
        left.push('<div class="alert bad">' + E(c.error) + (c.sampleId ? ' <a href="/new-claim.html#samples">Run the sample again</a>' : '') + '</div>');
        if (d.failureDetail) left.push('<section class="card"><details class="more" style="border-top:0"><summary>Technical details (administrators only)</summary><div class="inner"><div class="note-box pre mono small">' + E(d.failureDetail) + '</div></div></details></section>');
      }

      // Review banner
      if (d.review && d.review.status === 'pending') {
        left.push('<div class="card card-pad" style="border-color:var(--violet)"><div class="decision"><div style="flex:1;min-width:220px"><div class="big">' + E(d.review.kindLabel) + ' needed</div>' +
          '<div class="muted">The proposed position is <strong>' + E(AP.decisionText(d.review.proposedDecision) || 'not stated') + '</strong>' + (d.review.confidence != null ? ' at ' + AP.fmtPct(d.review.confidence) + ' confidence' : '') + '. Waiting since ' + AP.fmtRel(d.review.receivedAt) + '.</div></div>' +
          (d.review.canAct ? '<a class="btn primary" href="/review.html?id=' + encodeURIComponent(d.review.id) + '">Open review</a>' : '<span class="small muted">' + (d.review.kind === 'detailed' ? 'A senior claims handler will complete this.' : 'A claims handler will complete this.') + '</span>') +
          '</div></div>');
      } else if (c.status.indexOf('awaiting') === 0 && !d.review) {
        left.push('<div class="alert info">Waiting for a handler review. The review task has not reached the console yet; it appears in the review queue as soon as it arrives.</div>');
      }

      // Final coverage position
      var docUrl = res.coverage_position_document || (gen && gen.coverage_position_document);
      var comm = res.draft_customer_communication || (gen && gen.draft_customer_communication);
      if (c.status === 'completed' || docUrl || comm) {
        var settle = res.recommended_settlement_amount_after_excess != null ? res.recommended_settlement_amount_after_excess : cov && cov.recommended_settlement_amount_after_excess;
        var s = '<div class="decision" style="margin-bottom:14px"><div style="flex:1;min-width:200px"><div class="small muted">Confirmed coverage position</div><div class="big">' + E(AP.decisionText(c.confirmedDecision || c.decision) || '—') + '</div></div>' +
          (settle != null ? '<div><div class="small muted">Recommended settlement after excess</div><div class="big">' + money(settle) + '</div><div class="small muted">Non-binding. Not a payment authorisation.</div></div>' : '') + '</div>';
        if (docUrl) s += '<p><a class="btn" href="/api/claims/' + encodeURIComponent(c.id) + '/file/position" target="_blank" rel="noopener">Open coverage position document</a></p>';
        if (comm) s += '<div style="margin-top:14px"><div class="toolbar" style="justify-content:space-between;margin-bottom:6px"><h3>Draft customer communication</h3><button class="btn small" type="button" id="copyComm">Copy</button></div><div class="note-box pre" id="commText">' + E(comm) + '</div></div>';
        var recObj = res.claims_system_record || (rec && rec.claims_system_record);
        var aud = auditBlock('Claims system record and audit trail', [['Claims system record', recObj], ['Audit trail', res.audit_trail || (rec && rec.audit_trail) || (gen && gen.compiled_audit_trail)]]);
        left.push('<section class="card"><div class="card-head"><h2>Coverage position</h2></div><div class="card-body">' + s + '</div>' + aud + '</section>');
      }

      // Handler review outcome
      if (hd && has(hd)) {
        left.push(section('Handler review', AP.kv([
          ['Outcome', hd.handler_review_outcome || hd.quick_signoff_outcome],
          ['Confirmed decision', AP.decisionPill(hd.confirmed_coverage_decision), true],
          hd.handler_override_reason ? ['Override reason', hd.handler_override_reason] : null,
          ['Notes', hd.handler_notes],
          ['Reviewed by', hd.handler_reviewed_by],
          ['Reviewed at', hd.handler_reviewed_at]
        ])));
      } else if (d.review && d.review.status === 'completed') {
        left.push(section('Handler review', AP.kv([
          ['Review', d.review.kindLabel], ['Outcome', d.review.outcome], ['Confirmed decision', AP.decisionPill(d.review.confirmedDecision), true],
          ['Reviewed by', d.review.completedByName], ['Reviewed at', d.review.completedAt]
        ])));
      }

      // Coverage assessment
      if (has(cov)) {
        var flags = [['High value', cov.is_high_value_claim], ['Low confidence', cov.is_low_confidence], ['Partially covered', cov.is_partially_covered], ['Not covered', cov.is_not_covered]]
          .filter(function (f) { return f[1] === true; }).map(function (f) { return '<span class="pill plain warn">' + f[0] + '</span>'; }).join(' ');
        left.push('<section class="card"><div class="card-head"><h2>Coverage assessment</h2>' + (cov.requires_detailed_review != null ? '<span class="pill plain ' + (cov.requires_detailed_review ? 'violet' : 'info') + '">' + (cov.requires_detailed_review ? 'Routed to detailed review' : 'Routed to quick sign-off') + '</span>' : '') + '</div><div class="card-body">' +
          '<div class="decision" style="margin-bottom:12px"><div><div class="small muted">Proposed decision</div><div class="big">' + E(AP.decisionText(cov.coverage_decision) || '—') + '</div></div>' +
          '<div class="meter">Confidence <div class="bar"><span style="width:' + confWidth(cov.coverage_confidence_score) + '%"></span></div><strong>' + AP.fmtPct(cov.coverage_confidence_score) + '</strong></div>' + (flags ? '<div>' + flags + '</div>' : '') + '</div>' +
          AP.kv([
            ['Reasons', cov.coverage_decision_reasons],
            ['Applicable limits', cov.applicable_limits],
            ['Applicable sub-limits', cov.applicable_sub_limits],
            ['Applicable excess', cov.applicable_excess],
            ['Recommended settlement after excess', money(cov.recommended_settlement_amount_after_excess) + ' <span class="small muted">non-binding</span>', true],
            ['Outstanding information', cov.outstanding_information]
          ]) + '</div>' + auditBlock('Assessment audit', [['Coverage assessment audit', cov.coverage_assessment_audit]]) + '</section>');
      }

      // Interpretation
      if (has(interp)) {
        left.push('<section class="card"><div class="card-head"><h2>Policy wording interpretation</h2><span class="meter">Confidence <strong>' + AP.fmtPct(interp.clause_interpretation_confidence) + '</strong></span></div><div class="card-body stack">' +
          (interp.clause_interpretation_reasoning ? '<div class="note-box pre">' + E(interp.clause_interpretation_reasoning) + '</div>' : '') +
          AP.kv([['Insuring clauses', interp.insuring_clause_references], ['Exclusions', interp.exclusion_references], ['Definitions', interp.definition_references], ['General conditions', interp.general_condition_references], ['Endorsements', interp.endorsement_assessment]]) +
          '</div>' + auditBlock('Interpretation audit', [['Clause interpretation audit', interp.clause_interpretation_audit]]) + '</section>');
      }

      // Triage
      if (has(tri)) {
        left.push('<section class="card"><div class="card-head"><h2>Triage</h2></div><div class="card-body">' + AP.kv([
          ['Coverage type', tri.coverage_type], ['Peril', tri.peril_category], ['Urgency', tri.urgency_level], ['Complexity', tri.complexity_level],
          ['High value', yesNo(tri.is_high_value_claim, false), true], ['Reasons', tri.triage_reasons]
        ]) + '</div>' + auditBlock('Triage audit', [['Triage audit', tri.triage_audit]]) + '</section>');
      }

      // Policy validation
      if (has(val) || has(sched)) {
        var v = val || {}, sc = sched || {};
        left.push('<section class="card"><div class="card-head"><h2>Policy check</h2>' + (v.policy_validity_status ? '<span class="pill plain ' + (/valid|ok|pass/i.test(v.policy_validity_status) && !/invalid/i.test(v.policy_validity_status) ? 'ok' : 'warn') + '">' + E(AP.decisionText(v.policy_validity_status)) + '</span>' : '') + '</div><div class="card-body stack">' +
          (has(val) ? '<div class="grid-2">' + AP.kv([
            ['Cover in force', yesNo(v.cover_in_force, true), true], ['Insured matches', yesNo(v.insured_matches, true), true],
            ['Risk address matches', yesNo(v.risk_address_matches, true), true]]) + AP.kv([
            ['Premium paid', yesNo(v.premium_paid, true), true], ['Late notification', yesNo(v.late_notification, false), true]]) + '</div>' +
            (v.policy_validity_reasons && v.policy_validity_reasons.length ? '<div><h3 style="margin-bottom:6px">Reasons</h3>' + R(v.policy_validity_reasons) + '</div>' : '') : '') +
          (has(sched) ? '<div><h3 style="margin-bottom:8px">Policy schedule</h3>' + AP.kv([
            ['Policy number', sc.policy_number], ['Named insureds', sc.named_insureds], ['Risk address', sc.risk_address],
            ['Period of insurance', sc.period_of_insurance], ['Premium status', sc.premium_status], ['Selected covers', sc.selected_covers],
            ['Sums insured', sc.sums_insured], ['Sub-limits', sc.sub_limits], ['Excess', sc.excess], ['Endorsements', sc.endorsements]]) + '</div>' : '') +
          '</div>' + auditBlock('Source citations', [['Policy validation audit', v.policy_validity_audit], ['Schedule extraction audit', sc.policy_schedule_extraction_audit]]) + '</section>');
      }

      // FNOL
      if (has(fnol)) {
        left.push('<section class="card"><div class="card-head"><h2>Claim notification</h2></div><div class="card-body">' + AP.kv([
          ['Claim reference', fnol.claim_reference], ['Policy number', fnol.policy_number], ['Insured', fnol.insured_name], ['Risk address', fnol.risk_address],
          ['Date of loss', fnol.date_time_of_loss], ['Date reported', fnol.date_reported], ['Cause of loss', fnol.cause_of_loss], ['Description', fnol.loss_description],
          ['Estimated amount claimed', money(fnol.estimated_amount_claimed), true], ['Damaged items', fnol.damaged_items],
          ['Emergency indicators', fnol.emergency_indicators], ['Vulnerability indicators', fnol.vulnerability_indicators]
        ]) + '</div>' + auditBlock('Source citations', [['Extraction audit', fnol.fnol_extraction_audit], ['Evidence register', ev && ev.preserved_evidence], ['Evidence audit trail', ev && ev.evidence_audit_trail]]) + '</section>');
      }

      if (!left.length) left.push('<div class="card card-pad"><p class="muted" style="margin:0">Results appear here as each step finishes.</p></div>');

      // Right column
      var done = d.steps.filter(function (s) { return s.state === 'done'; }).length;
      var right = '<section class="card"><div class="card-head"><h2>Progress</h2><span class="small muted">' + done + ' of ' + d.steps.length + '</span></div><div class="card-body"><ol class="steps">' +
        d.steps.map(function (s) {
          var st = { done: 'Done', running: 'Running', waiting: 'Waiting', failed: 'Failed', todo: '' }[s.state];
          return '<li class="' + s.state + '"><span class="dot" aria-hidden="true"></span><span>' + E(s.label) + '</span><span class="state">' + st + '</span></li>';
        }).join('') + '</ol></div></section>';
      var f = d.files, base = '/api/claims/' + encodeURIComponent(c.id) + '/file/';
      right += '<section class="card"><div class="card-head"><h2>Documents</h2></div><div class="card-body"><ul class="plain" style="padding-left:0;list-style:none">' +
        [['fnol', 'Claim notification'], ['schedule', 'Policy schedule'], ['wording', 'Policy wording']].map(function (x) {
          return f[x[0]] ? '<li style="margin:6px 0"><a href="' + base + x[0] + '" target="_blank" rel="noopener">' + x[1] + '</a><div class="small muted wrap-any">' + E(f[x[0]].name) + '</div></li>' : '';
        }).join('') +
        (f.evidence.length ? '<li style="margin:10px 0 4px" class="small muted">Supporting evidence</li>' + f.evidence.map(function (e, i) { return '<li style="margin:4px 0"><a class="wrap-any" href="' + base + 'evidence-' + i + '" target="_blank" rel="noopener">' + E(e.name) + '</a></li>'; }).join('') : '<li class="small muted" style="margin-top:8px">No supporting evidence added</li>') +
        '</ul></div></section>';
      right += '<section class="card"><div class="card-head"><h2>Details</h2></div><div class="card-body">' + AP.kv([
        ['Title', c.title], ['Submitted by', c.createdByName], ['Submitted', AP.fmtDate(c.createdAt), true], c.completedAt ? ['Completed', AP.fmtDate(c.completedAt), true] : null,
        d.notes ? ['Notes', d.notes] : null]) + '</div></section>';

      body.innerHTML = head + '<div class="split"><div class="stack">' + left.join('') + '</div><div class="stack sticky">' + right + '</div></div>';

      document.getElementById('refresh').onclick = function () { load(true); };
      var rm = document.getElementById('remove');
      if (rm) rm.onclick = function () {
        AP.modal('Remove this claim?', '<p>This removes the claim from the console for everyone. The documents and the assessment record are not deleted.</p>', [
          { label: 'Cancel' },
          { label: 'Remove', danger: true, onClick: function () { AP.api('DELETE', '/api/claims/' + encodeURIComponent(c.id)).then(function () { location.href = '/claims.html'; }).catch(function (e) { AP.toast(e.message); }); } }
        ]);
      };
      var cp = document.getElementById('copyComm');
      if (cp) cp.onclick = function () {
        var t = document.getElementById('commText').textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { AP.toast('Copied'); }).catch(function () { AP.toast('Select the text to copy it'); });
      };
    }

    function confWidth(v) { if (v == null || isNaN(Number(v))) return 0; v = Number(v); if (v <= 1) v *= 100; return Math.max(0, Math.min(100, Math.round(v))); }

    var SAMPLES = null;
    function load(force) {
      clearTimeout(timer);
      if (SAMPLES === null) {
        SAMPLES = [];
        return fetch('/samples/samples.json').then(function (r) { return r.json(); }).then(function (j) { SAMPLES = j.samples || []; }).catch(function () {}).then(function () { load(force); });
      }
      AP.api('GET', '/api/claims/' + encodeURIComponent(id) + (force ? '?refresh=1' : '')).then(function (d) {
        var j = JSON.stringify(d);
        if (j !== lastJson) { var y = window.scrollY; render(d); window.scrollTo(0, y); lastJson = j; }
        var live = ['completed', 'failed', 'cancelled', 'timed_out'].indexOf(d.claim.status) < 0;
        if (live) timer = setTimeout(load, d.claim.status.indexOf('awaiting') === 0 ? 15000 : 5000);
      }).catch(function (e) {
        body.innerHTML = e.status === 404 ? '<div class="alert bad">This claim was not found. <a href="/claims.html">Back to claims</a></div>' : '<div class="alert bad">' + E(e.message) + '</div>';
      });
    }
    load();
  }
});
