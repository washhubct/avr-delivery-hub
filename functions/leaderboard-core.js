'use strict';
// LAST MILE — Classifica per provincia con montepremi legato alle consegne.
// Logica pura (niente Firestore): testabile con node --test. L'orchestrazione
// (lettura rapporti, danni, anagrafica, scrittura dei documenti) sta in index.js.
//
// Regole approvate da Guido il 31/10/2026:
//   • quattro classifiche separate: Catania, Messina, Palermo, Siracusa (Enna esclusa: un solo driver)
//   • montepremi mensile FISSO per provincia (deciso da Guido il 02/11/2026, dagli importi
//     di ottobre 2026): Catania 200 €, Messina 70 €, Palermo 60 €, Siracusa 40 €.
//     Il volume di consegne lo decide il Gruppo Arena, non i driver: niente montepremi
//     legato alle consegne e niente soglia di attivazione.
//   • ripartizione: con 5+ driver 50/30/20 ai primi tre, con 3-4 driver 60/40 ai primi due,
//     con meno di 3 driver niente premi
//   • premiabile solo chi ha zero danni nel mese e patente verificata (niente requisito di giorni:
//     i driver sono dipendenti con orario da contratto, tolto da Guido il 02/11/2026);
//     chi non è premiabile resta in classifica ma il premio passa al successivo
//   • premio: buono carburante Q8 o buono Amazon, a scelta del vincitore
//   • tetto fringe benefit (confermato da Guido il 01/11/2026): massimo 1.000 € di premi
//     per driver nell'anno solare; un premio che supera il residuo viene ridotto al residuo,
//     chi ha già raggiunto il tetto resta in classifica e il premio passa al successivo.
//     Si contano i premi dal primo mese della classifica (attivaDal, 2026-11).

const PROVINCE_PREMI = ['CT', 'ME', 'PA', 'SR'];
const NOME_PROVINCIA = { CT: 'Catania', ME: 'Messina', PA: 'Palermo', SR: 'Siracusa', EN: 'Enna' };

const REGOLE = {
    montepremiProvincia: { CT: 200, ME: 70, PA: 60, SR: 40 },
    minDriverTrePremi: 5,
    minDriverDuePremi: 3,
    quoteTre: [0.5, 0.3, 0.2],
    quoteDue: [0.6, 0.4],
    premio: 'Buono carburante Q8 o buono Amazon, a scelta del vincitore',
    tettoAnnuo: 1000,
    attivaDal: '2026-11',   // primo mese della classifica a premi: prima non si scrivono classifiche di provincia
};

function round5(x) { return Math.round(x / 5) * 5; }

// Montepremi fisso della provincia
function montepremi(provincia, regole) {
    const r = regole || REGOLE;
    return Number((r.montepremiProvincia || {})[provincia]) || 0;
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

// Requisiti per ricevere il premio. `d` = { danni, patenteOk, premiAnno }
// (`premiAnno` = euro di premi già maturati nell'anno, per il tetto fringe benefit)
function premiabile(d, regole) {
    const r = regole || REGOLE;
    const motivi = [];
    if ((Number(d.danni) || 0) > 0) motivi.push('danni');
    if (!d.patenteOk) motivi.push('patente');
    if ((Number(d.premiAnno) || 0) >= r.tettoAnnuo) motivi.push('tetto');
    return { ok: motivi.length === 0, motivi };
}

// Mesi 'YYYY-MM' dell'anno di `mese` che contano per il tetto: da attivaDal (o gennaio) al mese precedente
function mesiTetto(mese, regole) {
    const r = regole || REGOLE;
    const m = String(mese).match(/^(\d{4})-(\d{2})$/);
    if (!m) return [];
    const anno = m[1], out = [];
    for (let k = 1; k < Number(m[2]); k++) {
        const mm = anno + '-' + String(k).padStart(2, '0');
        if (mm >= r.attivaDal) out.push(mm);
    }
    return out;
}

// Classifica di una provincia. `drivers` = voci già ordinate per score, ognuna con
// { driver, consegne, danni, giorni, patenteOk, score, ... }. `premiAnno` = { driver: euro
// già maturati nell'anno }. Restituisce la classifica con posizione, premiabilità e premio
// assegnato (il premio salta chi non è premiabile; viene ridotto se supera il residuo del tetto).
function classificaProvincia(provincia, drivers, regole, premiAnno) {
    const r = regole || REGOLE;
    const anno = premiAnno || {};
    const lista = (drivers || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0))
        .map((d) => Object.assign({}, d, { premiAnno: Number(anno[d.driver]) || 0 }));
    const consegne = lista.reduce((s, d) => s + (Number(d.consegne) || 0), 0);
    const totale = montepremi(provincia, r);
    const importi = ripartisci(totale, lista.length, r);
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
        drivers: out,
    };
}

