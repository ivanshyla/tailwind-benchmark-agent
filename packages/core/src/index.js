'use strict';

const { loadCalculator, verifyAgainstSite, CALCULATOR_SHA256, PROTOCOL_URL } = require('./calculator');
const { deriveRawInputs, historyFor } = require('./derive');
const { lastFullMonth, shiftMonth } = require('./months');
const { Net } = require('./net');
const { startPairing, waitForTicket, sendSignal, signalReadiness, MIN_METRICS, DEFAULT_API } = require('./pairing');
const table = require('./connectors/table');

const connectors = {
  fakturownia: require('./connectors/fakturownia'),
  infakt: require('./connectors/infakt'),
  wfirma: require('./connectors/wfirma'),
  ksef: require('./connectors/ksef'),
  stripe: require('./connectors/stripe'),
};

module.exports = {
  connectors,
  table,
  Net,
  loadCalculator,
  verifyAgainstSite,
  CALCULATOR_SHA256,
  PROTOCOL_URL,
  deriveRawInputs,
  historyFor,
  lastFullMonth,
  shiftMonth,
  startPairing,
  waitForTicket,
  sendSignal,
  signalReadiness,
  MIN_METRICS,
  DEFAULT_API,
};
