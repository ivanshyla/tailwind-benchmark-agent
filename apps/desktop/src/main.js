'use strict';

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

// --- credentials (optional, encrypted with the OS keychain) -----------------

function loadCredentials() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {};
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(CREDENTIALS_FILE())));
  } catch {
    return {};
  }
}

ipcMain.handle('credentials:load', () => loadCredentials());
ipcMain.handle('credentials:save', (_e, { source, values }) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const all = { ...loadCredentials(), [source]: values };
  fs.writeFileSync(CREDENTIALS_FILE(), safeStorage.encryptString(JSON.stringify(all)));
  return true;
});
ipcMain.handle('credentials:forget', () => {
  fs.rmSync(CREDENTIALS_FILE(), { force: true });
  return true;
});

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

ipcMain.handle('data:fetch', async (_e, { source, values, mapping, period }) => {
  const history = core.historyFor(period);
  let orders;
  let skipped = 0;
  if (source === 'file') {
    if (!lastRaw) throw new Error('Choose a file first');
    ({ orders, skipped } = core.table.ordersFromRows(lastRaw.rows, mapping));
  } else {
    const connector = core.connectors[source];
    if (!connector) throw new Error(`Unknown source ${source}`);
    orders = await connector.fetchOrders(net, { ...values, from: history.from, to: history.to });
  }
  const months = new Set(orders.map((o) => o.date.slice(0, 7)));
  // Only counts go back to the window; the orders stay here and are dropped.
  return {
    raw: core.deriveRawInputs(orders, period),
    orderCount: orders.length,
    monthsWithData: months.size,
    skipped,
  };
});

// --- signal -----------------------------------------------------------------

ipcMain.handle('signal:preview', (_e, { cell, raw }) =>
  calculator.buildSignal({ ticket: '•••', ...cell, raw }),
);

let pairingAbort;
ipcMain.handle('signal:send', async (_e, { cell, raw }) => {
  const pairing = await core.startPairing(net, { api: API, period: cell.period });
  win.webContents.send('pairing', { code: pairing.code, approveUrl: pairing.approveUrl, expiresIn: pairing.expiresIn });
  await shell.openExternal(pairing.approveUrl);

  pairingAbort = new AbortController();
  const ticket = await core.waitForTicket(net, {
    api: API,
    pairingId: pairing.pairingId,
    secret: pairing.secret,
    signal: pairingAbort.signal,
  });
  const signal = calculator.buildSignal({ ticket, ...cell, raw });
  await core.sendSignal(net, { api: API, signal });
  return {
    sent: { ...signal, ticket: '•••' },
    resultUrl: `https://${SITE_HOST}/pl/benchmark/wynik?category=${cell.category}&city=${cell.city}&period=${cell.period}`,
  };
});
ipcMain.handle('signal:cancel', () => pairingAbort?.abort());

ipcMain.handle('open:external', (_e, url) => {
  // Only our own site, e.g. the result page.
  if (new URL(url).host === SITE_HOST) shell.openExternal(url);
});
