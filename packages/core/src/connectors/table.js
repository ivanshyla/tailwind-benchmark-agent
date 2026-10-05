'use strict';

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

/**
 * CSV / Excel export from anything: Booksy, a CRM, a booking system, a
 * spreadsheet. One row = one order. The owner maps three columns (date,
 * customer, status); common Polish and English headers are guessed.
 */

const GUESS = {
  date: ['data', 'date', 'data wystawienia', 'data sprzedaży', 'data wizyty', 'data zlecenia', 'data zamówienia', 'created', 'created at', 'issue date', 'order date'],
  customer: ['nip', 'klient', 'email', 'e-mail', 'telefon', 'phone', 'customer', 'client', 'nabywca', 'customer email', 'client id'],
  status: ['status', 'stan', 'state'],
};
const CANCELLED_WORDS = ['anul', 'odwoł', 'cancel', 'storn', 'no-show', 'nie przyszedł', 'refund'];

async function readTable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xlsx') {
    const readXlsx = require('read-excel-file/node');
    const [header, ...rows] = await readXlsx(fs.createReadStream(filePath));
    const headers = header.map((h) => String(h ?? '').trim());
    return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  }
  const text = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  return data;
}

function guessMapping(headers) {
  const pick = (candidates) =>
    headers.find((h) => candidates.includes(h.toLowerCase())) ??
    headers.find((h) => candidates.some((c) => h.toLowerCase().includes(c))) ??
    null;
  return { date: pick(GUESS.date), customer: pick(GUESS.customer), status: pick(GUESS.status) };
}

/** 'YYYY-MM-DD' from a Date, ISO string, 'DD.MM.YYYY' or 'DD/MM/YYYY'. */
function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const isCancelled = (status) => {
  const s = String(status ?? '').toLowerCase();
  return CANCELLED_WORDS.some((w) => s.includes(w));
};

function ordersFromRows(rows, mapping) {
  if (!mapping.date) throw new Error('Choose the date column');
  const orders = [];
  let skipped = 0;
  for (const row of rows) {
    const date = parseDate(row[mapping.date]);
    if (!date) {
      skipped += 1;
      continue;
    }
    orders.push({
      date,
      customer: mapping.customer ? String(row[mapping.customer] ?? '').trim() || null : null,
      cancelled: mapping.status ? isCancelled(row[mapping.status]) : false,
    });
  }
  return { orders, skipped };
}

module.exports = { readTable, guessMapping, ordersFromRows, parseDate, isCancelled };
