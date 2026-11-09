'use strict';
// LAST MILE — Richieste di assenza dall'app driver (richiesteAssenza/{id}):
// ferie e permessi passano dall'approvazione del responsabile di
// provincia; la malattia è una comunicazione (numero di protocollo del
// certificato telematico, mai il certificato con la diagnosi) e vale
// subito. Approvate/registrate diventano causali in presenzeDriver.
// Logica pura, testabile con node --test.

const TIPI = {
    ferie: { label: 'Ferie', approvazione: true },
    permesso: { label: 'Permesso', approvazione: true },
    malattia: { label: 'Malattia', approvazione: false },
};
const MAX_GIORNI = 60;

// Giorni da dal ad al compresi (YYYY-MM-DD), [] se non validi o oltre MAX_GIORNI.
function giorniTra(dal, al) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(dal || '') || !re.test(al || '') || al < dal) return [];
    const out = [];
    const d = new Date(dal + 'T12:00:00Z'), fine = new Date(al + 'T12:00:00Z');
    while (d <= fine && out.length <= MAX_GIORNI) {
        out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out.length > MAX_GIORNI ? [] : out;
}

// Stato in cui la richiesta produce causali nelle presenze.
function attiva(r) {
    return !!r && (r.stato === 'approvata' || (r.tipo === 'malattia' && r.stato === 'registrata'));
}

function periodoIt(r) {
    const it = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
    return r.dal === r.al ? 'il ' + it(r.dal) : 'dal ' + it(r.dal) + ' al ' + it(r.al);
}

// Testo push al responsabile per una richiesta nuova.
function pushNuova(r) {
    const t = TIPI[r.tipo] || { label: r.tipo };
    return {
        title: r.tipo === 'malattia' ? 'Malattia comunicata' : t.label + ' da approvare',
        body: (r.driverNome || r.driver || 'Un driver') + ': ' + t.label.toLowerCase() + ' ' + periodoIt(r),
    };
}

// Testo push al driver sull'esito.
function pushEsito(r) {
    const t = TIPI[r.tipo] || { label: r.tipo };
    const esito = r.stato === 'approvata' ? 'approvata ✓' : 'non approvata ✕';
    return {
        title: 'Last Mile Driver',
        body: 'La tua richiesta di ' + t.label.toLowerCase() + ' ' + periodoIt(r) + ' è stata ' + esito + (r.stato === 'rifiutata' && r.motivoRifiuto ? ': ' + r.motivoRifiuto : ''),
    };
}

// Giorni da scrivere / togliere in presenzeDriver passando da prima a dopo.
// Un giorno con causale messa a mano (senza richiestaId o di un'altra
// richiesta) non si tocca: decide il gestionale.
function pianoPresenze(prima, dopo, id, esistenti) {
    esistenti = esistenti || {};
    const metti = attiva(dopo) ? giorniTra(dopo.dal, dopo.al) : [];
    const togli = attiva(prima) ? giorniTra(prima.dal, prima.al).filter((g) => metti.indexOf(g) < 0) : [];
    const libero = (g) => { const e = esistenti[g]; return !e || !e.causale || e.richiestaId === id; };
    return {
        metti: metti.filter(libero),
        togli: togli.filter((g) => esistenti[g] && esistenti[g].richiestaId === id),
        saltati: metti.filter((g) => !libero(g)),
    };
}

module.exports = { TIPI, MAX_GIORNI, giorniTra, attiva, periodoIt, pushNuova, pushEsito, pianoPresenze };
