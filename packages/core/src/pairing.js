'use strict';

/**
 * Getting a one-time ticket without ever giving the agent a password.
 *
 * 1. The agent asks the API for a pairing: a short code for the owner and a
 *    secret only the agent knows.
 * 2. The owner opens tailwind.reviews/pl/benchmark/polacz themselves, signs
 *    in and types the code shown in the app. The app never opens a link that
 *    carries the code, so owners learn to approve only a code their own app
 *    shows, never one that arrives pre-filled in a link someone sent. The
 *    site verifies the business through Google Business — the same check as
 *    the web form — and issues the ticket.
 * 3. The agent polls with its secret and receives the ticket once, together
 *    with the category and city the server derived from the Google Business
 *    profile. The server ignores any category or city the client sends, so
 *    the signal carries the returned ones.
 *
 * The ticket then travels with the signal to the public endpoint, exactly as
 * from the website.
 */

const DEFAULT_API = 'https://api.tailwind.reviews';

async function startPairing(net, { api = DEFAULT_API, period }) {
  const res = await net.json(`${api}/v1.0/public/benchmark/pairings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period }),
  });
  return res.body; // { pairingId, code, secret, approveUrl, expiresIn }
}

/** Resolves with { ticket, period, category, city }, or rejects on expiry/refusal. */
async function waitForTicket(net, { api = DEFAULT_API, pairingId, secret, intervalMs = 3000, signal }) {
  for (;;) {
    if (signal?.aborted) throw new Error('Pairing cancelled');
    const res = await net.json(`${api}/v1.0/public/benchmark/pairings/${pairingId}`, {
      headers: { 'x-pairing-secret': secret },
    });
    const { status, ticket, period, category, city, reason } = res.body;
    if (status === 'approved') return { ticket, period, category, city };
    if (status === 'refused') {
      const err = new Error(reason ?? 'refused');
      err.reason = reason;
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * The signals endpoint rejects (400) a signal without growthMoM or with fewer
 * than MIN_METRICS known metrics; a cell needs comparable answers. Checked
 * before pairing so the owner does not spend the month's ticket on a refusal.
 */
const MIN_METRICS = 3;

function signalReadiness(metrics) {
  const known = Object.keys(metrics).filter((k) => metrics[k] !== null && metrics[k] !== undefined);
  const missing = Object.keys(metrics).filter((k) => !known.includes(k));
  const growthMissing = !known.includes('growthMoM');
  const short = Math.max(0, MIN_METRICS - known.length);
  return { ok: !growthMissing && short === 0, growthMissing, known, missing, short, required: MIN_METRICS };
}

async function sendSignal(net, { api = DEFAULT_API, signal }) {
  return net.json(`${api}/v1.0/public/benchmark/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal),
  });
}

module.exports = { startPairing, waitForTicket, sendSignal, signalReadiness, MIN_METRICS, DEFAULT_API };
