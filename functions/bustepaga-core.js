'use strict';
// LAST MILE — Buste paga: schema di estrazione (Claude) e logica pura
// (match dipendente → categoria di costo, ricalcolo costiMensili).
// Testabile con node --test, nessuna rete.

const BUSTA_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['is_busta_paga', 'leggibile', 'cognome', 'nome', 'codice_fiscale', 'periodo', 'netto_a_pagare', 'totale_competenze', 'costo_azienda', 'note'],
    properties: {
        is_busta_paga: { type: 'boolean', description: 'true se il documento è un cedolino / busta paga (prospetto paga mensile di un lavoratore)' },
        leggibile: { type: 'boolean', description: 'false se i campi essenziali (nome, periodo, netto) non sono leggibili' },
        cognome: { type: 'string', description: 'Cognome del lavoratore come stampato, stringa vuota se assente' },
        nome: { type: 'string', description: 'Nome del lavoratore, stringa vuota se assente' },
        codice_fiscale: { type: 'string', description: 'Codice fiscale del lavoratore (16 caratteri), stringa vuota se assente' },
        periodo: { type: 'string', description: 'Mese di retribuzione nel formato YYYY-MM (es. "2026-09" per settembre 2026); stringa vuota se non determinabile. Per tredicesima/quattordicesima usa il mese di erogazione.' },
        netto_a_pagare: { type: 'number', description: 'Importo "NETTO A PAGARE" / "NETTO DEL MESE" in euro, 0 se assente' },
        totale_competenze: { type: 'number', description: 'Totale competenze lorde del mese (retribuzione lorda), 0 se assente' },
        costo_azienda: { type: 'number', description: 'Costo complessivo per l\'azienda se stampato sul cedolino (es. "COSTO AZIENDA", "COSTO TOTALE"), altrimenti 0' },
        note: { type: 'string', description: 'SOLO anomalie che l\'ufficio deve sapere, in una frase (max 150 caratteri): più cedolini nello stesso PDF, totali che non tornano, tredicesima/quattordicesima, TFR liquidato, cedolino di conguaglio. Stringa vuota se è tutto regolare. Non commentare il mese atteso né l\'assenza del costo azienda: li gestisce il sistema.' },
    },
};

const SYSTEM_PROMPT = 'Sei l\'addetto amministrativo di una società di logistica italiana (Last Mile SRL). '
    + 'Ricevi il PDF di un cedolino paga (busta paga) emesso dal consulente del lavoro e devi trascrivere fedelmente i dati richiesti. '
    + 'Trascrivi SOLO ciò che è stampato: non stimare, non calcolare importi che non vedi (se il costo azienda non è stampato metti 0). '
    + 'Gli importi sono in euro con separatore decimale italiano (es. 1.234,56 = 1234.56). '
    + 'Il periodo è il mese di competenza della retribuzione indicato sul cedolino (es. "SETTEMBRE 2026" → "2026-09"). '
    + 'Se il PDF contiene più cedolini riporta il primo e segnalalo in note. Se il documento non è un cedolino imposta is_busta_paga=false.';

function norm(s) {
    return String(s || '').toUpperCase().trim()
        .replace(/[ÀÁÂÃ]/g, 'A').replace(/[ÈÉÊË]/g, 'E').replace(/[ÌÍÎÏ]/g, 'I')
        .replace(/[ÒÓÔÕ]/g, 'O').replace(/[ÙÚÛÜ]/g, 'U').replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ');
}

// Categoria di costo del dipendente:
//  'driver'  → anagrafica driver (per codice fiscale, poi cognome+nome)
//  'rizzuto' / 'faro' → responsabili con voce propria nel P&L
//  'ufficio' → tutti gli altri (HR, amministrazione)
function categoriaDipendente(estratto, anagrafica) {
    const cf = norm(estratto.codice_fiscale);
    const cognome = norm(estratto.cognome), nome = norm(estratto.nome);
    let driver = null;
    if (cf.length === 16) driver = anagrafica.find((d) => norm(d.codiceFiscale) === cf) || null;
    if (!driver && cognome) {
        const cand = anagrafica.filter((d) => norm(d.cognome) === cognome);
        driver = cand.length === 1 ? cand[0] : (cand.find((d) => norm(d.nome) === nome || (nome && norm(d.nome).startsWith(nome.split(' ')[0]))) || null);
    }
    if (driver) return { categoria: 'driver', driverId: driver.id || null, driverEmail: (driver.email || '').toLowerCase() || null, citta: String(driver.citta || '').toUpperCase() || null };
    if (cognome === 'RIZZUTO') return { categoria: 'rizzuto', driverId: null, driverEmail: null, citta: null };
    if (cognome === 'FARO') return { categoria: 'faro', driverId: null, driverEmail: null, citta: null };
    return { categoria: 'ufficio', driverId: null, driverEmail: null, citta: null };
}

// Id documento stabile: mese + cognome/nome (o CF) → ricaricare lo stesso cedolino lo sovrascrive
function idBusta(mese, estratto) {
    const cf = norm(estratto.codice_fiscale);
    const chiave = cf.length === 16 ? cf : (norm(estratto.cognome) + '_' + norm(estratto.nome)).replace(/ /g, '_');
    return mese + '_' + (chiave || 'SCONOSCIUTO');
}

// Totali per costiMensili dalla lista buste del mese (solo quelle valide):
// netto a pagare per categoria. Il costo pieno = netti + F24 (contributi e
// ritenute, inserito a mano) → per questo si usa il netto, non il lordo.
function ricalcolaCosti(buste) {
    const t = { compensiDriver: 0, nettoRizzuto: 0, nettoFaro: 0, hr: 0, nBuste: 0, nDriver: 0, nUfficio: 0, lordoTotale: 0, costoAziendaTotale: 0, perCitta: {} };
    buste.forEach((b) => {
        if (b.stato !== 'ok') return;
        const netto = Number(b.netto) || 0;
        t.nBuste++;
        t.lordoTotale += Number(b.lordo) || 0;
        t.costoAziendaTotale += Number(b.costoAzienda) || 0;
        if (b.categoria === 'driver') {
            t.compensiDriver += netto; t.nDriver++;
            const c = b.citta || '?'; // netti driver per città: margine per città con stipendi reali
            t.perCitta[c] = Math.round(((t.perCitta[c] || 0) + netto) * 100) / 100;
        }
        else if (b.categoria === 'rizzuto') t.nettoRizzuto += netto;
        else if (b.categoria === 'faro') t.nettoFaro += netto;
        else { t.hr += netto; t.nUfficio++; }
    });
    Object.keys(t).forEach((k) => { if (typeof t[k] === 'number') t[k] = Math.round(t[k] * 100) / 100; });
    return t;
}

module.exports = { BUSTA_SCHEMA, SYSTEM_PROMPT, categoriaDipendente, idBusta, ricalcolaCosti, norm };
