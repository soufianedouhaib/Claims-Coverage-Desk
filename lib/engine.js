// Client for the workflow engine's case API. The service key never leaves the server.

const BASE = function () { return (process.env.OPUS_BASE_URL || 'https://operator.opus.com/api/v1').replace(/\/$/, ''); };
const KEY = function () { return process.env.OPUS_SERVICE_KEY || ''; };

class EngineError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

// Read as text first: platform errors come back as HTML pages, and a bare .json() would hide the status.
async function call(method, path, body) {
  if (!KEY()) throw new EngineError('The assessment service is not configured (service key missing).', 503);
  let r;
  try {
    r = await fetch(BASE() + path, {
      method: method,
      headers: Object.assign({ 'x-service-key': KEY() }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new EngineError('Could not reach the assessment service.', 502, String(e && e.message));
  }
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
  if (r.status === 202) return { pending: true, status: 202, body: j };
  if (!r.ok) {
    const msg = (j && (j.message || j.error && (j.error.message || j.error))) || ('HTTP ' + r.status);
    throw new EngineError('The assessment service returned an error (' + r.status + '): ' + String(msg).slice(0, 300), r.status, text.slice(0, 500));
  }
  return j;
}

async function presign(opts) {
  return call('POST', '/file/upload/presigned', {
    fileExtension: opts.ext,
    originalName: opts.name,
    accessScope: 'unlisted',
    workflowId: opts.workflowId
  });
}

async function putFile(presignedUrl, buf, contentType) {
  const r = await fetch(presignedUrl, { method: 'PUT', headers: { 'Content-Type': contentType || 'application/octet-stream' }, body: buf });
  if (!r.ok) throw new EngineError('File upload failed (' + r.status + ').', 502);
}

async function createCase(workflowId, title, description) {
  const j = await call('POST', '/case', { workflowId: workflowId, title: title, description: description });
  return j.caseId;
}
async function executeCase(caseId, payload, callbackUrl) {
  const body = { payload: payload };
  if (callbackUrl) body.callbackUrl = callbackUrl;
  return call('POST', '/case/' + encodeURIComponent(caseId) + '/execute', body);
}
async function status(caseId) { return call('GET', '/case/' + encodeURIComponent(caseId) + '/status'); }
async function audit(caseId) { return call('GET', '/case/' + encodeURIComponent(caseId) + '/audit'); }
async function results(caseId) { return call('GET', '/case/' + encodeURIComponent(caseId) + '/results'); }

// Post a reviewer's decision back to the paused workflow (off-platform review callback).
async function submitCallback(cb, outputData) {
  const headers = { 'Content-Type': 'application/json' };
  headers[cb.token_header || 'X-Opus-Callback-Token'] = cb.token;
  let r;
  try {
    r = await fetch(cb.url, { method: 'POST', headers: headers, body: JSON.stringify({ output_data: outputData, status: 'success' }) });
  } catch (e) {
    return { ok: false, status: 0, text: 'Could not reach the assessment service.' };
  }
  const text = await r.text();
  return { ok: r.ok, status: r.status, text: text.slice(0, 500) };
}

module.exports = { presign, putFile, createCase, executeCase, status, audit, results, submitCallback, EngineError, configured: function () { return !!KEY(); } };
