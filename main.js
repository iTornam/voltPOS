/**
 * VoltPOS — Electron Main Process
 * Manages the app window, embedded HTTP server, and data storage.
 */

const { app, BrowserWindow, shell, dialog, Menu, Tray, nativeImage, ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

// ── Paths ────────────────────────────────────────────
const IS_DEV = process.argv.includes('--dev');
// Where the UI files live:
//  - installed build: electron-builder copies src/ to <resources>/app  (see extraResources in package.json)
//  - `npm start` / `npm run dev`: serve the src/ folder straight from the project
const APP_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, 'src');
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const PORT = 8765; // Internal port — not exposed to browser

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DATA_FILES = {
  products:  path.join(DATA_DIR, 'products.json'),
  sales:     path.join(DATA_DIR, 'sales.json'),
  settings:  path.join(DATA_DIR, 'settings.json'),
  customers: path.join(DATA_DIR, 'customers.json'),
  expenses:  path.join(DATA_DIR, 'expenses.json'),
  stocklog:  path.join(DATA_DIR, 'stocklog.json'),
};

// ── State ────────────────────────────────────────────
let mainWindow = null;
let server = null;
let tray = null;

// ── Embedded HTTP Server ─────────────────────────────
function startServer() {
  server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    const pathname = parsedUrl.pathname;

    // Security: the UI is same-origin, so no CORS headers are sent. Reject anything
    // that looks like a cross-site request or DNS-rebinding attempt.
    if (pathname.startsWith('/api/')) {
      const host = req.headers.host || '';
      if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) {
        sendJSON(res, { ok: false, error: 'Bad host' }, 403);
        return;
      }
      const origin = req.headers.origin;
      if (origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) {
        sendJSON(res, { ok: false, error: 'Bad origin' }, 403);
        return;
      }
      if (req.method === 'POST' && !(req.headers['content-type'] || '').includes('application/json')) {
        sendJSON(res, { ok: false, error: 'JSON only' }, 415);
        return;
      }
    }

    // API: status check
    if (pathname === '/api/status') {
      sendJSON(res, { ok: true, version: app.getVersion(), dataDir: DATA_DIR, appDir: APP_DIR, packaged: app.isPackaged, features: ['auth', 'recovery', 'tour', 'local-fonts'] });
      return;
    }

    // API: open data folder
    if (pathname === '/api/open-data-folder') {
      shell.openPath(DATA_DIR);
      sendJSON(res, { ok: true });
      return;
    }

    // API: auth (PINs, recovery code, setup lock)
    if (req.method === 'POST' && pathname.startsWith('/api/auth/')) {
      const action = pathname.replace('/api/auth/', '');
      readJSONBody(req, res, (body) => handleAuth(action, body, res));
      return;
    }

    // API: remote dashboard (config + sending snapshots to the cloud)
    if (pathname.startsWith('/api/remote/')) {
      const action = pathname.replace('/api/remote/', '');
      if (req.method === 'GET' && action === 'status') { sendJSON(res, remoteStatusPayload()); return; }
      if (req.method === 'POST') { readJSONBody(req, res, (body) => handleRemote(action, body, res), 300000); return; }
    }

    // API: load data
    if (pathname.startsWith('/api/load/')) {
      const key = pathname.replace('/api/load/', '').replace(/\//g, '');
      loadData(key, res);
      return;
    }

    // API: save data
    if (req.method === 'POST' && pathname.startsWith('/api/save/')) {
      const key = pathname.replace('/api/save/', '').replace(/\//g, '');
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => saveData(key, body, res));
      return;
    }

    // Serve static files from app directory
    let filePath = path.join(APP_DIR, pathname === '/' ? 'index.html' : pathname);

    // Security: prevent directory traversal
    if (filePath !== APP_DIR && !filePath.startsWith(APP_DIR + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (pathname !== '/') {
          // Try index.html for SPA routing
          fs.readFile(path.join(APP_DIR, 'index.html'), (err2, data2) => {
            if (err2) { res.writeHead(404); res.end('Not found'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data2);
          });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html',
        '.js':   'application/javascript',
        '.css':  'text/css',
        '.json': 'application/json',
        '.png':  'image/png',
        '.ico':  'image/x-icon',
        '.svg':  'image/svg+xml',
        '.woff': 'font/woff',
        '.woff2':'font/woff2',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });

  if (!fs.existsSync(path.join(APP_DIR, 'index.html'))) {
    console.error(`VoltPOS: cannot find index.html in ${APP_DIR}`);
    dialog.showErrorBox('VoltPOS cannot start', `The app files were not found:\n${APP_DIR}\n\nIf you are running from source, make sure src/index.html exists.`);
  }

  server.listen(PORT, 'localhost', () => {
    console.log(`VoltPOS server running at http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
    if (err.code === 'EADDRINUSE') {
      // Another VoltPOS (often an old one still running in the background on macOS) already owns the port.
      // Without this, this window would silently load the OTHER copy's pages and look like nothing updated.
      dialog.showErrorBox(
        'VoltPOS is already running',
        `Another copy of VoltPOS (or another program) is using port ${PORT}.\n\nQuit VoltPOS completely (right-click its Dock icon -> Quit, or Cmd+Q) and open it again.`
      );
      app.exit(1);
    }
  });
}

// ── Auth: PINs, recovery code, setup lock ────────────
// Everything security-related lives in settings.json under "security":
//   { setupComplete, pins: {role: {salt, hash}}, recovery: {salt, hash} }
// The renderer never sees hashes: /api/load/settings strips them and adds an "_auth"
// summary of booleans, and /api/save/settings refuses to overwrite them.
const ROLE_NAMES = ['cashier', 'manager', 'owner'];
const RECOVERY_FILE = path.join(DATA_DIR, 'RECOVERY.txt');
const sessions = new Map(); // token -> { role, exp }
const SESSION_MS = 30 * 60 * 1000;
const throttles = {
  pin:      { fails: 0, until: 0, max: 5, lockMs: 30 * 1000 },
  recovery: { fails: 0, until: 0, max: 5, lockMs: 5 * 60 * 1000 },
};

function readSettingsRaw() {
  if (!fs.existsSync(DATA_FILES.settings)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILES.settings, 'utf8')); // throws if corrupt — never overwrite blindly
}

function writeJSONAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function getSecurity(raw) {
  const s = (raw && raw.security) || {};
  return { setupComplete: !!s.setupComplete, pins: s.pins || {}, recovery: s.recovery || null, remote: s.remote || null };
}

function updateSecurity(mutator) {
  const raw = readSettingsRaw();
  const sec = getSecurity(raw);
  mutator(sec);
  raw.security = sec;
  writeJSONAtomic(DATA_FILES.settings, raw);
  return sec;
}

function authSummary(sec) {
  return {
    setupComplete: sec.setupComplete,
    pins: { cashier: !!sec.pins.cashier, manager: !!sec.pins.manager, owner: !!sec.pins.owner },
    remote: remoteSummary(sec),
  };
}

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(secret), salt, 32).toString('hex') };
}

function checkSecret(secret, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const a = crypto.scryptSync(String(secret), rec.salt, 32);
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function throttleWait(kind) {
  const t = throttles[kind];
  return Date.now() < t.until ? Math.ceil((t.until - Date.now()) / 1000) : 0;
}
function throttleFail(kind) {
  const t = throttles[kind];
  if (++t.fails >= t.max) { t.until = Date.now() + t.lockMs; t.fails = 0; }
}
function throttleReset(kind) { throttles[kind].fails = 0; throttles[kind].until = 0; }

function newSession(role) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { role, exp: Date.now() + SESSION_MS });
  return token;
}
function sessionRole(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { sessions.delete(token); return null; }
  s.exp = Date.now() + SESSION_MS; // sliding expiry
  return s.role;
}

// 16 chars from an unambiguous alphabet (no 0/O/1/I) = 80 bits, shown as XXXX-XXXX-XXXX-XXXX
function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) { out += alphabet[bytes[i] % alphabet.length]; if (i % 4 === 3 && i < 15) out += '-'; }
  return out;
}
function normalizeCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function writeRecoveryFile(code) {
  const text =
`VoltPOS — OWNER PIN RECOVERY CODE
==================================

Recovery code:  ${code}

If you forget the Owner PIN, tap "Forgot Owner PIN?" on the lock screen and enter
this code to set a new PIN. A new code is issued every time one is used.

KEEP THIS SAFE. Anyone with this code (or access to this file) can reset the Owner PIN.
Best practice: copy it somewhere private (print it or store it off this computer),
then delete this file.

Generated: ${new Date().toISOString()}
`;
  fs.writeFileSync(RECOVERY_FILE, text, { encoding: 'utf8', mode: 0o600 });
}

function issueRecoveryCode(sec) {
  const code = generateRecoveryCode();
  sec.recovery = hashSecret(normalizeCode(code));
  writeRecoveryFile(code); // plaintext copy for the owner; the stored version is hashed
  return code;
}

function readJSONBody(req, res, cb, limit = 20000) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > limit) req.destroy(); });
  req.on('end', () => {
    try { cb(JSON.parse(body || '{}')); }
    catch (e) { sendJSON(res, { ok: false, error: 'Bad request' }, 400); }
  });
}

function handleAuth(action, b, res) {
  try {
    const sec = getSecurity(readSettingsRaw());
    const ownerSet = !!sec.pins.owner;
    // Once setup is done and an Owner PIN exists, changing security needs an owner session.
    const ownerAuthorized = () => !(sec.setupComplete && ownerSet) || sessionRole(b.token) === 'owner';
    const bad = (msg, code = 400) => sendJSON(res, { ok: false, error: msg }, code);

    switch (action) {
      case 'verify': {
        const wait = throttleWait('pin');
        if (wait) return bad(`Too many attempts. Try again in ${wait}s.`, 429);
        if (!ROLE_NAMES.includes(b.role) || !sec.pins[b.role]) return bad('No PIN set for that role.');
        if (checkSecret(b.pin, sec.pins[b.role])) {
          throttleReset('pin');
          return sendJSON(res, { ok: true, token: newSession(b.role) });
        }
        throttleFail('pin');
        const w = throttleWait('pin');
        return bad(w ? `Too many attempts. Try again in ${w}s.` : 'Incorrect PIN. Try again.', w ? 429 : 401);
      }

      case 'logout':
        sessions.delete(b.token);
        return sendJSON(res, { ok: true });

      case 'set-pin': {
        if (!ROLE_NAMES.includes(b.role)) return bad('Unknown role.');
        if (!/^\d{4}$/.test(String(b.pin))) return bad('PIN must be exactly 4 digits.');
        if (!ownerAuthorized()) return bad('Owner login required.', 403);
        if (b.role !== 'owner' && !ownerSet) return bad('Set an Owner PIN first.');
        let recoveryCode = null;
        const out = updateSecurity((s) => {
          s.pins[b.role] = hashSecret(b.pin);
          if (b.role === 'owner' && (!s.recovery || !s.setupComplete)) recoveryCode = issueRecoveryCode(s); // always fresh during first-time setup
        });
        return sendJSON(res, { ok: true, auth: authSummary(out), recoveryCode, token: b.role === 'owner' ? newSession('owner') : undefined });
      }

      case 'clear-pins': {
        if (!ownerAuthorized()) return bad('Owner login required.', 403);
        const out = updateSecurity((s) => { s.pins = {}; s.recovery = null; });
        try { fs.unlinkSync(RECOVERY_FILE); } catch (e) {}
        sessions.clear();
        return sendJSON(res, { ok: true, auth: authSummary(out) });
      }

      case 'complete-setup': {
        if (sec.setupComplete) return sendJSON(res, { ok: true, auth: authSummary(sec) });
        if (!ownerSet && !b.skipped) return bad('Set an Owner PIN or explicitly skip.');
        const out = updateSecurity((s) => { s.setupComplete = true; });
        return sendJSON(res, { ok: true, auth: authSummary(out) });
      }

      case 'recover': {
        const wait = throttleWait('recovery');
        if (wait) return bad(`Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`, 429);
        if (!sec.recovery) return bad('No recovery code exists.');
        if (!/^\d{4}$/.test(String(b.newPin))) return bad('New PIN must be exactly 4 digits.');
        if (!checkSecret(normalizeCode(b.code), sec.recovery)) {
          throttleFail('recovery');
          return bad('Incorrect recovery code.', 401);
        }
        throttleReset('recovery');
        let recoveryCode;
        const out = updateSecurity((s) => { s.pins.owner = hashSecret(b.newPin); recoveryCode = issueRecoveryCode(s); });
        return sendJSON(res, { ok: true, auth: authSummary(out), recoveryCode, token: newSession('owner') });
      }

      case 'regenerate-recovery': {
        if (!ownerSet) return bad('Set an Owner PIN first.');
        if (!ownerAuthorized()) return bad('Owner login required.', 403);
        let recoveryCode;
        updateSecurity((s) => { recoveryCode = issueRecoveryCode(s); });
        return sendJSON(res, { ok: true, recoveryCode });
      }

      // One-time import of PINs that older versions kept in browser localStorage.
      case 'migrate': {
        if (sec.setupComplete || Object.keys(sec.pins).length) return sendJSON(res, { ok: true, migrated: false, auth: authSummary(sec) });
        let recoveryCode = null;
        const out = updateSecurity((s) => {
          const old = b.pins || {};
          for (const r of ROLE_NAMES) if (/^\d{4}$/.test(String(old[r]))) s.pins[r] = hashSecret(old[r]);
          if (s.pins.owner) recoveryCode = issueRecoveryCode(s);
          if (b.setupDone) s.setupComplete = true;
        });
        return sendJSON(res, { ok: true, migrated: true, auth: authSummary(out), recoveryCode });
      }

      default:
        return bad('Unknown action.', 404);
    }
  } catch (e) {
    console.error('Auth error:', e);
    sendJSON(res, { ok: false, error: 'Server error' }, 500);
  }
}

// ── Remote dashboard: push a small snapshot of the shop's numbers to the owner's cloud page ──
// Config lives in settings.json -> security.remote (server-side only; the key is never sent to the UI).
const remoteStatus = { lastOk: null, lastAttempt: null, lastError: null };

function remoteSummary(sec) {
  const r = sec.remote;
  return r ? { configured: !!(r.url && r.account && r.shop && r.key), enabled: !!r.enabled, url: r.url || '', account: r.account || '', shop: r.shop || '' }
           : { configured: false, enabled: false, url: '', account: '', shop: '' };
}
function remoteStatusPayload() {
  let sum;
  try { sum = remoteSummary(getSecurity(readSettingsRaw())); } catch (e) { sum = remoteSummary({}); }
  return { ok: true, ...sum, ...remoteStatus };
}
function cleanRemoteUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    const local = x.hostname === 'localhost' || x.hostname === '127.0.0.1';
    if (x.protocol !== 'https:' && !(local && x.protocol === 'http:')) return null; // internet servers must use https
    return x.origin;
  } catch (e) { return null; }
}
async function cloudPush(rc, snapshot) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(rc.url + '/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account': rc.account, 'X-Shop': rc.shop, 'X-Key': rc.key },
      body: JSON.stringify(snapshot),
      signal: ctl.signal,
    });
    if (r.ok) return { ok: true };
    if (r.status === 401) return { ok: false, error: 'The server rejected the account code, shop ID or shop key. Check them in Settings.' };
    if (r.status === 413) return { ok: false, error: 'The snapshot was too large for the server.' };
    return { ok: false, error: `The server answered with an error (${r.status}).` };
  } catch (e) {
    return { ok: false, offline: true, error: 'Could not reach the server. Are you online?' };
  } finally { clearTimeout(timer); }
}

async function handleRemote(action, b, res) {
  try {
    const sec = getSecurity(readSettingsRaw());
    const bad = (msg, code = 400) => sendJSON(res, { ok: false, error: msg }, code);

    if (action === 'config') {
      // Only the Owner may change this once a PIN is set (same rule as PIN changes).
      if (sec.setupComplete && sec.pins.owner && sessionRole(b.token) !== 'owner') return bad('Owner login required.', 403);
      if (b.clear) {
        const out = updateSecurity((s) => { s.remote = null; });
        remoteStatus.lastOk = remoteStatus.lastError = remoteStatus.lastAttempt = null;
        return sendJSON(res, { ok: true, auth: authSummary(out) });
      }
      const url = cleanRemoteUrl(b.url);
      const account = String(b.account || '').trim().toUpperCase();
      const shop = String(b.shop || '').trim();
      const key = String(b.key || '').trim();
      if (!url) return bad('Server address must start with https:// (for example https://voltpos-remote.yourname.workers.dev).');
      if (!/^[A-Z0-9]{6,16}$/.test(account)) return bad('Account code looks wrong. It is about 10 letters and numbers.');
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(shop)) return bad('Shop ID looks wrong (for example s1).');
      if (key && !/^[A-Za-z0-9]{16,64}$/.test(key)) return bad('Shop key looks wrong. It is about 24 letters and numbers.');
      const existing = sec.remote || {};
      const finalKey = key || (existing.url === url && existing.account === account && existing.shop === shop ? existing.key : '');
      if (!finalKey) return bad('Enter the shop key.');
      const out = updateSecurity((s) => { s.remote = { enabled: !!b.enabled, url, account, shop, key: finalKey }; });
      remoteStatus.lastError = null;
      return sendJSON(res, { ok: true, auth: authSummary(out) });
    }

    if (action === 'push') {
      const rc = sec.remote;
      if (!rc || !rc.url || !rc.key) return bad('Remote dashboard is not set up.');
      if (!rc.enabled && !b.force) return sendJSON(res, { ok: true, skipped: true });
      if (!b.snapshot || typeof b.snapshot !== 'object' || Array.isArray(b.snapshot)) return bad('No snapshot.');
      remoteStatus.lastAttempt = Date.now();
      const r = await cloudPush(rc, b.snapshot);
      if (r.ok) { remoteStatus.lastOk = Date.now(); remoteStatus.lastError = null; return sendJSON(res, { ok: true, at: remoteStatus.lastOk }); }
      remoteStatus.lastError = r.error;
      return sendJSON(res, { ok: false, offline: !!r.offline, error: r.error });
    }

    return bad('Unknown action.', 404);
  } catch (e) {
    console.error('Remote error:', e);
    sendJSON(res, { ok: false, error: 'Server error' }, 500);
  }
}

function loadData(key, res) {
  if (!DATA_FILES[key]) {
    sendJSON(res, { error: 'Unknown key' }, 400);
    return;
  }
  const filePath = DATA_FILES[key];
  if (key === 'settings') {
    // Never expose hashes to the renderer — send an _auth summary instead.
    try {
      const raw = readSettingsRaw();
      const sec = getSecurity(raw);
      delete raw.security;
      raw._auth = authSummary(sec);
      sendJSON(res, { ok: true, data: raw });
    } catch (e) {
      sendJSON(res, { ok: false, error: e.message }, 500);
    }
    return;
  }
  if (!fs.existsSync(filePath)) {
    sendJSON(res, { ok: true, data: null });
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    sendJSON(res, { ok: true, data });
  } catch (e) {
    sendJSON(res, { ok: false, error: e.message }, 500);
  }
}

function saveData(key, body, res) {
  if (!DATA_FILES[key]) {
    sendJSON(res, { error: 'Unknown key' }, 400);
    return;
  }
  try {
    const data = JSON.parse(body);
    if (key === 'settings') {
      // The renderer may not read or change security data through this route.
      const existing = readSettingsRaw();
      delete data._auth;
      delete data.security;
      if (existing.security) data.security = existing.security;
    }
    const filePath = DATA_FILES[key];
    const tmpPath = filePath + '.tmp';
    // Atomic write — write to temp then rename
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
    sendJSON(res, { ok: true });
  } catch (e) {
    sendJSON(res, { ok: false, error: e.message }, 500);
  }
}

function sendJSON(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ── App Window ───────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'VoltPOS',
    backgroundColor: '#0e1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    show: false, // Show after ready
  });

  // Load the app
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Show window when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools();
  });

  // Handle external links — open in real browser, not app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.hostname !== 'localhost') {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Build app menu
  buildMenu();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'VoltPOS',
      submenu: [
        { label: 'About VoltPOS', click: showAbout },
        { type: 'separator' },
        { label: 'Hide VoltPOS', role: 'hide' },
        { type: 'separator' },
        { label: 'Quit VoltPOS', accelerator: 'Cmd+Q', click: () => app.quit() },
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Data Folder',
          accelerator: isMac ? 'Cmd+Shift+D' : 'Ctrl+Shift+D',
          click: () => shell.openPath(DATA_DIR),
        },
        { type: 'separator' },
        ...(!isMac ? [
          { label: 'About VoltPOS', click: showAbout },
          { type: 'separator' },
          { label: 'Quit', accelerator: 'Ctrl+Q', click: () => app.quit() },
        ] : []),
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: isMac ? 'Cmd+R' : 'Ctrl+R', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { label: 'Zoom In',  accelerator: isMac ? 'Cmd+=' : 'Ctrl+=', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: isMac ? 'Cmd+-' : 'Ctrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: isMac ? 'Cmd+0' : 'Ctrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', role: 'togglefullscreen' },
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(DATA_DIR),
        },
        {
          label: 'Check for Updates…',
          click: () => checkForUpdates(true),
        },
        {
          label: 'VoltPOS Website',
          click: () => shell.openExternal('https://github.com/iTornam/voltpos'),
        },
      ]
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About VoltPOS',
    message: `VoltPOS v${app.getVersion()}`,
    detail: `Point of Sale System for retail businesses.\n\nData stored at:\n${DATA_DIR}\n\n© 2024 VoltPOS`,
    buttons: ['OK'],
  });
}

// ── IPC Handlers ─────────────────────────────────────
ipcMain.handle('get-data-dir', () => DATA_DIR);
ipcMain.handle('open-data-dir', () => shell.openPath(DATA_DIR));
ipcMain.handle('get-version', () => app.getVersion());

// ── Auto-updater (GitHub Releases) ───────────────────
// Windows: downloads in the background, installs when VoltPOS is next closed.
// macOS:   silent install only works for code-signed builds. Until you sign the app,
//          leave MAC_SIGNED = false and Mac users get a "download the new version" prompt.
const MAC_SIGNED = false;
const CAN_AUTO_INSTALL = process.platform !== 'darwin' || MAC_SIGNED;
const RELEASES_URL = 'https://github.com/iTornam/voltpos/releases/latest';
let manualUpdateCheck = false;

function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox(mainWindow, { type: 'info', message: 'Updates only work in the installed app, not in dev mode.' });
    return;
  }
  manualUpdateCheck = !!manual;
  autoUpdater.checkForUpdates().catch(() => {}); // offline is normal for this app — fail silently
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = CAN_AUTO_INSTALL;
  autoUpdater.autoInstallOnAppQuit = CAN_AUTO_INSTALL;

  autoUpdater.on('update-available', (info) => {
    if (CAN_AUTO_INSTALL) {
      if (manualUpdateCheck) dialog.showMessageBox(mainWindow, { type: 'info', message: `VoltPOS ${info.version} is downloading in the background.`, detail: "You'll be asked before it installs." });
      return;
    }
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'Update available',
      message: `VoltPOS ${info.version} is available.`,
      detail: 'Download the new installer from the releases page. Your data is kept.',
      buttons: ['Open download page', 'Later'], defaultId: 0, cancelId: 1,
    }).then((r) => { if (r.response === 0) shell.openExternal(RELEASES_URL); });
  });

  autoUpdater.on('update-not-available', () => {
    if (manualUpdateCheck) dialog.showMessageBox(mainWindow, { type: 'info', message: "You're on the latest version." });
    manualUpdateCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    // Never force a restart — a sale may be in progress. Default to "Later"; it installs on next quit.
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'Update ready',
      message: `VoltPOS ${info.version} is ready to install.`,
      detail: 'Restart now, or choose Later and it installs the next time you close VoltPOS.',
      buttons: ['Restart now', 'Later'], defaultId: 1, cancelId: 1,
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });

  autoUpdater.on('error', (err) => {
    console.error('Updater error:', err && err.message);
    if (manualUpdateCheck) dialog.showMessageBox(mainWindow, { type: 'warning', message: 'Could not check for updates.', detail: 'Check your internet connection and try again.' });
    manualUpdateCheck = false;
  });

  setTimeout(() => checkForUpdates(false), 15 * 1000);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
}

// ── App Lifecycle ────────────────────────────────────
app.whenReady().then(() => {
  startServer();

  // Small delay to ensure server is ready
  setTimeout(() => {
    createWindow();
    setupAutoUpdater();
  }, 300);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server) {
    server.close();
  }
});

// ── Security ─────────────────────────────────────────
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.hostname !== 'localhost') {
      event.preventDefault();
    }
  });
});
