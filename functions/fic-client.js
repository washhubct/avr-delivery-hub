'use strict';
// LAST MILE — Client Fatture in Cloud API v2
// Token e company id arrivano SOLO dal chiamante (secrets), mai da costanti.
// Nessun log del token o di dati anagrafici completi.

const BASE_URL = 'https://api-v2.fattureincloud.it';

class FicError extends Error {
    constructor(status, messaggio, dettagli) {
        super(messaggio);
        this.name = 'FicError';
        this.status = status;
        this.dettagli = dettagli || null;
    }
}

// Messaggi comprensibili per l'UI, per codice HTTP
function messaggioPerStatus(status, body) {
    const apiMsg = body && body.error && (body.error.message || body.error.description);
    switch (status) {
        case 401: return 'Token Fatture in Cloud non valido o revocato: rigeneralo da Impostazioni → Applicazioni collegate e aggiorna il secret FIC_TOKEN.';
        case 403: return 'Il token Fatture in Cloud non ha i permessi necessari (servono issued_documents e entities).';
        case 404: return 'Risorsa non trovata su Fatture in Cloud (company id o documento errato): ' + (apiMsg || '');
        case 422: return 'Fatture in Cloud ha rifiutato i dati: ' + (apiMsg || 'errore di validazione');
        case 429: return 'Limite di richieste Fatture in Cloud raggiunto: riprova tra qualche secondo.';
        default:
            if (status >= 500) return 'Fatture in Cloud non risponde (HTTP ' + status + '): riprova più tardi.';
            return 'Errore Fatture in Cloud (HTTP ' + status + '): ' + (apiMsg || '');
    }
}

function estraiValidazione(body) {
    if (!body || !body.error) return null;
    const e = body.error;
    const out = {};
    if (e.validation_result) out.validation_result = e.validation_result;
    if (e.validation) out.validation = e.validation;
    if (e.message) out.message = e.message;
    return Object.keys(out).length ? out : null;
}

/**
 * createFicClient({ token, companyId, fetchImpl, sleep, maxRetries })
 */
function createFicClient(opts) {
    if (!opts || !opts.token) throw new Error('FIC_TOKEN mancante');
    if (!opts.companyId) throw new Error('FIC_COMPANY_ID mancante');
    const token = String(opts.token);
    const companyId = String(opts.companyId);
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const maxRetries = opts.maxRetries === undefined ? 3 : opts.maxRetries;
    const baseUrl = opts.baseUrl || BASE_URL;

    async function request(method, path, body) {
        let attempt = 0;
        for (;;) {
            let res;
            try {
                res = await fetchImpl(baseUrl + path, {
                    method,
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Accept': 'application/json',
                        ...(body ? { 'Content-Type': 'application/json' } : {}),
                    },
                    body: body ? JSON.stringify(body) : undefined,
                });
            } catch (netErr) {
                if (attempt < maxRetries) { attempt++; await sleep(backoff(attempt)); continue; }
                throw new FicError(0, 'Connessione a Fatture in Cloud fallita: ' + netErr.message);
            }
            let json = null;
            const text = await res.text();
            try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }

            if (res.ok) return json;

            // Retry con backoff su 429 e 5xx
            if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
                attempt++;
                const ra = parseInt(res.headers && res.headers.get ? (res.headers.get('Retry-After') || '') : '', 10);
                await sleep(isNaN(ra) ? backoff(attempt) : ra * 1000);
                continue;
            }
            throw new FicError(res.status, messaggioPerStatus(res.status, json), estraiValidazione(json));
        }
    }
    function backoff(attempt) { return Math.min(8000, 500 * Math.pow(2, attempt - 1)); }

    const c = '/c/' + encodeURIComponent(companyId);

    return {
        companyId,
        request,

        async listCompanies() {
            const r = await request('GET', '/user/companies');
            return (r && r.data && r.data.companies) || [];
        },

        // Id aliquota IVA con la percentuale richiesta — MAI hardcodato
        async findVatTypeId(percento) {
            const r = await request('GET', c + '/info/vat_types');
            const list = (r && r.data) || [];
            const wanted = Number(percento);
            const cand = list.filter(v => Number(v.value) === wanted && v.ei_type !== 'N' && v.is_disabled !== true);
            const pick = cand.find(v => v.is_default) || cand[0];
            if (!pick) throw new FicError(422, 'Aliquota IVA ' + wanted + '% non trovata tra le aliquote di Fatture in Cloud: configurala prima.');
            return pick.id;
        },

        async findClientByVat(vatNumber) {
            const q = "vat_number = '" + String(vatNumber).replace(/'/g, '') + "'";
            const r = await request('GET', c + '/entities/clients?fields=id,name,vat_number,tax_code,address_street,address_postal_code,address_city,address_province,country,ei_code,e_invoice&q=' + encodeURIComponent(q));
            const list = (r && r.data) || [];
            return list[0] || null;
        },

        // Ultimo numero usato per anno/numerazione: { "2026": { "": 20 } }
        async getNumerazioni() {
            const r = await request('GET', c + '/issued_documents/info?type=invoice&fieldset=numerations');
            return (r && r.data && r.data.numerations) || {};
        },

        async createInvoice(data) {
            const r = await request('POST', c + '/issued_documents', { data });
            return r && r.data;
        },

        async getInvoice(id) {
            const r = await request('GET', c + '/issued_documents/' + encodeURIComponent(id) + '?fields=id,number,date,ei_status,ei_raw,amount_net,amount_vat,amount_gross');
            return r && r.data;
        },

        // dry_run=true → sola verifica XML lato FIC, nessun invio
        async sendEInvoice(id, dryRun) {
            const r = await request('POST', c + '/issued_documents/' + encodeURIComponent(id) + '/e_invoice/send', {
                data: { options: { dry_run: !!dryRun } },
            });
            return r && r.data;
        },
    };
}

module.exports = { createFicClient, FicError, messaggioPerStatus, BASE_URL };
