'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../leaderboard-core.js');

test('montepremi: 6 cent a consegna, arrotondato ai 10 €, tra 100 e 500', () => {
    assert.equal(L.montepremi(4154), 250);   // Catania settembre
    assert.equal(L.montepremi(1954), 120);   // Messina
    assert.equal(L.montepremi(977), 100);    // Siracusa: sotto il minimo
    assert.equal(L.montepremi(535), 100);    // Palermo
    assert.equal(L.montepremi(0), 100);
    assert.equal(L.montepremi(20000), 500);  // tetto
});

test('ripartisci: 50/30/20 con 5+ driver, 60/40 con 3-4, niente sotto i 3; somma sempre uguale al totale', () => {
    assert.deepEqual(L.ripartisci(250, 9), [125, 75, 50]);
    assert.deepEqual(L.ripartisci(120, 7), [60, 35, 25]);
    assert.deepEqual(L.ripartisci(100, 3), [60, 40]);
    assert.deepEqual(L.ripartisci(100, 4), [60, 40]);
    assert.deepEqual(L.ripartisci(100, 2), []);
    [250, 120, 100, 310, 500].forEach((t) => [3, 5, 8].forEach((n) => assert.equal(L.ripartisci(t, n).reduce((s, x) => s + x, 0), t)));
});

test('premiabile: 12 giorni, zero danni, patente verificata', () => {
    assert.deepEqual(L.premiabile({ giorni: 20, danni: 0, patenteOk: true }), { ok: true, motivi: [] });
    assert.deepEqual(L.premiabile({ giorni: 11, danni: 0, patenteOk: true }).motivi, ['giorni']);
    assert.deepEqual(L.premiabile({ giorni: 20, danni: 1, patenteOk: false }).motivi, ['danni', 'patente']);
});

test('soglia: 85% della media dei mesi con dati; proiezione pro-rata durante il mese', () => {
    const s = L.soglia(2100, [4000, 4200, 0], 15, 30);
    assert.equal(s.mesiStorico, 2);
    assert.equal(s.media, 4100);
    assert.equal(s.richiesto, 3485);
    assert.equal(s.proiezione, 4200);
    assert.equal(s.superata, false);
    assert.equal(s.proiezioneOk, true);
    const fine = L.soglia(3400, [4000], 31, 31);
    assert.equal(fine.proiezione, 3400);
    assert.equal(fine.superata, true);  // 3400 ≥ 3400
    const nuovo = L.soglia(500, [], 10, 31);
    assert.equal(nuovo.richiesto, 0);
    assert.equal(nuovo.superata, true);
});

test('classificaProvincia: posizioni, premi che saltano i non premiabili, totale consegne', () => {
    const drivers = [
        { driver: 'A', consegne: 600, danni: 1, giorni: 25, patenteOk: true, score: 620 },   // primo ma con un danno
        { driver: 'B', consegne: 500, danni: 0, giorni: 24, patenteOk: true, score: 580 },
        { driver: 'C', consegne: 450, danni: 0, giorni: 10, patenteOk: true, score: 530 },   // pochi giorni
        { driver: 'D', consegne: 400, danni: 0, giorni: 22, patenteOk: false, score: 470 },  // patente non verificata
        { driver: 'E', consegne: 300, danni: 0, giorni: 20, patenteOk: true, score: 380 },
        { driver: 'F', consegne: 250, danni: 0, giorni: 18, patenteOk: true, score: 330 },
    ];
    const c = L.classificaProvincia('CT', drivers.slice().reverse(), [2400, 2600], 31, 31);
    assert.equal(c.nome, 'Catania');
    assert.equal(c.consegne, 2500);
    assert.equal(c.montepremi, 150);
    assert.deepEqual(c.importi, [75, 45, 30]);
    assert.deepEqual(c.drivers.map((d) => d.driver), ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.deepEqual(c.premi, [{ posizione: 2, driver: 'B', importo: 75 }, { posizione: 5, driver: 'E', importo: 45 }, { posizione: 6, driver: 'F', importo: 30 }]);
    assert.deepEqual(c.drivers[0].motiviNonPremiabile, ['danni']);
    assert.equal(c.drivers[0].premio, 0);
    assert.equal(c.soglia.richiesto, 2125);
    assert.equal(c.soglia.superata, true);
    const piccola = L.classificaProvincia('SR', drivers.slice(0, 2), [], 31, 31);
    assert.deepEqual(piccola.importi, []);
    assert.deepEqual(piccola.premi, []);
});

test('giorniNelMese', () => {
    assert.equal(L.giorniNelMese('2026-10'), 31);
    assert.equal(L.giorniNelMese('2026-11'), 30);
    assert.equal(L.giorniNelMese('2028-02'), 29);
});
