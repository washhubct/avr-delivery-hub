'use strict';
// LAST MILE — F24: schema di estrazione (Claude) e logica pura
// (id stabile per modello, riepilogo per costiMensili). Testabile con node --test.
//
// Un PDF può contenere più deleghe F24 (il consulente spesso manda in un unico
// file F24 ordinario + F24 per l'INAIL o le addizionali): per questo il modello
// restituisce una LISTA di deleghe. Ogni delega va in costiMensili/{mese}.f24Doc.moduli[],
// il campo costiMensili/{mese}.f24 = somma dei saldi (al netto dei crediti compensati).

const SEZIONI = ['erario', 'inps', 'regioni', 'enti_locali', 'altri'];

const DELEGA_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['data_versamento', 'codice_fiscale', 'saldo_finale', 'erario_debito', 'erario_credito', 'inps_debito', 'inps_credito', 'regioni_debito', 'regioni_credito', 'enti_locali_debito', 'enti_locali_credito', 'altri_debito', 'altri_credito', 'periodi', 'tributi', 'quietanzato', 'note'],
    properties: {
        data_versamento: { type: 'string', description: 'Data di versamento / scadenza della delega in formato YYYY-MM-DD, stringa vuota se assente' },
        codice_fiscale: { type: 'string', description: 'Codice fiscale / partita IVA del contribuente, stringa vuota se assente' },
        saldo_finale: { type: 'number', description: 'SALDO FINALE della delega (importo effettivamente versato: totale debiti meno crediti compensati), in euro' },
        erario_debito: { type: 'number', description: 'Sezione ERARIO: totale importi a debito, 0 se assente' },
        erario_credito: { type: 'number', description: 'Sezione ERARIO: totale importi a credito compensati, 0 se assente' },
        inps_debito: { type: 'number', description: 'Sezione INPS: totale importi a debito, 0 se assente' },
        inps_credito: { type: 'number', description: 'Sezione INPS: totale importi a credito compensati, 0 se assente' },
        regioni_debito: { type: 'number', description: 'Sezione REGIONI: totale importi a debito, 0 se assente' },
        regioni_credito: { type: 'number', description: 'Sezione REGIONI: totale importi a credito, 0 se assente' },
        enti_locali_debito: { type: 'number', description: 'Sezione IMU E ALTRI TRIBUTI LOCALI: totale a debito, 0 se assente' },
        enti_locali_credito: { type: 'number', description: 'Sezione IMU E ALTRI TRIBUTI LOCALI: totale a credito, 0 se assente' },
        altri_debito: { type: 'number', description: 'Sezione ALTRI ENTI PREVIDENZIALI E ASSICURATIVI (INAIL ecc.): totale a debito, 0 se assente' },
        altri_credito: { type: 'number', description: 'Sezione ALTRI ENTI: totale a credito, 0 se assente' },
        periodi: { type: 'array', items: { type: 'string' }, description: 'Periodi di riferimento distinti presenti nella delega, formato YYYY-MM (es. "09/2026" o "0009 2026" → "2026-09"); vuoto se assenti' },
        tributi: {
            type: 'array',
            description: 'Una riga per ogni tributo/causale stampata nella delega',
            items: {
                type: 'object', additionalProperties: false,
                required: ['sezione', 'codice', 'periodo', 'debito', 'credito'],
                properties: {
                    sezione: { type: 'string', enum: SEZIONI, description: 'Sezione della delega in cui compare la riga' },
                    codice: { type: 'string', description: 'Codice tributo / causale contributo (es. 1001, 1712, 3802, DM10, CXX), stringa vuota se assente' },
                    periodo: { type: 'string', description: 'Periodo di riferimento della riga in YYYY-MM, stringa vuota se assente' },
                    debito: { type: 'number', description: 'Importo a debito in euro, 0 se assente' },
                    credito: { type: 'number', description: 'Importo a credito in euro, 0 se assente' },
                },
            },
        },
        quietanzato: { type: 'boolean', description: 'true se il documento è una quietanza / ricevuta di pagamento (versamento eseguito), false se è la delega da pagare' },
        note: { type: 'string', description: 'SOLO anomalie utili all\'ufficio in una frase (max 150 caratteri): saldo che non torna con le sezioni, delega a saldo zero per compensazione, ravvedimento. Stringa vuota se è tutto regolare.' },
    },
};

const F24_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['is_f24', 'leggibile', 'deleghe', 'note'],
    properties: {
        is_f24: { type: 'boolean', description: 'true se il documento contiene almeno un modello F24 (delega di pagamento unificato o sua quietanza)' },
        leggibile: { type: 'boolean', description: 'false se saldo e sezioni non sono leggibili' },
        deleghe: { type: 'array', description: 'Una voce per ogni delega F24 distinta presente nel PDF (una delega = un SALDO FINALE). Se delega e quietanza della stessa delega sono entrambe presenti, riportala una volta sola.', items: DELEGA_SCHEMA },
        note: { type: 'string', description: 'Anomalie a livello di documento (es. pagine non F24 incluse), stringa vuota se nessuna' },
    },
};

