# tailwind.reviews benchmark agent

Open-source desktop agent for the [tailwind.reviews market benchmark](https://tailwind.reviews/pl/benchmark):
"are you growing, or is your market growing?" for home-services businesses in Poland.

It reads your sales **on your computer** and sends tailwind.reviews only a
handful of rounded percentages. Your invoices, customers, amounts and order
counts never leave your machine.

```
your invoicing / payments ──► this app (your computer) ──► 7 rounded ratios ──► tailwind.reviews
   Fakturownia, inFakt,         counts orders, repeat        growth m/m, y/y,
   wFirma, KSeF, Stripe,        buyers, cancellations;       conversion, repeat,
   CSV / Excel                  runs calculator.v1.js        cancellations, CAC, pay
```

## Install

Download the installer for your system from
[Releases](https://github.com/ivanshyla/tailwind-benchmark-agent/releases/latest).

Releases are not yet signed with an Apple Developer ID or a Windows
code-signing certificate, so the system warns on first launch:

- **macOS** — open the app once, then System Settings → Privacy & Security →
  "Open Anyway" for *Benchmark tailwind.reviews*.
- **Windows** — "Windows protected your PC" → More info → Run anyway.
- **Linux** — `chmod +x tailwind-benchmark-*.AppImage` and run it.

Every release lists the SHA-256 of each file in `SHA256SUMS.txt`
(`shasum -a 256 <file>` on macOS/Linux, `certutil -hashfile <file> SHA256` on
Windows). Or build it yourself from this repository — see Development.

## What is sent

Exactly the object the app shows in step 4 — the same one the website form sends
([protocol.v1.json](https://tailwind.reviews/benchmark/protocol.v1.json)):

```json
{
  "v": 1,
  "ticket": "one-time ticket",
  "period": "2026-09",
  "category": "hydraulik",
  "city": "warszawa",
  "metrics": { "growthMoM": 50, "growthYoY": null, "conversion": 45, "repeat90": 100,
               "cancellation": 25, "cac": 450, "hourlyPay": null }
}
```

`category` and `city` are not chosen in the app: when you approve the pairing,
tailwind.reviews derives them from your business's Google Business profile and
returns them with the ticket, and the server ignores any category or city a
client sends. The app shows them before sending ("Według Google Business Twoja
firma to: Sprzątanie, Warszawa").

The server accepts a signal only with month-on-month growth (`growthMoM`) and
at least 3 known metrics; the app checks this before pairing and lists what is
missing. Accepted signals join the published market statistics within about
24 hours.

No business name, no tax number, no amounts, no counts, no cookies. Customer
identifiers (tax numbers, e-mails) are only used in memory to tell repeat
buyers apart, hashed with a key that exists for one run.

## How to check it yourself (or ask your AI assistant to)

1. **Same maths as the website.** `packages/core/src/calculator.v1.js` is a
   byte-for-byte copy of https://tailwind.reviews/benchmark/calculator.v1.js.
   Its SHA-256 is pinned in `packages/core/src/calculator.js`, checked on every
   start, and compared with the hash in the live protocol (the badge at the top
   of the window).
2. **Only allowed hosts.** All network traffic goes through
   `packages/core/src/net.js`, which refuses any host that is not the data source
   you picked or tailwind.reviews, and logs every request in the window
   ("Dziennik sieci"). Redirects are never followed: a 3xx answer is refused
   and logged, so an allowed host cannot forward a request elsewhere. A data
   source's host is allowed only for the run that reads it. The window itself
   is sandboxed and blocked from the network, and the app opens only
   `https://tailwind.reviews` pages in your browser (`apps/desktop/src/main.js`).
3. **Read-only access.** Connectors only list sales documents:
   - Fakturownia `GET /invoices.json`, inFakt `GET /invoices.json` + `/corrective_invoices.json`,
     wFirma `invoices/find`, Stripe `GET /v1/charges` (restricted read-only key).
   - KSeF: a small client written from the official OpenAPI
     ([CIRFMF/ksef-api](https://github.com/CIRFMF/ksef-api)); the KSeF token is
     encrypted locally (RSA-OAEP-SHA256 with the Ministry's published key), only
     invoice **metadata** is read, never the invoice XML, and the session is
     logged out at the end. Use a token with only "Przeglądanie faktur".
4. **One answer per business per month.** To send, the app shows a short code
   and opens tailwind.reviews/pl/benchmark/polacz; you sign in and type the code
   there yourself (the link never contains the code — only enter a code that
   your own app is showing). The site checks through Google Business that you
   run the business and gives the app a one-time ticket. The app never sees
   your password. The server stores that your business took part, not what it
   answered.
5. **Timing.** The server knows when your account approved the pairing. So
   that the moment the answer arrives does not point back at that approval,
   the app waits a random 30 s – 3 min (`crypto.randomInt`) before sending,
   with a countdown you can cancel. This blurs, but does not eliminate, the
   link: on a quiet day few approvals happen within any 3-minute window.
6. **Stored credentials.** Optional, encrypted with the system keychain
   (Electron `safeStorage`), and they stay in the app's main process: the
   window only learns which fields are set (last 4 characters). On Linux
   without a keyring (`basic_text` backend) nothing is written to disk and
   credentials are kept only until the app closes.

## What it computes

From one finished month M and the 12 months before it
(`packages/core/src/derive.js`):

| Count | From |
|---|---|
| orders in M, M-1, M-12 | completed sales documents per month |
| booked / cancelled | cancelled = flagged by the source, or a correction that brings the invoice to zero |
| customers in M-3 / of them returned by M | repeat buyers by tax number, e-mail or client id |
| new customers in M | buyers with no purchase in the 12 months before |

Inquiries, marketing spend and contractor pay are not in invoices; you can type
them in (optional). Proformas and advance invoices are not orders (the final
invoice that settles an advance is). KSeF can undercount consumer (B2C) sales,
which are optional there; if more than 10 000 KSeF invoices share one issue
date the connector stops with an error rather than undercount.

Stripe: one succeeded, captured charge is one order. Only a **full** refund
counts as a cancellation; a partially refunded charge still counts as a
completed order (a discount on a job that happened). Charges with nothing
captured are ignored.

## Development

```bash
npm install
npm test          # core: connectors (against recorded API shapes), derivation, calculator
npm run desktop   # start the app; TAILWIND_API=http://localhost:5599 for a local API
```

`apps/desktop` builds installers with electron-builder (`npm run dist --workspace=apps/desktop`).

## License

MIT
