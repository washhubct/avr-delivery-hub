'use strict';
// LAST MILE — Handler fatturazione elettronica (logica pura, dipendenze iniettate)
//
// Stato documento Firestore `fattureFic/{mese}` (mese = 'YYYY-MM'):
//   approvata  → approvazione registrata, creazione su FIC non riuscita (retry = ricrea)
//   creata     → bozza creata su FIC (ficDocumentId presente). Retry invio non ricrea.
//   dryrun_ok  → verifica XML passata
//   inviata    → inviata allo SDI
//   errore_*   → ultimo errore in `ultimoErrore`, stato precedente in `statoPrecedente`
//
// Nessun invio allo SDI può partire senza: body.approvato === true (creazione)
// e doc.approvataDa valorizzato (invio). Ogni azione viene loggata in `log[]`.

const Core = require('./fic-core.js');
const { FicError } = require('./fic-client.js');

const STATI_INVIABILI = ['creata', 'dryrun_ok', 'errore_dryrun', 'errore_invio'];

class HttpError extends Error {
    constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || null; }
}

function validaMese(m) {
    if (typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HttpError(400, 'Mese non valido (atteso YYYY-MM)');
    return m;
}
function validaData(d, label) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + 'T00:00:00Z'))) throw new HttpError(400, label + ' non valida (atteso YYYY-MM-DD)');
    return d;
}

// Costruisce il payload FIC a partire dalle righe già validate
function buildFicPayload({ righe, intestazione, entity, vatId, cfg }) {
    const tot = Core.totali(righe, cfg.ivaPercento);
    const items = righe.map(r => ({
        name: r.descrizione,
        qty: r.qty,
        measure: cfg.misura,
        net_price: Core.centsToNumber(r.prezzoCents),
        vat: { id: vatId },
    }));
    const data = {
        type: 'invoice',
        entity,
        date: intestazione.data,
        number: intestazione.numero,
        currency: { id: 'EUR' },
        e_invoice: true,
        ei_data: { payment_method: cfg.eiPaymentMethod, vat_kind: cfg.eiVatKind },
        items_list: items,
        payments_list: [{
            amount: Core.centsToNumber(tot.totale),
            due_date: intestazione.scadenza,
            status: 'not_paid',
            payment_terms: { days: cfg.scadenzaGiorni, type: 'standard' },
        }],
        payment_method: intestazione.metodoPagamento ? { name: intestazione.metodoPagamento } : undefined,
        visible_subject: 'Consegne a domicilio ' + intestazione.periodo,
    };
    if (intestazione.numerazione) data.numeration = intestazione.numerazione;
    return { data, totali: tot };
}

/**
 * deps: { db, fic (client|null → creato lazy via getFic()), getFic, now(), cfg (config/fic merged) }
 */
