'use strict';

/**
 * The only way the agent talks to the network. Every request must go to a
 * host on the allowlist (the data source the owner picked, and the
 * tailwind.reviews API) and is recorded in a log the app shows, so the owner
 * can see that their data went nowhere else. Response bodies from data
 * sources never leave the process.
 */
class Net {
  constructor({ allowedHosts = [], onLog } = {}) {
    this.allowedHosts = new Set(allowedHosts);
    this.log = [];
    this.onLog = onLog;
  }

  allow(host) {
    this.allowedHosts.add(host);
  }

  async fetch(url, init = {}) {
    const { host } = new URL(url);
    if (!this.allowedHosts.has(host)) {
      throw new Error(`Blocked request to ${host}: not on the allowlist`);
    }
    const entry = {
      at: new Date().toISOString(),
      method: init.method ?? 'GET',
      // Query strings can carry API tokens; the log keeps host and path only.
      url: `${host}${new URL(url).pathname}`,
      bytesSent: init.body ? Buffer.byteLength(String(init.body)) : 0,
      status: null,
    };
    this.log.push(entry);
    try {
      const res = await fetch(url, init);
      entry.status = res.status;
      return res;
    } finally {
      this.onLog?.(entry);
    }
  }

  async json(url, init) {
    const res = await this.fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      err.status = res.status;
      err.body = text.slice(0, 500);
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }
}

module.exports = { Net };
