// VoltPOS Remote — Cloudflare Worker (one file: API + the owner's web page)
//
// Storage (Workers KV, binding "VOLT"):
//   acct:<CODE>            -> { name, salt, hash, iter, shops:[{id,name,keyHash}], created }
//   snap:<CODE>:<shopId>   -> { receivedAt, snapshot }      (latest snapshot only)
//   sess:<token>           -> { code }                      (expires after 8 hours)
//   chgq:<CODE>:<shopId>   -> [ change, ... ]               edits the OWNER asks for (only the owner's session writes this)
//   chgr:<CODE>:<shopId>   -> { <id>: {status,note,at} }    what the SHOP did with them (only the shop's key writes this)
//   fail:<CODE>            -> failed-login counter          (expires after 15 minutes)
// Secrets: ADMIN_TOKEN (wrangler secret) - needed to create accounts.
//
// What the shops send: totals, recent sales, stock levels. Never PINs, never phone numbers.

const VIEWER_HTML = __VIEWER_HTML__;

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0e1117"/><path d="M56 12 28 56h20l-4 32 28-44H52z" fill="#f5c400"/></svg>';
const MANIFEST = JSON.stringify({ name: 'VoltPOS Dashboard', short_name: 'VoltPOS', start_url: '/', display: 'standalone',
  background_color: '#0e1117', theme_color: '#0e1117', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] });

const enc = new TextEncoder();
const SESSION_TTL = 8 * 3600;
const MAX_BODY = 900 * 1024;
const MAX_FAILS = 8;
const PBKDF2_ITER = 100000; // Cloudflare's maximum
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars: no 0/O/1/I, and no modulo bias

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC },
});

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
function randomString(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = ''; for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}
async function pbkdf2(password, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
function safeEqual(a, b) { // constant-time string compare
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let d = a.length ^ b.length; const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function readJSON(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Too large');
  try { const v = JSON.parse(text || '{}'); if (v && typeof v === 'object') return v; } catch (e) {}
  throw new HttpError(400, 'Bad request');
}
const CODE_RE = /^[A-Z0-9]{6,16}$/; // letters + digits only, 6 to 16 characters (the shop app checks the same rule)
const getAcct = async (env, code) => (CODE_RE.test(code) ? env.VOLT.get('acct:' + code, 'json') : null);
const cleanName = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

async function newPasswordRecord(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iter: PBKDF2_ITER, hash: await pbkdf2(password, salt, PBKDF2_ITER) };
}

// ── Edits the owner asks for ──
const CHANGE_TYPES = ['restock', 'price', 'low', 'add'];
const MAX_PENDING = 100;
const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const intIn = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const numIn = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 100) / 100 : null; };

