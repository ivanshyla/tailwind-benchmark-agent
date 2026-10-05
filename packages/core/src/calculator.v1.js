/*
 * tailwind.reviews market benchmark — browser calculator, protocol v1.
 *
 * This file is the whole client-side contract. It runs in the business
 * owner's browser, turns the numbers they type into rounded ratios, and is the
 * only code that sends the answer to the server. Raw numbers never leave this
 * file: buildSignal() returns ratios only, and sendSignal() posts exactly the
 * object it is given, without cookies.
 *
 * The one other value in the signal is a one-time ticket. A signed-in owner
 * gets it after proving through Google Business that they run a real
 * business — one ticket per business per month — so fake businesses cannot
 * fill a cell. The ticket is random and the server keeps only its hash and
 * month, so it does not say which business sent the answer.
 *
 * The page loads this file with a Subresource Integrity hash, so the browser
 * refuses to run any version other than the one published at
 * /benchmark/protocol.v1.json. To audit: read this file, compare its SHA-256
 * with the protocol, and watch the network tab — one POST to
 * /v1.0/public/benchmark/signals whose body matches buildSignal().
 *
 * No dependencies, no minification, no build step.
 */
(function (root) {
  'use strict';

  var PROTOCOL_VERSION = 1;

  function isCount(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0;
  }

  // Percent change, rounded to a whole percent.
  function growth(now, before) {
    if (!isCount(now) || !isCount(before) || before === 0) return null;
    return Math.round(((now - before) / before) * 100);
  }

  // Share of a whole, rounded to a whole percent. A part bigger than the
  // whole is a typo, not a 120% conversion, so it is dropped.
  function share(part, whole) {
    if (!isCount(part) || !isCount(whole) || whole === 0 || part > whole) {
      return null;
    }
    return Math.round((part / whole) * 100);
  }

  /**
   * raw: numbers for one finished month, every field optional:
   *   orders, ordersPrevMonth, ordersLastYear,
   *   inquiries, ordersFromInquiries,
   *   customers3MonthsAgo, returnedCustomers,
   *   booked, cancelled,
   *   marketingSpend (PLN), newCustomers,
   *   hourlyPay (PLN gross paid to the contractor, not the client price)
   */
  function computeMetrics(raw) {
    var r = raw || {};
    var cac = null;
    if (isCount(r.marketingSpend) && isCount(r.newCustomers) && r.newCustomers > 0) {
      // Rounded to 5 PLN so the exact spend cannot be recovered.
      cac = Math.round(r.marketingSpend / r.newCustomers / 5) * 5;
    }
    var hourlyPay = null;
    if (isCount(r.hourlyPay) && r.hourlyPay > 0) {
      hourlyPay = Math.round(r.hourlyPay);
    }
    return {
      growthMoM: growth(r.orders, r.ordersPrevMonth),
      growthYoY: growth(r.orders, r.ordersLastYear),
      conversion: share(r.ordersFromInquiries, r.inquiries),
      repeat90: share(r.returnedCustomers, r.customers3MonthsAgo),
      cancellation: share(r.cancelled, r.booked),
      cac: cac,
      hourlyPay: hourlyPay,
    };
  }

  /**
   * The signal: the only object that leaves the browser with the answer.
   * ticket: the one-time ticket from /v1.0/benchmark/ticket.
   */
  function buildSignal(params) {
    return {
      v: PROTOCOL_VERSION,
      ticket: params.ticket,
      period: params.period,
      category: params.category,
      city: params.city,
      metrics: computeMetrics(params.raw),
    };
  }

  function hasAnyMetric(signal) {
    var m = signal.metrics;
    for (var key in m) {
      if (Object.prototype.hasOwnProperty.call(m, key) && m[key] !== null) {
        return true;
      }
    }
    return false;
  }

  /**
   * POST the signal. credentials: 'omit' — no session cookie travels with it,
   * so the signed-in account is not attached to the answer.
   */
  function sendSignal(apiBase, signal) {
    return root
      .fetch(apiBase.replace(/\/$/, '') + '/v1.0/public/benchmark/signals', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signal),
      })
      .then(function (res) {
        if (!res.ok) throw new Error('Benchmark signal rejected: ' + res.status);
        return true;
      });
  }

  var api = {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    computeMetrics: computeMetrics,
    buildSignal: buildSignal,
    hasAnyMetric: hasAnyMetric,
    sendSignal: sendSignal,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TailwindBenchmark = api;
    root.dispatchEvent(new Event('tailwind-benchmark-ready'));
  }
})(typeof window !== 'undefined' ? window : globalThis);
