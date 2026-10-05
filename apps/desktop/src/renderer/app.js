'use strict';

/* global agent */

const CATEGORIES = [
  ['sprzatanie', 'Sprzątanie'], ['przeprowadzki', 'Przeprowadzki'], ['mycie-okien', 'Mycie okien'],
  ['pranie-tapicerki', 'Pranie dywanów i tapicerki'], ['zlota-raczka', 'Złota rączka'], ['hydraulik', 'Hydraulik'],
  ['elektryk', 'Elektryk'], ['remonty', 'Remonty i wykończenia'], ['dezynsekcja', 'Dezynsekcja i deratyzacja'],
  ['ogrod', 'Ogród i zieleń'],
];
const CITIES = [
  ['warszawa', 'Warszawa'], ['krakow', 'Kraków'], ['wroclaw', 'Wrocław'], ['lodz', 'Łódź'], ['poznan', 'Poznań'],
  ['trojmiasto', 'Trójmiasto'], ['slask', 'Katowice i Śląsk'], ['szczecin', 'Szczecin'], ['bydgoszcz', 'Bydgoszcz'],
  ['lublin', 'Lublin'], ['bialystok', 'Białystok'], ['rzeszow', 'Rzeszów'], ['inne', 'Inne miasto'],
];

const SOURCES = {
  fakturownia: {
    label: 'Fakturownia',
    fields: [
      ['subdomain', 'Adres konta (np. mojafirma.fakturownia.pl)'],
      ['apiToken', 'Kod autoryzacyjny API (Ustawienia → Integracja)', 'password'],
    ],
  },
  infakt: { label: 'inFakt', fields: [['apiKey', 'Klucz API (Ustawienia → API)', 'password']] },
  wfirma: {
    label: 'wFirma',
    fields: [
      ['accessKey', 'Access key (Ustawienia → Bezpieczeństwo → Klucze API)'],
      ['secretKey', 'Secret key', 'password'],
      ['appKey', 'App key (od wFirma)', 'password'],
      ['companyId', 'ID firmy (jeśli masz kilka, opcjonalnie)'],
    ],
  },
  ksef: {
    label: 'KSeF',
    note: 'Token KSeF tylko z uprawnieniem „Przeglądanie faktur”. Czytamy wyłącznie metadane faktur. Faktury B2C nie zawsze trafiają do KSeF.',
    fields: [
      ['nip', 'NIP firmy'],
      ['ksefToken', 'Token KSeF', 'password'],
    ],
  },
  stripe: {
    label: 'Stripe',
    note: 'Użyj klucza ograniczonego (restricted) z prawem tylko do odczytu Charges.',
    fields: [['apiKey', 'Klucz API (rk_live_…)', 'password']],
  },
  file: { label: 'Plik CSV / Excel', note: 'Eksport z Booksy, CRM, arkusza — jeden wiersz to jedno zamówienie.', fields: [] },
};

const MANUAL = [
  ['inquiries', 'Wszystkie zapytania w miesiącu'],
  ['ordersFromInquiries', 'Ile z nich zamieniło się w zamówienie'],
  ['marketingSpend', 'Wydatki na marketing w miesiącu (zł)'],
  ['hourlyPay', 'Średnia stawka brutto wykonawcy za godzinę (zł)'],
];

const COUNT_LABELS = {
  orders: 'Zamówienia w miesiącu',
  ordersPrevMonth: 'Zamówienia miesiąc wcześniej',
  ordersLastYear: 'Zamówienia rok wcześniej',
  booked: 'Wszystkie (z anulowanymi)',
  cancelled: 'Anulowane',
  customers3MonthsAgo: 'Klienci sprzed 3 miesięcy',
  returnedCustomers: '…którzy wrócili',
  newCustomers: 'Nowi klienci w miesiącu',
};

const $ = (id) => document.getElementById(id);
const state = { source: 'fakturownia', values: {}, mapping: null, counts: null, saved: {} };

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.append(c);
  return node;
}

function fillSelect(select, options, value) {
  select.replaceChildren(...options.map(([v, label]) => el('option', { value: v, text: label })));
  if (value) select.value = value;
}

