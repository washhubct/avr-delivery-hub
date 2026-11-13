'use strict';
// LAST MILE — Sync fatture da Fatture in Cloud → fattureMese/{YYYY-MM}
// Logica pura (nessuna rete, nessun Firestore): testabile con node --test.
//
// Il mese di COMPETENZA non è la data della fattura: il saldo consegne di
// agosto è datato 22/09, l'acconto di agosto 02/09, il contributo marketing di
// luglio 14/09. Si legge dal testo (oggetto, descrizioni righe, note); se non
// c'è, per le emesse ad Arena vale il mese precedente alla data, per le
// ricevute il mese della data. Un override manuale vince sempre.

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MESI_ABBR = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, sett: 9, ott: 10, nov: 11, dic: 12 };

// Voci di costo del Report Finanziario a cui si agganciano le fatture ricevute.
const VOCI_COSTO = ['carburante', 'costoMezzi', 'consulenteLavoro', 'finance', 'hr', 'altro'];

function pad2(n) { return String(n).padStart(2, '0'); }

function meseShift(mese, delta) {
    const [y, m] = mese.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1);
}

// "agosto 2026" / "Agosto '26" / "ago 2026" / "08/2026" / "2026-08" → "2026-08"; null se assente.
function meseDaTesto(testo) {
    const t = String(testo || '').toLowerCase();
    if (!t) return null;
    const re = /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|gen|feb|mar|apr|mag|giu|lug|ago|sett|set|ott|nov|dic)\.?\s*'?(\d{4}|\d{2})\b/;
    const m = t.match(re);
    if (m) {
        const idx = MESI.indexOf(m[1]) >= 0 ? MESI.indexOf(m[1]) + 1 : MESI_ABBR[m[1]];
        const anno = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
        if (idx && anno >= 2020 && anno <= 2099) return anno + '-' + pad2(idx);
    }
    // Periodo "dal 01/10/2026 al 15/10/2026" / "01.10.2026 - 31.10.2026" (es. carburante Q8,
    // fatturato a quindicina): mese del periodo; se cavalca due mesi, quello con più giorni
    const r = t.match(/(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\s*(?:al|a|-|–|\/)\s*(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})/);
    if (r) {
        const da = new Date(Date.UTC(+r[3], +r[2] - 1, +r[1])), a = new Date(Date.UTC(+r[6], +r[5] - 1, +r[4]));
        if (!isNaN(da) && !isNaN(a) && a >= da) {
            const giorni = {};
            for (let d = new Date(da); d <= a; d.setUTCDate(d.getUTCDate() + 1)) { const k = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); giorni[k] = (giorni[k] || 0) + 1; }
            return Object.keys(giorni).sort((x, y) => giorni[y] - giorni[x] || x.localeCompare(y))[0];
        }
    }
    // MM/YYYY ma non dentro una data DD/MM/YYYY (es. "del 16/06/2026")
    const n = t.match(/(?<![\d/])(0[1-9]|1[0-2])\/(20\d{2})\b/);
    if (n) return n[2] + '-' + n[1];
    const iso = t.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
    if (iso) return iso[1] + '-' + iso[2];
    return null;
}

function testoDocumento(doc) {
    const parti = [doc.subject, doc.visible_subject, doc.description, doc.notes];
    (doc.items_list || []).forEach((i) => { parti.push(i.name); parti.push(i.description); });
    return parti.filter(Boolean).join(' | ');
}

function num(v) { return Math.round((Number(v) || 0) * 100) / 100; }

// Fattura emessa FIC → riga compatta per fattureMese
function normalizzaEmessa(doc, override) {
    const data = String(doc.date || '').slice(0, 10);
    const meseData = data.slice(0, 7);
    const testo = testoDocumento(doc);
    let meseCompetenza, competenzaFonte;
    if (override && override.meseCompetenza) { meseCompetenza = override.meseCompetenza; competenzaFonte = 'manuale'; }
    else { const mt = meseDaTesto(testo); if (mt) { meseCompetenza = mt; competenzaFonte = 'testo'; } else { meseCompetenza = meseShift(meseData, -1); competenzaFonte = 'mese precedente'; } }
    const descrizione = doc.subject || doc.visible_subject || ((doc.items_list || [])[0] || {}).description || ((doc.items_list || [])[0] || {}).name || '';
    return {
        tipo: 'emessa',
        ficId: doc.id,
        numero: doc.number != null ? String(doc.number) + (doc.numeration ? doc.numeration : '') : '',
        data,
        cliente: (doc.entity && doc.entity.name) || '',
        clienteId: (doc.entity && doc.entity.id) || null,
        descrizione: String(descrizione).slice(0, 200),
        imponibile: num(doc.amount_net),
        iva: num(doc.amount_vat),
        lordo: num(doc.amount_gross),
        statoSdi: doc.ei_status || null,
        meseCompetenza,
        competenzaFonte,
        escludi: !!(override && override.escludi),
    };
}

