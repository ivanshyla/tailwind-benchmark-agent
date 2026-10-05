'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { connectors } = require('../src');
const { ordersFromInvoices } = require('../src/connectors/invoices');

/** A Net stand-in: routes by "METHOD host/path" prefix, records requests. */
class FakeNet {
  constructor(routes) {
    this.routes = routes;
    this.allowed = new Set();
    this.calls = [];
  }
  allow(host) {
    this.allowed.add(host);
  }
  async fetch(url, init = {}) {
    const u = new URL(url);
    assert.ok(this.allowed.has(u.host), `host ${u.host} was not allowed first`);
    const key = `${init.method ?? 'GET'} ${u.host}${u.pathname}`;
    this.calls.push({ key, url: u, init });
    const route = Object.keys(this.routes).find((k) => key.startsWith(k));
    assert.ok(route, `unexpected request ${key}`);
    const body = this.routes[route]({ url: u, init, n: this.calls.filter((c) => c.key === key).length });
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }
  async json(url, init) {
    return JSON.parse(await (await this.fetch(url, init)).text());
  }
}

test('a correction that zeroes an invoice cancels it', () => {
  const orders = ordersFromInvoices(
    [
      { ref: 1, date: '2026-09-01', customer: 'a', gross: 100 },
      { ref: 2, date: '2026-09-02', customer: 'b', gross: 200 },
    ],
    [
      { correctsRef: 1, gross: -100 },
      { correctsRef: 2, gross: -50 },
    ],
  );
  assert.deepEqual(orders.map((o) => o.cancelled), [true, false]);
});

test('fakturownia: kinds, corrections, pagination', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1, kind: 'vat', issue_date: '2026-09-01', buyer_tax_no: `n${i}`, price_gross: '10,00', status: 'issued',
  }));
  const net = new FakeNet({
    'GET firma.fakturownia.pl/invoices.json': ({ url }) =>
      url.searchParams.get('page') === '1'
        ? page1
        : [
            { id: 500, kind: 'proforma', issue_date: '2026-09-03', price_gross: '5' },
            { id: 501, kind: 'correction', from_invoice_id: 1, issue_date: '2026-09-04', price_gross: '-10,00' },
          ],
  });
  const orders = await connectors.fakturownia.fetchOrders(net, {
    subdomain: 'https://firma.fakturownia.pl', apiToken: 'T', from: '2025-09', to: '2026-09',
  });
  assert.equal(orders.length, 100);
  assert.equal(orders.filter((o) => o.cancelled).length, 1);
  assert.equal(net.calls[0].url.searchParams.get('date_from'), '2025-09-01');
  assert.equal(net.calls[0].url.searchParams.get('date_to'), '2026-09-30');
});

test('infakt: grosze, header auth, corrections', async () => {
  const net = new FakeNet({
    'GET api.infakt.pl/api/v3/invoices.json': () => ({
      entities: [
        { uuid: 'u1', kind: 'vat', invoice_date: '2026-09-01', client_tax_code: '111', gross_price: 12300 },
        { uuid: 'u2', kind: 'proforma', invoice_date: '2026-09-02', gross_price: 100 },
      ],
    }),
    'GET api.infakt.pl/api/v3/corrective_invoices.json': () => ({
      entities: [{ corrected_invoice_uuid: 'u1', gross_price: 0, corrected_invoice_gross_price: 12300 }],
    }),
  });
  const orders = await connectors.infakt.fetchOrders(net, { apiKey: 'K', from: '2025-09', to: '2026-09' });
  assert.deepEqual(orders, [{ date: '2026-09-01', customer: '111', cancelled: true }]);
  assert.equal(net.calls[0].init.headers['X-inFakt-ApiKey'], 'K');
});

test('wfirma: wrapped lists, schema_cancelled', async () => {
  const net = new FakeNet({
    'POST api2.wfirma.pl/invoices/find': () => ({
      status: { code: 'OK' },
      invoices: {
        0: { invoice: { id: '1', type: 'normal', date: '2026-09-01', total: '100.00', schema_cancelled: '0', contractor: { id: '7' } } },
        1: { invoice: { id: '2', type: 'normal', date: '2026-09-02', total: '50.00', schema_cancelled: '1', contractor: { id: '8' } } },
        2: { invoice: { id: '3', type: 'proforma', date: '2026-09-02', total: '50.00' } },
        parameters: { total: 3 },
      },
    }),
  });
  const orders = await connectors.wfirma.fetchOrders(net, {
    accessKey: 'a', secretKey: 's', appKey: 'k', from: '2025-09', to: '2026-09',
  });
  assert.deepEqual(orders, [
    { date: '2026-09-01', customer: '7', cancelled: false },
    { date: '2026-09-02', customer: '8', cancelled: true },
  ]);
});