function months() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return [v, d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })];
  });
}

function renderSources() {
  $('sources').replaceChildren(
    ...Object.entries(SOURCES).map(([id, s]) =>
      el('button', {
        class: `source ${state.source === id ? 'active' : ''}`,
        text: s.label,
        onclick: () => {
          state.source = id;
          state.values = { ...(state.saved[id] ?? {}) };
          state.counts = null;
          renderSources();
          renderFields();
          renderCounts();
          refreshPreview();
        },
      }),
    ),
  );
}

function renderFields() {
  const s = SOURCES[state.source];
  const nodes = [];
  if (s.note) nodes.push(el('p', { class: 'muted', text: s.note }));
  for (const [key, label, type] of s.fields) {
    nodes.push(
      el('label', {}, [
        label,
        el('input', {
          type: type ?? 'text',
          value: state.values[key] ?? '',
          autocomplete: 'off',
          oninput: (e) => (state.values[key] = e.target.value.trim()),
        }),
      ]),
    );
  }
  if (state.source === 'file') {
    nodes.push(el('button', { class: 'secondary', text: 'Wybierz plik…', onclick: pickFile }));
    if (state.mapping) nodes.push(mappingFields());
  }
  $('source-fields').replaceChildren(...nodes);
}

function mappingFields() {
  const { headers, mapping, fileName, rowCount } = state.mapping;
  const options = [['', '— brak —'], ...headers.map((h) => [h, h])];
  const select = (key, label) => {
    const s = el('select', { onchange: (e) => (mapping[key] = e.target.value || null) });
    fillSelect(s, options, mapping[key] ?? '');
    return el('label', {}, [label, s]);
  };
  return el('div', { class: 'mapping' }, [
    el('p', { class: 'muted', text: `${fileName}: ${rowCount} wierszy. Wskaż kolumny:` }),
    select('date', 'Data zamówienia'),
    select('customer', 'Klient (NIP, e-mail, telefon) — do liczenia powrotów'),
    select('status', 'Status (anulowane rozpoznamy po słowie „anul…”)'),
  ]);
}

async function pickFile() {
  const res = await agent.pickFile();
  if (res) state.mapping = res;
  renderFields();
}

function renderManual() {
  $('manual').replaceChildren(
    ...MANUAL.map(([key, label]) =>
      el('label', {}, [
        label,
        el('input', { inputmode: 'decimal', oninput: (e) => { state.manual[key] = e.target.value; refreshPreview(); } }),
      ]),
    ),
  );
}

function renderCounts() {
  const table = $('counts');
  if (!state.counts) {
    table.classList.add('hidden');
    return;
  }
  table.classList.remove('hidden');
  table.replaceChildren(
    el('caption', { text: 'Policzone lokalnie — te liczby nie są wysyłane' }),
    ...Object.entries(COUNT_LABELS)
      .filter(([k]) => state.counts[k] !== undefined)
      .map(([k, label]) => el('tr', {}, [el('td', { text: label }), el('td', { text: String(state.counts[k]) })])),
  );
}

const cell = () => ({ category: $('category').value, city: $('city').value, period: $('period').value });

function raw() {
  const manual = Object.fromEntries(
    Object.entries(state.manual)
      .filter(([, v]) => String(v).trim() !== '')
      .map(([k, v]) => [k, Number(String(v).replace(',', '.'))]),
  );
  return { ...(state.counts ?? {}), ...manual };
}

async function refreshPreview() {
  const signal = await agent.preview({ cell: cell(), raw: raw() });
  $('preview').textContent = JSON.stringify(signal, null, 2);
  $('send').disabled = !Object.values(signal.metrics).some((v) => v !== null);
}

async function fetchData() {
  const status = $('fetch-status');
  status.textContent = 'Czytam dane…';
  $('fetch').disabled = true;
  try {
    const res = await agent.fetchData({
      source: state.source,
      values: state.values,
      mapping: state.mapping?.mapping,
      period: cell().period,
    });
    state.counts = res.raw;
    status.textContent = `Gotowe: ${res.orderCount} zamówień z ${res.monthsWithData} miesięcy${res.skipped ? `, pominięto ${res.skipped} wierszy bez daty` : ''}.`;
    if ($('remember').checked && state.source !== 'file') {
      await agent.saveCredentials(state.source, state.values);
      state.saved[state.source] = { ...state.values };
    }
  } catch (error) {
    status.textContent = `Nie udało się: ${error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`;
  } finally {
    $('fetch').disabled = false;
    renderCounts();
    refreshPreview();
  }
}