// Fattura ricevuta FIC → riga compatta. fornitore = config fornitori/{entityId}
// (azienda + voce di default), override = fattureOverride/{ricevuta_<id>}.
function normalizzaRicevuta(doc, fornitore, override) {
    const data = String(doc.date || '').slice(0, 10);
    const meseData = data.slice(0, 7);
    const testo = testoDocumento(doc);
    let meseCompetenza, competenzaFonte;
    if (override && override.meseCompetenza) { meseCompetenza = override.meseCompetenza; competenzaFonte = 'manuale'; }
    else { const mt = meseDaTesto(testo); if (mt) { meseCompetenza = mt; competenzaFonte = 'testo'; } else { meseCompetenza = meseData; competenzaFonte = 'data'; } }
    const descrizione = doc.description || ((doc.items_list || [])[0] || {}).name || doc.category || '';
    const azienda = (override && override.azienda) || (fornitore && fornitore.azienda) || 'da_classificare';
    const voce = (override && override.voce) || (fornitore && fornitore.voce) || 'altro';
    return {
        tipo: 'ricevuta',
        ficId: doc.id,
        numero: doc.invoice_number ? String(doc.invoice_number) : '',
        data,
        fornitore: (doc.entity && doc.entity.name) || '',
        fornitoreId: (doc.entity && doc.entity.id) || null,
        descrizione: String(descrizione).slice(0, 200),
        categoriaFic: doc.category || '',
        imponibile: num(doc.amount_net),
        iva: num(doc.amount_vat),
        lordo: num(doc.amount_gross),
        meseCompetenza,
        competenzaFonte,
        azienda,
        voce: VOCI_COSTO.includes(voce) ? voce : 'altro',
        escludi: !!(override && override.escludi),
    };
}

// Fatture arrivate su FIC ma non ancora registrate (received_documents/pending):
// si registrano solo dopo il pagamento, ma per il P&L contano subito. Entrano
// solo i fornitori dell'elenco (config/fic.fornitoriDaRegistrare), le altre
// arrivate su FIC non riguardano il report. Il dettaglio FIC ha imponibile e IVA
// ma non le righe: il testo per la competenza viene dall'XML della fattura.
const FORNITORI_DA_REGISTRARE = ['M&R CONSULTING', 'FRATELLI ARENA', 'KUWAIT PETROLEUM'];

function nomeChiave(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9&]/g, ''); }

function daRegistrareAmmessa(doc, elenco) {
    const n = nomeChiave(doc && doc.supplier_name);
    return !!n && (elenco && elenco.length ? elenco : FORNITORI_DA_REGISTRARE).some((x) => nomeChiave(x) && n.includes(nomeChiave(x)));
}

// Descrizioni righe e causale dalla FatturaPA (anche dentro un .p7m: i tag restano in chiaro).
function testoDaXml(xml) {
    const out = [];
    const re = /<(?:\w+:)?(Descrizione|Causale)>([^<]{1,300})</g;
    let m;
    while ((m = re.exec(String(xml || ''))) && out.length < 200) {
        const t = m[2].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
        if (t && !out.includes(t)) out.push(t);
    }
    return out;
}

function normalizzaDaRegistrare(doc, righeXml, fornitore, override) {
    righeXml = righeXml || [];
    const r = normalizzaRicevuta({
        id: 'P' + doc.id,
        date: doc.emission_date || doc.date,
        invoice_number: doc.ei_number,
        entity: { name: doc.supplier_name, id: (fornitore && fornitore.id) || null },
        description: righeXml[0] || doc.subject || '',
        notes: righeXml.join(' | '),
        amount_net: doc.amount_net, amount_vat: doc.amount_vat, amount_gross: doc.amount_gross,
    }, fornitore, override);
    // Fornitore in elenco ma non ancora classificato: è un costo Last Mile per definizione
    if (r.azienda === 'da_classificare' && !(override && override.azienda)) r.azienda = 'lastmile';
    r.daRegistrare = true;
    return r;
}

// Raggruppa per mese di competenza e calcola i totali (solo righe non escluse;
// i costi contano solo azienda 'lastmile' + 'da_classificare', così un costo mai
// classificato non sparisce in silenzio: resta visibile da sistemare).
function raggruppaPerMese(emesse, ricevute) {
    const mesi = {};
    const get = (m) => (mesi[m] = mesi[m] || { mese: m, emesse: [], ricevute: [], totali: null });
    emesse.forEach((e) => get(e.meseCompetenza).emesse.push(e));
    ricevute.forEach((r) => get(r.meseCompetenza).ricevute.push(r));
    Object.values(mesi).forEach((m) => {
        m.emesse.sort((a, b) => a.data.localeCompare(b.data) || String(a.numero).localeCompare(String(b.numero)));
        m.ricevute.sort((a, b) => a.data.localeCompare(b.data));
        const t = { ricaviImponibile: 0, ricaviIva: 0, ricaviLordo: 0, costiImponibile: 0, costiIva: 0, costiLordo: 0, costiPerVoce: {}, nEmesse: 0, nRicevute: 0, nDaClassificare: 0 };
        m.emesse.forEach((e) => { if (e.escludi) return; t.ricaviImponibile += e.imponibile; t.ricaviIva += e.iva; t.ricaviLordo += e.lordo; t.nEmesse++; });
        m.ricevute.forEach((r) => {
            if (r.escludi || (r.azienda !== 'lastmile' && r.azienda !== 'da_classificare')) return;
            if (r.azienda === 'da_classificare') t.nDaClassificare++;
            t.costiImponibile += r.imponibile; t.costiIva += r.iva; t.costiLordo += r.lordo; t.nRicevute++;
            t.costiPerVoce[r.voce] = num((t.costiPerVoce[r.voce] || 0) + r.imponibile);
        });
        Object.keys(t).forEach((k) => { if (typeof t[k] === 'number') t[k] = num(t[k]); });
        m.totali = t;
    });
    return mesi;
}

module.exports = { meseDaTesto, meseShift, normalizzaEmessa, normalizzaRicevuta, raggruppaPerMese, VOCI_COSTO, FORNITORI_DA_REGISTRARE, nomeChiave, daRegistrareAmmessa, testoDaXml, normalizzaDaRegistrare };
