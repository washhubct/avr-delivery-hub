'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../f24-core.js');

const delega = {
    data_versamento: '2026-10-16', codice_fiscale: '06183200879', saldo_finale: 18250.5,
    erario_debito: 9000.5, erario_credito: 0, inps_debito: 10000, inps_credito: 1000, regioni_debito: 200, regioni_credito: 0,
    enti_locali_debito: 50, enti_locali_credito: 0, altri_debito: 0, altri_credito: 0,
    periodi: ['2026-09'], quietanzato: true, note: '',
    tributi: [
        { sezione: 'erario', codice: '1001', periodo: '2026-09', debito: 9000.5, credito: 0 },
        { sezione: 'inps', codice: 'DM10', periodo: '2026-09', debito: 10000, credito: 0 },
        { sezione: 'inps', codice: 'DM10', periodo: '2026-08', debito: 0, credito: 1000 },
        { sezione: 'regioni', codice: '3802', periodo: '2026-09', debito: 200, credito: 0 },
        { sezione: 'enti_locali', codice: '3848', periodo: '2026-09', debito: 50, credito: 0 },
    ],
};

test('id stabile: data + saldo in centesimi; senza data usa la posizione', () => {
    assert.equal(F.idDelega('2026-09', delega, 0), '2026-09_20261016_1825050');
    assert.equal(F.idDelega('2026-09', { data_versamento: '', saldo_finale: 10 }, 2), '2026-09_SENZADATA_1000_2');
});

test('modulo: sezioni, totali, periodi e nessun avviso quando il saldo torna', () => {
    const m = F.moduloDaDelega('2026-09', delega, 0, 'f24/2026-09/x.pdf');
    assert.equal(m.saldo, 18250.5);
    assert.equal(m.totDebiti, 19250.5);
    assert.equal(m.totCrediti, 1000);
    assert.deepEqual(m.sezioni.inps, { debito: 10000, credito: 1000 });
    assert.deepEqual(m.periodi, ['2026-08', '2026-09']);
    assert.equal(m.quietanzato, true);
    assert.deepEqual(m.avvisi, []);
});

test('modulo: avvisi per periodo diverso dal mese e saldo che non torna', () => {
    const m = F.moduloDaDelega('2026-10', Object.assign({}, delega, { saldo_finale: 17000, note: 'ravvedimento' }), 0, 'f');
    assert.equal(m.avvisi.length, 3);
    assert.match(m.avvisi[0], /Periodo di riferimento 2026-08, 2026-09, caricato su 2026-10/);
    assert.match(m.avvisi[1], /non torna/);
    assert.equal(m.avvisi[2], 'ravvedimento');
});

test('modulo: delega a saldo zero segnalata', () => {
    const m = F.moduloDaDelega('2026-09', Object.assign({}, delega, { saldo_finale: 0, inps_credito: 10250.5, erario_credito: 9000.5, periodi: [], tributi: [] }), 0, 'f');
    assert.deepEqual(m.avvisi, ['Delega a saldo zero (compensazione)']);
});

test('riepilogo: totale = somma saldi, per sezione netto crediti', () => {
    const a = F.moduloDaDelega('2026-09', delega, 0, 'f');
    const b = F.moduloDaDelega('2026-09', Object.assign({}, delega, { data_versamento: '2026-10-20', saldo_finale: 300, erario_debito: 0, inps_debito: 0, inps_credito: 0, regioni_debito: 0, enti_locali_debito: 0, altri_debito: 300, tributi: [], periodi: [] }), 0, 'g');
    const r = F.riepilogoF24([a, b]);
    assert.equal(r.n, 2);
    assert.equal(r.totale, 18550.5);
    assert.deepEqual(r.perSezione, { erario: 9000.5, inps: 9000, regioni: 200, enti_locali: 50, altri: 300 });
    assert.deepEqual(F.riepilogoF24([]), { n: 0, totale: 0, perSezione: { erario: 0, inps: 0, regioni: 0, enti_locali: 0, altri: 0 } });
});
