'use strict';

/**
 * Shared rules for invoice-based sources (Fakturownia, inFakt, wFirma, KSeF).
 *
 * One sales invoice = one order. Proformas, estimates and advance invoices are
 * not orders (an advance is settled later by a final invoice, which is
 * counted). An invoice is "cancelled" when the source flags it so, or when a
 * correction brings its gross total to zero — Polish invoicing has no other
 * way to undo a sale, and none of these APIs lists cancellations directly.
 */

const ZERO_TOLERANCE = 0.01;

/**
 * invoices:    [{ ref, date, customer, gross, cancelled? }]
 * corrections: [{ correctsRef, gross }] — gross is the change (negative when
 *              money goes back); a correction that zeroes `ref` cancels it.
 */
function ordersFromInvoices(invoices, corrections = []) {
  const delta = new Map();
  for (const c of corrections) {
    if (c.correctsRef == null) continue;
    delta.set(c.correctsRef, (delta.get(c.correctsRef) ?? 0) + Number(c.gross ?? 0));
  }
  return invoices.map((inv) => {
    const after = Number(inv.gross ?? 0) + (delta.get(inv.ref) ?? 0);
    const zeroed = delta.has(inv.ref) && Math.abs(after) < ZERO_TOLERANCE;
    return { date: inv.date, customer: inv.customer ?? null, cancelled: Boolean(inv.cancelled) || zeroed };
  });
}

/** Parse "1 234,56" / "1234.56" / 123456 (grosze when `cents`). */
function amount(value, { cents = false } = {}) {
  if (typeof value === 'number') return cents ? value / 100 : value;
  const n = Number(String(value ?? '0').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? (cents ? n / 100 : n) : 0;
}

module.exports = { ordersFromInvoices, amount };
