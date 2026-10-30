'use strict';
// LAST MILE — Posta amministrativa: logica pura per l'import automatico di
// buste paga e F24 dalle mail del consulente del lavoro (M&R Consulting).
// Niente rete: testabile con node --test. La parte Gmail sta in gmail-dwd.js,
// l'orchestrazione in index.js (postaNotturna).

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MESI_ABBR = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

function norm(s) {
    return String(s || '').toLowerCase()
        .replace(/[àáâ]/g, 'a').replace(/[èéê]/g, 'e').replace(/[ìíî]/g, 'i').replace(/[òóô]/g, 'o').replace(/[ùúû]/g, 'u');
}

// Mese di competenza dall'oggetto della mail:
//  "INVIO DOCUMENTI MESE LUGLIO 2026" → 2026-07, "Fwd: F24 settembre 26" → 2026-09,
//  "cedolini 09/2026" → 2026-09. null se non determinabile (mai indovinare).
function meseDaOggetto(oggetto) {
    const t = norm(oggetto);
    // nome del mese (anche abbreviato) + anno a 4 o 2 cifre, nell'ordine in cui compaiono
    const re = /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\b\.?\s*(?:del\s*|')?(20\d{2}|\d{2})\b/;
    const m = t.match(re);
    if (m) {
        let i = MESI.indexOf(m[1]); if (i < 0) i = MESI_ABBR.indexOf(m[1]);
        const anno = m[2].length === 4 ? m[2] : '20' + m[2];
        return anno + '-' + String(i + 1).padStart(2, '0');
    }
    const n = t.match(/\b(0?[1-9]|1[0-2])\s*[\/.-]\s*(20\d{2})\b/);
    if (n) return n[2] + '-' + String(Number(n[1])).padStart(2, '0');
    return null;
}

// Le mail con "bozza/bozze" nell'oggetto portano cedolini provvisori
function isBozza(oggetto) { return /\bbozz[ae]\b/i.test(String(oggetto || '')); }

// La mail riguarda cedolini o F24? Il consulente manda dallo stesso indirizzo anche
// UNILAV, contratti, malattie: quelle si ignorano senza scaricare nulla.
function pertinente(oggetto) { return /\b(bust[ae]|cedolin\w*|documenti\s+(del\s+)?mese|f\s*24|quietanz\w*|libro\s+unico|lul)\b/i.test(norm(oggetto)); }

// Tipo di allegato: 'f24' | 'buste' | null (non PDF). Prima il nome file ("F24 …pdf",
// "CEDOLINI …pdf"), poi l'oggetto della mail (lo scanner manda "doc0937….pdf":
// se la mail parla di F24/quietanza è un F24). In dubbio buste paga: quella pipeline
// riconosce da sola le pagine che non sono cedolini.
function tipoAllegato(nomeFile, mimeType, oggetto) {
    const n = norm(nomeFile);
    const pdf = /\.pdf$/.test(n) || /application\/pdf/.test(String(mimeType || ''));
    if (!pdf) return null;
    if (/f\s*24|deleg|quietanz|tribut/.test(n)) return 'f24';
    if (/bust|cedolin|paga|lul|libro/.test(n)) return 'buste';
    if (/f\s*24|quietanz/.test(norm(oggetto))) return 'f24';
    return 'buste';
}

// Mesi vicini (per riconoscere la quietanza di una delega già letta su un altro mese)
function mesiVicini(mese, prima, dopo) {
    const m = String(mese).match(/^(\d{4})-(\d{2})$/); if (!m) return [];
    const out = [];
    for (let k = -(prima || 0); k <= (dopo || 0); k++) {
        if (k === 0) continue;
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + k, 1));
        out.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
    }
    return out;
}

// Stessa delega (stessa scadenza e stesso saldo) già presente in una lista di moduli
function trovaModuloUguale(moduli, m) {
    return (moduli || []).find((x) => x.id !== m.id && String(x.dataVersamento || '') === String(m.dataVersamento || '') && Math.abs((Number(x.saldo) || 0) - (Number(m.saldo) || 0)) < 0.01) || null;
}

// Estrae gli allegati dal payload Gmail (users.messages.get format=full), ricorsivo
// su multipart e su messaggi inoltrati come allegato (message/rfc822).
function allegatiDaPayload(payload) {
    const out = [];
    (function walk(p) {
        if (!p) return;
        const body = p.body || {};
        if (p.filename && body.attachmentId) {
            out.push({ nome: p.filename, mimeType: p.mimeType || '', attachmentId: body.attachmentId, size: Number(body.size) || 0 });
        }
        (p.parts || []).forEach(walk);
    })(payload);
    return out;
}

function header(payload, nome) {
    const h = ((payload && payload.headers) || []).find((x) => String(x.name).toLowerCase() === nome.toLowerCase());
    return h ? h.value : '';
}

// Query Gmail: PDF allegati, dal consulente (anche quando la mail è un inoltro di
// Risorse Umane: l'indirizzo originale resta nel corpo "Da: …" e il termine libero lo trova).
function queryGmail(mittenti, dal) {
    const m = (mittenti || []).map((x) => String(x).trim()).filter(Boolean);
    const parts = ['has:attachment', 'filename:pdf'];
    if (dal) parts.push('after:' + String(dal).replace(/-/g, '/'));
    if (m.length) parts.push('(' + m.map((x) => 'from:' + x).concat(m.map((x) => '"' + x + '"')).join(' OR ') + ')');
    return parts.join(' ');
}

function nomeFileSicuro(nome) {
    return String(nome || 'allegato.pdf').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'allegato.pdf';
}

function etichettaMese(mese) {
    const m = String(mese || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return mese;
    return MESI[Number(m[2]) - 1].toUpperCase() + ' ' + m[1];
}

// Descrizione dell'F24 su Fatture in Cloud: Guido li chiama col mese di scadenza
// ("F24 SETTEMBRE 2026" = pagato il 16/09), si aggiunge il mese di competenza.
function descrizioneF24Fic(modulo, mese) {
    const d = String(modulo.dataVersamento || '');
    const meseScad = /^\d{4}-\d{2}/.test(d) ? etichettaMese(d.slice(0, 7)) : etichettaMese(mese);
    return 'F24 ' + meseScad + ' (retribuzioni ' + etichettaMese(mese).toLowerCase() + ')';
}

// Trova su FIC un F24 già caricato a mano per la stessa delega: stessa scadenza e stesso
// importo; altrimenti stesso mese di scadenza e importo entro 50 € (la quietanza pagata
// qualche giorno dopo porta pochi euro di interessi: non va duplicato).
function trovaTaxFic(taxes, modulo) {
    const data = String(modulo.dataVersamento || ''), saldo = Number(modulo.saldo) || 0;
    const esatto = (taxes || []).find((t) => String(t.due_date || '') === data && Math.abs((Number(t.amount) || 0) - saldo) < 0.01);
    if (esatto) return esatto;
    if (!/^\d{4}-\d{2}/.test(data)) return null;
    return (taxes || []).find((t) => String(t.due_date || '').slice(0, 7) === data.slice(0, 7) && Math.abs((Number(t.amount) || 0) - saldo) <= 50) || null;
}

module.exports = { meseDaOggetto, isBozza, pertinente, tipoAllegato, mesiVicini, trovaModuloUguale, allegatiDaPayload, header, queryGmail, nomeFileSicuro, etichettaMese, descrizioneF24Fic, trovaTaxFic, MESI };
