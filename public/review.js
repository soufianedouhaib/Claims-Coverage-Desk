AP.boot({
  title: 'Review', nav: 'reviews', perm: ['review_quick', 'review_detailed'],
  render: function (me, main) {
    var E = AP.esc, R = AP.renderValue;
    var id = AP.qs('id');
    main.innerHTML = '<div id="body"><div class="loading-page"><span class="spinner"></span></div></div>';
    var body = document.getElementById('body');
    if (!id) { body.innerHTML = '<div class="alert bad">No review selected. <a href="/reviews.html">Back to reviews</a></div>'; return; }

    var KNOWN = ['handler_review_outcome', 'quick_signoff_outcome', 'confirmed_coverage_decision', 'handler_override_reason', 'handler_notes'];
    function auto(v) { return /_reviewed_by$|_reviewed_at$|_audit$/.test(v); }
    function canonical(d) {
      return { ok: 'Covered', warn: 'Partially covered', bad: 'Not covered', info: 'More information required' }[AP.decisionClass(d)] || '';
    }
    function draftKey() { return 'ccd-review-draft:' + id; }
    function loadDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch (e) { return null; } }
    function saveDraft(v) { try { localStorage.setItem(draftKey(), JSON.stringify(v)); } catch (e) {} }
    function clearDraft() { try { localStorage.removeItem(draftKey()); } catch (e) {} }

    function pick(d, k) {
      var a = d.inputs || {}, b = d.reviewedOutputs || {};
      return a[k] != null && a[k] !== '' ? a[k] : b[k];
    }

    function render(d) {
      var r = d.review, kind = r.kind;
      var outcomeVar = kind === 'detailed' ? 'handler_review_outcome' : 'quick_signoff_outcome';
      var proposed = pick(d, 'coverage_decision');
      var conf = pick(d, 'coverage_confidence_score');
      var settle = pick(d, 'recommended_settlement_amount_after_excess');
      var claim = d.claim;
      document.title = r.kindLabel + ' · ' + (r.claimReference || 'Claim') + ' · ' + AP.APP_NAME;

      var head = '<div class="page-head"><div><div class="crumb"><a href="/reviews.html?kind=' + kind + '">Reviews</a> / ' + E(r.kindLabel) + '</div>' +
        '<h1 class="wrap-any">' + E(r.kindLabel) + ': ' + E(r.claimReference || (claim && claim.title) || 'Claim') + '</h1>' +
        '<div class="sub">' + [claim && claim.insuredName ? E(claim.insuredName) : null, claim && claim.policyNumber ? 'Policy <span class="id">' + E(claim.policyNumber) + '</span>' : null].filter(Boolean).join(' · ') + (claim ? (claim.insuredName || claim.policyNumber ? ' · ' : '') + '<a href="/claim.html?id=' + encodeURIComponent(claim.id) + '">Open full claim</a>' : '') + '</div>' +
        '<div class="toolbar" style="margin-top:10px">' + AP.reviewStatusPill(r.status) + '<span class="small muted">Received ' + AP.fmtDate(r.receivedAt) + '</span></div></div></div>';

      // ---- assessment ----
      var a = [];
      a.push('<section class="card"><div class="card-head"><h2>Proposed coverage position</h2></div><div class="card-body">' +
        '<div class="decision" style="margin-bottom:14px"><div style="flex:1;min-width:180px"><div class="small muted">Proposed decision</div><div class="big">' + E(AP.decisionText(proposed) || '—') + '</div></div>' +
        '<div class="meter">Confidence <div class="bar"><span style="width:' + width(conf) + '%"></span></div><strong>' + AP.fmtPct(conf) + '</strong></div>' +
        (settle != null ? '<div><div class="small muted">Recommended settlement after excess</div><div class="big">' + AP.fmtNum(settle) + '</div><div class="small muted">Non-binding, for your review only</div></div>' : '') +
        '</div>' + AP.kv([
          ['Reasons', pick(d, 'coverage_decision_reasons')],
          ['Applicable limits', pick(d, 'applicable_limits')],
          ['Applicable sub-limits', pick(d, 'applicable_sub_limits')],
          ['Applicable excess', pick(d, 'applicable_excess')],
          kind === 'detailed' || pick(d, 'outstanding_information') ? ['Outstanding information', pick(d, 'outstanding_information')] : null
        ]) + '</div></section>');

      a.push('<section class="card"><div class="card-head"><h2>Policy interpretation</h2></div><div class="card-body stack">' +
        (pick(d, 'clause_interpretation_reasoning') ? '<div class="note-box pre">' + E(pick(d, 'clause_interpretation_reasoning')) + '</div>' : '<p class="muted">No reasoning supplied.</p>') +
        AP.kv([['Insuring clauses', pick(d, 'insuring_clause_references')], kind === 'detailed' || pick(d, 'exclusion_references') ? ['Exclusions', pick(d, 'exclusion_references')] : null]) +
        '</div></section>');

      var aud = [['Evidence audit trail', pick(d, 'evidence_audit_trail')], ['Coverage assessment audit', pick(d, 'coverage_assessment_audit')]]
        .filter(function (x) { return x[1] != null && !(Array.isArray(x[1]) && !x[1].length); });
      if (aud.length) a.push('<section class="card"><details class="more" style="border-top:0"><summary>Evidence and audit trail</summary><div class="inner stack">' +
        aud.map(function (x) { return '<div><h3 style="margin-bottom:6px">' + x[0] + '</h3>' + R(x[1], x[0]) + '</div>'; }).join('') + '</div></details></section>');

      if (claim) {
        var base = '/api/claims/' + encodeURIComponent(claim.id) + '/file/';
        a.push('<section class="card"><div class="card-head"><h2>Source documents</h2></div><div class="card-body toolbar">' +
          (claim.files.fnol ? '<a class="btn small" target="_blank" rel="noopener" href="' + base + 'fnol">Claim notification</a>' : '') +
          (claim.files.schedule ? '<a class="btn small" target="_blank" rel="noopener" href="' + base + 'schedule">Policy schedule</a>' : '') +
          (claim.files.wording ? '<a class="btn small" target="_blank" rel="noopener" href="' + base + 'wording">Policy wording</a>' : '') +
          claim.files.evidence.map(function (e, i) { return '<a class="btn small" target="_blank" rel="noopener" href="' + base + 'evidence-' + i + '">' + E(e.name) + '</a>'; }).join('') +
          '</div></section>');
      }

      // ---- form ----
      var schema = d.schema || {};
      var extra = Object.keys(schema).filter(function (v) { return KNOWN.indexOf(v) < 0 && !auto(v); });
      var f;
      if (r.status === 'pending') {
        var draft = loadDraft() || {};
        var decOpts = d.decisions.slice();
        var proposedCanon = canonical(proposed);
        if (proposed && !proposedCanon && decOpts.indexOf(proposed) < 0) decOpts.unshift(proposed);
        var defDec = draft.confirmed_coverage_decision || proposedCanon || proposed || '';
        f = '<form class="card card-pad form-grid" id="f" novalidate><h2>Your decision</h2>' +
          '<fieldset style="border:0;padding:0;margin:0"><legend class="req" style="font-weight:550;font-size:13px;margin-bottom:6px">Review outcome</legend>' +
          d.outcomes.map(function (o) {
            return '<label style="display:flex;gap:8px;align-items:center;padding:6px 0;cursor:pointer"><input type="radio" name="outcome" value="' + E(o) + '"' + (draft.outcome === o ? ' checked' : '') + '> ' + E(o) + '</label>';
          }).join('') + '</fieldset>' +
          '<label class="field"><span class="req">Confirmed coverage decision</span><select id="decision">' +
          decOpts.map(function (o) { return '<option' + (o === defDec ? ' selected' : '') + '>' + E(o) + '</option>'; }).join('') + '</select>' +
          '<span class="hint" id="decHint"></span></label>' +
          (kind === 'detailed' ? '<label class="field" id="ovWrap"><span id="ovLabel">Override reason</span><span class="hint">Required when you override or change the proposed decision.</span><textarea id="override" maxlength="4000">' + E(draft.override || '') + '</textarea></label>' : '') +
          '<label class="field"><span class="req">Handler notes</span><span class="hint">' + (kind === 'detailed' ? 'Your rationale. If you need clarification, say exactly what is missing.' : 'Why you confirm, or why you return or override it.') + '</span><textarea id="notes" maxlength="4000">' + E(draft.notes || '') + '</textarea></label>' +
          extra.map(function (v) {
            var s = schema[v] || {};
            return '<label class="field">' + E(s.display_name || AP.humanize(v)) + (s.description ? '<span class="hint">' + E(s.description) + '</span>' : '') +
              (s.type === 'bool' ? '<select data-extra="' + E(v) + '"><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select>' :
                '<input type="' + (s.type === 'float' ? 'number' : 'text') + '" data-extra="' + E(v) + '">') + '</label>';
          }).join('') +
          (d.reviewedAt ? '<label class="field"><span class="req">Reviewed on</span><span class="hint">Choose the date from the calendar. It is sent to the workflow as <strong id="dateOut" class="mono">' + E(d.reviewedAt.example) + '</strong></span>' +
            '<input type="date" id="reviewedOn" value="' + today() + '" max="' + today() + '" required></label>' : '') +
          '<div class="note-box small">Recorded as reviewed by <strong>' + E(me.name) + '</strong>' + (d.reviewedAt ? '' : ' with the time you submit') + '. This confirms or overrides the coverage position only; it does not authorise, calculate or settle any payment.</div>' +
          '<div class="alert bad" id="err" role="alert"' + (r.lastError ? '' : ' hidden') + '>' + E(r.lastError || '') + '</div>' +
          '<button class="btn primary" type="submit" id="go">Submit decision</button></form>';
      } else {
        var s2 = d.submitted || {};
        f = '<section class="card"><div class="card-head"><h2>Decision</h2>' + AP.reviewStatusPill(r.status) + '</div><div class="card-body">' +
          (r.status === 'completed' ? AP.kv([
            ['Outcome', s2[outcomeVar]], ['Confirmed decision', AP.decisionPill(s2.confirmed_coverage_decision), true],
            s2.handler_override_reason ? ['Override reason', s2.handler_override_reason] : null, ['Notes', s2.handler_notes],
            ['Reviewed by', r.completedByName], ['Reviewed at', AP.fmtDate(r.completedAt), true]])
            : '<div class="alert warn">' + E(r.lastError || 'This review is no longer open.') + '</div><p class="small muted" style="margin-top:10px">If the review step ran out of time, the claim shows as timed out. An administrator can check the review step\'s time limit.</p>') +
          '</div></section>';
      }

      body.innerHTML = head + '<div class="split"><div class="stack">' + a.join('') + '</div><div class="stack sticky">' + f + '</div></div>';
      if (r.status === 'pending') wire(d, kind, outcomeVar, proposed);
    }

    function wire(d, kind, outcomeVar, proposed) {
      var form = document.getElementById('f'), err = document.getElementById('err');
      var dec = document.getElementById('decision'), notes = document.getElementById('notes'), ov = document.getElementById('override');
      function outcome() { var x = form.querySelector('input[name=outcome]:checked'); return x ? x.value : ''; }
      function changed() { return canonical(dec.value) !== canonical(proposed) || (!canonical(dec.value) && dec.value !== proposed); }
      function update() {
        var o = outcome();
        var hint = document.getElementById('decHint');
        if (o === 'Confirmed' && changed()) hint.textContent = 'This differs from the proposed decision. Choose an override outcome, or set it back.';
        else if (changed()) hint.textContent = 'Changed from the proposed decision (' + AP.decisionText(proposed) + ').';
        else hint.textContent = 'Same as the proposed decision.';
        if (ov) {
          var need = o === 'Overridden' || changed();
          document.getElementById('ovLabel').className = need ? 'req' : '';
        }
        saveDraft({ outcome: o, confirmed_coverage_decision: dec.value, notes: notes.value, override: ov ? ov.value : '' });
      }
      form.addEventListener('input', update); form.addEventListener('change', update); update();
      var ro = document.getElementById('reviewedOn');
      if (ro && d.reviewedAt) ro.addEventListener('change', function () { document.getElementById('dateOut').textContent = fmtDate(d.reviewedAt.format, ro.value) || d.reviewedAt.example; });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        err.hidden = true;
        var o = outcome();
        var problems = [];
        if (!o) problems.push('Choose a review outcome.');
        if (!notes.value.trim()) problems.push('Add handler notes.');
        if (o === 'Confirmed' && changed()) problems.push('You chose "Confirmed" but changed the decision. Choose an override outcome or set the decision back.');
        if (ov && (o === 'Overridden' || changed()) && !ov.value.trim()) problems.push('Give an override reason.');
        if (problems.length) { err.innerHTML = problems.map(E).join('<br>'); err.hidden = false; return; }
        var values = { confirmed_coverage_decision: dec.value, handler_notes: notes.value.trim() };
        values[outcomeVar] = o;
        if (ov) values.handler_override_reason = ov.value.trim();
        var ro = document.getElementById('reviewedOn');
        if (ro) { if (!ro.value) { err.textContent = 'Pick the review date.'; err.hidden = false; return; } values.reviewed_on = ro.value; }
        form.querySelectorAll('[data-extra]').forEach(function (x) { if (x.value !== '') values[x.dataset.extra] = x.value; });
        AP.modal('Submit this decision?', AP.kv([['Outcome', o], ['Coverage decision', AP.decisionPill(dec.value), true]]) + '<p class="small muted" style="margin-top:12px">The assessment continues as soon as you submit. This cannot be undone from the console.</p>', [
          { label: 'Cancel' },
          { label: 'Submit', primary: true, onClick: function (back, close) {
            var go = document.getElementById('go'); go.disabled = true; go.textContent = 'Submitting…'; close();
            AP.api('POST', '/api/reviews/' + encodeURIComponent(id) + '/submit', { values: values }).then(function () {
              clearDraft(); AP.toast('Decision submitted'); AP.refreshBadge(); load();
            }).catch(function (e2) {
              err.textContent = e2.message; err.hidden = false; go.disabled = false; go.textContent = 'Submit decision';
              if (e2.status === 409) setTimeout(load, 1500);
            });
            return false;
          } }
        ]);
      });
    }

    function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    // Same formatting the server applies, for the live preview under the date picker.
    function fmtDate(fmt, ymd) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); if (!m) return '';
      if (/^unix$/i.test(fmt)) return String(Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000));
      var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      var now = new Date(), h = now.getUTCHours(), p2 = function (n) { return String(n).padStart(2, '0'); };
      var map = { Y: m[1], y: m[1].slice(2), m: m[2], d: m[3], H: p2(h), I: p2(h % 12 || 12), M: p2(now.getUTCMinutes()), S: p2(now.getUTCSeconds()), b: MON[+m[2] - 1], B: MONTH[+m[2] - 1], p: h < 12 ? 'AM' : 'PM', '%': '%' };
      return fmt.replace(/%([YymdHIMSbBp%])/g, function (_, t) { return map[t]; });
    }
    function width(v) { if (v == null || isNaN(Number(v))) return 0; v = Number(v); if (v <= 1) v *= 100; return Math.max(0, Math.min(100, Math.round(v))); }

    function load() {
      AP.api('GET', '/api/reviews/' + encodeURIComponent(id)).then(render).catch(function (e) {
        body.innerHTML = e.status === 404 ? '<div class="alert bad">This review was not found, or your role cannot open it. <a href="/reviews.html">Back to reviews</a></div>' : '<div class="alert bad">' + E(e.message) + '</div>';
      });
    }
    load();
  }
});