function cleanChange(c) {
  if (!c || typeof c !== 'object' || !CHANGE_TYPES.includes(c.type)) throw new HttpError(400, 'Unknown kind of change.');
  const out = { type: c.type };
  if (c.type !== 'add') {
    out.product = cleanText(c.product, 40);
    out.name = cleanText(c.name, 80); // shown to the shop; also used to find the product if its id changed
    if (!out.product && !out.name) throw new HttpError(400, 'Choose a product.');
  }
  if (c.type === 'restock') {
    out.qty = intIn(c.qty, 1, 100000); if (out.qty === null) throw new HttpError(400, 'Quantity must be a whole number from 1 to 100000.');
    if (c.cost !== undefined && c.cost !== null && c.cost !== '') { out.cost = numIn(c.cost, 0, 10000000); if (out.cost === null) throw new HttpError(400, 'Cost price looks wrong.'); }
  } else if (c.type === 'price') {
    out.price = numIn(c.price, 0, 10000000); if (out.price === null) throw new HttpError(400, 'Price looks wrong.');
  } else if (c.type === 'low') {
    out.low = intIn(c.low, 0, 100000); if (out.low === null) throw new HttpError(400, 'Low-stock level must be a whole number.');
  } else { // add
    out.name = cleanText(c.name, 80); if (!out.name) throw new HttpError(400, 'Enter the product name.');
    out.cat = cleanText(c.cat, 40) || 'General';
    out.price = numIn(c.price, 0, 10000000); if (out.price === null) throw new HttpError(400, 'Selling price looks wrong.');
    out.cost = c.cost === undefined || c.cost === null || c.cost === '' ? 0 : numIn(c.cost, 0, 10000000); if (out.cost === null) throw new HttpError(400, 'Cost price looks wrong.');
    out.stock = c.stock === undefined || c.stock === '' ? 0 : intIn(c.stock, 0, 100000); if (out.stock === null) throw new HttpError(400, 'Opening stock must be a whole number.');
    out.low = c.low === undefined || c.low === '' ? 5 : intIn(c.low, 0, 100000); if (out.low === null) throw new HttpError(400, 'Low-stock level must be a whole number.');
    out.barcode = cleanText(c.barcode, 40);
  }
  return out;
}
const sessionAcct = async (request, env) => {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const sess = token && /^[A-Z2-9]{40}$/.test(token) ? await env.VOLT.get('sess:' + token, 'json') : null;
  const acct = sess ? await getAcct(env, sess.code) : null;
  if (!acct) throw new HttpError(401, 'Please sign in again.');
  return { code: sess.code, acct };
};
async function shopAuth(request, env) { // a shop proves itself with its own key
  const code = (request.headers.get('X-Account') || '').toUpperCase();
  const shopId = request.headers.get('X-Shop') || '';
  const acct = await getAcct(env, code);
  const shop = acct && acct.shops.find((s) => s.id === shopId);
  if (!shop || !safeEqual(await sha256(request.headers.get('X-Key') || ''), shop.keyHash)) throw new HttpError(401, 'Wrong account code, shop ID or key.');
  return { code, shop };
}
const queueKey = (code, id) => `chgq:${code}:${id}`;
const resultKey = (code, id) => `chgr:${code}:${id}`;

// the owner asks for a change
async function createChange(request, env) {
  const { code, acct } = await sessionAcct(request, env);
  const b = await readJSON(request);
  const shop = acct.shops.find((s) => s.id === b.shop);
  if (!shop) throw new HttpError(404, 'No such shop.');
  const change = cleanChange(b.change);
  const queue = (await env.VOLT.get(queueKey(code, shop.id), 'json')) || [];
  const results = (await env.VOLT.get(resultKey(code, shop.id), 'json')) || {};
  const pending = queue.filter((c) => !results[c.id]).length;
  if (pending >= MAX_PENDING) throw new HttpError(429, 'This shop already has ' + MAX_PENDING + ' changes waiting. Wait for it to catch up.');
  const rec = { id: randomString(12), at: Date.now(), ...change };
  queue.push(rec);
  // tidy up: keep everything still waiting, plus the 60 most recent finished ones
  const fin = queue.filter((c) => results[c.id]);
  const drop = new Set(fin.slice(0, Math.max(0, fin.length - 60)).map((c) => c.id));
  await env.VOLT.put(queueKey(code, shop.id), JSON.stringify(queue.filter((c) => !drop.has(c.id))));
  return json({ ok: true, id: rec.id });
}
// the shop collects what is waiting for it
async function pullChanges(request, env) {
  const { code, shop } = await shopAuth(request, env);
  const queue = (await env.VOLT.get(queueKey(code, shop.id), 'json')) || [];
  const results = (await env.VOLT.get(resultKey(code, shop.id), 'json')) || {};
  return json({ ok: true, changes: queue.filter((c) => !results[c.id]).slice(0, 50) });
}
// the shop reports what it did
async function ackChanges(request, env) {
  const { code, shop } = await shopAuth(request, env);
  const b = await readJSON(request);
  const queue = (await env.VOLT.get(queueKey(code, shop.id), 'json')) || [];
  const known = new Set(queue.map((c) => c.id));
  const results = (await env.VOLT.get(resultKey(code, shop.id), 'json')) || {};
  let n = 0;
  for (const r of (Array.isArray(b.results) ? b.results : []).slice(0, 100)) {
    if (!r || !known.has(r.id) || results[r.id]) continue; // unknown id, or already settled: ignore
    if (!['applied', 'rejected', 'failed'].includes(r.status)) continue;
    results[r.id] = { status: r.status, note: cleanText(r.note, 120), at: Date.now() };
    n++;
  }
  const ids = Object.keys(results);
  if (ids.length > 200) ids.sort((a, z) => results[a].at - results[z].at).slice(0, ids.length - 200).forEach((i) => delete results[i]);
  await env.VOLT.put(resultKey(code, shop.id), JSON.stringify(results));
  return json({ ok: true, settled: n });
}

