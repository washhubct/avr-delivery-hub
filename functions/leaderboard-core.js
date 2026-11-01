'use strict';
// LAST MILE — Classifica per provincia con montepremi legato alle consegne.
// Logica pura (niente Firestore): testabile con node --test. L'orchestrazione
// (lettura rapporti, danni, anagrafica, scrittura dei documenti) sta in index.js.
//
// Regole approvate da Guido il 31/10/2026:
//   • quattro classifiche separate: Catania, Messina, Palermo, Siracusa (Enna esclusa: un solo driver)
//   • montepremi mensile della provincia = 5 centesimi per consegna dei suoi driver,
//     arrotondato ai 10 €, minimo 40 €, massimo 200 € (così il primo di Catania, la provincia
//     con più ricavi, prende al massimo 100 €; le altre province sono in proporzione alle consegne)
//     — scala ridotta da Guido il 01/11/2026 (prima 6 cent, 100-500 €)
//   • ripartizione: con 5+ driver 50/30/20 ai primi tre, con 3-4 driver 60/40 ai primi due,
//     con meno di 3 driver niente premi
//   • premiabile solo chi ha almeno 12 giorni lavorati, zero danni nel mese e patente verificata;
//     chi non è premiabile resta in classifica ma il premio passa al successivo
//   • i premi si pagano solo se la provincia fa almeno l'85% della media delle consegne
//     dei tre mesi precedenti (i mesi senza dati non contano)
//   • premio: buono carburante Q8 o buono Amazon, a scelta del vincitore
//   • tetto fringe benefit (confermato da Guido il 01/11/2026): massimo 1.000 € di premi
//     per driver nell'anno solare; un premio che supera il residuo viene ridotto al residuo,
//     chi ha già raggiunto il tetto resta in classifica e il premio passa al successivo.
//     Si contano i premi del nuovo sistema (dal 2026-11) dei mesi con soglia superata.

const PROVINCE_PREMI = ['CT', 'ME', 'PA', 'SR'];
const NOME_PROVINCIA = { CT: 'Catania', ME: 'Messina', PA: 'Palermo', SR: 'Siracusa', EN: 'Enna' };

const REGOLE = {
    euroPerConsegna: 0.05,
    montepremiMin: 40,
    montepremiMax: 200,
    minGiorniLavorati: 12,
    sogliaPct: 0.85,
    minDriverTrePremi: 5,
    minDriverDuePremi: 3,
    quoteTre: [0.5, 0.3, 0.2],
    quoteDue: [0.6, 0.4],
    premio: 'Buono carburante Q8 o buono Amazon, a scelta del vincitore',
    tettoAnnuo: 1000,
    tettoDal: '2026-11',
};

function round10(x) { return Math.round(x / 10) * 10; }
function round5(x) { return Math.round(x / 5) * 5; }

// Montepremi della provincia dalle consegne del mese
function montepremi(consegne, regole) {
    const r = regole || REGOLE;
    const grezzo = round10((Number(consegne) || 0) * r.euroPerConsegna);
    return Math.min(r.montepremiMax, Math.max(r.montepremiMin, grezzo));
}

// Importi dei premi (1°, 2°, 3°): arrotondati ai 5 €, il resto va al primo
function ripartisci(totale, nDriver, regole) {
    const r = regole || REGOLE;
    let quote;
    if (nDriver >= r.minDriverTrePremi) quote = r.quoteTre;
    else if (nDriver >= r.minDriverDuePremi) quote = r.quoteDue;
    else return [];
    const altri = quote.slice(1).map((q) => round5(totale * q));
    const primo = totale - altri.reduce((s, x) => s + x, 0);
    return [primo].concat(altri);
}

// Requisiti per ricevere il premio. `d` = { giorni, danni, patenteOk, premiAnno }
// (`premiAnno` = euro di premi già maturati nell'anno, per il tetto fringe benefit)
function premiabile(d, regole) {
    const r = regole || REGOLE;
    const motivi = [];
    if ((Number(d.giorni) || 0) < r.minGiorniLavorati) motivi.push('giorni');
    if ((Number(d.danni) || 0) > 0) motivi.push('danni');
    if (!d.patenteOk) motivi.push('patente');
    if ((Number(d.premiAnno) || 0) >= r.tettoAnnuo) motivi.push('tetto');
    return { ok: motivi.length === 0, motivi };
}

