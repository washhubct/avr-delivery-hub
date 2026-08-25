'use strict';
// node --test — client FIC con HTTP mockato + handler (approvazione, idempotenza)
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFicClient, FicError } = require('../fic-client.js');
const { createHandlers, buildFicPayload, HttpError } = require('../fic-handlers.js');
const Core = require('../fic-core.js');

// ── Mock fetch ─────────────────────────────────────────────────────
function mockFetch(routes) {
    const calls = [];
    const fn = async (url, init) => {
        const method = (init && init.method) || 'GET';
        calls.push({ url, method, body: init && init.body ? JSON.parse(init.body) : null, headers: init.headers });
        for (const r of routes) {
            if (r.method === method && (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url))) {
                const resp = typeof r.respond === 'function' ? r.respond(calls.length) : r.respond;
                return {
                    ok: resp.status >= 200 && resp.status < 300, status: resp.status,
                    headers: { get: h => (resp.headers || {})[h] || null },
                    text: async () => JSON.stringify(resp.body === undefined ? {} : resp.body),
                };
            }
        }
        return { ok: false, status: 404, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'no route' } }) };
    };
    fn.calls = calls;
    return fn;
}
const noSleep = async () => {};
function client(fetchImpl) { return createFicClient({ token: 'tok-secret', companyId: '123', fetchImpl, sleep: noSleep }); }

test('client: header bearer, ricerca cliente, vat 22% da info/vat_types', async () => {
    const f = mockFetch([
        { method: 'GET', match: '/info/vat_types', respond: { status: 200, body: { data: [{ id: 5, value: 10 }, { id: 7, value: 22, is_default: true }, { id: 9, value: 22 }] } } },
        { method: 'GET', match: '/entities/clients?q=', respond: { status: 200, body: { data: [{ id: 42, name: 'X' }] } } },
    ]);
    const c = client(f);
    assert.equal(await c.findVatTypeId(22), 7);
    const cl = await c.findClientByVat('01234567890');
    assert.equal(cl.id, 42);
    assert.equal(f.calls[0].headers.Authorization, 'Bearer tok-secret');
    assert.ok(decodeURIComponent(f.calls[1].url).includes("vat_number = '01234567890'"));
});

test('client: aliquota 22% assente → errore chiaro', async () => {
    const f = mockFetch([{ method: 'GET', match: '/info/vat_types', respond: { status: 200, body: { data: [{ id: 5, value: 10 }] } } }]);
    await assert.rejects(client(f).findVatTypeId(22), e => e instanceof FicError && /22%/.test(e.message));
});

test('client: creazione, dry-run e invio', async () => {
    const f = mockFetch([
        { method: 'POST', match: /\/issued_documents$/, respond: { status: 200, body: { data: { id: 777, number: 12, amount_gross: 55760.56 } } } },
        { method: 'POST', match: '/issued_documents/777/e_invoice/send', respond: { status: 200, body: { data: { success: true } } } },
        { method: 'GET', match: '/issued_documents/777', respond: { status: 200, body: { data: { id: 777, ei_status: 'sent' } } } },
    ]);
    const c = client(f);
    const created = await c.createInvoice({ type: 'invoice' });
    assert.equal(created.id, 777);
    assert.deepEqual(f.calls[0].body, { data: { type: 'invoice' } });
    await c.sendEInvoice(777, true);
    assert.deepEqual(f.calls[1].body, { data: { options: { dry_run: true } } });
    await c.sendEInvoice(777, false);
    assert.deepEqual(f.calls[2].body, { data: { options: { dry_run: false } } });
    assert.equal((await c.getInvoice(777)).ei_status, 'sent');
});

for (const [status, re] of [[401, /Token Fatture in Cloud/], [404, /non trovata/], [422, /rifiutato/], [403, /permessi/]]) {
    test('client: HTTP ' + status + ' → messaggio comprensibile, nessun retry', async () => {
        const f = mockFetch([{ method: 'GET', match: '/issued_documents/1', respond: { status, body: { error: { message: 'boom', validation_result: { xml_errors: ['x'] } } } } }]);
        await assert.rejects(client(f).getInvoice(1), e => e instanceof FicError && e.status === status && re.test(e.message) && (status !== 422 || e.dettagli.validation_result.xml_errors[0] === 'x'));
        assert.equal(f.calls.length, 1);
    });
}