// ── A shop pushes its latest snapshot ──
async function push(request, env) {
  const code = (request.headers.get('X-Account') || '').toUpperCase();
  const shopId = request.headers.get('X-Shop') || '';
  const key = request.headers.get('X-Key') || '';
  const acct = await getAcct(env, code);
  const shop = acct && acct.shops.find((s) => s.id === shopId);
  const keyHash = await sha256(key);
  if (!shop || !safeEqual(keyHash, shop.keyHash)) throw new HttpError(401, 'Wrong account code, shop ID or key.');
  const snapshot = await readJSON(request);
  if (Array.isArray(snapshot)) throw new HttpError(400, 'Bad snapshot');
  const receivedAt = Date.now();
  await env.VOLT.put(`snap:${code}:${shop.id}`, JSON.stringify({ receivedAt, snapshot }));
  return json({ ok: true, receivedAt });
}

// ── The owner logs in ──
async function login(request, env) {
  const body = await readJSON(request);
  const code = String(body.account || '').trim().toUpperCase();
  const password = String(body.password || '');
  const failKey = 'fail:' + code;
  const fails = parseInt((await env.VOLT.get(failKey)) || '0', 10);
  if (fails >= MAX_FAILS) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const acct = await getAcct(env, code);
  // always do the slow hash so a wrong account code takes as long as a wrong password
  const attempt = acct ? await pbkdf2(password, acct.salt, acct.iter) : await pbkdf2(password, '00'.repeat(16), PBKDF2_ITER);
  if (!acct || !safeEqual(attempt, acct.hash)) {
    await env.VOLT.put(failKey, String(fails + 1), { expirationTtl: 900 });
    throw new HttpError(401, 'Wrong account code or password.');
  }
  await env.VOLT.delete(failKey);
  const token = randomString(40);
  await env.VOLT.put('sess:' + token, JSON.stringify({ code }), { expirationTtl: SESSION_TTL });
  return json({ ok: true, token, name: acct.name, shops: acct.shops.map(({ id, name }) => ({ id, name })) });
}

async function data(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const sess = token && /^[A-Z2-9]{40}$/.test(token) ? await env.VOLT.get('sess:' + token, 'json') : null;
  if (!sess) throw new HttpError(401, 'Please sign in again.');
  const acct = await getAcct(env, sess.code);
  if (!acct) throw new HttpError(401, 'Please sign in again.');
  const shops = await Promise.all(acct.shops.map(async (s) => {
    const rec = await env.VOLT.get(`snap:${sess.code}:${s.id}`, 'json');
    const queue = (await env.VOLT.get(queueKey(sess.code, s.id), 'json')) || [];
    const results = (await env.VOLT.get(resultKey(sess.code, s.id), 'json')) || {};
    const changes = queue.slice(-40).reverse().map((c) => ({ ...c, status: results[c.id] ? results[c.id].status : 'pending', note: results[c.id] ? results[c.id].note : '', doneAt: results[c.id] ? results[c.id].at : null }));
    return { id: s.id, name: s.name, receivedAt: rec ? rec.receivedAt : null, snapshot: rec ? rec.snapshot : null, changes };
  }));
  return json({ ok: true, name: acct.name, shops, now: Date.now() });
}