// Mesi 'YYYY-MM' dell'anno di `mese` che contano per il tetto: da tettoDal (o gennaio) al mese precedente
function mesiTetto(mese, regole) {
    const r = regole || REGOLE;
    const m = String(mese).match(/^(\d{4})-(\d{2})$/);
    if (!m) return [];
    const anno = m[1], out = [];
    for (let k = 1; k < Number(m[2]); k++) {
        const mm = anno + '-' + String(k).padStart(2, '0');
        if (mm >= r.tettoDal) out.push(mm);
    }
    return out;
}

// Soglia di attivazione: consegne del mese contro l'85% della media dei mesi precedenti.
// `storico` = consegne della provincia nei mesi precedenti (si ignorano quelli a zero).
// Durante il mese la proiezione riporta il parziale a fine mese (pro-rata sui giorni).
function soglia(consegne, storico, giornoDelMese, giorniNelMese, regole) {
    const r = regole || REGOLE;
    const validi = (storico || []).map(Number).filter((x) => x > 0);
    const media = validi.length ? Math.round(validi.reduce((s, x) => s + x, 0) / validi.length) : 0;
    const richiesto = Math.round(media * r.sogliaPct);
    const g = Math.max(1, Number(giornoDelMese) || 1), n = Math.max(g, Number(giorniNelMese) || g);
    const proiezione = Math.round((Number(consegne) || 0) * n / g);
    return {
        mesiStorico: validi.length,
        media,
        richiesto,
        consegne: Number(consegne) || 0,
        proiezione,
        superata: (Number(consegne) || 0) >= richiesto,
        proiezioneOk: proiezione >= richiesto,
    };
}

// Classifica di una provincia. `drivers` = voci già ordinate per score, ognuna con
// { driver, consegne, danni, giorni, patenteOk, score, ... }. `premiAnno` = { driver: euro
// già maturati nell'anno }. Restituisce la classifica con posizione, premiabilità e premio
// assegnato (il premio salta chi non è premiabile; viene ridotto se supera il residuo del tetto).
function classificaProvincia(provincia, drivers, storico, giornoDelMese, giorniNelMese, regole, premiAnno) {
    const r = regole || REGOLE;
    const anno = premiAnno || {};
    const lista = (drivers || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0))
        .map((d) => Object.assign({}, d, { premiAnno: Number(anno[d.driver]) || 0 }));
    const consegne = lista.reduce((s, d) => s + (Number(d.consegne) || 0), 0);
    const totale = montepremi(consegne, r);
    const importi = ripartisci(totale, lista.length, r);
    const sog = soglia(consegne, storico, giornoDelMese, giorniNelMese, r);
    let k = 0;
    const out = lista.map((d, i) => {
        const p = premiabile(d, r);
        let premio = 0, premioPieno = 0;
        if (p.ok && k < importi.length) {
            premioPieno = importi[k]; k++;
            premio = Math.min(premioPieno, r.tettoAnnuo - d.premiAnno);
        }
        return Object.assign({}, d, {
            posizione: i + 1, premiabile: p.ok, motiviNonPremiabile: p.motivi, premio,
            premioRidotto: premio > 0 && premio < premioPieno,
        });
    });
    return {
        provincia,
        nome: NOME_PROVINCIA[provincia] || provincia,
        nDriver: lista.length,
        consegne,
        montepremi: totale,
        importi,
        premi: out.filter((d) => d.premio > 0).map((d) => ({ posizione: d.posizione, driver: d.driver, importo: d.premio, ridotto: d.premioRidotto })),
        soglia: sog,
        drivers: out,
    };
}

// Giorni nel mese 'YYYY-MM'
function giorniNelMese(mese) {
    const m = String(mese).match(/^(\d{4})-(\d{2})$/);
    if (!m) return 30;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

module.exports = { PROVINCE_PREMI, NOME_PROVINCIA, REGOLE, montepremi, ripartisci, premiabile, mesiTetto, soglia, classificaProvincia, giorniNelMese };