test('client: 429 → retry con backoff poi successo; 429 persistente → errore', async () => {
    let n = 0;
    const f = mockFetch([{ method: 'GET', match: '/issued_documents/1', respond: () => (++n < 3 ? { status: 429, headers: { 'Retry-After': '1' } } : { status: 200, body: { data: { id: 1 } } }) }]);
    assert.equal((await client(f).getInvoice(1)).id, 1);
    assert.equal(f.calls.length, 3);
    const f2 = mockFetch([{ method: 'GET', match: '/issued_documents/1', respond: { status: 429 } }]);
    await assert.rejects(client(f2).getInvoice(1), e => e.status === 429 && /Limite di richieste/.test(e.message));
    assert.equal(f2.calls.length, 4); // 1 + 3 retry
});

test('client: 500 → retry, errore senza stacktrace', async () => {
    const f = mockFetch([{ method: 'GET', match: '/issued_documents/1', respond: { status: 503 } }]);
    await assert.rejects(client(f).getInvoice(1), e => e.status === 503 && /non risponde/.test(e.message));
});

// ── Mock Firestore minimale ────────────────────────────────────────
function mockDb(seed) {
    const store = Object.assign({}, seed || {});
    return {
        store,
        collection: name => ({
            doc: id => {
                const key = name + '/' + id;
                return {
                    get: async () => ({ exists: store[key] !== undefined, data: () => store[key] }),
                    set: async d => { store[key] = JSON.parse(JSON.stringify(d)); },
                    update: async d => { store[key] = Object.assign({}, store[key], JSON.parse(JSON.stringify(d))); },
                };
            },
        }),
    };
}
const CALLER = { uid: 'u1', email: 'guido@last-mile.it' };
const CONFIG = { 'config/fic': { cliente: { piva: '01234567890', ragioneSociale: 'Fratelli Arena', eiCode: 'ABCDEFG' } } };
const RIGHE = Core.righeToJson([
    { tipo: 'feriali', area: 'CT', codice: '300', descrizione: 'Filiale 300 (CT) - consegne giorni feriali luglio 2026', qty: 2160, prezzoCents: 970n, totaleCents: 2160n * 970n },
    { tipo: 'festivi', area: 'CT', codice: '300', descrizione: 'Filiale 300 (CT) - consegne giorni festivi luglio 2026', qty: 277, prezzoCents: 1261n, totaleCents: 277n * 1261n },
    { tipo: 'acconto', descrizione: 'Detrazione acconto', qty: 1, prezzoCents: -100000n, totaleCents: -100000n },
]);
const INTESTAZIONE = { numero: '12', data: '2026-08-05', scadenza: '2026-08-10', metodoPagamento: 'Bonifico bancario' };

function ficRoutes(extra) {
    return [
        { method: 'GET', match: '/info/vat_types', respond: { status: 200, body: { data: [{ id: 7, value: 22 }] } } },
        { method: 'GET', match: '/entities/clients?q=', respond: { status: 200, body: { data: [{ id: 42 }] } } },
        { method: 'POST', match: /\/issued_documents$/, respond: { status: 200, body: { data: { id: 777, number: 12, amount_gross: 28349.43 } } } },
        { method: 'POST', match: '/e_invoice/send', respond: { status: 200, body: { data: { success: true } } } },
        { method: 'GET', match: '/issued_documents/777', respond: { status: 200, body: { data: { id: 777, ei_status: 'sent' } } } },
    ].concat(extra || []);
}
function handlersWith(db, f) {
    return createHandlers({ db, getFic: async () => client(f), now: () => '2026-08-05T10:00:00.000Z' });
}

test('handler: NESSUN invio/creazione senza flag di approvazione', async () => {
    const f = mockFetch(ficRoutes());
    const h = handlersWith(mockDb(CONFIG), f);
    await assert.rejects(h.creaFattura({ mese: '2026-07', righe: RIGHE, intestazione: INTESTAZIONE, scostamentiVerificati: true }, CALLER), e => e instanceof HttpError && e.status === 400 && /approvazione/i.test(e.message));
    await assert.rejects(h.creaFattura({ mese: '2026-07', righe: RIGHE, intestazione: INTESTAZIONE, approvato: 'true', scostamentiVerificati: true }, CALLER), e => e.status === 400);
    await assert.rejects(h.creaFattura({ mese: '2026-07', righe: RIGHE, intestazione: INTESTAZIONE, approvato: true }, CALLER), e => /scostamenti/.test(e.message));
    // invio: doc creato ma senza approvataDa → bloccato
    const db2 = mockDb(Object.assign({ 'fattureFic/2026-07': { stato: 'creata', ficDocumentId: 777 } }, CONFIG));
    await assert.rejects(handlersWith(db2, f).inviaSdi({ mese: '2026-07', approvato: true }, CALLER), e => e.status === 403);
    await assert.rejects(handlersWith(db2, f).inviaSdi({ mese: '2026-07' }, CALLER), e => e.status === 400);
    assert.equal(f.calls.length, 0, 'nessuna chiamata HTTP verso FIC deve essere partita');
});

