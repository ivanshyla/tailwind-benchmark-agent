'use strict';

/** 'YYYY-MM' shifted by `delta` months. */
function shiftMonth(period, delta) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' of a 'YYYY-MM-DD' (or ISO) date string. */
function monthOf(date) {
  return date.slice(0, 7);
}

/** First and last day ('YYYY-MM-DD') covering months [from, to]. */
function dateRange(fromPeriod, toPeriod) {
  const [ty, tm] = toPeriod.split('-').map(Number);
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return { from: `${fromPeriod}-01`, to: `${toPeriod}-${String(last).padStart(2, '0')}` };
}

/** The last fully finished month as 'YYYY-MM'. */
function lastFullMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

module.exports = { shiftMonth, monthOf, dateRange, lastFullMonth };
