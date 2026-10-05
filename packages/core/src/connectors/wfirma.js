'use strict';

const { dateRange } = require('../months');
const { ordersFromInvoices, amount } = require('./invoices');

/**
 * wFirma API v2 — https://doc.wfirma.pl
 * The owner creates an access key + secret key (Ustawienia → Bezpieczeństwo →
 * Aplikacje → Klucze API). wFirma also requires an appKey that it issues to
 * each integration on request; the tailwind.reviews agent ships with its own
 * once wFirma grants it (WFIRMA_APP_KEY), and the owner can paste one too.
 */
const HOST = 'api2.wfirma.pl';
const PAGE = 100;
const ORDER_TYPES = new Set([
  'normal',
  'receipt_normal',
  'receipt_fiscal_normal',
  'income_normal',
  'bill',
  'receipt_bill',
  'receipt_fiscal_bill',
  'income_bill',
]);

// wFirma wraps lists as { invoices: { "0": { invoice: {...} }, ... } }.
const listOf = (res, key, item) =>
  Object.entries(res?.[key] ?? {})
    .filter(([k]) => /^\d+$/.test(k))
    .map(([, v]) => v?.[item])
    .filter(Boolean);

async function fetchOrders(net, { accessKey, secretKey, appKey, companyId, from, to }) {
  net.allow(HOST);
  const range = dateRange(from, to);
  const query = new URLSearchParams({ inputFormat: 'json', outputFormat: 'json' });
  if (companyId) query.set('company_id', companyId);
  const headers = { accessKey, secretKey, appKey, 'Content-Type': 'application/json' };

  const all = [];
  for (let page = 1; ; page += 1) {
    const res = await net.json(`https://${HOST}/invoices/find?${query}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invoices: {
          parameters: {
            conditions: {
              and: [
                { condition: { field: 'date', operator: 'ge', value: range.from } },
                { condition: { field: 'date', operator: 'le', value: range.to } },
              ],
            },
            page,
            limit: PAGE,
          },
        },
      }),
    });
    if (res?.status?.code && res.status.code !== 'OK') {
      throw new Error(`wFirma: ${res.status.code}`);
    }
    const rows = listOf(res, 'invoices', 'invoice');
    all.push(...rows);
    if (rows.length < PAGE) break;
  }

  const invoices = all
    .filter((inv) => ORDER_TYPES.has(inv.type))
    .map((inv) => ({
      ref: inv.id,
      date: inv.date,
      customer: inv.contractor?.id ?? inv.contractor_detail?.nip ?? null,
      gross: amount(inv.total),
      cancelled: inv.schema_cancelled === '1' || inv.schema_cancelled === 1 || inv.schema_cancelled === true,
    }));
  const corrections = all
    .filter((inv) => inv.type === 'correction')
    .map((inv) => ({ correctsRef: inv.parent_id ?? inv.parent?.id, gross: amount(inv.total) }));

  return ordersFromInvoices(invoices, corrections);
}

module.exports = {
  id: 'wfirma',
  label: 'wFirma',
  fields: ['accessKey', 'secretKey', 'appKey', 'companyId'],
  fetchOrders,
};
