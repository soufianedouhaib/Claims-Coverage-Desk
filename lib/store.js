// Small key-value layer over Redis.
// Supports Upstash / Vercel KV REST credentials, a TCP REDIS_URL, or (local only) memory.
// Env vars are matched by SUFFIX because Vercel prefixes injected names (e.g. MYSTORE_KV_REST_API_URL).

function envBySuffix(suffixes, exclude) {
  const keys = Object.keys(process.env);
  for (const s of suffixes) {
    const k = keys.find(function (k) {
      return k.endsWith(s) && process.env[k] && !(exclude && exclude.test(k));
    });
    if (k) return { name: k, value: process.env[k] };
  }
  return null;
}

function restConfig() {
  const url = envBySuffix(['KV_REST_API_URL', 'REDIS_REST_URL', 'REST_API_URL']);
  const token = envBySuffix(['KV_REST_API_TOKEN', 'REDIS_REST_TOKEN', 'REST_API_TOKEN'], /READ_ONLY/);
  if (url && token) return { url: url.value.replace(/\/$/, ''), token: token.value, names: [url.name, token.name] };
  return null;
}

function tcpConfig() {
  const u = envBySuffix(['REDIS_URL', 'KV_URL']);
  if (u && /^rediss?:\/\//.test(u.value)) return { url: u.value, names: [u.name] };
  return null;
}

// ---------- REST backend ----------
function restBackend(cfg) {
  async function cmd(args) {
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error('Storage returned ' + r.status); }
    if (j.error) throw new Error('Storage error: ' + j.error);
    return j.result;
  }
  return {
    kind: 'redis-rest',
    get: function (k) { return cmd(['GET', k]); },
    set: function (k, v) { return cmd(['SET', k, v]); },
    del: function (k) { return cmd(['DEL', k]); },
    lpush: function (k, v) { return cmd(['LPUSH', k, v]); },
    lrange: function (k, a, b) { return cmd(['LRANGE', k, String(a), String(b)]); },
    lrem: function (k, v) { return cmd(['LREM', k, '0', v]); },
    setnx: function (k, v, ttl) { return cmd(['SET', k, v, 'NX', 'EX', String(ttl)]).then(function (r) { return r === 'OK'; }); }
  };
}

// ---------- TCP backend ----------
function tcpBackend(cfg) {
  let client = null;
  function c() {
    if (!client) {
      const Redis = require('ioredis');
      client = new Redis(cfg.url, { maxRetriesPerRequest: 2, lazyConnect: false, tls: cfg.url.startsWith('rediss://') ? {} : undefined });
    }
    return client;
  }
  return {
    kind: 'redis-tcp',
    get: function (k) { return c().get(k); },
    set: function (k, v) { return c().set(k, v); },
    del: function (k) { return c().del(k); },
    lpush: function (k, v) { return c().lpush(k, v); },
    lrange: function (k, a, b) { return c().lrange(k, a, b); },
    lrem: function (k, v) { return c().lrem(k, 0, v); },
    setnx: function (k, v, ttl) { return c().set(k, v, 'EX', ttl, 'NX').then(function (r) { return r === 'OK'; }); }
  };
}

// ---------- Memory backend (local development / tests only) ----------
function memoryBackend() {
  const m = new Map();
  const exp = new Map();
  function alive(k) { if (exp.has(k) && exp.get(k) < Date.now()) { m.delete(k); exp.delete(k); } return m.has(k); }
  return {
    kind: 'memory',
    get: async function (k) { return alive(k) ? m.get(k) : null; },
    set: async function (k, v) { m.set(k, v); exp.delete(k); return 'OK'; },
    del: async function (k) { m.delete(k); return 1; },
    lpush: async function (k, v) { const a = m.get(k) || []; a.unshift(v); m.set(k, a); return a.length; },
    lrange: async function (k, a, b) { const l = m.get(k) || []; return l.slice(a, b === -1 ? undefined : b + 1); },
    lrem: async function (k, v) { const l = (m.get(k) || []).filter(function (x) { return x !== v; }); m.set(k, l); return 1; },
    setnx: async function (k, v, ttl) { if (alive(k)) return false; m.set(k, v); exp.set(k, Date.now() + ttl * 1000); return true; }
  };
}

let backend = null;
function pick() {
  if (backend) return backend;
  const rest = restConfig();
  const tcp = tcpConfig();
  if (rest) backend = restBackend(rest);
  else if (tcp) backend = tcpBackend(tcp);
  else backend = memoryBackend();
  return backend;
}

const PREFIX = 'ccd:';

const store = {
  kind: function () { return pick().kind; },
  persistent: function () { return pick().kind !== 'memory'; },
  envNames: function () {
    const rest = restConfig(); const tcp = tcpConfig();
    return rest ? rest.names : tcp ? tcp.names : [];
  },
  getJSON: async function (k) {
    const v = await pick().get(PREFIX + k);
    if (v == null) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; }
  },
  setJSON: function (k, v) { return pick().set(PREFIX + k, JSON.stringify(v)); },
  del: function (k) { return pick().del(PREFIX + k); },
  listPush: function (k, v) { return pick().lpush(PREFIX + k, v); },
  list: async function (k, max) { return (await pick().lrange(PREFIX + k, 0, (max || 2000) - 1)) || []; },
  listRemove: function (k, v) { return pick().lrem(PREFIX + k, v); },
  lock: function (k, ttlSeconds) { return pick().setnx(PREFIX + 'lock:' + k, '1', ttlSeconds || 30); },
  unlock: function (k) { return pick().del(PREFIX + 'lock:' + k); },
  _reset: function () { backend = null; }
};

module.exports = store;
