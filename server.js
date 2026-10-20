// Claims Coverage Desk: Express backend.
// Holds the service key, starts claim assessments, tracks progress, and receives the two
// handler-review steps (detailed review and quick sign-off) as off-platform review webhooks.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const auth = require('./lib/auth');
const engine = require('./lib/engine');

// ---------------------------------------------------------------------------
// Workflow contract (pinned from the workflow definition)
// ---------------------------------------------------------------------------
const WORKFLOW_ID = process.env.WORKFLOW_ID || 'dfcf34a1-993e-4093-bd04-3022204c3f12';

const INPUTS = {
  fnol:     { id: 'fnol_claim_notification_pdf',        type: 'file',        displayName: 'Fnol Claim Notification Pdf' },
  schedule: { id: 'policy_schedule_or_certificate_pdf', type: 'file',        displayName: 'Policy Schedule Or Certificate Pdf' },
  wording:  { id: 'policy_wording_or_pds_pdf',          type: 'file',        displayName: 'Policy Wording Or Pds Pdf' },
  // A list of files is type "array" with a file item definition ("array_files" is not a valid
  // type in the v1 case API and made the run fail before its first step).
  evidence: { id: 'supporting_evidence',                type: process.env.EVIDENCE_INPUT_TYPE || 'array', displayName: 'Supporting Evidence',
    typeDefinition: { id: 'b3ab3b8c-ddcc-4b91-bf4e-cb50338bd9ac', variable_name: 'item', display_name: 'Item', default: null, description: null, is_nullable: false,
      tags: [], options: [], allowed_types: [{ type: 'file', type_definition: null, functions: [], type_definition_enforced: true }], current_type: null, non_editable_fields: [], can_delete: true } }
};

// Workflow step names (as the engine reports them) -> what the console shows.
const STEPS = [
  { node: 'Extract FNOL Details',        label: 'Read claim notification' },
  { node: 'Extract Policy Schedule',     label: 'Read policy schedule' },
  { node: 'Preserve Claim Evidence',     label: 'Register evidence' },
  { node: 'Validate Policy',             label: 'Validate policy' },
  { node: 'Triage Claim',                label: 'Triage claim' },
  { node: 'Interpret Policy Clauses',    label: 'Interpret policy wording' },
  { node: 'Determine Coverage',          label: 'Assess coverage' },
  { node: ['Claims Handler Review', 'Quick Handler Sign-Off'], label: 'Handler review', review: true },
  { node: 'Generate Coverage Position',  label: 'Prepare coverage position' },
  { node: 'Create Claims System Record', label: 'Create claims record' }
];
const REVIEW_NODES = { 'Claims Handler Review': 'detailed', 'Quick Handler Sign-Off': 'quick' };
const REVIEW_KIND = {
  detailed: { label: 'Detailed review', perm: 'review_detailed', outcomeVar: 'handler_review_outcome',
    outcomes: ['Confirmed', 'Overridden', 'Clarification requested'] },
  quick:    { label: 'Quick sign-off',  perm: 'review_quick',    outcomeVar: 'quick_signoff_outcome',
    outcomes: ['Confirmed', 'Non-binding override', 'Returned for further review'] }
};
const DECISIONS = ['Covered', 'Partially covered', 'Not covered', 'More information required'];

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];

function missingEnv() {
  const m = [];
  if (!process.env.OPUS_SERVICE_KEY) m.push('OPUS_SERVICE_KEY');
  if (!auth.hasSessionSecret()) m.push('SESSION_SECRET');
  if (!process.env.REVIEW_WEBHOOK_SECRET) m.push('REVIEW_WEBHOOK_SECRET');
  if (!store.persistent()) m.push('Redis storage (connect an Upstash Redis store)');
  if (!auth.demoEnabled() && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) m.push('ADMIN_EMAIL / ADMIN_PASSWORD (first sign-in)');
  return m;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Keep vendor and tool names out of anything the browser shows.
app.use('/api', function (req, res, next) {
  const orig = res.json.bind(res);
  res.json = function (body) {
    if (body && typeof body.error === 'string') body.error = clean(body.error);
    return orig(body);
  };
  next();
});
function clean(s) { return String(s).replace(/\bopus\b/gi, 'assessment service').replace(/x-opus-[a-z-]+/gi, 'callback header'); }

const json = express.json({ limit: '1mb' });
const bigJson = express.json({ limit: '6mb' });

function wrap(fn) { return function (req, res, next) { Promise.resolve(fn(req, res, next)).catch(next); }; }
function nowIso() { return new Date().toISOString(); }
function rid() { return crypto.randomBytes(9).toString('base64url'); }
function originOf(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return proto + '://' + host;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------
// Turn the engine's various {variable: {value,...}} / [{variableName, value}] shapes into {variable: value}.
function toValueMap(x) {
  const out = {};
  if (!x) return out;
  if (Array.isArray(x)) {
    x.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      const k = it.variable_name || it.variableName || it.name || it.id;
      if (k) out[k] = it.value;
    });
    return out;
  }
  if (typeof x === 'object') {
    Object.keys(x).forEach(function (k) {
      const v = x[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && ('type' in v || 'variable_name' in v || 'displayName' in v || 'display_name' in v)) ? v.value : v;
    });
  }
  return out;
}

// Bound what we store per claim (very large engine payloads would hit storage limits).
function trim(v, depth) {
  depth = depth || 0;
  if (typeof v === 'string') return v.length > 40000 ? v.slice(0, 40000) + ' …[truncated]' : v;
  if (Array.isArray(v)) return v.slice(0, 300).map(function (x) { return trim(x, depth + 1); });
  if (v && typeof v === 'object') {
    if (depth > 8) return '[nested]';
    const o = {};
    Object.keys(v).slice(0, 200).forEach(function (k) { o[k] = trim(v[k], depth + 1); });
    return o;
  }
  return v;
}

function nodeKey(name) { return String(name || '').trim().toLowerCase(); }

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
async function getClaim(id) { return store.getJSON('claim:' + id); }
async function saveClaim(c) { c.updatedAt = nowIso(); await store.setJSON('claim:' + c.id, c); return c; }
async function getClaimData(id) { return (await store.getJSON('claimdata:' + id)) || { nodes: {}, results: null }; }
async function saveClaimData(id, d) { return store.setJSON('claimdata:' + id, d); }
async function allClaimIds() {
  const ids = await store.list('claims', 5000);
  const seen = {}; return ids.filter(function (i) { if (seen[i]) return false; seen[i] = 1; return true; });
}
async function allClaims() {
  const out = [];
  for (const id of await allClaimIds()) { const c = await getClaim(id); if (c && !c.deleted) out.push(c); }
  return out;
}

function deriveStatus(c, review) {
  const s = c.engineStatus || 'PENDING';
  if (s === 'COMPLETED') return 'completed';
  if (s === 'FAILED') return 'failed';
  if (s === 'CANCELLED') return 'cancelled';
  if (s === 'TIMED_OUT') return 'timed_out';
  if (review && review.status === 'pending') return 'awaiting_' + review.kind;
  if (s === 'WAITING') return c.waitingKind ? 'awaiting_' + c.waitingKind : 'awaiting_review';
  if (s === 'PENDING') return 'queued';
  return 'processing';
}

function toRow(c, review) {
  const decision = c.confirmedDecision || c.coverageDecision || null;
  return {
    id: c.id,
    title: c.title,
    claimReference: c.claimReference || null,
    insuredName: c.insuredName || null,
    policyNumber: c.policyNumber || null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    createdByName: c.createdByName,
    status: deriveStatus(c, review),
    engineStatus: c.engineStatus,
    coverageDecision: c.coverageDecision || null,
    confirmedDecision: c.confirmedDecision || null,
    decision: decision,
    decisionConfirmed: !!c.confirmedDecision,
    reviewKind: c.reviewKind || (review && review.kind) || null,
    reviewId: c.reviewId || null,
    reviewStatus: review ? review.status : null,
    progress: c.progress ? { executed: c.progress.executed || 0, total: c.progress.total || STEPS.length, running: c.progress.runningLabel || null } : null,
    error: c.error || null,
    completedAt: c.completedAt || null,
    sampleId: c.sampleId || null
  };
}

