// Local stand-in for the workflow engine, for testing the console without a real service key.
// Simulates the Policy Coverage Assessment workflow, including both off-platform review steps.
// Title contains "complex" -> detailed review; "fail" -> fails at policy validation; otherwise quick sign-off.
const express = require('express');
const crypto = require('crypto');

function createMock(opts) {
  const APP_URL = opts.appUrl;            // where the console runs
  const SECRET = opts.webhookSecret;
  const STEP_MS = opts.stepMs || 600;
  const app = express();
  let base = '';
  const files = new Map(), cases = new Map(), byExec = new Map();
  app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PUT, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  function key(req, res) { if (req.headers['x-service-key'] !== opts.serviceKey) { res.status(401).json({ message: 'Unauthorized' }); return false; } return true; }

  app.post('/api/v1/file/upload/presigned', express.json(), function (req, res) {
    if (!key(req, res)) return;
    const id = crypto.randomUUID();
    res.status(201).json({ presignedUrl: base + '/s3/' + id, fileUrl: base + '/files/' + id + (req.body.fileExtension || '') });
  });
  app.put('/s3/:id', express.raw({ type: '*/*', limit: '20mb' }), function (req, res) { files.set(req.params.id, { body: req.body, type: req.headers['content-type'] }); res.status(200).end(); });
  app.get('/files/:name', function (req, res) {
    const f = files.get(req.params.name.replace(/\.[a-z0-9]+$/i, ''));
    if (!f) return res.status(404).send('no file');
    res.type(f.type || 'application/octet-stream').send(f.body);
  });
  app.post('/api/v1/case', express.json(), function (req, res) {
    if (!key(req, res)) return;
    const id = crypto.randomUUID();
    cases.set(id, { id: id, title: req.body.title || '', status: 'PENDING', nodes: {}, order: [], running: '', results: null });
    res.status(201).json({ caseId: id });
  });
  app.post('/api/v1/case/:id/execute', express.json(), function (req, res) {
    if (!key(req, res)) return;
    const c = cases.get(req.params.id);
    if (!c) return res.status(404).json({ message: 'Not found' });
    c.payload = req.body.payload;
    c.status = 'IN_PROGRESS';
    run(c);
    res.status(201).json({ success: true, caseId: c.id, message: 'Job execution started' });
  });
  app.get('/api/v1/case/:id/status', function (req, res) { if (!key(req, res)) return; const c = cases.get(req.params.id); if (!c) return res.status(404).json({}); res.json({ status: c.status }); });
  app.get('/api/v1/case/:id/audit', function (req, res) {
    if (!key(req, res)) return;
    const c = cases.get(req.params.id); if (!c) return res.status(404).json({});
    const nd = {};
    c.order.forEach(function (n, i) {
      const x = c.nodes[n];
      nd[n] = { executionStatus: x.status, executionStartTime: x.start, executionTime: x.ms || 0, executionIndex: i,
        executionInput: null, executionOutput: x.out ? Object.keys(x.out).map(function (k) { return { variableName: k, displayName: k, value: x.out[k], type: typeof x.out[k] }; }) : null };
    });
    res.json({ totalNodeCount: 11, runningNode: c.running, nextNode: '', remainingNodesToExecute: [], executedNodes: c.order.filter(function (n) { return c.nodes[n].status === 'COMPLETED'; }),
      executedNodeCount: c.order.filter(function (n) { return c.nodes[n].status === 'COMPLETED'; }).length, failedNodes: c.order.filter(function (n) { return c.nodes[n].status === 'FAILED'; }), failedNodeCount: 0, audit: { nodesExecutionData: nd } });
  });
  app.get('/api/v1/case/:id/results', function (req, res) {
    if (!key(req, res)) return;
    const c = cases.get(req.params.id); if (!c) return res.status(404).json({});
    if (c.status !== 'COMPLETED') return res.status(202).json({ statusCode: 202, message: 'Not finished' });
    const r = {}; Object.keys(c.results).forEach(function (k) { r[k] = { value: c.results[k], type: typeof c.results[k], displayName: k }; });
    res.json({ results: r });
  });
  app.post('/api/v1/execution/callback/:exec', express.json(), function (req, res) {
    const w = byExec.get(req.params.exec);
    if (!w || w.done) return res.status(401).json({ message: 'Token invalid or spent' });
    if (req.headers['x-opus-callback-token'] !== w.token) return res.status(401).json({ message: 'bad token' });
    const allowed = Object.keys(w.schema);
    const bad = Object.keys(req.body.output_data || {}).filter(function (k) { return allowed.indexOf(k) < 0; });
    if (bad.length) return res.status(422).json({ message: 'Undeclared: ' + bad.join(',') });
    w.done = true; w.resolve(req.body.output_data);
    res.json({ ok: true });
  });

  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  async function run(c) {
    const t = c.title.toLowerCase();
    const complex = /complex|flood|theft/.test(t), fail = /fail/.test(t);
    const ref = 'CLM-' + (2026000 + Math.floor(Math.random() * 9000));
    const D = data(ref, complex);
    async function step(name, out) {
      c.order.push(name); c.running = name;
      c.nodes[name] = { status: 'STARTED', start: Date.now() };
      await sleep(STEP_MS);
      c.nodes[name].status = 'COMPLETED'; c.nodes[name].ms = STEP_MS; c.nodes[name].out = out;
    }
    await step('Extract FNOL Details', D.fnol);
    await step('Extract Policy Schedule', D.sched);
    await step('Preserve Claim Evidence', D.ev);
    if (fail) { c.order.push('Validate Policy'); c.nodes['Validate Policy'] = { status: 'FAILED', start: Date.now() }; c.running = ''; c.status = 'FAILED'; return; }
    await step('Validate Policy', D.val);
    await step('Triage Claim', D.tri);
    await step('Interpret Policy Clauses', D.interp);
    await step('Determine Coverage', D.cov);
    const node = complex ? 'Claims Handler Review' : 'Quick Handler Sign-Off';
    c.order.push(node); c.running = node; c.status = 'WAITING';
    c.nodes[node] = { status: 'WAITING', start: Date.now() };
    const execId = opts.execIdMode === 'random' ? crypto.randomUUID() : c.id;
    const token = crypto.randomBytes(16).toString('hex');
    const schema = complex ? {
      handler_review_outcome: { type: 'str', display_name: 'Handler Review Outcome', variable_name: 'handler_review_outcome', is_nullable: false },
      confirmed_coverage_decision: { type: 'str', display_name: 'Confirmed Coverage Decision', variable_name: 'confirmed_coverage_decision', is_nullable: false },
      handler_override_reason: { type: 'str', display_name: 'Handler Override Reason', variable_name: 'handler_override_reason', is_nullable: false },
      handler_notes: { type: 'str', display_name: 'Handler Notes', variable_name: 'handler_notes', is_nullable: false },
      handler_reviewed_by: { type: 'str', display_name: 'Handler Reviewed By', variable_name: 'handler_reviewed_by', is_nullable: false },
      handler_reviewed_at: { type: 'date', display_name: 'Handler Reviewed At', variable_name: 'handler_reviewed_at', is_nullable: false },
      handler_review_audit: { type: 'array', display_name: 'Handler Review Audit', variable_name: 'handler_review_audit', is_nullable: false }
    } : {
      quick_signoff_outcome: { type: 'str', display_name: 'Quick Signoff Outcome', variable_name: 'quick_signoff_outcome', is_nullable: false },
      confirmed_coverage_decision: { type: 'str', display_name: 'Confirmed Coverage Decision', variable_name: 'confirmed_coverage_decision', is_nullable: false },
      handler_notes: { type: 'str', display_name: 'Handler Notes', variable_name: 'handler_notes', is_nullable: false },
      handler_reviewed_by: { type: 'str', display_name: 'Handler Reviewed By', variable_name: 'handler_reviewed_by', is_nullable: false },
      handler_reviewed_at: { type: 'date', display_name: 'Handler Reviewed At', variable_name: 'handler_reviewed_at', is_nullable: false },
      quick_signoff_audit: { type: 'array', display_name: 'Quick Signoff Audit', variable_name: 'quick_signoff_audit', is_nullable: false }
    };
    const inputs = {};
    const wrapv = function (k, v, ty) { inputs[k] = { type: ty || (Array.isArray(v) ? 'array' : typeof v === 'number' ? 'float' : typeof v === 'object' ? 'object' : 'str'), display_name: k, variable_name: k, value: v }; };
    ['claim_reference'].forEach(function (k) { wrapv(k, ref); });
    ['coverage_decision', 'coverage_decision_reasons', 'applicable_limits', 'applicable_sub_limits', 'applicable_excess', 'coverage_confidence_score', 'outstanding_information', 'coverage_assessment_audit'].forEach(function (k) { wrapv(k, D.cov[k]); });
    ['clause_interpretation_reasoning', 'insuring_clause_references', 'exclusion_references'].forEach(function (k) { wrapv(k, D.interp[k]); });
    wrapv('evidence_audit_trail', D.ev.evidence_audit_trail);
    if (!complex) { delete inputs.outstanding_information; delete inputs.exclusion_references; delete inputs.evidence_audit_trail; }
    inputs.review_node = { type: 'node', display_name: 'Reviewed Node', variable_name: 'reviewed_node', value: {
      node_execution_id: crypto.randomUUID(), handler_id: 'h', input_schema: {}, output_schema: {},
      input: {}, output: Object.keys(D.cov).reduce(function (o, k) { o[k] = { value: D.cov[k], type: 'str' }; return o; }, {}), process: {} } };
    const decision = new Promise(function (resolve) { byExec.set(execId, { token: token, schema: schema, resolve: resolve }); });
    const payload = { execution_id: execId, workflow_id: 'wf', workflow_name: 'Policy Coverage Assessment', inputs: inputs,
      callback: { url: base + '/api/v1/execution/callback/' + execId, token: token, token_header: 'X-Opus-Callback-Token' }, expected_output_schema: schema };
    if (!opts.noWebhook) {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(APP_URL + '/api/hooks/review', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': SECRET }, body: JSON.stringify(payload) });
          if (r.ok) break;
        } catch (e) { /* retry */ }
        await sleep(500);
      }
    }
    c.pendingPayload = payload;
    const outData = await decision;
    c.nodes[node].status = 'COMPLETED'; c.nodes[node].out = outData; c.status = 'IN_PROGRESS';
    const confirmed = outData.confirmed_coverage_decision;
    await step('Generate Coverage Position', { coverage_position_document: base + '/files/position-' + c.id + '.pdf', draft_customer_communication: D.comm(confirmed), compiled_audit_trail: [{ event: 'Position generated', at: new Date().toISOString() }] });
    files.set('position-' + c.id, { body: Buffer.from('%PDF-1.4\n% coverage position for ' + ref + '\n'), type: 'application/pdf' });
    await step('Create Claims System Record', { claims_system_record: { claim_reference: ref, policy_number: D.fnol.policy_number, insured_name: D.fnol.insured_name, coverage_position: confirmed, status: 'Coverage position issued', payment_initiated: false }, audit_trail: [{ event: 'Record created', at: new Date().toISOString(), actor: 'system' }, { event: 'Handler review', at: outData.handler_reviewed_at, actor: outData.handler_reviewed_by }] });
    c.running = ''; c.status = 'COMPLETED';
    c.results = {
      coverage_position_document: base + '/files/position-' + c.id + '.pdf',
      draft_customer_communication: D.comm(confirmed),
      claims_system_record: { claim_reference: ref, policy_number: D.fnol.policy_number, insured_name: D.fnol.insured_name, coverage_position: confirmed, status: 'Coverage position issued', payment_initiated: false },
      audit_trail: [{ event: 'Record created', at: new Date().toISOString(), actor: 'system' }],
      coverage_decision: D.cov.coverage_decision,
      recommended_settlement_amount_after_excess: D.cov.recommended_settlement_amount_after_excess,
      handler_decision: outData
    };
  }

  function data(ref, complex) {
    const fnol = {
      claim_reference: ref, policy_number: 'HCP-48213907', insured_name: complex ? 'Marguerite Okonkwo-Lindqvist' : 'Daniel Ferreira',
      risk_address: complex ? '14 Kestrel Rise, Brindlewood, NSW 2794' : '7 Harbour View Lane, Westmere, VIC 3029',
      date_time_of_loss: '2026-10-11T03:20:00Z', date_reported: '2026-10-12',
      cause_of_loss: complex ? 'Storm and water ingress' : 'Escape of water (burst pipe)',
      loss_description: complex ? 'Severe storm lifted roof tiles; rainwater entered the upper floor and damaged ceilings, carpets and an antique cabinet. Mould now visible.' : 'Flexible hose under the kitchen sink failed overnight, flooding the kitchen floor and damaging lower cabinets.',
      damaged_items: complex ? [{ item: 'Ceiling plaster (2 rooms)', damage: 'Collapsed', estimated_cost: 8400 }, { item: 'Carpet, upper hall', damage: 'Saturated', estimated_cost: 3100 }, { item: 'Antique walnut cabinet', damage: 'Veneer lifting', estimated_cost: 12500 }]
        : [{ item: 'Kitchen base cabinets', damage: 'Swollen panels', estimated_cost: 2900 }, { item: 'Vinyl flooring', damage: 'Lifted', estimated_cost: 1100 }],
      estimated_amount_claimed: complex ? 24000 : 4000,
      emergency_indicators: complex ? ['Roof open to weather'] : [], vulnerability_indicators: complex ? ['Elderly occupant living alone'] : [],
      fnol_extraction_audit: [{ field: 'claim_reference', source: 'FNOL p.1', quote: ref }]
    };
    const sched = { policy_number: 'HCP-48213907', named_insureds: [fnol.insured_name], risk_address: fnol.risk_address,
      period_of_insurance: { start: '2026-03-01', end: '2027-02-28' },
      selected_covers: [{ cover: 'Buildings', status: 'Selected' }, { cover: 'Contents', status: 'Selected' }],
      sums_insured: { buildings: 650000, contents: 120000 }, sub_limits: [{ item: 'Antiques and collectibles', limit: 5000 }, { item: 'Mould remediation', limit: 2500 }],
      excess: { amount: 500, terms: 'Standard excess per event' }, endorsements: complex ? [{ id: 'E4', wording: 'Storm damage to gutters excluded' }] : [],
      premium_status: 'Paid', policy_schedule_extraction_audit: [{ field: 'policy_number', source: 'Schedule p.1' }] };
    const ev = { preserved_evidence: [{ file: 'photo_kitchen.jpg', type: 'photo', sha256: 'a3f9…' }], evidence_audit_trail: [{ item: 'photo_kitchen.jpg', registered_at: '2026-10-12T09:01:00Z', action: 'Registered, unaltered' }] };
    const val = { cover_in_force: true, insured_matches: true, risk_address_matches: true, premium_paid: true, late_notification: false,
      policy_validity_status: 'Valid', policy_validity_reasons: ['Loss date within the period of insurance', 'Premium paid', 'Insured and address match the schedule'],
      policy_validity_audit: [{ check: 'Period', result: 'Pass' }] };
    const tri = { coverage_type: 'Buildings and contents', peril_category: complex ? 'Storm' : 'Escape of liquid', urgency_level: complex ? 'High' : 'Standard',
      complexity_level: complex ? 'Complex' : 'Simple', is_high_value_claim: complex, triage_reasons: complex ? ['Open roof', 'Vulnerable occupant', 'Antique item over sub-limit'] : ['Single peril, low value'], triage_audit: [] };
    const interp = { insuring_clause_references: [{ clause: complex ? '3.2 Storm' : '3.5 Escape of liquid', citation: 'Policy wording p.14', relevance: 'Primary insuring clause' }],
      definition_references: [{ term: complex ? 'Storm' : 'Escape of liquid', citation: 'Definitions p.4' }],
      exclusion_references: complex ? [{ clause: '5.9 Mould', citation: 'p.22', applicability: 'Partially applies: gradual mould excluded beyond sub-limit' }] : [],
      general_condition_references: [], endorsement_assessment: complex ? [{ endorsement: 'E4', effect: 'Gutter damage not covered' }] : [],
      clause_interpretation_reasoning: complex ? 'The storm event falls within clause 3.2. Mould remediation is limited by sub-limit and exclusion 5.9; the antique cabinet is capped at the antiques sub-limit of 5,000.' : 'Sudden failure of a flexible hose is an escape of liquid under clause 3.5. No exclusion applies.',
      clause_interpretation_confidence: complex ? 0.68 : 0.93, clause_interpretation_audit: [] };
    const cov = { coverage_decision: complex ? 'Partially covered' : 'Covered',
      coverage_decision_reasons: complex ? ['Storm damage covered under 3.2', 'Antique cabinet capped at sub-limit', 'Mould partially excluded (5.9)'] : ['Escape of liquid covered under 3.5', 'No exclusions apply'],
      applicable_limits: [{ cover: 'Buildings', limit: 650000 }], applicable_sub_limits: complex ? [{ item: 'Antiques', limit: 5000 }, { item: 'Mould', limit: 2500 }] : [],
      applicable_excess: { amount: 500, reason: 'Standard excess per event' }, coverage_confidence_score: complex ? 0.64 : 0.94,
      outstanding_information: complex ? ['Roofer report confirming storm cause', 'Valuation for antique cabinet'] : [],
      requires_handler_review: true, is_low_confidence: complex, is_not_covered: false, is_partially_covered: complex, is_high_value_claim: complex, requires_detailed_review: complex,
      coverage_assessment_audit: [{ event: 'Assessment', at: '2026-10-12T09:05:00Z', citation: complex ? '3.2, 5.9' : '3.5' }],
      recommended_settlement_amount_after_excess: complex ? 16000 : 3500 };
    return { fnol: fnol, sched: sched, ev: ev, val: val, tri: tri, interp: interp, cov: cov,
      comm: function (d) { return 'Dear ' + fnol.insured_name + ',\n\nThank you for reporting your claim ' + ref + '. Having reviewed your policy, our position is: ' + d + '.\n\nThis letter sets out our coverage position only. Any settlement will be confirmed separately.\n\nKind regards,\nClaims team'; } };
  }

  return {
    app: app,
    setBase: function (b) { base = b; },
    cases: cases,
    resendWebhook: async function (caseId) { const c = cases.get(caseId); if (c && c.pendingPayload) return fetch(APP_URL + '/api/hooks/review', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': SECRET }, body: JSON.stringify(c.pendingPayload) }); }
  };
}

module.exports = createMock;
