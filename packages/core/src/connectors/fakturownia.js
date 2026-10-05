'use strict';

const { dateRange } = require('../months');
const { ordersFromInvoices, amount } = require('./invoices');

/**
 * Fakturownia — https://github.com/fakturownia/API
 * Account = subdomain (firma.fakturownia.pl), API token from
 * Ustawienia → Ustawienia konta → Integracja → Kod autoryzacyjny API.
 * The token travels as the api_token query parameter (the only documented
 * way); the agent's network log strips query strings.
 */
const ORDER_KINDS = new Set(['vat', 'receipt', 'bill', 'final', 'vat_mp', 'vat_margin']);

async function fetchOrders(net, { subdomain, apiToken, from, to }) {
  const account = String(subdomain).replace(/\.fakturownia\.pl.*$/, '').replace(/^https?:\/\//, '');
  const host = `${account}.fakturownia.pl`;
  net.allow(host);
  const range = dateRange(from, to);

  const invoices = [];
  const corrections = [];
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({
      period: 'more',
      date_from: range.from,
      date_to: range.to,
      search_date_type: 'issue_date',
      per_page: '100',
      page: String(page),
      api_token: apiToken,
    });
    const rows = await net.json(`https://${host}/invoices.json?${params}`);
    for (const inv of rows) {
      if (inv.kind === 'correction') {
        corrections.push({ correctsRef: inv.from_invoice_id, gross: amount(inv.price_gross) });
      } else if (ORDER_KINDS.has(inv.kind)) {
        invoices.push({
          ref: inv.id,
          date: inv.issue_date,
          customer: inv.buyer_tax_no || inv.buyer_email || inv.client_id || inv.buyer_name || null,
          gross: amount(inv.price_gross),
          cancelled: inv.status === 'rejected',
        });
      }
    }
    if (rows.length < 100) break;
  }
  return ordersFromInvoices(invoices, corrections);
}

module.exports = {
  id: 'fakturownia',
  label: 'Fakturownia',
  fields: ['subdomain', 'apiToken'],
  fetchOrders,
};