async function reviewForClaim(c) {
  if (!c.reviewId) return null;
  return getReview(c.reviewId);
}

function stepsFor(c, data, review) {
  const nodes = (data && data.nodes) || {};
  const byKey = {};
  Object.keys(nodes).forEach(function (k) { byKey[nodeKey(k)] = nodes[k]; });
  return STEPS.map(function (s) {
    let names = Array.isArray(s.node) ? s.node : [s.node];
    if (s.review) names = names.concat(Object.keys(nodes).filter(isReviewNodeName));
    let hit = null, hitName = null;
    names.forEach(function (n) { if (!hit && byKey[nodeKey(n)]) { hit = byKey[nodeKey(n)]; hitName = n; } });
    let label = s.label;
    if (s.review) {
      const kind = (hitName && REVIEW_NODES[hitName]) || c.reviewKind;
      if (kind) label = REVIEW_KIND[kind].label;
    }
    let st = hit ? String(hit.status || '').toUpperCase() : '';
    let state = st === 'COMPLETED' ? 'done' : st === 'FAILED' ? 'failed' : st === 'WAITING' ? 'waiting' : st === 'STARTED' || st === 'RUNNING' || st === 'IN_PROGRESS' ? 'running' : st ? 'running' : 'todo';
    if (c.engineStatus === 'COMPLETED' && state !== 'failed') state = 'done';
    return { label: label, state: state, ms: hit && hit.ms || null, review: !!s.review };
  }).map(function (s, i, all) {
    // A review has arrived: everything before it has finished, even if the progress log lags behind.
    const ri = all.findIndex(function (x) { return x.review; });
    if (review && (review.status === 'pending' || review.status === 'submitting')) {
      if (i < ri && s.state !== 'failed') s.state = 'done';
      if (i === ri) { s.state = 'waiting'; s.label = REVIEW_KIND[review.kind].label; }
    } else if (review && review.status === 'completed' && i <= ri && s.state !== 'failed') {
      s.state = 'done'; if (i === ri) s.label = REVIEW_KIND[review.kind].label;
    }
    delete s.review;
    return s;
  });
}

function pickFirst(obj, keys) {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  return null;
}

// Pull headline facts out of stored node outputs / final results.
function absorbFacts(c, data) {
  const nodes = data.nodes || {};
  const get = function (n) { const k = Object.keys(nodes).find(function (x) { return nodeKey(x) === nodeKey(n); }); return k ? (nodes[k].outputs || {}) : {}; };
  const fnol = get('Extract FNOL Details');
  const sched = get('Extract Policy Schedule');
  const cov = get('Determine Coverage');
  const results = data.results || {};
  c.claimReference = c.claimReference || pickFirst(fnol, ['claim_reference']) || pickFirst(results.claims_system_record || {}, ['claim_reference']) || null;
  c.insuredName = c.insuredName || pickFirst(fnol, ['insured_name']) || null;
  c.policyNumber = c.policyNumber || pickFirst(fnol, ['policy_number']) || pickFirst(sched, ['policy_number']) || null;
  if (cov.coverage_decision) c.coverageDecision = cov.coverage_decision;
  if (results.coverage_decision && !c.coverageDecision) c.coverageDecision = results.coverage_decision;
  if (cov.requires_detailed_review === true) c.expectedReview = 'detailed';
  if (cov.requires_detailed_review === false) c.expectedReview = 'quick';
  const hd = results.handler_decision;
  if (hd && typeof hd === 'object' && hd.confirmed_coverage_decision) c.confirmedDecision = hd.confirmed_coverage_decision;
}

async function refreshClaim(c, force) {
  if (!c || (c.final && (c.engineStatus === 'COMPLETED' || c.failureDetail !== undefined))) return c;
  const fresh = c.lastPolledAt && (Date.now() - Date.parse(c.lastPolledAt) < 4000);
  if (fresh && !force) return c;
  if (!engine.configured()) return c;
  if (!(await store.lock('poll:' + c.id, 10))) return c;
  try {
    c = (await getClaim(c.id)) || c;
    const data = await getClaimData(c.id);
    try {
      const st = await engine.status(c.caseId);
      if (st && st.status) c.engineStatus = st.status;
    } catch (e) { c.pollError = e.message; }

    try {
      const a = await engine.audit(c.caseId);
      if (a && !a.pending) {
        const ned = (a.audit && a.audit.nodesExecutionData) || {};
        Object.keys(ned).forEach(function (name) {
          const n = ned[name] || {};
          data.nodes[name] = {
            status: n.executionStatus || 'UNKNOWN',
            ms: n.executionTime || null,
            index: n.executionIndex,
            outputs: trim(toValueMap(n.executionOutput))
          };
        });
        const running = a.runningNode || '';
        c.progress = {
          executed: a.executedNodeCount || 0,
          total: a.totalNodeCount || STEPS.length,
          running: running,
          runningLabel: labelForNode(running)
        };
        Object.keys(REVIEW_NODES).forEach(function (n) {
          const k = Object.keys(data.nodes).find(function (x) { return nodeKey(x) === nodeKey(n); });
          if (k) { c.reviewKind = c.reviewKind || REVIEW_NODES[n]; if (String(data.nodes[k].status).toUpperCase() === 'WAITING') c.waitingKind = REVIEW_NODES[n]; }
        });
        if (REVIEW_NODES[running]) c.waitingKind = REVIEW_NODES[running];
        const failed = (a.failedNodes || []).filter(function (n) { return !/^(input|output)$/i.test(n); });
        if (failed.length && c.engineStatus === 'FAILED') c.error = 'The assessment stopped at: ' + labelForNode(failed[0]) + (failed.length > 1 ? ' (the steps after it did not run)' : '');
      }
    } catch (e) { /* audit is best-effort */ }

    if (c.engineStatus === 'COMPLETED' && !c.resultsFetched) {
      try {
        const r = await engine.results(c.caseId);
        if (r && !r.pending && r.results) {
          data.results = trim(toValueMap(r.results));
          c.resultsFetched = true;
          c.completedAt = c.completedAt || nowIso();
        }
      } catch (e) { c.pollError = e.message; }
    }
    if (c.engineStatus === 'FAILED' && !c.error) {
      c.error = (c.progress && c.progress.executed) ? 'The assessment could not be completed.' : 'The assessment stopped before its first step. This usually means an input was rejected.';
    }
    // Keep whatever the engine says about a failure, for administrators.
    if (['FAILED', 'TIMED_OUT', 'CANCELLED'].indexOf(c.engineStatus) >= 0 && c.failureDetail === undefined) {
      try { const r = await engine.results(c.caseId); c.failureDetail = r && r.body ? JSON.stringify(r.body).slice(0, 1500) : (r ? JSON.stringify(r).slice(0, 1500) : ''); }
      catch (e) { c.failureDetail = String(e.detail || e.message || '').slice(0, 1500); }
    }
    if (c.engineStatus === 'TIMED_OUT' && !c.error) c.error = 'The assessment ran out of time (a review may have passed its deadline).';
    absorbFacts(c, data);
    if (TERMINAL.indexOf(c.engineStatus) >= 0 && (c.engineStatus !== 'COMPLETED' || c.resultsFetched)) c.final = true;
    c.lastPolledAt = nowIso();
    await saveClaimData(c.id, data);
    await saveClaim(c);
    if (!c.reviewId && (c.engineStatus === 'WAITING' || c.claimReference)) await linkOrphanReviews(c);
  } finally {
    await store.unlock('poll:' + c.id);
  }
  return c;
}

function labelForNode(name) {
  if (!name) return null;
  if (REVIEW_NODES[name]) return REVIEW_KIND[REVIEW_NODES[name]].label;
  if (isReviewNodeName(name)) return 'Handler review';
  const s = STEPS.find(function (s) { return !Array.isArray(s.node) && nodeKey(s.node) === nodeKey(name); });
  return s ? s.label : 'Processing';
}

// ---------------------------------------------------------------------------
// Reviews (off-platform review webhooks)
// ---------------------------------------------------------------------------
async function getReview(id) { return store.getJSON('review:' + id); }
async function saveReview(r) { r.updatedAt = nowIso(); await store.setJSON('review:' + r.id, r); return r; }
async function allReviews() {
  const ids = await store.list('reviews', 5000);
  const seen = {}; const out = [];
  for (const id of ids) { if (seen[id]) continue; seen[id] = 1; const r = await getReview(id); if (r && !r.dismissed) out.push(r); }
  return out;
}