// ── You (the VoltPOS seller) manage accounts with ADMIN_TOKEN ──
async function admin(request, env, action) {
  const token = env.ADMIN_TOKEN;
  if (!token || token.length < 16) throw new HttpError(503, 'ADMIN_TOKEN is not set on the server.');
  if (!safeEqual(request.headers.get('X-Admin') || '', token)) throw new HttpError(401, 'Not allowed.');
  const b = await readJSON(request);

  if (action === 'account') {
    const name = cleanName(b.name, 60);
    const password = String(b.password || '');
    const shopNames = (Array.isArray(b.shops) ? b.shops : []).map((n) => cleanName(n, 60)).filter(Boolean).slice(0, 10);
    if (!name || password.length < 8 || !shopNames.length) throw new HttpError(400, 'Need name, password (8+ characters) and at least one shop.');
    let code = String(b.code || '').replace(/\s+/g, '').toUpperCase();
    if (code) {
      if (!CODE_RE.test(code)) throw new HttpError(400, 'Account code must be 6 to 16 letters and numbers only (no spaces or symbols).');
      if (await env.VOLT.get('acct:' + code)) throw new HttpError(409, 'That account code is already taken. Choose another.');
    } else {
      do { code = randomString(10); } while (await env.VOLT.get('acct:' + code));
    }
    const shops = []; const keys = [];
    for (let i = 0; i < shopNames.length; i++) {
      const key = randomString(24);
      shops.push({ id: 's' + (i + 1), name: shopNames[i], keyHash: await sha256(key) });
      keys.push({ id: 's' + (i + 1), name: shopNames[i], key });
    }
    await env.VOLT.put('acct:' + code, JSON.stringify({ name, ...(await newPasswordRecord(password)), shops, created: Date.now() }));
    return json({ ok: true, account: code, shops: keys });
  }

  const code = String(b.account || '').trim().toUpperCase();
  const acct = await getAcct(env, code);
  if (!acct) throw new HttpError(404, 'No such account.');

  if (action === 'shop') {
    const name = cleanName(b.name, 60);
    if (!name) throw new HttpError(400, 'Shop name needed.');
    if (acct.shops.length >= 10) throw new HttpError(400, 'Too many shops.');
    const n = Math.max(0, ...acct.shops.map((s) => parseInt(s.id.slice(1), 10) || 0)) + 1;
    const key = randomString(24);
    acct.shops.push({ id: 's' + n, name, keyHash: await sha256(key) });
    await env.VOLT.put('acct:' + code, JSON.stringify(acct));
    return json({ ok: true, account: code, shop: { id: 's' + n, name, key } });
  }
  if (action === 'reset-password') {
    const password = String(b.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password must be 8+ characters.');
    Object.assign(acct, await newPasswordRecord(password));
    await env.VOLT.put('acct:' + code, JSON.stringify(acct));
    await env.VOLT.delete('fail:' + code);
    return json({ ok: true });
  }
  if (action === 'delete-account') {
    await Promise.all(acct.shops.flatMap((s) => [env.VOLT.delete(`snap:${code}:${s.id}`), env.VOLT.delete(queueKey(code, s.id)), env.VOLT.delete(resultKey(code, s.id))]));
    await env.VOLT.delete('acct:' + code);
    return json({ ok: true });
  }
  throw new HttpError(404, 'Unknown action.');
}

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const m = request.method;
  if (m === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return new Response(VIEWER_HTML, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SEC,
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'",
    } });
  }
  if (m === 'GET' && pathname === '/manifest.json') return new Response(MANIFEST, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400', ...SEC } });
  if (m === 'GET' && pathname === '/icon.svg') return new Response(ICON_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400', ...SEC } });
  if (m === 'GET' && pathname === '/api/health') return json({ ok: true, service: 'voltpos-remote' });
  if (m === 'POST' && pathname === '/api/push') return push(request, env);
  if (m === 'POST' && pathname === '/api/login') return login(request, env);
  if (m === 'POST' && pathname === '/api/changes') return createChange(request, env);
  if (m === 'POST' && pathname === '/api/pull') return pullChanges(request, env);
  if (m === 'POST' && pathname === '/api/ack') return ackChanges(request, env);
  if (m === 'GET' && pathname === '/api/data') return data(request, env);
  if (m === 'POST' && pathname.startsWith('/api/admin/')) return admin(request, env, pathname.slice('/api/admin/'.length));
  return json({ ok: false, error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
      console.error(e);
      return json({ ok: false, error: 'Server error' }, 500);
    }
  },
};
