'use strict';
// LAST MILE — Presenze driver: un doc per driver e giorno in
// presenzeDriver/{email}_{YYYY-MM-DD}, ricavato dall'app driver
// (apertura turno in turniDriver + rapporti in reportDriver).
// Solo la presenza, niente ore. Le Cloud Function scrivono i campi app
// (fonti, primoAccesso, presenteApp); il gestionale solo causale e nota.
// Logica pura, testabile con node --test.

// Causali impostabili dal gestionale. 'presente' conferma un giorno senza
// app (es. consegne Arena senza turno); 'non_lavorato' annulla una
// presenza app sbagliata (app aperta nel giorno libero).
const CAUSALI = ['presente', 'ferie', 'malattia', 'permesso', 'riposo', 'assente', 'non_lavorato'];

function idPresenza(email, data) {
    return String(email || '').trim().toLowerCase() + '_' + data;
}

function giornoRoma(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    const d = new Date(v);
    return isNaN(d) ? null : d;
}

// Campi "app" del doc presenza dai turni e rapporti di quel driver in quel giorno.
// anag (facoltativa) = doc driverAnagrafica, fonte preferita per nome e città.
function campiApp({ email, data, turni, rapporti, anag }) {
    turni = turni || []; rapporti = rapporti || [];
    const t0 = turni[0] || {}, r0 = rapporti[0] || {};
    const cognome = String((anag && anag.cognome) || t0.driver || r0.driver || '').toUpperCase();
    const nome = String((anag && anag.nome) || '');
    const orari = turni.map((t) => t.oraInizio).concat(rapporti.map((r) => r.oraInizio)).filter((o) => /^\d{2}:\d{2}$/.test(o || '')).sort();
    return {
        email: String(email).toLowerCase(),
        data,
        mese: data.slice(0, 7),
        driver: cognome,
        driverNome: (cognome + ' ' + nome).trim(),
        citta: String((anag && anag.citta) || t0.citta || r0.area || '').toUpperCase(),
        fonti: { turno: turni.length, rapporto: rapporti.length },
        presenteApp: turni.length + rapporti.length > 0,
        primoAccesso: orari[0] || null,
    };
}

// Esito del giorno per griglia ed export: la causale del gestionale vince
// sull'app; senza causale conta la presenza app.
function esitoGiorno(doc) {
    if (!doc) return null;
    if (doc.causale && CAUSALI.includes(doc.causale)) return doc.causale;
    return doc.presenteApp ? 'presente' : null;
}

// Raggruppa turni e rapporti per chiave presenza (per il recupero storico).
function raggruppa(turni, rapporti) {
    const g = {};
    const slot = (email, data) => (g[idPresenza(email, data)] ||= { email: String(email).toLowerCase(), data, turni: [], rapporti: [] });
    (turni || []).forEach((t) => { if (t.email && /^\d{4}-\d{2}-\d{2}$/.test(t.data || '')) slot(t.email, t.data).turni.push(t); });
    (rapporti || []).forEach((r) => {
        const d = toDate(r.data);
        if (r.driverEmail && d) slot(r.driverEmail, giornoRoma(d)).rapporti.push(r);
    });
    return g;
}

module.exports = { CAUSALI, idPresenza, giornoRoma, toDate, campiApp, esitoGiorno, raggruppa };