test('stripe: succeeded charges, refunds, cursor pagination', async () => {
  const net = new FakeNet({
    'GET api.stripe.com/v1/charges': ({ url }) =>
      url.searchParams.get('starting_after')
        ? { has_more: false, data: [{ id: 'ch_3', status: 'succeeded', created: 1788220800, refunded: true, customer: 'cus_2' }] }
        : {
            has_more: true,
            data: [
              { id: 'ch_1', status: 'succeeded', created: 1788220800, refunded: false, customer: 'cus_1' },
              { id: 'ch_2', status: 'failed', created: 1788220800 },
            ],
          },
  });
  const orders = await connectors.stripe.fetchOrders(net, { apiKey: 'rk', from: '2025-09', to: '2026-09' });
  assert.deepEqual(orders, [
    { date: '2026-09-01', customer: 'cus_1', cancelled: false },
    { date: '2026-09-01', customer: 'cus_2', cancelled: true },
  ]);
  assert.equal(net.calls[1].url.searchParams.get('starting_after'), 'ch_2');
});

test('ksef: windows stay under the 100-day limit', () => {
  const ws = connectors.ksef.windows('2025-09-01', '2026-09-30');
  assert.ok(ws.length >= 5);
  for (const w of ws) {
    assert.ok((new Date(w.to) - new Date(w.from)) / 86400000 <= 100);
  }
  assert.equal(ws[0].from, '2025-09-01T00:00:00.000Z');
  assert.equal(ws.at(-1).to, '2026-09-30T23:59:59.000Z');
});

test('ksef: token encrypted RSA-OAEP-SHA256 as "token|timestampMs", metadata only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksef-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=Ministerstwo Finansow',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1',
  ], { stdio: 'ignore' });
  const certDer = new crypto.X509Certificate(fs.readFileSync(path.join(dir, 'c.pem'))).raw.toString('base64');
  const privateKey = fs.readFileSync(path.join(dir, 'k.pem'));

  let decrypted;
  const net = new FakeNet({
    'GET api.ksef.mf.gov.pl/v2/security/public-key-certificates': () => [
      { certificate: 'xx', publicKeyId: 'sym', usage: ['SymmetricKeyEncryption'] },
      { certificate: certDer, publicKeyId: 'tok', usage: ['KsefTokenEncryption'] },
    ],
    'POST api.ksef.mf.gov.pl/v2/auth/challenge': () => ({ challenge: 'CH', timestampMs: 1791000000000 }),
    'POST api.ksef.mf.gov.pl/v2/auth/ksef-token': ({ init }) => {
      const body = JSON.parse(init.body);
      decrypted = crypto
        .privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(body.encryptedToken, 'base64'))
        .toString('utf8');
      assert.deepEqual(body.contextIdentifier, { type: 'Nip', value: '1234567890' });
      assert.equal(body.publicKeyId, 'tok');
      return { referenceNumber: 'R1', authenticationToken: { token: 'AUTH' } };
    },
    'GET api.ksef.mf.gov.pl/v2/auth/R1': () => ({ status: { code: 200 } }),
    'POST api.ksef.mf.gov.pl/v2/auth/token/redeem': () => ({ accessToken: { token: 'ACCESS' }, refreshToken: { token: 'R' } }),
    'POST api.ksef.mf.gov.pl/v2/invoices/query/metadata': ({ n }) =>
      n === 1
        ? {
            hasMore: false,
            invoices: [
              { ksefNumber: 'K1', invoiceType: 'Vat', issueDate: '2025-09-02', invoiceHash: 'h1', grossAmount: 100, buyer: { identifier: { type: 'Nip', value: '999' } } },
              { ksefNumber: 'K2', invoiceType: 'Zal', issueDate: '2025-09-03', invoiceHash: 'h2', grossAmount: 50 },
              { ksefNumber: 'K3', invoiceType: 'Kor', issueDate: '2025-09-04', hashOfCorrectedInvoice: 'h1', grossAmount: -100 },
            ],
          }
        : { hasMore: false, invoices: [] },
    'DELETE api.ksef.mf.gov.pl/v2/auth/sessions/current': () => ({}),
  });

  const orders = await connectors.ksef.fetchOrders(net, {
    nip: '123-456-78-90', ksefToken: 'SECRET', from: '2025-09', to: '2026-09',
  });
  assert.equal(decrypted, 'SECRET|1791000000000');
  assert.deepEqual(orders, [{ date: '2025-09-02', customer: '999', cancelled: true }]);
  assert.ok(net.calls.every((c) => !c.key.includes('/invoices/ksef/')), 'never downloads invoice XML');
  assert.ok(net.calls.some((c) => c.key.startsWith('DELETE')), 'logs the session out');
  const metadataCall = net.calls.find((c) => c.key.includes('query/metadata'));
  assert.equal(metadataCall.init.headers.Authorization, 'Bearer ACCESS');
});