const REFUSALS = {
  no_verified_business: 'Połącz Google Business na tailwind.reviews dla firmy, której wizytówką w Mapach Google zarządzasz.',
  already_participated: 'Twoja firma już wysłała sygnał za ten miesiąc.',
};

async function send() {
  const box = $('pairing');
  $('send').disabled = true;
  $('result').classList.add('hidden');
  try {
    const res = await agent.send({ cell: cell(), raw: raw() });
    box.classList.add('hidden');
    $('result').classList.remove('hidden');
    $('result').replaceChildren(
      el('strong', { text: 'Wysłane. ' }),
      'Serwer dostał dokładnie ten obiekt:',
      el('pre', { text: JSON.stringify(res.sent, null, 2) }),
      el('button', { class: 'secondary', text: 'Zobacz rynek na tailwind.reviews', onclick: () => agent.openExternal(res.resultUrl) }),
    );
  } catch (error) {
    const msg = error.message;
    const reason = Object.keys(REFUSALS).find((r) => msg.includes(r));
    box.replaceChildren(el('p', { class: 'error', text: reason ? REFUSALS[reason] : `Nie wysłano: ${msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}` }));
  } finally {
    $('send').disabled = false;
  }
}

function showPairing({ code, expiresIn }) {
  const box = $('pairing');
  box.classList.remove('hidden');
  box.replaceChildren(
    el('p', { text: 'Otworzyliśmy tailwind.reviews w przeglądarce. Sprawdź, czy widzisz ten sam kod, i potwierdź:' }),
    el('div', { class: 'code', text: code }),
    el('p', { class: 'muted', text: `Kod ważny ${Math.round(expiresIn / 60)} minut. Czekamy na potwierdzenie…` }),
    el('button', { class: 'link', text: 'Anuluj', onclick: () => agent.cancel() }),
  );
}

function logEntry(entry) {
  const ok = entry.status && entry.status < 400;
  $('net-log').prepend(
    el('li', { class: ok ? '' : 'bad' }, [
      el('span', { class: 'method', text: entry.method }),
      ` ${entry.url} `,
      el('span', { class: 'status', text: entry.status ? String(entry.status) : '…' }),
      entry.bytesSent ? el('span', { class: 'muted', text: ` · wysłano ${entry.bytesSent} B` }) : '',
    ]),
  );
}

async function init() {
  state.manual = {};
  state.saved = await agent.loadCredentials();
  state.values = { ...(state.saved[state.source] ?? {}) };
  fillSelect($('category'), CATEGORIES);
  fillSelect($('city'), CITIES);
  fillSelect($('period'), months());
  for (const id of ['category', 'city', 'period']) $(id).addEventListener('change', refreshPreview);
  renderSources();
  renderFields();
  renderManual();
  refreshPreview();
  $('fetch').addEventListener('click', fetchData);
  $('send').addEventListener('click', send);
  $('forget').addEventListener('click', async () => {
    await agent.forgetCredentials();
    state.saved = {};
  });
  agent.onNetLog(logEntry);
  agent.onPairing(showPairing);

  const badge = $('calc-badge');
  const v = await agent.verifyCalculator();
  badge.textContent =
    v.ok === true
      ? '✓ Kalkulator identyczny z opublikowanym na tailwind.reviews'
      : v.ok === false
        ? '✗ Kalkulator różni się od opublikowanego — nie wysyłaj'
        : v.status === 404
          ? 'Protokół nie jest jeszcze opublikowany na tailwind.reviews'
          : 'Nie udało się sprawdzić kalkulatora (brak połączenia)';
  badge.className = `badge ${v.ok === true ? 'good' : v.ok === false ? 'bad' : ''}`;
  badge.title = `sha256 ${v.pinned}`;
}

init();