// When a step is (re)connected off-platform, the platform may rename its variables to
// generated ids such as "workflow_output_3dfyyjpmp" while keeping the display names. Map those
// back to the names the console understands ("Handler Notes" -> handler_notes); the real
// variable name is kept for sending the decision back.
function snake(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function canonicalName(varName, def) {
  if (/^workflow_(output|input)_/.test(varName) && def && (def.display_name || def.displayName)) return snake(def.display_name || def.displayName);
  return varName;
}
function canonicalSchema(schema) {
  const out = {};
  Object.keys(schema || {}).forEach(function (v) {
    const def = schema[v] || {};
    out[canonicalName(v, def)] = Object.assign({}, def, { variable_name: def.variable_name || v });
  });
  return out;
}
function isReviewNodeName(name) { return !!REVIEW_NODES[name] || /off-?platform|handler review|sign-?off|human task/i.test(String(name || '')); }

function kindFromSchema(schema, q) {
  if (q === 'detailed' || q === 'quick') return q;
  const keys = Object.keys(schema || {});
  if (keys.indexOf('handler_review_outcome') >= 0 || keys.indexOf('handler_override_reason') >= 0) return 'detailed';
  if (keys.indexOf('quick_signoff_outcome') >= 0) return 'quick';
  return 'detailed';
}

async function linkReview(r) {
  if (r.claimId) return r;
  const claims = await allClaims();
  let c = claims.find(function (x) { return x.caseId === r.executionId || x.id === r.executionId; });
  let how = c ? 'execution' : null;
  if (!c && r.claimReference) {
    c = claims.find(function (x) { return x.claimReference && String(x.claimReference).trim() === String(r.claimReference).trim() && TERMINAL.indexOf(x.engineStatus) < 0; });
    if (c) how = 'reference';
  }
  if (!c) {
    const waiting = claims.filter(function (x) { return !x.reviewId && (x.engineStatus === 'WAITING' || x.engineStatus === 'IN_PROGRESS') && (!x.expectedReview || x.expectedReview === r.kind); });
    if (waiting.length === 1) { c = waiting[0]; how = 'only-waiting'; }
  }
  if (c) {
    r.claimId = c.id; r.linkedBy = how;
    c.reviewId = r.id; c.reviewKind = r.kind; c.waitingKind = r.kind;
    if (!c.claimReference && r.claimReference) c.claimReference = r.claimReference;
    await saveClaim(c);
  }
  return r;
}

async function linkOrphanReviews(c) {
  const rs = await allReviews();
  for (const r of rs) {
    if (r.claimId || r.status !== 'pending') continue;
    if (r.executionId === c.caseId || (c.claimReference && r.claimReference && String(r.claimReference).trim() === String(c.claimReference).trim())) {
      r.claimId = c.id; r.linkedBy = 'later';
      c.reviewId = r.id; c.reviewKind = r.kind;
      await saveReview(r); await saveClaim(c);
      return;
    }
  }
}

function reviewRow(r, c) {
  const inp = r.inputs || {};
  const rv = r.reviewedOutputs || {};
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: REVIEW_KIND[r.kind].label,
    status: r.status,
    claimId: r.claimId || null,
    claimTitle: c ? c.title : null,
    claimReference: r.claimReference || (c && c.claimReference) || null,
    insuredName: (c && c.insuredName) || null,
    proposedDecision: pickFirst(inp, ['coverage_decision']) || pickFirst(rv, ['coverage_decision']),
    confidence: pickFirst(inp, ['coverage_confidence_score']) != null ? inp.coverage_confidence_score : pickFirst(rv, ['coverage_confidence_score']),
    receivedAt: r.receivedAt,
    completedAt: r.completedAt || null,
    completedByName: r.completedByName || null,
    outcome: r.submitted ? r.submitted[REVIEW_KIND[r.kind].outcomeVar] || null : null,
    confirmedDecision: r.submitted ? r.submitted.confirmed_coverage_decision || null : null,
    notes: r.submitted ? r.submitted.handler_notes || null : null,
    overrideReason: r.submitted ? r.submitted.handler_override_reason || null : null,
    reviewedBy: r.submitted ? r.submitted.handler_reviewed_by || r.completedByName || null : null,
    reviewedAt: r.submitted ? r.submitted.handler_reviewed_at || r.completedAt || null : null,
    lastError: r.lastError || null
  };
}

// Dates go back in the workflow's own date format. A date variable may carry a format string
// (e.g. "%d/%m/%Y" or "UNIX") in its type definition; without one the platform default is
// "%Y-%m-%d" (e.g. 2026-10-20).
function dateFormatOf(def) {
  def = def || {};
  const td = def.type_definition || def.typeDefinition || (def.allowed_types && def.allowed_types[0] && def.allowed_types[0].type_definition);
  const f = typeof td === 'string' ? td : (td && (td.format || td.date_format || td.dateFormat)) || def.format || def.date_format;
  return (typeof f === 'string' && f.trim()) ? f.trim() : '%Y-%m-%d';
}
function formatDate(fmt, ymd, now) {
  now = now || new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds())) : now;
  if (/^unix$/i.test(fmt)) return String(Math.floor(d.getTime() / 1000));
  const p2 = function (n) { return String(n).padStart(2, '0'); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const h = d.getUTCHours();
  const map = { Y: d.getUTCFullYear(), y: p2(d.getUTCFullYear() % 100), m: p2(d.getUTCMonth() + 1), d: p2(d.getUTCDate()), H: p2(h), I: p2(h % 12 || 12),
    M: p2(d.getUTCMinutes()), S: p2(d.getUTCSeconds()), b: MON[d.getUTCMonth()], B: MONTH[d.getUTCMonth()], p: h < 12 ? 'AM' : 'PM', '%': '%' };
  return fmt.replace(/%([YymdHIMSbBp%])/g, function (_, t) { return String(map[t]); });
}
function reviewedAtDef(schema) {
  const k = Object.keys(schema || {}).find(function (c) { return /_reviewed_at$/.test(c); });
  return k ? schema[k] : null;
}

function coerce(type, v) {
  type = String(type || 'str').toLowerCase();
  if (v === undefined) return null;
  if (type === 'float' || type === 'int' || type === 'number') { if (v === '' || v == null) return null; const n = Number(v); return isNaN(n) ? null : n; }
  if (type === 'bool' || type === 'boolean') return v === true || v === 'true' || v === 'yes';
  if (type === 'array' || type === 'object' || type.indexOf('array') === 0) {
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return type === 'object' ? { text: v } : [v]; } }
    return v;
  }
  if (type === 'date') return v ? String(v) : null;
  return v == null ? '' : String(v);
}

// ---------------------------------------------------------------------------
// Routes: auth
// ---------------------------------------------------------------------------
const loginAttempts = new Map();
app.post('/api/auth/login', json, wrap(async function (req, res) {
  const email = auth.normEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || '');
  const key = (req.ip || '') + '|' + email;
  const a = loginAttempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 8) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  let u = await auth.getUser(email);
  if (!u) u = await auth.bootstrapAdmin(email, password);
  if (!u || u.active === false || !auth.checkPassword(password, u.passHash)) {
    a.n++; loginAttempts.set(key, a);
    return res.status(401).json({ error: 'Email or password is not correct.' });
  }
  loginAttempts.delete(key);
  u.lastLoginAt = nowIso();
  await auth.saveUser(u);
  auth.setSession(res, u, originOf(req).startsWith('https'));
  res.json({ ok: true, user: auth.publicUser(u) });
}));

const ROLE_BLURB = {
  admin: 'Everything, including users and set-up',
  intake: 'Submits claims and follows their progress',
  handler: 'Quick sign-offs: sees only claims routed to quick sign-off',
  senior: 'Detailed reviews: sees only claims routed to detailed review'
};
// Public: the demo accounts shown on the sign-in page.
app.get('/api/auth/demo-accounts', wrap(async function (req, res) {
  const list = await auth.listDemoAccounts();
  res.json({ enabled: auth.demoEnabled(), accounts: list.map(function (u) {
    return { email: u.email, name: u.name, role: u.role, roleLabel: (auth.ROLES[u.role] || {}).label || u.role, blurb: ROLE_BLURB[u.role] || '' };
  }) });
}));

