# Changelog

## 0.1.1

Security and correctness fixes from review.

- **Network:** redirects are never followed; any 3xx is refused and logged
  (previously an allowed host could redirect a request, and on 307/308 its
  body, to any host). Hosts a connector allows now last only for that run.
- **Pairing:** the app shows the code and opens tailwind.reviews/pl/benchmark/polacz
  without it; the owner types the code there. Only `https://tailwind.reviews`
  (or `http://localhost` when `TAILWIND_API` points at this machine) is ever
  opened in the browser.
- **Pairing:** category and city come from the business's Google Business
  profile, returned by the server with the ticket, and are shown before sending.
- **Timing:** after approval the app waits a random 30 s – 3 min before
  sending, with a countdown and cancel, so the send time does not link the
  answer to the account. Only one send runs at a time.
- **Minimum metrics:** the app checks before pairing that the signal has
  month-on-month growth and at least 3 metrics (the server's rule) and lists
  what is missing.
- **Credentials:** the window no longer receives stored secrets, only which
  fields are set; a blank field keeps the stored value. On Linux with the
  `basic_text` safeStorage backend nothing is written to disk.
- **KSeF:** clear errors for an unknown environment, for a sign-in that is
  never confirmed (instead of redeeming anyway), and for more than 10 000
  invoices on one issue date (instead of looping until the rate limit);
  continuation dates are sent as DateTime.
- **inFakt:** advance invoices (zaliczkowe) are no longer counted next to
  their final invoice.
- **Stripe:** charges with nothing captured are ignored; documented that only a
  full refund counts as a cancellation.

## 0.1.0

First release.
