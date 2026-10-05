'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * The agent does not reimplement the maths: it runs the very file the
 * website runs (https://tailwind.reviews/benchmark/calculator.v1.js), vendored
 * byte for byte. Its SHA-256 is pinned here and checked on load, and
 * `verifyAgainstSite` compares it with the hash the live protocol publishes.
 */
const CALCULATOR_FILE = path.join(__dirname, 'calculator.v1.js');
const CALCULATOR_SHA256 =
  '392a6fff21ba8bca2d1c35ad41b9e88f4cd2a104775d9d4139d8e6a6ead013c1';
const PROTOCOL_URL = 'https://tailwind.reviews/benchmark/protocol.v1.json';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function loadCalculator() {
  const actual = sha256(fs.readFileSync(CALCULATOR_FILE));
  if (actual !== CALCULATOR_SHA256) {
    throw new Error(`calculator.v1.js was modified (sha256 ${actual})`);
  }
  return require(CALCULATOR_FILE);
}

/** { ok, published } — whether the site still publishes this exact file. */
async function verifyAgainstSite(net) {
  const protocol = await net.json(PROTOCOL_URL);
  const published = protocol?.files?.calculator?.sha256 ?? null;
  return { ok: published === CALCULATOR_SHA256, published };
}

module.exports = { loadCalculator, verifyAgainstSite, CALCULATOR_SHA256, PROTOCOL_URL };
