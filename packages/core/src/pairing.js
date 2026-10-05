'use strict';

/**
 * Getting a one-time ticket without ever giving the agent a password.
 *
 * 1. The agent asks the API for a pairing: a short code for the owner and a
 *    secret only the agent knows.
 * 2. The owner opens tailwind.reviews, signs in, checks the code matches the
 *    one in the app and approves. The site verifies the business through
 *    Google Business — the same check as the web form — and issues the ticket.
 * 3. The agent polls with its secret and receives the ticket once.
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

/** Resolves with the ticket, or rejects on expiry/refusal. */
async function waitForTicket(net, { api = DEFAULT_API, pairingId, secret, intervalMs = 3000, signal }) {
  for (;;) {
    if (signal?.aborted) throw new Error('Pairing cancelled');
    const res = await net.json(`${api}/v1.0/public/benchmark/pairings/${pairingId}`, {
      headers: { 'x-pairing-secret': secret },
    });
    const { status, ticket, reason } = res.body;
    if (status === 'approved') return ticket;
    if (status === 'refused') {
      const err = new Error(reason ?? 'refused');
      err.reason = reason;
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function sendSignal(net, { api = DEFAULT_API, signal }) {
  return net.json(`${api}/v1.0/public/benchmark/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal),
  });
}

module.exports = { startPairing, waitForTicket, sendSignal, DEFAULT_API };
