'use strict';

const crypto = require('crypto');
const { monthOf, shiftMonth } = require('./months');

/**
 * Every connector returns the same minimal shape, and nothing else about a
 * sale is ever read:
 *
 *   { date: 'YYYY-MM-DD', customer: string | null, cancelled: boolean }
 *
 * `customer` (a tax number, e-mail or client id) is only used to tell repeat
 * buyers apart. It is hashed with a key that lives in memory for this run
 * and is never stored or sent.
 */

/** Months of history a connector must fetch for a target month. */
const HISTORY_MONTHS = 12;

function historyFor(period) {
  return { from: shiftMonth(period, -HISTORY_MONTHS), to: period };
}

/**
 * Raw counts for the calculator (calculator.v1.js computeMetrics) from a list
 * of orders. Counts only — the calculator turns them into rounded ratios.
 *
 *   orders, ordersPrevMonth, ordersLastYear — completed orders per month
 *   booked, cancelled                       — all vs cancelled in the month
 *   customers3MonthsAgo, returnedCustomers  — buyers in M-3, and how many of
 *                                             them bought again in M-2..M
 *   newCustomers                            — buyers in M with no purchase in
 *                                             the 12 months before
 */
function deriveRawInputs(orders, period) {
  const key = crypto.randomBytes(32);
  const anon = (customer) =>
    customer ? crypto.createHmac('sha256', key).update(String(customer).trim().toLowerCase()).digest('hex') : null;

  const byMonth = new Map();
  for (const order of orders) {
    const month = monthOf(order.date);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push({ customer: anon(order.customer), cancelled: Boolean(order.cancelled) });
  }

  const inMonth = (m) => byMonth.get(m) ?? [];
  const completed = (m) => inMonth(m).filter((o) => !o.cancelled);
  const buyers = (m) => new Set(completed(m).map((o) => o.customer).filter(Boolean));
  const hasCustomers = orders.some((o) => o.customer);

  const raw = {
    orders: completed(period).length,
    ordersPrevMonth: completed(shiftMonth(period, -1)).length,
    ordersLastYear: completed(shiftMonth(period, -12)).length,
    booked: inMonth(period).length,
    cancelled: inMonth(period).filter((o) => o.cancelled).length,
  };

  if (hasCustomers) {
    const earlier = buyers(shiftMonth(period, -3));
    const later = new Set([
      ...buyers(shiftMonth(period, -2)),
      ...buyers(shiftMonth(period, -1)),
      ...buyers(period),
    ]);
    raw.customers3MonthsAgo = earlier.size;
    raw.returnedCustomers = [...earlier].filter((c) => later.has(c)).length;

    const before = new Set();
    for (let i = 1; i <= HISTORY_MONTHS; i += 1) {
      for (const c of buyers(shiftMonth(period, -i))) before.add(c);
    }
    raw.newCustomers = [...buyers(period)].filter((c) => !before.has(c)).length;
  }

  // A month with no data at all is "unknown", not "zero orders".
  const hasMonth = (m) => byMonth.has(m);
  if (!hasMonth(shiftMonth(period, -1))) delete raw.ordersPrevMonth;
  if (!hasMonth(shiftMonth(period, -12))) delete raw.ordersLastYear;
  if (!hasMonth(shiftMonth(period, -3))) {
    delete raw.customers3MonthsAgo;
    delete raw.returnedCustomers;
  }
  return raw;
}

module.exports = { deriveRawInputs, historyFor, HISTORY_MONTHS };
