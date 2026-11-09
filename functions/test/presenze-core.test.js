'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../presenze-core.js');

test('id presenza: email minuscola + giorno', () => {
    assert.equal(P.idPresenza(' Vito@Gmail.com ', '2026-11-09'), 'vito@gmail.com_2026-11-09');
});

test('giorno Roma: le 23:30 UTC del 31/10 sono già l\'1/11 in Italia', () => {
    assert.equal(P.giornoRoma(new Date('2026-10-31T23:30:00Z')), '2026-11-01');
    assert.equal(P.giornoRoma(new Date('2026-10-31T22:30:00Z')), '2026-10-31');
});

test('campi app: anagrafica vince su turno, primo accesso = orario più basso', () => {
    const c = P.campiApp({
        email: 'X@Y.it', data: '2026-11-09',
        turni: [{ driver: 'VINCI', citta: 'CT', oraInizio: '14:10' }, { driver: 'VINCI', oraInizio: '08:05' }],
        rapporti: [{ oraInizio: '09:00', area: 'CT' }],
        anag: { cognome: 'Vinci', nome: 'Vito', citta: 'ct' },
    });
    assert.equal(c.email, 'x@y.it');
    assert.equal(c.mese, '2026-11');
    assert.equal(c.driverNome, 'VINCI Vito');
    assert.equal(c.citta, 'CT');
    assert.deepEqual(c.fonti, { turno: 2, rapporto: 1 });
    assert.equal(c.presenteApp, true);
    assert.equal(c.primoAccesso, '08:05');
});

test('campi app: senza turni né rapporti non è presente', () => {
    const c = P.campiApp({ email: 'a@b.it', data: '2026-11-09', turni: [], rapporti: [] });
    assert.equal(c.presenteApp, false);
    assert.equal(c.primoAccesso, null);
});

test('esito: la causale vince sull\'app, causale ignota ignorata', () => {
    assert.equal(P.esitoGiorno({ presenteApp: true }), 'presente');
    assert.equal(P.esitoGiorno({ presenteApp: true, causale: 'non_lavorato' }), 'non_lavorato');
    assert.equal(P.esitoGiorno({ presenteApp: false, causale: 'malattia' }), 'malattia');
    assert.equal(P.esitoGiorno({ presenteApp: false, causale: 'boh' }), null);
    assert.equal(P.esitoGiorno(null), null);
});

test('raggruppa: rapporto con Timestamp e turno sullo stesso giorno finiscono insieme', () => {
    const ts = { toDate: () => new Date('2026-11-09T11:00:00Z') };
    const g = P.raggruppa(
        [{ email: 'A@b.it', data: '2026-11-09' }, { email: 'a@b.it', data: '2026-11-10' }, { email: 'a@b.it', data: 'boh' }],
        [{ driverEmail: 'a@b.it', data: ts }, { driverEmail: '', data: ts }]
    );
    assert.deepEqual(Object.keys(g).sort(), ['a@b.it_2026-11-09', 'a@b.it_2026-11-10']);
    assert.equal(g['a@b.it_2026-11-09'].turni.length, 1);
    assert.equal(g['a@b.it_2026-11-09'].rapporti.length, 1);
});