test('handler: crea → dry-run → invia, con audit e totali server-side', async () => {
    const f = mockFetch(ficRoutes());
    const db = mockDb(CONFIG);
    const h = handlersWith(db, f);
    const out = await h.creaFattura({ mese: '2026-07', righe: RIGHE, intestazione: INTESTAZIONE, approvato: true, scostamentiVerificati: true, totali: { imponibile: '23444.97', totale: '28602.86' } }, CALLER);
    assert.equal(out.stato, 'creata');
    assert.equal(out.ficDocumentId, 777);
    assert.equal(out.totali.imponibile, '23444.97'); // 20952.00 + 3492.97 − 1000.00
    assert.equal(out.totali.iva, '5157.89');
    assert.equal(out.totali.totale, '28602.86');
    assert.equal(out.avvisi.length, 1); // FIC mock risponde 28349.43 ≠ 28350.32
    const doc = db.store['fattureFic/2026-07'];
    assert.equal(doc.approvataDa, 'guido@last-mile.it');
    assert.equal(doc.log[0].azione, 'approvazione');
    const payload = f.calls.find(c => /issued_documents$/.test(c.url)).body.data;
    assert.equal(payload.type, 'invoice');
    assert.equal(payload.e_invoice, true);
    assert.deepEqual(payload.entity, { id: 42 });
    assert.equal(payload.items_list.length, 3);
    assert.equal(payload.items_list[0].net_price, 9.7);
    assert.equal(payload.items_list[0].vat.id, 7);
    assert.equal(payload.items_list[2].net_price, -1000);
    assert.equal(payload.payments_list[0].amount, 28602.86);
    assert.equal(payload.payments_list[0].due_date, '2026-08-10');
    assert.equal(payload.ei_data.payment_method, 'MP05');
    assert.ok(!JSON.stringify(payload).includes('tok-secret'));

    // invio: dry-run prima dell'invio reale
    const before = f.calls.length;
    const inv = await h.inviaSdi({ mese: '2026-07', approvato: true }, CALLER);
    assert.equal(inv.stato, 'inviata');
    assert.equal(inv.eiStatus, 'sent');
    const sends = f.calls.slice(before).filter(c => c.url.includes('/e_invoice/send'));
    assert.deepEqual(sends.map(s => s.body.data.options.dry_run), [true, false]);
    assert.equal(db.store['fattureFic/2026-07'].stato, 'inviata');
    assert.equal(db.store['fattureFic/2026-07'].inviataDa, CALLER.email);
    // reinvio → bloccato
    await assert.rejects(h.inviaSdi({ mese: '2026-07', approvato: true }, CALLER), e => e.status === 409);
    // stato
    const st = await h.stato({ mese: '2026-07' });
    assert.equal(st.eiStatus, 'sent');
});

test('handler: creazione già fatta → 409, nessuna duplicazione su FIC', async () => {
    const f = mockFetch(ficRoutes());
    const db = mockDb(Object.assign({ 'fattureFic/2026-07': { stato: 'creata', ficDocumentId: 777, approvataDa: 'x' } }, CONFIG));
    await assert.rejects(handlersWith(db, f).creaFattura({ mese: '2026-07', righe: RIGHE, intestazione: INTESTAZIONE, approvato: true, scostamentiVerificati: true }, CALLER), e => e.status === 409);
    assert.equal(f.calls.length, 0);
});

