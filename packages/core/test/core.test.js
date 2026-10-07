'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { deriveRawInputs, historyFor } = require('../src/derive');
const { loadCalculator } = require('../src/calculator');
const http = require('node:http');
const { Net } = require('../src/net');
const { signalReadiness } = require('../src/pairing');
const { guessMapping, ordersFromRows, parseDate, isCancelled } = require('../src/connectors/table');
const { shiftMonth, dateRange } = require('../src/months');

const order = (date, customer, cancelled = false) => ({ date, customer, cancelled });

test('months helpers', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-09', -12), '2025-09');
  assert.deepEqual(dateRange('2025-09', '2026-02'), { from: '2025-09-01', to: '2026-02-28' });
  assert.deepEqual(historyFor('2026-09'), { from: '2025-09', to: '2026-09' });
});

test('derives counts the calculator expects', () => {
  const orders = [
    // M-12 (2025-09): 2 orders
    order('2025-09-03', 'a'), order('2025-09-10', 'x'),
    // M-3 (2026-06): buyers a, b, c
    order('2026-06-01', 'a'), order('2026-06-02', 'b'), order('2026-06-05', 'c'),
    // M-1 (2026-08): 2 completed, b returns
    order('2026-08-01', 'b'), order('2026-08-20', 'd'),
    // M (2026-09): a returns, e and f are new, one cancelled booking
    order('2026-09-02', 'A '), order('2026-09-03', 'e'), order('2026-09-04', 'f'),
    order('2026-09-05', 'g', true),
  ];
  const raw = deriveRawInputs(orders, '2026-09');
  assert.deepEqual(raw, {
    orders: 3,
    ordersPrevMonth: 2,
    ordersLastYear: 2,
    booked: 4,
    cancelled: 1,
    customers3MonthsAgo: 3,
    returnedCustomers: 2, // a (case/space-insensitive) and b
    newCustomers: 2, // e, f — 'a' bought within the last 12 months
  });
});

test('missing months are unknown, not zero', () => {
  const raw = deriveRawInputs([order('2026-09-01', null)], '2026-09');
  assert.deepEqual(raw, { orders: 1, booked: 1, cancelled: 0 });
});

test('runs the vendored website calculator and yields ratios only', () => {
  const calc = loadCalculator();
  const signal = calc.buildSignal({
    ticket: 't', period: '2026-09', category: 'sprzatanie', city: 'warszawa',
    raw: { orders: 107, ordersPrevMonth: 100, booked: 110, cancelled: 3, marketingSpend: 4321, newCustomers: 40 },
  });
  assert.deepEqual(signal.metrics, {
    growthMoM: 7, growthYoY: null, conversion: null, repeat90: null,
    cancellation: 3, cac: 110, hourlyPay: null,
  });
  assert.deepEqual(Object.keys(signal).sort(), ['category', 'city', 'metrics', 'period', 'ticket', 'v']);
});

test('net blocks hosts outside the allowlist', async () => {
  const net = new Net({ allowedHosts: ['api.tailwind.reviews'] });
  await assert.rejects(net.fetch('https://evil.example/x'), /not on the allowlist/);
  assert.equal(net.log.length, 0);
});

test('net never follows redirects and logs the refused one', async () => {
  let hitTarget = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/target') {
      hitTarget = true;
      res.end('{}');
      return;
    }
    res.writeHead(307, { Location: 'http://evil.example/steal' });
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const host = `127.0.0.1:${server.address().port}`;
  const logged = [];
  const net = new Net({ allowedHosts: [host], onLog: (e) => logged.push(e) });
  try {
    await assert.rejects(
      net.json(`http://${host}/start`, { method: 'POST', body: '{"secret":1}' }),
      /Blocked redirect from 127\.0\.0\.1:\d+ to evil\.example \(HTTP 307\)/,
    );
    assert.equal(logged.length, 1);
    assert.equal(logged[0].status, 307);
    assert.match(logged[0].error, /redirect to evil\.example blocked/);
    assert.equal(hitTarget, false);
  } finally {
    server.close();
  }
});

test('net scopes connector allowances to one run', async () => {
  const net = new Net({ allowedHosts: ['api.tailwind.reviews'] });
  const run = net.scope();
  run.allow('api.stripe.com');
  assert.ok(run.allowedHosts.has('api.tailwind.reviews'));
  await assert.rejects(net.fetch('https://api.stripe.com/v1/charges'), /not on the allowlist/);
  assert.equal(run.log, net.log);
});

test('signal readiness: growthMoM and at least 3 metrics', () => {
  const none = { growthMoM: null, growthYoY: null, conversion: null, repeat90: null, cancellation: null, cac: null, hourlyPay: null };
  assert.deepEqual(signalReadiness({ ...none, growthMoM: 5, cancellation: 2, cac: 100 }).ok, true);
  const noGrowth = signalReadiness({ ...none, conversion: 40, repeat90: 20, cancellation: 2, cac: 100 });
  assert.equal(noGrowth.ok, false);
  assert.equal(noGrowth.growthMissing, true);
  const short = signalReadiness({ ...none, growthMoM: 5, cancellation: 0 });
  assert.equal(short.ok, false);
  assert.equal(short.short, 1);
  assert.deepEqual(short.known, ['growthMoM', 'cancellation']);
  assert.ok(short.missing.includes('cac'));
});

test('table connector guesses Polish headers and parses dates', () => {
  const mapping = guessMapping(['Data wystawienia', 'NIP nabywcy', 'Status', 'Kwota']);
  assert.deepEqual(mapping, { date: 'Data wystawienia', customer: 'NIP nabywcy', status: 'Status' });
  assert.equal(parseDate('05.09.2026'), '2026-09-05');
  assert.equal(parseDate('2026-09-05T10:00'), '2026-09-05');
  assert.equal(parseDate(new Date(Date.UTC(2026, 8, 5))), '2026-09-05');
  assert.equal(isCancelled('Anulowana'), true);
  const { orders, skipped } = ordersFromRows(
    [
      { 'Data wystawienia': '01.09.2026', 'NIP nabywcy': '123', Status: 'Wystawiona' },
      { 'Data wystawienia': 'brak', 'NIP nabywcy': '1', Status: '' },
    ],
    mapping,
  );
  assert.deepEqual(orders, [{ date: '2026-09-01', customer: '123', cancelled: false }]);
  assert.equal(skipped, 1);
});