// Testo della push quotidiana che spinge a segnare le consegne (19:30, lun-sab).
// ctx = { consegneOggi, provincia, classifica: { nome, importi, montepremi, nDriver }, entry: voce del
// driver in classifica (o null), terzoScore, giorniRestanti }. `seed` varia la chiusura di giorno in giorno.
const CHIUSURE = [
    'Continua così 💪',
    'Il podio si costruisce un giorno alla volta 🏆',
    'Zero danni nel mese = +50 punti 🛡️',
    'Segna anche gli orari: la velocità vale fino a +30 punti 🚀',
    'Ogni consegna segnata è un punto in più 📈',
    'Patente verificata nell\'app = premio garantito ✅',
];
const MOTIVI_BREVI = { danni: 'un danno nel mese ti esclude dal premio', patente: 'verifica la patente nell\'app', tetto: 'hai raggiunto il tetto annuo dei premi' };
const plurale = (n, uno, tanti) => `${n} ${n === 1 ? uno : tanti}`;
function messaggioStimolo(ctx, seed) {
    const c = ctx.classifica, e = ctx.entry, n = Number(ctx.consegneOggi) || 0;
    const chiusura = CHIUSURE[(Number(seed) || 0) % CHIUSURE.length];
    const oggiStr = plurale(n, 'consegna segnata', 'consegne segnate');
    if (!c) {
        return n > 0 ? `📦 Oggi ${oggiStr}, grazie! ${chiusura}` : '✍️ Hai consegnato oggi? Segna le consegne nell\'app prima di chiudere la giornata 📦';
    }
    const importi = c.importi || [];
    if (!e) {
        return `🏁 La classifica di ${c.nome} è aperta (montepremi €${c.montepremi}): segna le consegne ogni giorno, ognuna vale 1 punto. ${chiusura}`;
    }
    const motivi = e.motiviNonPremiabile || [];
    let stato;
    if (e.posizione <= importi.length) {
        stato = motivi.length === 0
            ? `in zona premio: €${importi[e.posizione - 1]} 🎁`
            : `in zona premio, ma ${MOTIVI_BREVI[motivi[0]] || 'manca un requisito'}`;
    } else if (importi.length && ctx.terzoScore != null) {
        const gap = Math.max(1, ctx.terzoScore - (e.score || 0) + 1);
        stato = `${plurale(gap, 'punto', 'punti')} dall\'ultimo posto premiato (€${importi[importi.length - 1]})`;
    } else if (!importi.length) {
        stato = `${plurale(e.score || 0, 'punto', 'punti')} · con 3 driver in classifica partono i premi`;
    } else {
        stato = plurale(e.score || 0, 'punto', 'punti');
    }
    const testa = n > 0
        ? `📦 Oggi ${oggiStr}! Sei ${e.posizione}° a ${c.nome}, ${stato}.`
        : `✍️ Hai consegnato oggi? Segna le consegne: ogni consegna è 1 punto. Sei ${e.posizione}° a ${c.nome}, ${stato}.`;
    const coda = ctx.giorniRestanti != null && ctx.giorniRestanti <= 7 ? `Mancano ${ctx.giorniRestanti} giorni a fine mese ⏳` : chiusura;
    return `${testa} ${coda}`;
}

// Giorni nel mese 'YYYY-MM'
function giorniNelMese(mese) {
    const m = String(mese).match(/^(\d{4})-(\d{2})$/);
    if (!m) return 30;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

module.exports = { PROVINCE_PREMI, NOME_PROVINCIA, REGOLE, montepremi, ripartisci, premiabile, mesiTetto, classificaProvincia, messaggioStimolo, giorniNelMese };