const SYSTEM_PROMPT = 'Sei l\'addetto amministrativo di una società di logistica italiana (Last Mile SRL). '
    + 'Ricevi il PDF di uno o più modelli F24 (delega di pagamento unificato, o la relativa quietanza della banca) preparati dal consulente del lavoro: contributi INPS, ritenute IRPEF dei dipendenti (codici 1001, 1012, 1040…), addizionali regionali e comunali (3802, 3848…), INAIL, IVA. '
    + 'Trascrivi SOLO ciò che è stampato: non stimare. Gli importi sono in euro con separatore decimale italiano (1.234,56 = 1234.56). '
    + 'Per ogni delega riporta il SALDO FINALE (quello che viene addebitato), i totali a debito e a credito di ogni sezione e una riga per ogni tributo. '
    + 'I periodi di riferimento sono stampati come MM/AAAA o "mese anno": convertili in YYYY-MM. '
    + 'Se il PDF contiene più deleghe elencale tutte; se una delega è ripetuta come quietanza, contala una sola volta e imposta quietanzato=true. '
    + 'Se il documento non è un F24 imposta is_f24=false.';

const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

// Id stabile per delega: data + saldo in centesimi (ricaricare lo stesso F24 lo sovrascrive).
// Se la data manca, si usa la posizione nel file.
function idDelega(mese, d, indice) {
    const data = String(d.data_versamento || '').replace(/-/g, '');
    const cents = Math.round((Number(d.saldo_finale) || 0) * 100);
    return mese + '_' + (data || 'SENZADATA') + '_' + cents + (data ? '' : '_' + (indice || 0));
}

// Normalizza la delega estratta nel modulo salvato in costiMensili.f24Doc.moduli[]
function moduloDaDelega(mese, d, indice, file, extra) {
    const sezioni = {};
    SEZIONI.forEach((s) => { sezioni[s] = { debito: r2(d[s + '_debito']), credito: r2(d[s + '_credito']) }; });
    const totDebiti = r2(SEZIONI.reduce((a, s) => a + sezioni[s].debito, 0));
    const totCrediti = r2(SEZIONI.reduce((a, s) => a + sezioni[s].credito, 0));
    const saldo = r2(d.saldo_finale);
    const avvisi = [];
    const periodi = Array.from(new Set([...(d.periodi || []), ...(d.tributi || []).map((t) => t.periodo)].filter((p) => /^\d{4}-\d{2}$/.test(p)))).sort();
    if (periodi.length && !periodi.includes(mese)) avvisi.push('Periodo di riferimento ' + periodi.join(', ') + ', caricato su ' + mese);
    if (totDebiti > 0 && Math.abs(totDebiti - totCrediti - saldo) > 0.5) avvisi.push('Il saldo (' + saldo.toFixed(2) + ') non torna con le sezioni (debiti ' + totDebiti.toFixed(2) + ' − crediti ' + totCrediti.toFixed(2) + ')');
    if (saldo === 0) avvisi.push('Delega a saldo zero (compensazione)');
    if (d.note) avvisi.push(d.note);
    return Object.assign({
        id: idDelega(mese, d, indice), file, mese,
        dataVersamento: d.data_versamento || null, codiceFiscale: (d.codice_fiscale || '').toUpperCase(),
        saldo, totDebiti, totCrediti, sezioni, periodi,
        tributi: (d.tributi || []).map((t) => ({ sezione: t.sezione, codice: t.codice || '', periodo: t.periodo || '', debito: r2(t.debito), credito: r2(t.credito) })),
        quietanzato: !!d.quietanzato, avvisi,
    }, extra || {});
}

// Riepilogo del mese: totale F24 (= costiMensili.f24) e somma per sezione (a debito, netto crediti)
function riepilogoF24(moduli) {
    const perSezione = {};
    SEZIONI.forEach((s) => { perSezione[s] = 0; });
    let totale = 0;
    (moduli || []).forEach((m) => {
        totale += Number(m.saldo) || 0;
        SEZIONI.forEach((s) => { const x = (m.sezioni && m.sezioni[s]) || {}; perSezione[s] += (Number(x.debito) || 0) - (Number(x.credito) || 0); });
    });
    SEZIONI.forEach((s) => { perSezione[s] = r2(perSezione[s]); });
    return { n: (moduli || []).length, totale: r2(totale), perSezione };
}

module.exports = { F24_SCHEMA, SYSTEM_PROMPT, SEZIONI, idDelega, moduloDaDelega, riepilogoF24 };
