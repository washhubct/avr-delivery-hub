'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../leaderboard-core.js');

test('montepremi: 5 cent a consegna, arrotondato ai 10 €, tra 40 e 200 (primo di Catania max 100 €)', () => {
    assert.equal(L.montepremi(4137), 200);   // Catania ottobre: al tetto → 100/60/40
    assert.equal(L.montepremi(1390), 70);    // Messina → 35/20/15
    assert.equal(L.montepremi(1024), 50);    // Palermo → 30/20
    assert.equal(L.montepremi(750), 40);     // Siracusa → 25/15
    assert.equal(L.montepremi(300), 40);     // sotto il minimo
    assert.equal(L.montepremi(0), 40);
    assert.equal(L.montepremi(20000), 200);  // tetto
});

test('ripartisci: 50/30/20 con 5+ driver, 60/40 con 3-4, niente sotto i 3; somma sempre uguale al totale', () => {
    assert.deepEqual(L.ripartisci(200, 9), [100, 60, 40]);
    assert.deepEqual(L.ripartisci(70, 7), [35, 20, 15]);
    assert.deepEqual(L.ripartisci(50, 3), [30, 20]);
    assert.deepEqual(L.ripartisci(40, 4), [25, 15]);
    assert.deepEqual(L.ripartisci(100, 2), []);
    [200, 70, 50, 40, 100, 130].forEach((t) => [3, 5, 8].forEach((n) => assert.equal(L.ripartisci(t, n).reduce((s, x) => s + x, 0), t)));
});

test('premiabile: 12 giorni, zero danni, patente verificata', () => {
    assert.deepEqual(L.premiabile({ giorni: 20, danni: 0, patenteOk: true }), { ok: true, motivi: [] });
    assert.deepEqual(L.premiabile({ giorni: 11, danni: 0, patenteOk: true }).motivi, ['giorni']);
    assert.deepEqual(L.premiabile({ giorni: 20, danni: 1, patenteOk: false }).motivi, ['danni', 'patente']);
    assert.deepEqual(L.premiabile({ giorni: 20, danni: 0, patenteOk: true, premiAnno: 1000 }).motivi, ['tetto']);
    assert.deepEqual(L.premiabile({ giorni: 20, danni: 0, patenteOk: true, premiAnno: 950 }).motivi, []);
});

test('tetto 1.000 €/anno: premio ridotto al residuo, chi ha raggiunto il tetto salta', () => {
    const drivers = [
        { driver: 'A', consegne: 600, danni: 0, giorni: 25, patenteOk: true, score: 650 },
        { driver: 'B', consegne: 500, danni: 0, giorni: 24, patenteOk: true, score: 580 },
        { driver: 'C', consegne: 450, danni: 0, giorni: 20, patenteOk: true, score: 530 },
        { driver: 'D', consegne: 400, danni: 0, giorni: 22, patenteOk: true, score: 470 },
        { driver: 'E', consegne: 300, danni: 0, giorni: 20, patenteOk: true, score: 380 },
    ];
    const c = L.classificaProvincia('CT', drivers, [], 31, 31, null, { A: 1000, B: 950 });
    assert.deepEqual(c.importi, [55, 35, 20]);  // 2250 cons → 110 €
    assert.deepEqual(c.drivers[0].motiviNonPremiabile, ['tetto']);
    assert.equal(c.drivers[0].premio, 0);
    assert.deepEqual(c.premi, [
        { posizione: 2, driver: 'B', importo: 50, ridotto: true },   // residuo 50 su 55
        { posizione: 3, driver: 'C', importo: 35, ridotto: false },
        { posizione: 4, driver: 'D', importo: 20, ridotto: false },
    ]);
    assert.equal(c.drivers[1].premiAnno, 950);
    assert.deepEqual(L.mesiTetto('2026-11'), []);
    assert.deepEqual(L.mesiTetto('2026-12'), ['2026-11']);
    assert.deepEqual(L.mesiTetto('2027-03'), ['2027-01', '2027-02']);
    assert.deepEqual(L.mesiTetto('2027-01'), []);
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
    assert.equal(c.montepremi, 130);
    assert.deepEqual(c.importi, [65, 40, 25]);
    assert.deepEqual(c.drivers.map((d) => d.driver), ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.deepEqual(c.premi, [{ posizione: 2, driver: 'B', importo: 65, ridotto: false }, { posizione: 5, driver: 'E', importo: 40, ridotto: false }, { posizione: 6, driver: 'F', importo: 25, ridotto: false }]);
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
