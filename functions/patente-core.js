'use strict';
// LAST MILE — Verifica patente: logica pura (testabile senza rete)
//
// L'AI (Claude, visione) estrae i dati dalle foto fronte/retro; qui si decide
// se la patente è VERIFICATA o RESPINTA confrontando con l'anagrafica.
// Nessuna dipendenza: solo funzioni pure.

// Schema JSON che Claude deve restituire (structured output)
const PATENTE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['is_patente', 'leggibile', 'cognome', 'nome', 'numero', 'data_nascita', 'data_rilascio', 'data_scadenza', 'categorie', 'paese', 'note'],
    properties: {
        is_patente: { type: 'boolean', description: 'true se le immagini mostrano una patente di guida (fronte e/o retro)' },
        leggibile: { type: 'boolean', description: 'true se i campi principali (nome, numero, scadenza) sono leggibili con certezza' },
        cognome: { type: 'string', description: 'Campo 1 della patente (cognome), stringa vuota se non leggibile' },
        nome: { type: 'string', description: 'Campo 2 (nome), stringa vuota se non leggibile' },
        numero: { type: 'string', description: 'Campo 5 (numero patente), senza spazi, stringa vuota se non leggibile' },
        data_nascita: { type: 'string', description: 'Campo 3, formato YYYY-MM-DD, vuota se non leggibile' },
        data_rilascio: { type: 'string', description: 'Campo 4a, formato YYYY-MM-DD, vuota se non leggibile' },
        data_scadenza: { type: 'string', description: 'Campo 4b (data di scadenza), formato YYYY-MM-DD, vuota se non leggibile' },
        categorie: { type: 'array', items: { type: 'string' }, description: 'Categorie abilitate lette dal retro (es. B, C, CE); vuoto se il retro non è leggibile' },
        paese: { type: 'string', description: 'Sigla dello stato emittente (es. I, D, RO), vuota se non leggibile' },
        note: { type: 'string', description: 'Eventuali anomalie: foto sfocata, documento tagliato, sospetto fotomontaggio, dati incoerenti tra fronte e retro' },
    },
};

const SYSTEM_PROMPT = 'Sei un sistema di verifica documentale per un\'azienda di logistica italiana. '
    + 'Ricevi le foto (fronte e retro) della patente di guida di un autista e devi trascrivere fedelmente i campi del documento. '
    + 'Regole: trascrivi solo ciò che leggi con certezza, senza indovinare; le date vanno in formato YYYY-MM-DD; '
    + 'il campo 4b è la scadenza del documento (per le patenti italiane in formato carta di credito è la data accanto a "4b"); '
    + 'se un\'immagine non è una patente, o è troppo sfocata/tagliata per leggere nome, numero o scadenza, imposta leggibile=false e spiega in note. '
    + 'Segnala in note qualunque segno di manomissione o incoerenza.';

function norm(s) {
    return String(s || '').toUpperCase()
        .replace(/[ÀÁÂÃÄ]/g, 'A').replace(/[ÈÉÊË]/g, 'E').replace(/[ÌÍÎÏ]/g, 'I')
        .replace(/[ÒÓÔÕÖ]/g, 'O').replace(/[ÙÚÛÜ]/g, 'U')
        .replace(/[^A-Z0-9]/g, '');
}

function isYMD(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z'));
}

// Confronto nome: il cognome del documento deve contenere (o essere contenuto in)
// il cognome in anagrafica; il nome basta che condivida la prima parola.
function nomeCoerente(estratto, anag) {
    const cogDoc = norm(estratto.cognome), cogAnag = norm(anag.cognome);
    if (!cogDoc || !cogAnag) return false;
    const cogOk = cogDoc.includes(cogAnag) || cogAnag.includes(cogDoc);
    if (!cogOk) {
        // Anagrafiche con cognome+nome invertiti o alias: prova con nome+cognome uniti
        const tuttoDoc = norm(estratto.cognome + estratto.nome), tuttoAnag = norm(anag.cognome + (anag.nome || ''));
        return !!tuttoDoc && (tuttoDoc.includes(tuttoAnag) || tuttoAnag.includes(tuttoDoc));
    }
    const nomeAnag = norm(String(anag.nome || '').split(/\s+/)[0]);
    if (!nomeAnag) return true; // anagrafica senza nome: basta il cognome
    const nomeDoc = norm(estratto.nome);
    return !nomeDoc || nomeDoc.includes(nomeAnag) || nomeAnag.includes(nomeDoc);
}

/**
 * valutaPatente(estratto, anag, oggiYMD) → { stato: 'verificata'|'respinta', motivo, numero, scadenza }
 * - respinta se non è una patente / illeggibile / nome diverso / numero o scadenza mancanti / scaduta
 * - in caso di scadenza letta ma passata, ritorna comunque `scadenza` (il documento fa fede)
 */
function valutaPatente(estratto, anag, oggiYMD) {
    const e = estratto || {};
    const numero = norm(e.numero);
    const scadenza = isYMD(e.data_scadenza) ? e.data_scadenza : null;
    if (e.is_patente === false) return { stato: 'respinta', motivo: 'Le foto non mostrano una patente di guida.' + (e.note ? ' ' + e.note : ''), numero: null, scadenza: null };
    if (e.leggibile === false) return { stato: 'respinta', motivo: 'Foto non leggibile: rifalle con buona luce, documento intero e a fuoco.' + (e.note ? ' ' + e.note : ''), numero: null, scadenza: null };
    if (!nomeCoerente(e, anag)) return { stato: 'respinta', motivo: 'Il nome sulla patente (' + [e.cognome, e.nome].filter(Boolean).join(' ') + ') non corrisponde all\'intestatario dell\'account.', numero: null, scadenza: null };
    if (!numero || numero.length < 6) return { stato: 'respinta', motivo: 'Numero della patente (campo 5) non leggibile.', numero: null, scadenza: null };
    if (!scadenza) return { stato: 'respinta', motivo: 'Data di scadenza (campo 4b) non leggibile.', numero, scadenza: null };
    if (scadenza < oggiYMD) return { stato: 'respinta', motivo: 'La patente risulta scaduta il ' + scadenza.split('-').reverse().join('/') + ': va rinnovata.', numero, scadenza };
    return { stato: 'verificata', motivo: null, numero, scadenza };
}

module.exports = { PATENTE_SCHEMA, SYSTEM_PROMPT, valutaPatente, nomeCoerente, norm, isYMD };
