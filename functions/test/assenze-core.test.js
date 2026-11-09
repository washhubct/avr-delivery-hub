'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assenze-core.js');

test('giorniTra: compresi, cambio mese, invalidi e troppo lunghi', () => {
    assert.deepEqual(A.giorniTra('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    assert.deepEqual(A.giorniTra('2026-11-09', '2026-11-09'), ['2026-11-09']);
    assert.deepEqual(A.giorniTra('2026-11-10', '2026-11-09'), []);
    assert.deepEqual(A.giorniTra('boh', '2026-11-09'), []);
    assert.equal(A.giorniTra('2026-01-01', '2026-03-01').length, 60);
    assert.deepEqual(A.giorniTra('2026-01-01', '2026-03-02'), []);
});

test('attiva: ferie solo approvate, malattia già registrata', () => {
    assert.equal(A.attiva({ tipo: 'ferie', stato: 'in_attesa' }), false);
    assert.equal(A.attiva({ tipo: 'ferie', stato: 'approvata' }), true);
    assert.equal(A.attiva({ tipo: 'malattia', stato: 'registrata' }), true);
    assert.equal(A.attiva({ tipo: 'ferie', stato: 'registrata' }), false);
    assert.equal(A.attiva({ tipo: 'malattia', stato: 'annullata' }), false);
});

test('push: testi per responsabile e driver', () => {
    const r = { tipo: 'ferie', dal: '2026-12-22', al: '2026-12-27', driverNome: 'VINCI Vito' };
    assert.deepEqual(A.pushNuova(r), { title: 'Ferie da approvare', body: 'VINCI Vito: ferie dal 22/12 al 27/12' });
    assert.equal(A.pushNuova({ ...r, tipo: 'malattia', al: '2026-12-22' }).body, 'VINCI Vito: malattia il 22/12');
    assert.match(A.pushEsito({ ...r, stato: 'rifiutata', motivoRifiuto: 'picco di Natale' }).body, /non approvata ✕: picco di Natale$/);
    assert.match(A.pushEsito({ ...r, stato: 'approvata' }).body, /approvata ✓$/);
});

test('piano: approvazione mette i giorni, salta quelli con causale manuale', () => {
    const prima = { tipo: 'ferie', stato: 'in_attesa', dal: '2026-11-10', al: '2026-11-12' };
    const dopo = { ...prima, stato: 'approvata' };
    const p = A.pianoPresenze(prima, dopo, 'R1', { '2026-11-11': { causale: 'malattia' } });
    assert.deepEqual(p.metti, ['2026-11-10', '2026-11-12']);
    assert.deepEqual(p.saltati, ['2026-11-11']);
    assert.deepEqual(p.togli, []);
});

test('piano: annullo toglie solo i giorni messi da questa richiesta', () => {
    const prima = { tipo: 'ferie', stato: 'approvata', dal: '2026-11-10', al: '2026-11-11' };
    const dopo = { ...prima, stato: 'annullata' };
    const p = A.pianoPresenze(prima, dopo, 'R1', { '2026-11-10': { causale: 'ferie', richiestaId: 'R1' }, '2026-11-11': { causale: 'ferie' } });
    assert.deepEqual(p.metti, []);
    assert.deepEqual(p.togli, ['2026-11-10']);
});

test('piano: malattia nuova (prima = null) va subito in presenze', () => {
    const p = A.pianoPresenze(null, { tipo: 'malattia', stato: 'registrata', dal: '2026-11-09', al: '2026-11-10' }, 'R2', {});
    assert.deepEqual(p.metti, ['2026-11-09', '2026-11-10']);
});
