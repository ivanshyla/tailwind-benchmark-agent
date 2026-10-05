'use strict';

const crypto = require('crypto');
const { dateRange } = require('../months');
const { ordersFromInvoices, amount } = require('./invoices');

/**
 * KSeF 2.0 (Krajowy System e-Faktur) — https://github.com/CIRFMF/ksef-api
 *
 * A thin, read-only client written from the official OpenAPI so that no
 * third-party code ever handles the owner's KSeF token. The token needs only
 * the InvoiceRead permission (KSeF app → Tokeny → Generuj, "Przeglądanie
 * faktur"). Only invoice METADATA is read — never the invoice XML.
 *
 * B2C invoices are optional in KSeF and small businesses may issue outside it
 * until 2027, so KSeF can undercount consumer sales; the app says so.
 */
const ENVIRONMENTS = {
  prod: 'https://api.ksef.mf.gov.pl/v2',
  demo: 'https://api-demo.ksef.mf.gov.pl/v2',
  test: 'https://api-test.ksef.mf.gov.pl/v2',
};
const MAX_RANGE_DAYS = 90; // API limit is 100 days
const PAGE = 250;
const ORDER_TYPES = new Set(['Vat', 'Upr', 'Roz', 'VatPef', 'VatPefSp', 'VatRr']);
const CORRECTION_TYPES = new Set(['Kor', 'KorRoz', 'KorPef', 'KorVatRr']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const tokenOf = (t) => (typeof t === 'string' ? t : t?.token);

async function authenticate(net, base, { nip, ksefToken }) {
  const certs = await net.json(`${base}/security/public-key-certificates`);
  const cert = (Array.isArray(certs) ? certs : certs?.certificates ?? []).find((c) =>
    (c.usage ?? []).includes('KsefTokenEncryption'),
  );
  if (!cert) throw new Error('KSeF: no token-encryption key published');
  const publicKey = new crypto.X509Certificate(Buffer.from(cert.certificate, 'base64')).publicKey;

  const challenge = await net.json(`${base}/auth/challenge`, { method: 'POST' });
  const encryptedToken = crypto
    .publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(`${ksefToken}|${challenge.timestampMs}`, 'utf8'),
    )
    .toString('base64');

  const init = await net.json(`${base}/auth/ksef-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge: challenge.challenge,
      contextIdentifier: { type: 'Nip', value: String(nip).replace(/\D/g, '') },
      encryptedToken,
      publicKeyId: cert.publicKeyId,
    }),
  });
  const authToken = tokenOf(init.authenticationToken);

  for (let i = 0; i < 30; i += 1) {
    const status = await net.json(`${base}/auth/${init.referenceNumber}`, { headers: bearer(authToken) });
    const code = status?.status?.code;
    if (code === 200) break;
    if (code && code >= 400) throw new Error(`KSeF auth refused: ${status.status.description ?? code}`);
    await sleep(1000);
  }

  const tokens = await net.json(`${base}/auth/token/redeem`, { method: 'POST', headers: bearer(authToken) });
  return tokenOf(tokens.accessToken);
}

/** Windows of at most MAX_RANGE_DAYS covering [from, to]. */
function windows(from, to) {
  const out = [];
  let start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T23:59:59Z`);
  while (start <= end) {
    const stop = new Date(Math.min(end.getTime(), start.getTime() + MAX_RANGE_DAYS * 86400000 - 1000));
    out.push({ from: start.toISOString(), to: stop.toISOString() });
    start = new Date(stop.getTime() + 1000);
  }
  return out;
}

async function queryMetadata(net, base, accessToken, window) {
  const rows = [];
  let from = window.from;
  for (let offset = 0; ; offset += 1) {
    const params = new URLSearchParams({ pageOffset: String(offset), pageSize: String(PAGE), sortOrder: 'Asc' });
    let res;
    try {
      res = await net.json(`${base}/invoices/query/metadata?${params}`, {
        method: 'POST',
        headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectType: 'Subject1', dateRange: { dateType: 'Issue', from, to: window.to } }),
      });
    } catch (err) {
      if (err.status === 429) {
        throw new Error('KSeF rate limit reached (20 queries per hour). Try again later.');
      }
      throw err;
    }
    rows.push(...(res.invoices ?? []));
    if (res.isTruncated && res.invoices?.length) {
      // 10 000-record cap per filter: continue from the last record's date.
      from = res.invoices[res.invoices.length - 1].issueDate;
      offset = -1;
      continue;
    }
    if (!res.hasMore) break;
  }
  return rows;
}

async function fetchOrders(net, { nip, ksefToken, environment = 'prod', from, to }) {
  const base = ENVIRONMENTS[environment];
  net.allow(new URL(base).host);
  const range = dateRange(from, to);
  const accessToken = await authenticate(net, base, { nip, ksefToken });
  try {
    const seen = new Set();
    const all = [];
    for (const w of windows(range.from, range.to)) {
      for (const inv of await queryMetadata(net, base, accessToken, w)) {
        if (seen.has(inv.ksefNumber)) continue;
        seen.add(inv.ksefNumber);
        all.push(inv);
      }
    }
    const invoices = all
      .filter((inv) => ORDER_TYPES.has(inv.invoiceType))
      .map((inv) => ({
        ref: inv.invoiceHash,
        date: String(inv.issueDate).slice(0, 10),
        customer: inv.buyer?.identifier?.value || inv.buyer?.name || null,
        gross: amount(inv.grossAmount),
      }));
    const corrections = all
      .filter((inv) => CORRECTION_TYPES.has(inv.invoiceType))
      .map((inv) => ({ correctsRef: inv.hashOfCorrectedInvoice, gross: amount(inv.grossAmount) }));
    return ordersFromInvoices(invoices, corrections);
  } finally {
    await net.fetch(`${base}/auth/sessions/current`, { method: 'DELETE', headers: bearer(accessToken) }).catch(() => {});
  }
}

module.exports = {
  id: 'ksef',
  label: 'KSeF',
  fields: ['nip', 'ksefToken', 'environment'],
  fetchOrders,
  windows,
};
