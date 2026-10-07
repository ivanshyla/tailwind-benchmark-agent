'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } = require('electron');
const core = require('tailwind-benchmark-core');

/**
 * Main process. It is the only part of the app that touches the network or
 * the disk, and it does so only through tailwind-benchmark-core's Net, which
 * refuses any host not on the allowlist and logs every request. The window
 * (renderer) is sandboxed, has no Node access and is blocked from the network.
 */

const API = process.env.TAILWIND_API ?? core.DEFAULT_API;
const SITE_HOST = 'tailwind.reviews';
const PAIRING_PATH = '/pl/benchmark/polacz';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
// Pointing TAILWIND_API at this machine is the explicit development switch;
// only then may the app open http://localhost pages.
const DEV = Boolean(process.env.TAILWIND_API) && LOCAL_HOSTS.has(new URL(API).hostname);
const SEND_DELAY_MS = { min: 30_000, max: 180_000 };
const CREDENTIALS_FILE = () => path.join(app.getPath('userData'), 'credentials.bin');

let win;
const net = new core.Net({
  allowedHosts: [new URL(API).host, SITE_HOST],
  onLog: (entry) => win?.webContents.send('net-log', entry),
});
const calculator = core.loadCalculator();

// Raw rows live only in this process, for the duration of one run.
let lastRaw = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: 'Benchmark tailwind.reviews',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Development aid: AGENT_SCREENSHOT=out.png saves the window and quits.
  if (process.env.AGENT_SCREENSHOT) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(process.env.AGENT_SCREENSHOT, image.toPNG());
        app.quit();
      }, 4000),
    );
  }
}

app.whenReady().then(() => {
  // The window may load its own files and nothing else.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('file://') && !details.url.startsWith('devtools://') });
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// --- opening the browser ----------------------------------------------------

/**
 * The only pages the app opens in the browser: https://tailwind.reviews (no
 * port, no credentials in the URL), or a local site in development. Whatever
 * the API or the window asks for, nothing else is opened.
 */
function siteUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === 'https:' && u.hostname === SITE_HOST && !u.port) return u;
  if (DEV && u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return u;
  return null;
}

function openSite(url) {
  const u = siteUrl(url);
  if (!u) throw new Error(`Refusing to open ${String(url).slice(0, 100)}: not https://${SITE_HOST}`);
  return shell.openExternal(u.href);
}

// --- credentials (optional, encrypted with the OS keychain) -----------------

/**
 * On Linux without a keyring, safeStorage reports encryption as available
 * but uses the 'basic_text' backend, a hardcoded key; a file "encrypted" that
 * way is as readable as plain text. Secrets are then kept in memory only.
 */
function storageStatus() {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'unavailable' };
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return { ok: false, reason: 'basic_text' };
  }
  return { ok: true };
}

function loadCredentials() {
  try {
    if (!storageStatus().ok) return {};
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(CREDENTIALS_FILE())));
  } catch {
    return {};
  }
}

// Values used in this session, per source; never sent to the window.
let sessionCredentials = {};

function knownCredentials() {
  const stored = loadCredentials();
  const out = {};
  for (const source of new Set([...Object.keys(stored), ...Object.keys(sessionCredentials)])) {
    out[source] = { ...stored[source], ...sessionCredentials[source] };
  }
  return out;
}

const mask = (value) => {
  const s = String(value ?? '');
  return s.length >= 8 ? `…${s.slice(-4)}` : '•••';
};

function masked(values = {}) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
      .map(([k, v]) => [k, mask(v)]),
  );
}

// The window learns which fields are set, never their values.
ipcMain.handle('credentials:load', () => {
  const all = knownCredentials();
  return {
    storage: storageStatus(),
    sources: Object.fromEntries(Object.entries(all).map(([source, values]) => [source, masked(values)])),
  };
});
ipcMain.handle('credentials:forget', () => {
  fs.rmSync(CREDENTIALS_FILE(), { force: true });
  sessionCredentials = {};
  return true;
});

function saveCredentials(source, values) {
  if (!storageStatus().ok) return false;
  const all = { ...loadCredentials(), [source]: values };
  fs.writeFileSync(CREDENTIALS_FILE(), safeStorage.encryptString(JSON.stringify(all)));
  return true;
}

// --- calculator integrity ---------------------------------------------------

ipcMain.handle('calculator:verify', async () => {
  try {
    const result = await core.verifyAgainstSite(net);
    return { ...result, pinned: core.CALCULATOR_SHA256 };
  } catch (error) {
    return { ok: null, error: error.message, status: error.status ?? null, pinned: core.CALCULATOR_SHA256 };
  }
});

// --- reading data -----------------------------------------------------------

ipcMain.handle('file:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const filePath = res.filePaths[0];
  const rows = await core.table.readTable(filePath);
  const headers = Object.keys(rows[0] ?? {});
  lastRaw = { filePath, rows };
  return { fileName: path.basename(filePath), headers, mapping: core.table.guessMapping(headers), rowCount: rows.length };
});