test('handler: dry-run fallito → stato errore_dryrun, nessun invio reale, retry possibile', async () => {
    let n = 0;
    const f = mockFetch(ficRoutes().filter(r => r.match !== '/e_invoice/send').concat([{
        method: 'POST', match: '/e_invoice/send',
        respond: () => (++n === 1 ? { status: 422, body: { error: { message: 'XML non valido', validation_result: { xml_errors: ['CAP mancante'] } } } } : { status: 200, body: { data: {} } }),
    }]));
    const db = mockDb(Object.assign({ 'fattureFic/2026-07': { stato: 'creata', ficDocumentId: 777, approvataDa: 'x', log: [] } }, CONFIG));
    const h = handlersWith(db, f);
    await assert.rejects(h.inviaSdi({ mese: '2026-07', approvato: true }, CALLER), e => e.status === 422 && /Verifica XML fallita/.test(e.message) && e.extra.validation_result.xml_errors[0] === 'CAP mancante');
    assert.equal(db.store['fattureFic/2026-07'].stato, 'errore_dryrun');
    assert.equal(f.calls.filter(c => c.url.includes('/e_invoice/send')).length, 1);
    // retry: stesso documento, non ricreato
    const inv = await h.inviaSdi({ mese: '2026-07', approvato: true }, CALLER);
    assert.equal(inv.stato, 'inviata');
    assert.equal(f.calls.filter(c => /issued_documents$/.test(c.url) && c.method === 'POST').length, 0);
});

test('handler: invio reale fallito → errore_invio, retry senza ricreare', async () => {
    let n = 0;
    const f = mockFetch(ficRoutes().filter(r => r.match !== '/e_invoice/send').concat([{
        method: 'POST', match: '/e_invoice/send',
        respond: () => (++n >= 2 && n <= 5 ? { status: 500 } : { status: 200, body: { data: {} } }), // 1 invio + 3 retry falliscono
    }]));
    const db = mockDb(Object.assign({ 'fattureFic/2026-07': { stato: 'creata', ficDocumentId: 777, approvataDa: 'x', log: [] } }, CONFIG));
    const h = handlersWith(db, f);
    await assert.rejects(h.inviaSdi({ mese: '2026-07', approvato: true }, CALLER), e => e.status === 502);
    assert.equal(db.store['fattureFic/2026-07'].stato, 'errore_invio');
    const inv = await h.inviaSdi({ mese: '2026-07', approvato: true }, CALLER);
    assert.equal(inv.stato, 'inviata');
});

test('handler: FIC fallisce in creazione → stato errore_creazione, approvazione loggata, retry ricrea', async () => {
    let n = 0;
    const f = mockFetch(ficRoutes().filter(r => !(r.method === 'POST' && String(r.match) === String(/\/issued_documents$/))).concat([{
        method: 'POST', match: /\/issued_documents$/, respond: () => (++n === 1 ? { status: 422, body: { error: { message: 'numero duplicato' } } } : { status: 200, body: { data: { id: 778 } } }),
    }]));
    const db = mockDb(CONFIG);
    const h = handlersWith(db, f);
    const body = { mese: '2026-07', righe: RIGHE, intestazione: INTESTAZIONE, approvato: true, scostamentiVerificati: true };
    await assert.rejects(h.creaFattura(body, CALLER), e => /numero duplicato/.test(e.message));
    assert.equal(db.store['fattureFic/2026-07'].stato, 'errore_creazione');
    assert.equal(db.store['fattureFic/2026-07'].ficDocumentId, null);
    const out = await h.creaFattura(body, CALLER);
    assert.equal(out.ficDocumentId, 778);
});

test('handler: validazioni input', async () => {
    const h = handlersWith(mockDb(CONFIG), mockFetch([]));
    const ok = { righe: RIGHE, intestazione: INTESTAZIONE, approvato: true, scostamentiVerificati: true };
    await assert.rejects(h.creaFattura({ ...ok, mese: '07/2026' }, CALLER), e => e.status === 400);
    await assert.rejects(h.creaFattura({ ...ok, mese: '2026-07', intestazione: { ...INTESTAZIONE, scadenza: '2026-08-01' } }, CALLER), e => /scadenza/i.test(e.message));
    await assert.rejects(h.creaFattura({ ...ok, mese: '2026-07', righe: [{ descrizione: 'x', qty: 1, prezzo: '1.00', totale: '9.00' }] }, CALLER), e => /coerente/.test(e.message));
    await assert.rejects(h.creaFattura({ ...ok, mese: '2026-07', totali: { imponibile: '1.00', totale: '1.22' } }, CALLER), e => /non coincidono/.test(e.message));
});

test('buildFicPayload: importi decimali esatti e totale quadrato', () => {
    const righe = Core.righeFromJson(RIGHE);
    const { data, totali } = buildFicPayload({ righe, intestazione: { ...INTESTAZIONE, periodo: 'luglio 2026' }, entity: { id: 1 }, vatId: 7, cfg: Core.mergeConfig() });
    assert.equal(Core.centsToString(totali.totale), data.payments_list[0].amount.toFixed(2));
    assert.equal(data.items_list[1].net_price, 12.61);
    assert.equal(data.currency.id, 'EUR');
});