app.post('/api/auth/demo', json, wrap(async function (req, res) {
  if (!auth.demoEnabled()) return res.status(404).json({ error: 'Demo accounts are switched off.' });
  await auth.ensureDemoAccounts();
  const u = await auth.getUser(req.body && req.body.email);
  if (!auth.quickSignIn(u)) return res.status(404).json({ error: 'That account is not available for one-click sign-in.' });
  u.lastLoginAt = nowIso();
  await auth.saveUser(u);
  auth.setSession(res, u, originOf(req).startsWith('https'));
  res.json({ ok: true, user: auth.publicUser(u) });
}));

app.post('/api/auth/logout', function (req, res) { auth.clearSession(res); res.json({ ok: true }); });

app.get('/api/me', wrap(async function (req, res) {
  const u = await auth.currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  const p = auth.publicUser(u);
  p.can = auth.ROLES[u.role].can;
  p.storageReady = store.persistent();
  p.support = supportInfo();
  res.json(p);
}));

// Details for the "Contact Opus" email. Public, so the sign-in page can offer it too.
function supportInfo() {
  return {
    email: process.env.SUPPORT_EMAIL || 'support@opus.com',
    product: 'Claims Coverage Desk',
    workflowId: WORKFLOW_ID,
    orgId: process.env.OPUS_ORG_ID || 'b99049b2-1fe2-4338-aa11-5c0b2d17351f',
    workspaceId: process.env.OPUS_WORKSPACE_ID || '77f9dccc-eefa-4966-a57f-c55aef25ccce'
  };
}
app.get('/api/support-info', function (req, res) { res.json(supportInfo()); });

// Which claims a person may see. Returns false for anything outside their scope (served as 404).
function canSeeClaim(u, c, review) {
  if (!u || !c) return false;
  if (auth.can(u, 'view_all')) return true;
  if (u.role === 'intake') return c.createdBy === u.email;
  const kind = (review && review.kind) || c.reviewKind || null;
  if (!kind) return false;
  return auth.can(u, REVIEW_KIND[kind].perm);
}
async function visibleRows(u, claims) {
  const rows = [];
  for (const c of claims) { const r = await reviewForClaim(c); if (canSeeClaim(u, c, r)) rows.push(toRow(c, r)); }
  return rows;
}

