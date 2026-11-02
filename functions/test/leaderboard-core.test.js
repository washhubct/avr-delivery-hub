'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../leaderboard-core.js');

test('montepremi fisso per provincia (importi di ottobre 2026)', () => {
    assert.equal(L.montepremi('CT'), 200);   // → 100/60/40
    assert.equal(L.montepremi('ME'), 70);    // → 35/20/15
    assert.equal(L.montepremi('PA'), 60);    // → 30/20/10 oppure 35/25
    assert.equal(L.montepremi('SR'), 40);    // → 25/15
    assert.equal(L.montepremi('EN'), 0);     // Enna: nessun premio
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
    const c = L.classificaProvincia('ME', drivers, null, { A: 1000, B: 35 });
    assert.deepEqual(c.importi, [35, 20, 15]);
    assert.deepEqual(c.drivers[0].motiviNonPremiabile, ['tetto']);
    assert.equal(c.drivers[0].premio, 0);
    assert.deepEqual(c.premi, [
        { posizione: 2, driver: 'B', importo: 35, ridotto: false },
        { posizione: 3, driver: 'C', importo: 20, ridotto: false },
        { posizione: 4, driver: 'D', importo: 15, ridotto: false },
    ]);
    assert.equal(c.drivers[1].premiAnno, 35);
    const r = L.classificaProvincia('CT', drivers.slice(0, 5), null, { A: 940 });
    assert.deepEqual(r.premi[0], { posizione: 1, driver: 'A', importo: 60, ridotto: true });  // residuo 60 su 100
    assert.deepEqual(L.mesiTetto('2026-11'), []);
    assert.deepEqual(L.mesiTetto('2026-12'), ['2026-11']);
    assert.deepEqual(L.mesiTetto('2027-03'), ['2027-01', '2027-02']);
    assert.deepEqual(L.mesiTetto('2027-01'), []);
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
    const c = L.classificaProvincia('CT', drivers.slice().reverse());
    assert.equal(c.nome, 'Catania');
    assert.equal(c.consegne, 2500);
    assert.equal(c.montepremi, 200);
    assert.deepEqual(c.importi, [100, 60, 40]);
    assert.deepEqual(c.drivers.map((d) => d.driver), ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.deepEqual(c.premi, [{ posizione: 2, driver: 'B', importo: 100, ridotto: false }, { posizione: 5, driver: 'E', importo: 60, ridotto: false }, { posizione: 6, driver: 'F', importo: 40, ridotto: false }]);
    assert.deepEqual(c.drivers[0].motiviNonPremiabile, ['danni']);
    assert.equal(c.drivers[0].premio, 0);
    const piccola = L.classificaProvincia('SR', drivers.slice(0, 2));
    assert.deepEqual(piccola.importi, []);
    assert.deepEqual(piccola.premi, []);
});

test('giorniNelMese', () => {
    assert.equal(L.giorniNelMese('2026-10'), 31);
    assert.equal(L.giorniNelMese('2026-11'), 30);
    assert.equal(L.giorniNelMese('2028-02'), 29);
});