function createHandlers(deps) {
    const { db } = deps;
    const now = deps.now || (() => new Date().toISOString());

    async function loadConfig() {
        const snap = await db.collection('config').doc('fic').get();
        const stored = snap.exists ? snap.data() : {};
        return { cfg: Core.mergeConfig(stored.core || {}), cliente: stored.cliente || null };
    }

    function logEntry(caller, azione, extra) {
        return Object.assign({ ts: now(), uid: caller.uid, email: caller.email, azione }, extra || {});
    }

    // ── 1. Approva + crea bozza su FIC ──────────────────────────────
    async function creaFattura(body, caller) {
        if (body.approvato !== true) throw new HttpError(400, 'Approvazione esplicita mancante: nessuna fattura viene creata senza approvazione.');
        if (body.scostamentiVerificati !== true) throw new HttpError(400, 'Devi confermare di aver verificato gli scostamenti.');
        const mese = validaMese(body.mese);
        const it = body.intestazione || {};
        validaData(it.data, 'Data fattura');
        validaData(it.scadenza, 'Scadenza');
        if (it.scadenza < it.data) throw new HttpError(400, 'La scadenza precede la data fattura');
        if (typeof it.numero !== 'string' || !it.numero.trim()) throw new HttpError(400, 'Numero fattura mancante');
        const righe = Core.righeFromJson(body.righe);
        if (righe.length === 0) throw new HttpError(400, 'Nessuna riga in fattura');
        if (righe.length > 500) throw new HttpError(400, 'Troppe righe');

        const { cfg, cliente } = await loadConfig();
        if (!cliente || !cliente.piva) throw new HttpError(500, 'Configurazione cliente mancante: imposta config/fic.cliente.piva in Firestore');

        const ref = db.collection('fattureFic').doc(mese);
        const snap = await ref.get();
        const esistente = snap.exists ? snap.data() : null;
        if (esistente && esistente.ficDocumentId) {
            throw new HttpError(409, 'Fattura ' + mese + ' già creata su Fatture in Cloud (id ' + esistente.ficDocumentId + ', stato ' + esistente.stato + '). Usa "Invia allo SDI" o "Aggiorna stato".');
        }

        const tot = Core.totali(righe, cfg.ivaPercento);
        // Cross-check con i totali dichiarati dal client (se inviati)
        if (body.totali) {
            const dichiarati = body.totali;
            if (Core.centsToString(tot.imponibile) !== String(dichiarati.imponibile) || Core.centsToString(tot.totale) !== String(dichiarati.totale)) {
                throw new HttpError(400, 'I totali ricalcolati dal server non coincidono con l\'anteprima: ricarica il file.');
            }
        }
        const [mAnno, mMese] = mese.split('-').map(Number);
        const intestazione = {
            numero: it.numero.trim(),
            numerazione: it.numerazione ? String(it.numerazione).trim() : null,
            data: it.data,
            scadenza: it.scadenza,
            metodoPagamento: it.metodoPagamento || cfg.metodoPagamento,
            periodo: Core.labelMese(mMese, mAnno),
        };
        const totaliStr = { imponibile: Core.centsToString(tot.imponibile), iva: Core.centsToString(tot.iva), totale: Core.centsToString(tot.totale) };

        // Registra approvazione PRIMA della chiamata esterna (audit anche se FIC fallisce)
        const base = {
            mese, stato: 'approvata', intestazione, righe: Core.righeToJson(righe), totali: totaliStr,
            scostamenti: Array.isArray(body.scostamenti) ? body.scostamenti.slice(0, 100) : [],
            approvataDa: caller.email, approvataUid: caller.uid, approvataIl: now(),
            ficDocumentId: null, eiStatus: null, ultimoErrore: null,
            log: [...((esistente && esistente.log) || []), logEntry(caller, 'approvazione', { numero: intestazione.numero, totale: totaliStr.totale, righe: righe.length })],
        };
        await ref.set(base);

        const fic = await deps.getFic();
        let vatId, entity;
        try {
            vatId = await fic.findVatTypeId(cfg.ivaPercento);
            const cl = await fic.findClientByVat(cliente.piva);
            if (cl) entity = { id: cl.id };
            else {
                if (!cliente.ragioneSociale || !cliente.eiCode) throw new HttpError(500, 'Cliente P.IVA ' + cliente.piva + ' non trovato su FIC e anagrafica config/fic.cliente incompleta (ragioneSociale, eiCode).');
                entity = {
                    name: cliente.ragioneSociale, vat_number: cliente.piva, tax_code: cliente.codiceFiscale || cliente.piva,
                    address_street: cliente.indirizzo || '', address_postal_code: cliente.cap || '', address_city: cliente.citta || '',
                    address_province: cliente.provincia || '', country: 'Italia', e_invoice: true, ei_code: cliente.eiCode,
                };
            }
            const { data } = buildFicPayload({ righe, intestazione, entity, vatId, cfg });
            const created = await fic.createInvoice(data);
            if (!created || !created.id) throw new FicError(500, 'Fatture in Cloud non ha restituito l\'id del documento');
            await ref.update({
                stato: 'creata', ficDocumentId: created.id, ficNumero: created.number || null, ficUrl: created.url || null,
                ficAmount: { net: created.amount_net ?? null, vat: created.amount_vat ?? null, gross: created.amount_gross ?? null },
                log: [...base.log, logEntry(caller, 'creata_fic', { ficDocumentId: created.id })],
            });
            // Controllo quadratura: FIC deve confermare lo stesso totale
            const warn = [];
            if (created.amount_gross !== undefined && created.amount_gross !== null && Core.centsToString(Core.toCents(created.amount_gross)) !== totaliStr.totale) {
                warn.push('ATTENZIONE: totale FIC ' + created.amount_gross + ' ≠ totale calcolato ' + totaliStr.totale);
            }
            return { ok: true, stato: 'creata', ficDocumentId: created.id, totali: totaliStr, avvisi: warn };
        } catch (e) {
            const msg = e.message || String(e);
            await ref.update({ stato: 'errore_creazione', ultimoErrore: { ts: now(), messaggio: msg, dettagli: e.dettagli || null }, log: [...base.log, logEntry(caller, 'errore_creazione', { messaggio: msg })] });
            if (e instanceof HttpError) throw e;
            throw new HttpError(e.status && e.status >= 400 ? 502 : 500, msg, e.dettagli || null);
        }
    }

    // ── 2. Dry-run + invio SDI ───────────────────────────────────────
    async function inviaSdi(body, caller) {
        const mese = validaMese(body.mese);
        if (body.approvato !== true) throw new HttpError(400, 'Conferma di invio mancante.');
        const ref = db.collection('fattureFic').doc(mese);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpError(404, 'Nessuna fattura per ' + mese + ': crea prima la bozza.');
        const doc = snap.data();
        if (!doc.approvataDa) throw new HttpError(403, 'Fattura non approvata: invio bloccato.');
        if (!doc.ficDocumentId) throw new HttpError(409, 'Bozza non ancora creata su Fatture in Cloud.');
        if (doc.stato === 'inviata') throw new HttpError(409, 'Fattura già inviata allo SDI (stato ' + (doc.eiStatus || 'n/d') + ').');
        if (!STATI_INVIABILI.includes(doc.stato)) throw new HttpError(409, 'Stato ' + doc.stato + ' non inviabile.');

        const fic = await deps.getFic();
        const log = doc.log || [];
        // Dry-run obbligatorio
        try {
            await fic.sendEInvoice(doc.ficDocumentId, true);
            log.push(logEntry(caller, 'dryrun_ok'));
            await ref.update({ stato: 'dryrun_ok', ultimoErrore: null, log });
        } catch (e) {
            log.push(logEntry(caller, 'errore_dryrun', { messaggio: e.message }));
            await ref.update({ stato: 'errore_dryrun', ultimoErrore: { ts: now(), messaggio: e.message, dettagli: e.dettagli || null }, log });
            throw new HttpError(422, 'Verifica XML fallita: ' + e.message, e.dettagli || null);
        }
        if (body.soloVerifica === true) return { ok: true, stato: 'dryrun_ok' };

        // Invio reale
        try {
            const r = await fic.sendEInvoice(doc.ficDocumentId, false);
            log.push(logEntry(caller, 'inviata_sdi'));
            let eiStatus = null;
            try { const inv = await fic.getInvoice(doc.ficDocumentId); eiStatus = inv && inv.ei_status ? inv.ei_status : null; } catch (e2) { /* stato aggiornabile dopo */ }
            await ref.update({ stato: 'inviata', inviataDa: caller.email, inviataIl: now(), eiStatus, ultimoErrore: null, ficSendResult: r || null, log });
            return { ok: true, stato: 'inviata', eiStatus };
        } catch (e) {
            log.push(logEntry(caller, 'errore_invio', { messaggio: e.message }));
            await ref.update({ stato: 'errore_invio', ultimoErrore: { ts: now(), messaggio: e.message, dettagli: e.dettagli || null }, log });
            throw new HttpError(502, 'Invio allo SDI fallito: ' + e.message, e.dettagli || null);
        }
    }

    // ── 3. Stato ─────────────────────────────────────────────────────
    async function stato(body) {
        const mese = validaMese(body.mese);
        const ref = db.collection('fattureFic').doc(mese);
        const snap = await ref.get();
        if (!snap.exists) return { ok: true, esiste: false };
        const doc = snap.data();
        let eiStatus = doc.eiStatus || null, eiRaw = null;
        if (doc.ficDocumentId && body.refresh !== false) {
            try {
                const fic = await deps.getFic();
                const inv = await fic.getInvoice(doc.ficDocumentId);
                if (inv) {
                    eiStatus = inv.ei_status || eiStatus;
                    eiRaw = inv.ei_raw || null;
                    const upd = { eiStatus };
                    if (eiRaw && eiRaw.errors) upd.eiErrori = eiRaw.errors;
                    await ref.update(upd);
                }
            } catch (e) {
                return { ok: true, esiste: true, stato: doc.stato, eiStatus, ultimoErrore: doc.ultimoErrore, avviso: 'Stato FIC non aggiornabile: ' + e.message, doc: pubblico(doc) };
            }
        }
        return { ok: true, esiste: true, stato: doc.stato, eiStatus, eiErrori: eiRaw && eiRaw.errors ? eiRaw.errors : (doc.eiErrori || null), ultimoErrore: doc.ultimoErrore || null, doc: pubblico(doc) };
    }

    function pubblico(doc) {
        return {
            mese: doc.mese, stato: doc.stato, intestazione: doc.intestazione, totali: doc.totali, righe: doc.righe,
            approvataDa: doc.approvataDa, approvataIl: doc.approvataIl, inviataDa: doc.inviataDa || null, inviataIl: doc.inviataIl || null,
            ficDocumentId: doc.ficDocumentId, ficNumero: doc.ficNumero || null, ficUrl: doc.ficUrl || null, eiStatus: doc.eiStatus || null,
            ultimoErrore: doc.ultimoErrore || null, log: (doc.log || []).slice(-20),
        };
    }

    return { creaFattura, inviaSdi, stato, buildFicPayload };
}

module.exports = { createHandlers, buildFicPayload, HttpError, STATI_INVIABILI };