app.post('/api/account/password', json, auth.requireAuth(), wrap(async function (req, res) {
  const u = await auth.currentUser(req);
  const cur = String(req.body.current || ''), nxt = String(req.body.next || '');
  if (!auth.checkPassword(cur, u.passHash)) return res.status(400).json({ error: 'Your current password is not correct.' });
  if (nxt.length < 10) return res.status(400).json({ error: 'Use at least 10 characters for the new password.' });
  u.passHash = auth.hashPassword(nxt);
  u.sessionVersion = (u.sessionVersion || 1) + 1;
  await auth.saveUser(u);
  auth.setSession(res, u, originOf(req).startsWith('https'));
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Routes: users (admin)
// ---------------------------------------------------------------------------
app.get('/api/users', auth.requireAuth('users'), wrap(async function (req, res) {
  const us = await auth.listUsers();
  res.json({ users: us.map(auth.publicUser), roles: Object.keys(auth.ROLES).map(function (k) { return { id: k, label: auth.ROLES[k].label }; }) });
}));

app.post('/api/users', json, auth.requireAuth('users'), wrap(async function (req, res) {
  const b = req.body || {};
  const email = auth.normEmail(b.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!auth.ROLES[b.role]) return res.status(400).json({ error: 'Choose a role.' });
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Enter a name.' });
  if (b.password && String(b.password).length < 10) return res.status(400).json({ error: 'Use at least 10 characters for the password, or leave it empty for one-click sign-in only.' });
  if (!b.password && b.quickSignIn === false) return res.status(400).json({ error: 'Set a password, or allow one-click sign-in, so this person can sign in.' });
  if (await auth.getUser(email)) return res.status(409).json({ error: 'A user with that email already exists.' });
  const u = await auth.saveUser({ email: email, name: String(b.name).trim(), role: b.role, active: true, quickSignIn: b.quickSignIn !== false,
    passHash: auth.hashPassword(b.password || crypto.randomBytes(24).toString('hex')), createdAt: nowIso(), sessionVersion: 1 });
  res.json({ user: auth.publicUser(u) });
}));

app.patch('/api/users/:email', json, auth.requireAuth('users'), wrap(async function (req, res) {
  const me = await auth.currentUser(req);
  const u = await auth.getUser(req.params.email);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const b = req.body || {};
  const self = u.email === me.email;
  if (b.role !== undefined) {
    if (!auth.ROLES[b.role]) return res.status(400).json({ error: 'Choose a role.' });
    if (self && b.role !== 'admin') return res.status(400).json({ error: 'You cannot remove your own administrator role.' });
    u.role = b.role; u.sessionVersion = (u.sessionVersion || 1) + 1;
  }
  if (b.name !== undefined && String(b.name).trim()) u.name = String(b.name).trim();
  if (b.quickSignIn !== undefined) u.quickSignIn = !!b.quickSignIn;
  if (b.active !== undefined) {
    if (self && !b.active) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    u.active = !!b.active; u.sessionVersion = (u.sessionVersion || 1) + 1;
  }
  if (b.password) {
    if (String(b.password).length < 10) return res.status(400).json({ error: 'Use at least 10 characters for the password.' });
    u.passHash = auth.hashPassword(b.password); u.sessionVersion = (u.sessionVersion || 1) + 1;
  }
  await auth.saveUser(u);
  res.json({ user: auth.publicUser(u) });
}));

app.delete('/api/users/:email', auth.requireAuth('users'), wrap(async function (req, res) {
  const me = await auth.currentUser(req);
  const u = await auth.getUser(req.params.email);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.email === me.email) return res.status(400).json({ error: 'You cannot delete your own account.' });
  await auth.deleteUser(u.email);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Routes: uploads
// ---------------------------------------------------------------------------
const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.heic', '.webp', '.gif', '.tif', '.tiff', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.eml', '.msg'];
function extOf(name) { const m = /\.[A-Za-z0-9]{1,6}$/.exec(String(name || '')); return m ? m[0].toLowerCase() : ''; }
const MAX_FILE = 10 * 1024 * 1024;

app.post('/api/uploads/presign', json, auth.requireAuth('submit'), wrap(async function (req, res) {
  const name = String(req.body.name || 'file');
  const ext = extOf(name);
  if (ALLOWED_EXT.indexOf(ext) < 0) return res.status(400).json({ error: 'This file type is not supported: ' + (ext || 'no extension') });
  if (Number(req.body.size) > MAX_FILE) return res.status(400).json({ error: name + ' is larger than 10 MB.' });
  const p = await engine.presign({ ext: ext, name: name, workflowId: WORKFLOW_ID });
  res.json({ presignedUrl: p.presignedUrl, fileUrl: p.fileUrl });
}));

// Fallback when the browser cannot upload straight to storage: the file passes through this server
// (limited to ~4 MB by the hosting platform).
app.post('/api/uploads/direct', auth.requireAuth('submit'), express.raw({ type: '*/*', limit: '4.4mb' }), wrap(async function (req, res) {
  const name = decodeURIComponent(String(req.headers['x-file-name'] || 'file'));
  const ext = extOf(name);
  if (ALLOWED_EXT.indexOf(ext) < 0) return res.status(400).json({ error: 'This file type is not supported: ' + (ext || 'no extension') });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'The file was empty.' });
  const p = await engine.presign({ ext: ext, name: name, workflowId: WORKFLOW_ID });
  await engine.putFile(p.presignedUrl, req.body, req.headers['x-file-type'] || 'application/octet-stream');
  res.json({ fileUrl: p.fileUrl });
}));

// ---------------------------------------------------------------------------
// Routes: claims
// ---------------------------------------------------------------------------
function fileRef(x) {
  if (!x || typeof x.fileUrl !== 'string' || !/^https?:\/\//.test(x.fileUrl)) return null;
  return { name: String(x.name || 'file').slice(0, 200), url: x.fileUrl, size: Number(x.size) || null };
}

app.post('/api/claims', json, auth.requireAuth('submit'), wrap(async function (req, res) {
  const u = await auth.currentUser(req);
  const b = req.body || {};
  const f = b.files || {};
  const files = { fnol: fileRef(f.fnol), schedule: fileRef(f.schedule), wording: fileRef(f.wording), evidence: (Array.isArray(f.evidence) ? f.evidence : []).map(fileRef).filter(Boolean) };
  const missing = [];
  if (!files.fnol) missing.push('claim notification (FNOL)');
  if (!files.schedule) missing.push('policy schedule or certificate');
  if (!files.wording) missing.push('policy wording or PDS');
  if (missing.length) return res.status(400).json({ error: 'Please add the ' + missing.join(', ') + '.' });
  const title = String(b.title || '').trim().slice(0, 120) || ('Claim submitted ' + new Date().toISOString().slice(0, 10));
  const notes = String(b.notes || '').trim().slice(0, 2000);
  const sampleId = /^[a-z0-9-]{1,40}$/.test(String(b.sampleId || '')) ? String(b.sampleId) : null;

  const caseId = await engine.createCase(WORKFLOW_ID, title, notes || ('Submitted by ' + u.name));
  const payload = {};
  payload[INPUTS.fnol.id] = { value: files.fnol.url, type: INPUTS.fnol.type, displayName: INPUTS.fnol.displayName };
  payload[INPUTS.schedule.id] = { value: files.schedule.url, type: INPUTS.schedule.type, displayName: INPUTS.schedule.displayName };
  payload[INPUTS.wording.id] = { value: files.wording.url, type: INPUTS.wording.type, displayName: INPUTS.wording.displayName };
  payload[INPUTS.evidence.id] = { value: files.evidence.map(function (e) { return e.url; }), type: INPUTS.evidence.type, displayName: INPUTS.evidence.displayName };
  if (INPUTS.evidence.type === 'array') payload[INPUTS.evidence.id].typeDefinition = INPUTS.evidence.typeDefinition;

  const claim = {
    id: caseId, caseId: caseId, title: title, notes: notes,
    createdBy: u.email, createdByName: u.name, createdAt: nowIso(),
    engineStatus: 'PENDING', files: files, sampleId: sampleId
  };
  await saveClaim(claim);
  await store.listPush('claims', caseId);

  let cbUrl = null;
  if (process.env.REVIEW_WEBHOOK_SECRET && process.env.PUBLIC_BASE_URL) {
    cbUrl = originOf(req) + '/api/hooks/case/' + encodeURIComponent(process.env.REVIEW_WEBHOOK_SECRET);
  }
  try {
    await engine.executeCase(caseId, payload, cbUrl);
    claim.engineStatus = 'IN_PROGRESS';
  } catch (e) {
    claim.engineStatus = 'FAILED';
    claim.error = clean(e.message);
  }
  await saveClaim(claim);
  res.json({ claim: toRow(claim, null) });
}));

app.get('/api/claims', auth.requireAuth('view'), wrap(async function (req, res) {
  let claims = await allClaims();
  claims.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  // Keep the newest in-flight claims fresh without hammering the engine.
  const stale = claims.filter(function (c) { return !c.final; }).slice(0, 6);
  for (const c of stale) { const r = await refreshClaim(c); Object.assign(c, r); }
  const rows = await visibleRows(await auth.currentUser(req), claims);
  res.json({ claims: rows });
}));

app.get('/api/claims.csv', auth.requireAuth('export'), wrap(async function (req, res) {
  const claims = await allClaims();
  claims.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  const csvUser = await auth.currentUser(req);
  const cols = ['Claim reference', 'Title', 'Insured', 'Policy number', 'Status', 'Proposed decision', 'Confirmed decision', 'Review type', 'Submitted by', 'Submitted at', 'Completed at'];
  const lines = [cols];
  for (const c of claims) {
    const rv = await reviewForClaim(c);
    if (!canSeeClaim(csvUser, c, rv)) continue;
    const r = toRow(c, rv);
    lines.push([r.claimReference, r.title, r.insuredName, r.policyNumber, STATUS_LABELS[r.status] || r.status, r.coverageDecision, r.confirmedDecision, r.reviewKind ? REVIEW_KIND[r.reviewKind].label : '', r.createdByName, r.createdAt, r.completedAt]);
  }
  const csv = lines.map(function (l) { return l.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="claims-' + new Date().toISOString().slice(0, 10) + '.csv"');
  res.send('﻿' + csv);
}));

const STATUS_LABELS = {
  queued: 'Queued', processing: 'Processing', awaiting_detailed: 'Awaiting detailed review', awaiting_quick: 'Awaiting quick sign-off',
  awaiting_review: 'Awaiting review', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', timed_out: 'Timed out'
};

app.get('/api/claims/:id', auth.requireAuth('view'), wrap(async function (req, res) {
  let c = await getClaim(req.params.id);
  if (!c || c.deleted) return res.status(404).json({ error: 'Claim not found.' });
  const u = await auth.currentUser(req);
  if (!canSeeClaim(u, c, await reviewForClaim(c))) return res.status(404).json({ error: 'Claim not found.' });
  c = await refreshClaim(c, req.query.refresh === '1');
  const data = await getClaimData(c.id);
  const review = await reviewForClaim(c);
  const nodes = {};
  Object.keys(data.nodes || {}).forEach(function (k) { nodes[k] = data.nodes[k].outputs || {}; });
  res.json({
    claim: toRow(c, review),
    notes: c.notes || '',
    files: {
      fnol: c.files.fnol ? { name: c.files.fnol.name } : null,
      schedule: c.files.schedule ? { name: c.files.schedule.name } : null,
      wording: c.files.wording ? { name: c.files.wording.name } : null,
      evidence: (c.files.evidence || []).map(function (e) { return { name: e.name }; })
    },
    steps: stepsFor(c, data, review),
    outputs: nodes,
    results: data.results || null,
    review: review ? Object.assign(reviewRow(review, c), { canAct: auth.can(u, REVIEW_KIND[review.kind].perm) }) : null,
    failureDetail: auth.can(u, 'system') ? (c.failureDetail || null) : undefined,
    support: { caseId: c.caseId, status: c.engineStatus, reason: c.error || null, workflowVersion: c.workflowVersion || null,
      reviewExecutionId: review ? review.executionId || null : null, submittedAt: c.createdAt, submittedBy: c.createdByName, finishedAt: c.completedAt || null },
    inputType: auth.can(u, 'system') ? INPUTS.evidence.type : undefined
  });
}));

// Open an input document or the generated coverage position document.
app.get('/api/claims/:id/file/:which', auth.requireAuth('view'), wrap(async function (req, res) {
  const c = await getClaim(req.params.id);
  if (!c || c.deleted || !canSeeClaim(await auth.currentUser(req), c, await reviewForClaim(c))) return res.status(404).json({ error: 'Claim not found.' });
  let url = null;
  const w = req.params.which;
  if (w === 'fnol' || w === 'schedule' || w === 'wording') url = c.files[w] && c.files[w].url;
  else if (/^evidence-\d+$/.test(w)) { const e = (c.files.evidence || [])[Number(w.split('-')[1])]; url = e && e.url; }
  else if (w === 'position') {
    const d = await getClaimData(c.id);
    let v = d.results && d.results.coverage_position_document;
    if (!v) { const k = Object.keys(d.nodes || {}).find(function (x) { return nodeKey(x) === nodeKey('Generate Coverage Position'); }); v = k && d.nodes[k].outputs.coverage_position_document; }
    if (v && typeof v === 'object') v = v.url || v.fileUrl || v.value;
    url = v;
  }
  if (!url || !/^https?:\/\//.test(String(url))) return res.status(404).json({ error: 'That document is not available.' });
  res.redirect(302, url);
}));

app.post('/api/claims/:id/refresh', auth.requireAuth('view'), wrap(async function (req, res) {
  const c = await getClaim(req.params.id);
  if (!c || c.deleted || !canSeeClaim(await auth.currentUser(req), c, await reviewForClaim(c))) return res.status(404).json({ error: 'Claim not found.' });
  const r = await refreshClaim(c, true);
  res.json({ claim: toRow(r, await reviewForClaim(r)) });
}));

// Remove a claim from the console (does not touch the assessment record itself).
app.delete('/api/claims/:id', auth.requireAuth('users'), wrap(async function (req, res) {
  const c = await getClaim(req.params.id);
  if (!c || c.deleted) return res.status(404).json({ error: 'Claim not found.' });
  c.deleted = true; await saveClaim(c);
  await store.listRemove('claims', c.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Routes: dashboard
// ---------------------------------------------------------------------------
app.get('/api/dashboard', auth.requireAuth('view'), wrap(async function (req, res) {
  const u = await auth.currentUser(req);
  const claims = await allClaims();
  claims.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  for (const c of claims.filter(function (c) { return !c.final; }).slice(0, 6)) Object.assign(c, await refreshClaim(c));
  const rows = await visibleRows(u, claims);
  const reviews = (await allReviews()).filter(function (r) { return r.status === 'pending'; });
  const weekAgo = Date.now() - 7 * 864e5;
  res.json({
    counts: {
      processing: rows.filter(function (r) { return r.status === 'processing' || r.status === 'queued'; }).length,
      awaiting: rows.filter(function (r) { return r.status.indexOf('awaiting') === 0; }).length,
      completed7d: rows.filter(function (r) { return r.status === 'completed' && Date.parse(r.completedAt || r.updatedAt) > weekAgo; }).length,
      problems: rows.filter(function (r) { return ['failed', 'cancelled', 'timed_out'].indexOf(r.status) >= 0; }).length
    },
    queues: {
      quick: auth.can(u, 'review_quick') ? reviews.filter(function (r) { return r.kind === 'quick'; }).length : null,
      detailed: auth.can(u, 'review_detailed') ? reviews.filter(function (r) { return r.kind === 'detailed'; }).length : null
    },
    recent: rows.slice(0, 8)
  });
}));

// ---------------------------------------------------------------------------
// Routes: reports (always limited to what the person may see)
// ---------------------------------------------------------------------------
function decisionBucket(d) {
  const n = normDecision(d);
  return { covered: 'Covered', partial: 'Partially covered', not: 'Not covered', info: 'More information required' }[n] || (d ? 'Other' : null);
}
app.get('/api/reports', auth.requireAuth('reports'), wrap(async function (req, res) {
  const u = await auth.currentUser(req);
  const days = Math.max(7, Math.min(90, Number(req.query.days) || 30));
  const since = Date.now() - days * 864e5;
  const claims = (await allClaims()).filter(function (c) { return Date.parse(c.createdAt) >= since; });
  const rows = [], reviews = [];
  for (const c of claims) {
    const r = await reviewForClaim(c);
    if (!canSeeClaim(u, c, r)) continue;
    rows.push(toRow(c, r));
    if (r) reviews.push(r);
  }
  const DEC = ['Covered', 'Partially covered', 'Not covered', 'More information required', 'Other'];
  const proposed = {}, confirmed = {};
  DEC.forEach(function (d) { proposed[d] = 0; confirmed[d] = 0; });
  rows.forEach(function (r) {
    const p = decisionBucket(r.coverageDecision); if (p) proposed[p]++;
    const c = decisionBucket(r.confirmedDecision); if (c) confirmed[c]++;
  });
  // Claims per day
  const perDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    perDay.push({ day: d, submitted: rows.filter(function (r) { return String(r.createdAt).slice(0, 10) === d; }).length,
      completed: rows.filter(function (r) { return r.completedAt && String(r.completedAt).slice(0, 10) === d; }).length });
  }
  const mins = function (a, b) { const x = (Date.parse(b) - Date.parse(a)) / 60000; return isFinite(x) && x >= 0 ? x : null; };
  const avg = function (xs) { xs = xs.filter(function (x) { return x != null; }); return xs.length ? xs.reduce(function (s, x) { return s + x; }, 0) / xs.length : null; };
  const done = reviews.filter(function (r) { return r.status === 'completed'; });
  const changed = done.filter(function (r) { const a = r.submitted && r.submitted.handler_review_audit || r.submitted && r.submitted.quick_signoff_audit; return Array.isArray(a) && a[0] && a[0].decision_changed; });
  const outcomes = {};
  done.forEach(function (r) {
    let o = r.submitted && r.submitted[REVIEW_KIND[r.kind].outcomeVar];
    if (!o) { const raw = r.submittedRaw || r.submitted || {}; const k = Object.keys(raw).find(function (x) { return /outcome/i.test(x) && typeof raw[x] === 'string'; }); o = k && raw[k]; }
    o = o || 'Not recorded';
    outcomes[o] = (outcomes[o] || 0) + 1;
  });
  res.json({
    days: days,
    scope: auth.can(u, 'view_all') ? 'all' : u.role === 'intake' ? 'mine' : u.role === 'handler' ? 'quick' : 'detailed',
    totals: {
      claims: rows.length,
      completed: rows.filter(function (r) { return r.status === 'completed'; }).length,
      awaiting: rows.filter(function (r) { return r.status.indexOf('awaiting') === 0; }).length,
      inProgress: rows.filter(function (r) { return r.status === 'processing' || r.status === 'queued'; }).length,
      problems: rows.filter(function (r) { return ['failed', 'cancelled', 'timed_out'].indexOf(r.status) >= 0; }).length,
      quick: rows.filter(function (r) { return r.reviewKind === 'quick'; }).length,
      detailed: rows.filter(function (r) { return r.reviewKind === 'detailed'; }).length,
      reviewsDone: done.length,
      overrides: changed.length,
      avgTurnaroundMin: avg(rows.filter(function (r) { return r.completedAt; }).map(function (r) { return mins(r.createdAt, r.completedAt); })),
      avgReviewWaitMin: avg(done.map(function (r) { return mins(r.receivedAt, r.completedAt); }))
    },
    perDay: perDay,
    decisions: DEC.map(function (d) { return { decision: d, proposed: proposed[d], confirmed: confirmed[d] }; }).filter(function (x) { return x.decision !== 'Other' || x.proposed || x.confirmed; }),
    outcomes: Object.keys(outcomes).map(function (k) { return { outcome: k, count: outcomes[k] }; }).sort(function (a, b) { return b.count - a.count; })
  });
}));

// ---------------------------------------------------------------------------
// Routes: reviews
// ---------------------------------------------------------------------------
function canSeeReview(u, r) { return auth.can(u, REVIEW_KIND[r.kind].perm); }

app.get('/api/reviews', auth.requireAuth(), wrap(async function (req, res) {
  const u = await auth.currentUser(req);
  if (!auth.can(u, 'review_quick') && !auth.can(u, 'review_detailed')) return res.status(403).json({ error: 'Your role does not have access to reviews.' });
  const rs = (await allReviews()).filter(function (r) { return canSeeReview(u, r); });
  const out = [];
  for (const r of rs) out.push(reviewRow(r, r.claimId ? await getClaim(r.claimId) : null));
  out.sort(function (a, b) { return String(b.receivedAt).localeCompare(String(a.receivedAt)); });
  res.json({ reviews: out, kinds: Object.keys(REVIEW_KIND).filter(function (k) { return auth.can(u, REVIEW_KIND[k].perm); }) });
}));

app.get('/api/reviews/:id', auth.requireAuth(), wrap(async function (req, res) {
  const u = await auth.currentUser(req);
  const r = await getReview(req.params.id);
  if (!r || r.dismissed || !canSeeReview(u, r)) return res.status(404).json({ error: 'Review not found.' });
  const c = r.claimId ? await getClaim(r.claimId) : null;
  const k = REVIEW_KIND[r.kind];
  res.json({
    review: reviewRow(r, c),
    inputs: r.inputs || {},
    reviewedOutputs: r.reviewedOutputs || {},
    schema: r.schema || {},
    submitted: r.submitted || null,
    outcomes: k.outcomes,
    reviewedAt: (function () {
      const def = reviewedAtDef(r.schema);
      if (!def) return null;
      const fmt = dateFormatOf(def);
      return { format: fmt, example: formatDate(fmt, new Date().toISOString().slice(0, 10)) };
    })(),
    decisions: DECISIONS,
    me: { name: u.name, email: u.email },
    claim: c ? { id: c.id, title: c.title, insuredName: c.insuredName, policyNumber: c.policyNumber, claimReference: c.claimReference,
      files: { fnol: !!c.files.fnol, schedule: !!c.files.schedule, wording: !!c.files.wording, evidence: (c.files.evidence || []).map(function (e) { return { name: e.name }; }) } } : null
  });
}));

app.post('/api/reviews/:id/submit', json, auth.requireAuth(), wrap(async function (req, res) {
  const u = await auth.currentUser(req);
  let r = await getReview(req.params.id);
  if (!r || r.dismissed || !canSeeReview(u, r)) return res.status(404).json({ error: 'Review not found.' });
  if (r.status !== 'pending') return res.status(409).json({ error: r.status === 'completed' ? 'This review has already been completed by ' + (r.completedByName || 'another handler') + '.' : 'This review can no longer be completed.' });
  const k = REVIEW_KIND[r.kind];
  const b = (req.body && req.body.values) || {};
  const outcome = String(b[k.outcomeVar] || '').trim();
  const decision = String(b.confirmed_coverage_decision || '').trim();
  const notes = String(b.handler_notes || '').trim();
  const overrideReason = String(b.handler_override_reason || '').trim();
  const proposed = pickFirst(r.inputs || {}, ['coverage_decision']) || pickFirst(r.reviewedOutputs || {}, ['coverage_decision']) || '';
  if (k.outcomes.indexOf(outcome) < 0) return res.status(400).json({ error: 'Choose a review outcome.' });
  if (!decision) return res.status(400).json({ error: 'Choose the confirmed coverage decision.' });
  if (!notes) return res.status(400).json({ error: 'Add handler notes explaining your decision.' });
  const changed = normDecision(decision) !== normDecision(proposed);
  if (r.kind === 'detailed' && (outcome === 'Overridden' || changed) && !overrideReason) return res.status(400).json({ error: 'Give an override reason, because the decision differs from the proposed one.' });

  if (!(await store.lock('submit:' + r.id, 60))) return res.status(409).json({ error: 'This review is being submitted by someone else.' });
  try {
    r = await getReview(r.id);
    if (r.status !== 'pending') return res.status(409).json({ error: 'This review has already been completed.' });
    const cb = await store.getJSON('reviewcb:' + r.id);
    if (!cb || !cb.url || !cb.token) return res.status(410).json({ error: 'The link back to the assessment is missing for this review, so it cannot be submitted.' });

    const at = nowIso();
    const reviewer = u.name + ' (' + u.email + ')';
    const auditEntry = {
      action: outcome,
      review_type: k.label,
      proposed_coverage_decision: proposed || null,
      confirmed_coverage_decision: decision,
      decision_changed: changed,
      rationale: r.kind === 'detailed' && overrideReason ? overrideReason : notes,
      notes: notes,
      reviewer: reviewer,
      timestamp: at,
      note: 'Confirms or overrides the coverage position only. Does not authorise any payment or settlement.'
    };
    const out = {}, outCanon = {};
    const schema = r.schema || {};
    // schema keys are the console's names; each entry's variable_name is what the workflow expects back.
    Object.keys(schema).forEach(function (c) {
      const t = schema[c] && schema[c].type;
      const v = (schema[c] && schema[c].variable_name) || c;
      if (/_reviewed_by$/.test(c)) out[v] = reviewer;
      else if (/_reviewed_at$/.test(c)) {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.reviewed_on || '')) ? b.reviewed_on : at.slice(0, 10);
        out[v] = (t === 'date' || !t) ? formatDate(dateFormatOf(schema[c]), day) : at;
      }
      else if (/_audit$/.test(c)) out[v] = [auditEntry];
      else if (c === k.outcomeVar) out[v] = outcome;
      else if (c === 'confirmed_coverage_decision') out[v] = decision;
      else if (c === 'handler_notes') out[v] = notes;
      else if (c === 'handler_override_reason') out[v] = overrideReason;
      else if (b[c] !== undefined) out[v] = coerce(t, b[c]);
      else if (schema[c] && schema[c].is_nullable) out[v] = null;
      else out[v] = coerce(t, '');
      outCanon[c] = out[v];
    });

    r.status = 'submitting'; await saveReview(r);
    const resp = await engine.submitCallback(cb, out);
    if (resp.ok) {
      r.status = 'completed'; r.completedAt = at; r.completedBy = u.email; r.completedByName = u.name; r.submitted = outCanon; r.submittedRaw = out; r.lastError = null;
      await saveReview(r);
      await store.del('reviewcb:' + r.id);
      if (r.claimId) {
        const c = await getClaim(r.claimId);
        if (c) { c.confirmedDecision = decision; c.waitingKind = null; c.engineStatus = c.engineStatus === 'WAITING' ? 'IN_PROGRESS' : c.engineStatus; c.lastPolledAt = null; await saveClaim(c); }
      }
      return res.json({ ok: true, review: reviewRow(r, null) });
    }
    if (resp.status === 401) {
      r.status = 'expired'; r.lastError = 'The assessment no longer accepts this review (it was already answered or passed its deadline).';
      await saveReview(r);
      return res.status(409).json({ error: r.lastError });
    }
    r.status = 'pending';
    r.lastError = resp.status === 422 ? 'The assessment rejected one of the fields (' + clean(resp.text).slice(0, 200) + ').' : resp.status === 0 ? resp.text : 'The assessment service returned ' + resp.status + '.';
    await saveReview(r);
    return res.status(502).json({ error: r.lastError + ' Your entries were not lost; try again.' });
  } finally {
    await store.unlock('submit:' + r.id);
  }
}));

function normDecision(s) {
  s = String(s || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!s) return '';
  if (/partial/.test(s)) return 'partial';
  if (/more info|information|pending|insufficient|refer/.test(s)) return 'info';
  if (/not covered|no cover|declin|uncovered|unavailable|excluded|reject/.test(s)) return 'not';
  if (/cover|full|accept/.test(s)) return 'covered';
  return s;
}

// ---------------------------------------------------------------------------
// Webhooks from the workflow engine
// ---------------------------------------------------------------------------
// The secret can arrive in the x-webhook-secret header (default name, change with
// REVIEW_WEBHOOK_HEADER), as "Authorization: Bearer <secret>", or as ?key=<secret> in the URL.
// Surrounding spaces and quotes are ignored on both sides.
function cleanSecret(v) { return String(v == null ? '' : v).trim().replace(/^["']|["']$/g, '').trim(); }
function webhookSecretCandidates(req) {
  const hdr = (process.env.REVIEW_WEBHOOK_HEADER || 'x-webhook-secret').toLowerCase();
  const out = [];
  if (req.headers[hdr] != null) out.push(['header ' + hdr, req.headers[hdr]]);
  const auth = String(req.headers.authorization || '');
  if (/^bearer\s+/i.test(auth)) out.push(['authorization bearer', auth.replace(/^bearer\s+/i, '')]);
  if (req.query.key != null) out.push(['url key', req.query.key]);
  if (req.hookPathSecret) out.push(['url path', req.hookPathSecret]);
  return out;
}
function webhookAuthorised(req) {
  const want = cleanSecret(process.env.REVIEW_WEBHOOK_SECRET);
  if (!want) return false;
  return webhookSecretCandidates(req).some(function (c) {
    const got = cleanSecret(c[1]);
    return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  });
}
// What arrived, without revealing any secret: header names, and the length of what was sent.
const STD_HEADERS = /^(host|content-type|content-length|user-agent|accept|accept-encoding|connection|x-forwarded-.*|x-real-ip|x-vercel-.*|forwarded|traceparent|tracestate|baggage|via|cdn-loop|x-amz-.*)$/;
function describeDelivery(req) {
  const names = Object.keys(req.headers).filter(function (h) { return !STD_HEADERS.test(h); });
  const want = cleanSecret(process.env.REVIEW_WEBHOOK_SECRET);
  const cands = webhookSecretCandidates(req).map(function (c) { return c[0] + ' (' + cleanSecret(c[1]).length + ' chars, expected ' + want.length + ')'; });
  const q = Object.keys(req.query || {});
  return 'Secret looked for in: ' + (cands.length ? cands.join(', ') : 'nothing found') + '. Other headers received: ' + (names.length ? names.join(', ') : 'none') +
    '. URL parameters received: ' + (q.length ? q.join(', ') : 'none') + '. Path: ' + String(req.path || '').replace(/\/[A-Za-z0-9_\-]{20,}/g, '/<secret>');
}

// Record every delivery attempt (accepted or not) so the System page can show what arrived.
function noteAttempt(req, status, note) {
  const b = req.body || {};
  return store.setJSON('meta:lastWebhookAttempt', { at: nowIso(), status: status, note: note,
    kind: hookKind(req), executionId: b.execution_id || null, bytes: Number(req.headers['content-length']) || null }).catch(function () {});
}
// The kind and the secret can also be path segments, for platforms that drop URL parameters:
//   /api/hooks/review/detailed/<secret>   /api/hooks/review/quick/<secret>   /api/hooks/review/<secret>
function hookKind(req) { return req.query.kind || req.hookPathKind || null; }
function hookPath(req, res, next) {
  [req.params.a, req.params.b].forEach(function (seg) {
    if (!seg) return;
    if (seg === 'detailed' || seg === 'quick') req.hookPathKind = seg; else req.hookPathSecret = seg;
  });
  next();
}
app.post(['/api/hooks/review', '/api/hooks/review/:a', '/api/hooks/review/:a/:b'], hookPath, bigJson, wrap(async function (req, res) {
  if (!process.env.REVIEW_WEBHOOK_SECRET) { await noteAttempt(req, 503, 'REVIEW_WEBHOOK_SECRET not set'); return res.status(503).json({ error: 'Review webhook is not configured.' }); }
  if (!webhookAuthorised(req)) { await noteAttempt(req, 401, 'Secret missing or wrong. ' + describeDelivery(req)); return res.status(401).json({ error: 'Not authorised.' }); }
  const p = req.body || {};
  if (!p.callback || !p.callback.url || !p.callback.token) { await noteAttempt(req, 400, 'No callback block in the delivery'); return res.status(400).json({ error: 'Missing callback block.' }); }
  await noteAttempt(req, 200, 'Accepted');
  const schema = canonicalSchema(p.expected_output_schema || {});
  const kind = kindFromSchema(schema, hookKind(req));
  const rawInputs = p.inputs || {};
  const inputs = {};
  let reviewedOutputs = {};
  Object.keys(rawInputs).forEach(function (k) {
    const v = rawInputs[k];
    const val = v && typeof v === 'object' && 'value' in v ? v.value : v;
    const t = v && v.type;
    if (k === 'review_node' || k === 'reviewed_node' || t === 'node' || (t && t.type === 'node')) {
      reviewedOutputs = toValueMap(val && val.output);
      const ri = toValueMap(val && val.input);
      Object.keys(ri).forEach(function (x) { if (!(x in inputs)) inputs[x] = ri[x]; });
    } else inputs[canonicalName(k, v)] = val;
  });
  const execId = String(p.execution_id || '');
  const dedupeKey = 'reviewexec:' + execId + ':' + kind;
  const existingId = execId ? await store.getJSON(dedupeKey) : null;
  if (existingId) {
    const ex = await getReview(existingId);
    if (ex && ex.status === 'pending') {
      await store.setJSON('reviewcb:' + ex.id, p.callback);
      return res.json({ ok: true, id: ex.id, duplicate: true });
    }
  }
  let r = {
    id: rid(), kind: kind, status: 'pending', executionId: execId,
    workflowId: p.workflow_id || null, receivedAt: nowIso(),
    claimReference: inputs.claim_reference || reviewedOutputs.claim_reference || null,
    inputs: trim(inputs), reviewedOutputs: trim(reviewedOutputs), schema: schema
  };
  await store.setJSON('reviewcb:' + r.id, p.callback);
  await saveReview(r);
  await store.listPush('reviews', r.id);
  if (execId) await store.setJSON(dedupeKey, r.id);
  await store.setJSON('meta:lastWebhookAt', nowIso());
  try { r = await linkReview(r); await saveReview(r); } catch (e) { /* linking is best-effort */ }
  res.json({ ok: true, id: r.id });
}));

// Optional: case-finished notification (only used when PUBLIC_BASE_URL is set).
app.post('/api/hooks/case/:secret', bigJson, wrap(async function (req, res) {
  const want = process.env.REVIEW_WEBHOOK_SECRET || '';
  const got = String(req.params.secret || '');
  if (!want || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return res.status(401).json({ error: 'Not authorised.' });
  const id = (req.body && (req.body.caseId || req.body.case_id || req.body.jobExecutionId || req.body.execution_id)) || '';
  const c = id ? await getClaim(String(id)) : null;
  if (c) { c.lastPolledAt = null; await saveClaim(c); try { await refreshClaim(c, true); } catch (e) { /* next view retries */ } }
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Admin: system page data
// ---------------------------------------------------------------------------
app.get('/api/system', auth.requireAuth('system'), wrap(async function (req, res) {
  const reviews = await allReviews();
  const claims = await allClaims();
  const origin = originOf(req);
  res.json({
    workflowId: WORKFLOW_ID,
    serviceBaseUrl: (process.env.OPUS_BASE_URL || 'https://operator.opus.com/api/v1'),
    serviceKeySet: engine.configured(),
    sessionSecretSet: auth.hasSessionSecret(),
    storage: { kind: store.kind(), envNames: store.envNames() },
    reviewWebhook: {
      url: origin + '/api/hooks/review',
      header: process.env.REVIEW_WEBHOOK_HEADER || 'x-webhook-secret',
      secretSet: !!process.env.REVIEW_WEBHOOK_SECRET,
      lastReceivedAt: await store.getJSON('meta:lastWebhookAt'),
      lastAttempt: await store.getJSON('meta:lastWebhookAttempt')
    },
    caseCallback: process.env.PUBLIC_BASE_URL ? 'on' : 'off (set PUBLIC_BASE_URL to enable)',
    evidenceInputType: INPUTS.evidence.type,
    missing: missingEnv(),
    counts: { claims: claims.length, reviews: reviews.length, pendingReviews: reviews.filter(function (r) { return r.status === 'pending'; }).length },
    unlinked: reviews.filter(function (r) { return !r.claimId; }).map(function (r) { return reviewRow(r, null); }),
    recentClaims: claims.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 30).map(function (c) { return { id: c.id, title: c.title, claimReference: c.claimReference || null, createdAt: c.createdAt }; })
  });
}));

app.post('/api/reviews/:id/link', json, auth.requireAuth('system'), wrap(async function (req, res) {
  const r = await getReview(req.params.id);
  const c = await getClaim(String(req.body.claimId || ''));
  if (!r || !c) return res.status(404).json({ error: 'Review or claim not found.' });
  r.claimId = c.id; r.linkedBy = 'manual';
  c.reviewId = r.id; c.reviewKind = r.kind;
  await saveReview(r); await saveClaim(c);
  res.json({ ok: true });
}));

app.post('/api/reviews/:id/dismiss', auth.requireAuth('system'), wrap(async function (req, res) {
  const r = await getReview(req.params.id);
  if (!r) return res.status(404).json({ error: 'Review not found.' });
  r.dismissed = true; await saveReview(r);
  await store.listRemove('reviews', r.id);
  res.json({ ok: true });
}));

app.get('/api/health', function (req, res) {
  const m = missingEnv();
  res.json({ ok: m.length === 0, storage: store.kind(), missing: m });
});

app.use('/api', function (req, res) { res.status(404).json({ error: 'Not found.' }); });

// eslint-disable-next-line no-unused-vars
app.use(function (err, req, res, next) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  const msg = err.type === 'entity.too.large' ? 'That file is too large to send through the server (limit about 4 MB).' : (err instanceof engine.EngineError ? err.message : status >= 500 ? 'Something went wrong on the server.' : err.message);
  res.status(status).json({ error: clean(msg) });
});

// Static pages (Vercel serves public/ itself; this is for local runs).
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, function () { console.log('Claims Coverage Desk on http://localhost:' + port); });
}

module.exports = app;
module.exports._internals = { STEPS, REVIEW_KIND, DECISIONS, normDecision, toValueMap };
