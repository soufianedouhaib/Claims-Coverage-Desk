// Users, roles, password hashing and signed session cookies.
const crypto = require('crypto');
const store = require('./store');

const ROLES = {
  admin:   { label: 'Administrator',         can: ['submit', 'view', 'review_quick', 'review_detailed', 'export', 'users', 'system'] },
  intake:  { label: 'Claims Intake',         can: ['submit', 'view'] },
  handler: { label: 'Claims Handler',        can: ['view', 'review_quick'] },
  senior:  { label: 'Senior Claims Handler', can: ['view', 'review_quick', 'review_detailed', 'export'] }
};

const COOKIE = 'ccd_session';
const SESSION_HOURS = 12;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  // A fixed fallback would let anyone forge sessions, so without a secret we use a per-process
  // random one: sign-ins work but do not survive a cold start. /api/health reports it as missing.
  if (!secret._r) secret._r = crypto.randomBytes(32).toString('hex');
  return secret._r;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + h;
}
function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  const h = crypto.scryptSync(String(pw), parts[1], 64);
  const want = Buffer.from(parts[2], 'hex');
  return want.length === h.length && crypto.timingSafeEqual(h, want);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch (e) { return null; }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (c) {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function setSession(res, user, secure) {
  const token = sign({ e: user.email, v: user.sessionVersion || 1, exp: Date.now() + SESSION_HOURS * 3600e3 });
  res.setHeader('Set-Cookie', COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + SESSION_HOURS * 3600 + (secure ? '; Secure' : ''));
}
function clearSession(res) {
  res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

// ---------- users ----------
function normEmail(e) { return String(e || '').trim().toLowerCase(); }

async function getUser(email) { return store.getJSON('user:' + normEmail(email)); }
async function saveUser(u) {
  const isNew = !(await getUser(u.email));
  await store.setJSON('user:' + u.email, u);
  if (isNew) await store.listPush('users', u.email);
  return u;
}
async function listUsers() {
  const emails = await store.list('users');
  const seen = {};
  const out = [];
  for (const e of emails) {
    if (seen[e]) continue; seen[e] = 1;
    const u = await getUser(e);
    if (u) out.push(u);
  }
  return out;
}
function publicUser(u) {
  return { email: u.email, name: u.name, role: u.role, roleLabel: (ROLES[u.role] || {}).label || u.role, active: u.active !== false, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null };
}

// First sign-in bootstrap: the admin named in env vars is created the first time they sign in.
async function bootstrapAdmin(email, password) {
  const ae = normEmail(process.env.ADMIN_EMAIL);
  const ap = process.env.ADMIN_PASSWORD;
  if (!ae || !ap || normEmail(email) !== ae || password !== ap) return null;
  const existing = await getUser(ae);
  if (existing) return null;
  return saveUser({ email: ae, name: process.env.ADMIN_NAME || 'Administrator', role: 'admin', active: true, passHash: hashPassword(ap), createdAt: new Date().toISOString(), sessionVersion: 1 });
}

async function currentUser(req) {
  if (req._user !== undefined) return req._user;
  const p = verify(parseCookies(req)[COOKIE]);
  let u = null;
  if (p) {
    u = await getUser(p.e);
    if (!u || u.active === false || (u.sessionVersion || 1) !== p.v) u = null;
  }
  req._user = u;
  return u;
}

function can(user, perm) { return !!(user && ROLES[user.role] && ROLES[user.role].can.indexOf(perm) >= 0); }

function requireAuth(perm) {
  return async function (req, res, next) {
    try {
      const u = await currentUser(req);
      if (!u) return res.status(401).json({ error: 'Please sign in.' });
      if (perm && !can(u, perm)) return res.status(403).json({ error: 'Your role does not have access to this.' });
      next();
    } catch (e) { next(e); }
  };
}

module.exports = {
  ROLES, hashPassword, checkPassword, setSession, clearSession, normEmail,
  getUser, saveUser, listUsers, publicUser, bootstrapAdmin, currentUser, can, requireAuth,
  hasSessionSecret: function () { return !!(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16); }
};
