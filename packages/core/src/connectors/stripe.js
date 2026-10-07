'use strict';

const { dateRange } = require('../months');

/**
 * Stripe: one successful, captured charge = one order. Works with a
 * restricted key that can only read Charges (Dashboard → Developers → API
 * keys → Create restricted key → Charges: Read).
 *
 * Cancellation rule, by decision: only a FULL refund (`refunded: true`) counts
 * as a cancelled order. A partial refund is a discount or a goodwill gesture
 * on a job that happened, so it still counts as a completed order. Charges
 * with nothing captured (authorisations never captured) are not orders at all.
 */
const HOST = 'api.stripe.com';

const toUnix = (date, endOfDay = false) =>
  Math.floor(new Date(`${date}T${endOfDay ? '23:59:59' : '00:00:00'}Z`).getTime() / 1000);

async function fetchOrders(net, { apiKey, from, to }) {
  net.allow(HOST);
  const range = dateRange(from, to);
  const orders = [];
  let startingAfter;
  for (;;) {
    const params = new URLSearchParams({
      limit: '100',
      'created[gte]': String(toUnix(range.from)),
      'created[lte]': String(toUnix(range.to, true)),
    });
    if (startingAfter) params.set('starting_after', startingAfter);
    const page = await net.json(`https://${HOST}/v1/charges?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    for (const charge of page.data) {
      if (charge.status !== 'succeeded') continue;
      if (charge.captured === false || charge.amount_captured === 0) continue;
      orders.push({
        date: new Date(charge.created * 1000).toISOString().slice(0, 10),
        customer: charge.customer ?? charge.billing_details?.email ?? charge.receipt_email ?? null,
        cancelled: Boolean(charge.refunded),
      });
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return orders;
}

module.exports = { id: 'stripe', label: 'Stripe', fields: ['apiKey'], fetchOrders };
