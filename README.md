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
   ("Dziennik sieci"). The window itself is sandboxed and blocked from the network
   (`apps/desktop/src/main.js`).
3. **Read-only access.** Connectors only list sales documents:
   - Fakturownia `GET /invoices.json`, inFakt `GET /invoices.json` + `/corrective_invoices.json`,
     wFirma `invoices/find`, Stripe `GET /v1/charges` (restricted read-only key).
   - KSeF: a small client written from the official OpenAPI
     ([CIRFMF/ksef-api](https://github.com/CIRFMF/ksef-api)); the KSeF token is
     encrypted locally (RSA-OAEP-SHA256 with the Ministry's published key), only
     invoice **metadata** is read, never the invoice XML, and the session is
     logged out at the end. Use a token with only "Przeglądanie faktur".
4. **One answer per business per month.** To send, you approve a short code on
   tailwind.reviews while signed in; the site checks through Google Business that
   you run the business and gives the app a one-time ticket. The app never sees
   your password. The server stores that your business took part, not what it
   answered.

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
them in (optional). Proformas and advance invoices are not orders. KSeF can
undercount consumer (B2C) sales, which are optional there.

## Development

```bash
npm install
npm test          # core: connectors (against recorded API shapes), derivation, calculator
npm run desktop   # start the app; TAILWIND_API=http://localhost:5599 for a local API
```

`apps/desktop` builds installers with electron-builder (`npm run dist --workspace=apps/desktop`).

## License

MIT
