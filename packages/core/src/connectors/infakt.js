'use strict';

const { dateRange } = require('../months');
const { ordersFromInvoices, amount } = require('./invoices');

/**
 * inFakt API v3 — https://docs.infakt.pl
 * API key from Ustawienia → API, sent as X-inFakt-ApiKey. VAT invoices and
 * corrections live on separate endpoints; amounts are in grosze.
 */
const HOST = 'api.infakt.pl';
const PAGE = 100;

async function listAll(net, path, apiKey, filters) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({ ...filters, offset: String(offset), limit: String(PAGE) });
    const page = await net.json(`https://${HOST}/api/v3/${path}?${params}`, {
      headers: { 'X-inFakt-ApiKey': apiKey },
    });
    const rows = page?.entities ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchOrders(net, { apiKey, from, to }) {
  net.allow(HOST);
  const range = dateRange(from, to);
  const byIssue = {
    'q[invoice_date_gteq]': range.from,
    'q[invoice_date_lteq]': range.to,
    order: 'invoice_date asc',
  };

  const invoices = (await listAll(net, 'invoices.json', apiKey, byIssue))
    .filter((inv) => inv.kind !== 'proforma')
    .map((inv) => ({
      ref: inv.uuid,
      date: inv.invoice_date,
      customer: inv.client_tax_code || inv.client_id || inv.client_company_name || null,
      gross: amount(inv.gross_price, { cents: true }),
    }));

  // The docs do not say whether a correction's gross_price is the change or
  // the total after it. A zero total is read as "corrected to nothing", so
  // both readings mark a full reversal as cancelled.
  const corrections = (await listAll(net, 'corrective_invoices.json', apiKey, byIssue)).map((c) => {
    const gross = amount(c.gross_price, { cents: true });
    const original = amount(c.corrected_invoice_gross_price, { cents: true });
    return { correctsRef: c.corrected_invoice_uuid, gross: gross === 0 ? -original : gross };
  });

  return ordersFromInvoices(invoices, corrections);
}

module.exports = { id: 'infakt', label: 'inFakt', fields: ['apiKey'], fetchOrders };
