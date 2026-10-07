'use strict';

/**
 * The only way the agent talks to the network. Every request must go to a
 * host on the allowlist (the data source the owner picked, and the
 * tailwind.reviews API) and is recorded in a log the app shows, so the owner
 * can see that their data went nowhere else. Response bodies from data
 * sources never leave the process.
 */
class Net {
  constructor({ allowedHosts = [], onLog, log = [] } = {}) {
    this.allowedHosts = new Set(allowedHosts);
    this.log = log;
    this.onLog = onLog;
  }

  allow(host) {
    this.allowedHosts.add(host);
  }

  /**
   * A Net for one connector run: it starts from this allowlist and shares the
   * log, but hosts a connector allows on it disappear with it, so a data
   * source picked once is not reachable for the rest of the session.
   */
  scope() {
    return new Net({ allowedHosts: this.allowedHosts, onLog: this.onLog, log: this.log });
  }

  async fetch(url, init = {}) {
    const { host, pathname } = new URL(url);
    if (!this.allowedHosts.has(host)) {
      throw new Error(`Blocked request to ${host}: not on the allowlist`);
    }
    const entry = {
      at: new Date().toISOString(),
      method: init.method ?? 'GET',
      // Query strings can carry API tokens; the log keeps host and path only.
      url: `${host}${pathname}`,
      bytesSent: init.body ? Buffer.byteLength(String(init.body)) : 0,
      status: null,
    };
    this.log.push(entry);
    try {
      // Following a redirect would let an allowed host send the request (and,
      // on 307/308, its body) to any other host, outside the allowlist and
      // outside the log. Redirects are therefore never followed.
      const res = await fetch(url, { ...init, redirect: 'manual' });
      entry.status = res.status;
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers?.get?.('location');
        let target = null;
        try {
          target = location ? new URL(location, url).host : null;
        } catch {
          target = null;
        }
        entry.error = `redirect${target ? ` to ${target}` : ''} blocked`;
        const err = new Error(`Blocked redirect from ${host}${target ? ` to ${target}` : ''} (HTTP ${res.status})`);
        err.status = res.status;
        throw err;
      }
      return res;
    } catch (error) {
      entry.error ??= error.message;
      throw error;
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