ipcMain.handle('data:fetch', async (_e, { source, values, mapping, period, remember }) => {
  const history = core.historyFor(period);
  let orders;
  let skipped = 0;
  let credentials;
  let saved = false;
  if (source === 'file') {
    if (!lastRaw) throw new Error('Choose a file first');
    ({ orders, skipped } = core.table.ordersFromRows(lastRaw.rows, mapping));
  } else {
    const connector = core.connectors[source];
    if (!connector) throw new Error(`Unknown source ${source}`);
    // A blank field keeps the value already known for it.
    const typed = Object.fromEntries(
      Object.entries(values ?? {})
        .filter(([k, v]) => connector.fields.includes(k) && typeof v === 'string' && v.trim() !== '')
        .map(([k, v]) => [k, v.trim()]),
    );
    const merged = { ...knownCredentials()[source], ...typed };
    // Hosts the connector allows live only as long as this run.
    orders = await connector.fetchOrders(net.scope(), { ...merged, from: history.from, to: history.to });
    sessionCredentials[source] = merged;
    if (remember) saved = saveCredentials(source, merged);
    credentials = masked(merged);
  }
  const months = new Set(orders.map((o) => o.date.slice(0, 7)));
  // Only counts go back to the window; the orders stay here and are dropped.
  return {
    raw: core.deriveRawInputs(orders, period),
    orderCount: orders.length,
    monthsWithData: months.size,
    skipped,
    credentials,
    saved,
  };
});

// --- signal -----------------------------------------------------------------

// Category and city come from the business's Google Business profile on the
// server; until pairing returns them the preview shows a placeholder.
const FROM_GOOGLE = '(z Google Business)';

function previewSignal(period, raw) {
  return calculator.buildSignal({ ticket: '•••', period, category: FROM_GOOGLE, city: FROM_GOOGLE, raw });
}

ipcMain.handle('signal:preview', (_e, { period, raw }) => {
  const signal = previewSignal(period, raw);
  return { signal, readiness: core.signalReadiness(signal.metrics) };
});

function sleep(ms, abort) {
  return new Promise((resolve, reject) => {
    if (abort.aborted) return reject(new Error('Pairing cancelled'));
    const timer = setTimeout(resolve, ms);
    abort.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Pairing cancelled'));
      },
      { once: true },
    );
  });
}

// One send at a time: a second one would replace the first one's cancel
// handle and race it for the ticket.
let sending = null;

ipcMain.handle('signal:send', async (_e, { period, raw }) => {
  if (sending) throw new Error('send_in_progress');
  const readiness = core.signalReadiness(previewSignal(period, raw).metrics);
  if (!readiness.ok) throw new Error('not_enough_metrics');
  const abort = new AbortController();
  sending = abort;
  try {
    const pairing = await core.startPairing(net, { api: API, period });
    // The page is opened without the code: the owner types the code the app
    // shows, so they never get used to approving a code that came in a link.
    const origin = siteUrl(pairing.approveUrl)?.origin ?? `https://${SITE_HOST}`;
    const pairUrl = new URL(PAIRING_PATH, origin);
    win.webContents.send('pairing', {
      code: pairing.code,
      page: `${pairUrl.host}${pairUrl.pathname}`,
      expiresIn: pairing.expiresIn,
    });
    await openSite(pairUrl.href);

    const approved = await core.waitForTicket(net, {
      api: API,
      pairingId: pairing.pairingId,
      secret: pairing.secret,
      signal: abort.signal,
    });
    if (!approved.ticket || !approved.category || !approved.city) {
      throw new Error('tailwind.reviews did not return the business category and city');
    }

    // The server knows when the account approved the pairing; sending right
    // away would let that moment tie the anonymous answer to the account.
    const delayMs = crypto.randomInt(SEND_DELAY_MS.min, SEND_DELAY_MS.max + 1);
    win.webContents.send('pairing-approved', {
      category: approved.category,
      city: approved.city,
      period: approved.period ?? period,
      delayMs,
    });
    await sleep(delayMs, abort.signal);

    const signal = calculator.buildSignal({
      ticket: approved.ticket,
      period: approved.period ?? period,
      category: approved.category,
      city: approved.city,
      raw,
    });
    await core.sendSignal(net, { api: API, signal });
    const q = new URLSearchParams({ category: signal.category, city: signal.city, period: signal.period });
    return {
      sent: { ...signal, ticket: '•••' },
      resultUrl: `https://${SITE_HOST}/pl/benchmark/wynik?${q}`,
    };
  } finally {
    sending = null;
  }
});
ipcMain.handle('signal:cancel', () => sending?.abort());

ipcMain.handle('open:external', (_e, url) => openSite(url));
