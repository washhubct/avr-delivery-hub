'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bustepaga-core.js');

const anag = [
    { id: 'a1', cognome: 'BRUNO', nome: 'NICOLÒ', codiceFiscale: 'BRNNCL00A01C351X', email: 'Bruno@x.it', citta: 'CT' },
    { id: 'a2', cognome: 'DI PRIMA', nome: 'SIMONE', codiceFiscale: '' },
    { id: 'a3', cognome: 'ROSSI', nome: 'MARIO' },
    { id: 'a4', cognome: 'ROSSI', nome: 'LUCA' },
];

test('categoria: driver per codice fiscale anche con cognome diverso', () => {
    const c = B.categoriaDipendente({ cognome: 'BRUNO', nome: '', codice_fiscale: 'brnncl00a01c351x' }, anag);
    assert.deepEqual(c, { categoria: 'driver', driverId: 'a1', driverEmail: 'bruno@x.it', citta: 'CT' });
});

test('categoria: driver per cognome unico, cognome ambiguo risolto dal nome', () => {
    assert.equal(B.categoriaDipendente({ cognome: 'Di Prima', nome: 'Simone', codice_fiscale: '' }, anag).driverId, 'a2');
    assert.equal(B.categoriaDipendente({ cognome: 'ROSSI', nome: 'LUCA', codice_fiscale: '' }, anag).driverId, 'a4');
    // ambiguo senza nome → non è un driver certo: finisce in ufficio (da controllare)
    assert.equal(B.categoriaDipendente({ cognome: 'ROSSI', nome: '', codice_fiscale: '' }, anag).categoria, 'ufficio');
});

test('categoria: responsabili e ufficio', () => {
    assert.equal(B.categoriaDipendente({ cognome: 'Rizzuto', nome: 'Alessio', codice_fiscale: '' }, anag).categoria, 'rizzuto');
    assert.equal(B.categoriaDipendente({ cognome: 'FARO', nome: 'ALFIO', codice_fiscale: '' }, anag).categoria, 'faro');
    assert.equal(B.categoriaDipendente({ cognome: 'CASTIGLIA', nome: 'LAURA', codice_fiscale: '' }, anag).categoria, 'ufficio');
});

test('idBusta stabile: CF se c\'è, altrimenti cognome_nome', () => {
    assert.equal(B.idBusta('2026-09', { codice_fiscale: 'BRNNCL00A01C351X', cognome: 'X', nome: 'Y' }), '2026-09_BRNNCL00A01C351X');
    assert.equal(B.idBusta('2026-09', { codice_fiscale: '', cognome: 'Di Prima', nome: 'Simone' }), '2026-09_DI_PRIMA_SIMONE');
});

test('ricalcolaCosti: netti per categoria, solo buste ok', () => {
    const t = B.ricalcolaCosti([
        { stato: 'ok', categoria: 'driver', netto: 1500.5, lordo: 2000, costoAzienda: 0, citta: 'CT' },
        { stato: 'ok', categoria: 'driver', netto: 1400, lordo: 1900, costoAzienda: 2600, citta: 'ME' },
        { stato: 'ok', categoria: 'rizzuto', netto: 1600, lordo: 2100 },
        { stato: 'ok', categoria: 'faro', netto: 2000, lordo: 2700 },
        { stato: 'ok', categoria: 'ufficio', netto: 1200, lordo: 1600 },
        { stato: 'errore', categoria: 'driver', netto: 9999 },
    ]);
    assert.equal(t.compensiDriver, 2900.5);
    assert.equal(t.nettoRizzuto, 1600);
    assert.equal(t.nettoFaro, 2000);
    assert.equal(t.hr, 1200);
    assert.equal(t.nBuste, 5);
    assert.equal(t.nDriver, 2);
    assert.equal(t.lordoTotale, 10300);
    assert.equal(t.costoAziendaTotale, 2600);
    assert.deepEqual(t.perCitta, { CT: 1500.5, ME: 1400 });
});
