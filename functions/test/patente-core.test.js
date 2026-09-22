'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { valutaPatente, nomeCoerente } = require('../patente-core.js');

const OGGI = '2026-09-22';
const anag = { cognome: 'VINCI', nome: 'Vito' };
const ok = { is_patente: true, leggibile: true, cognome: 'VINCI', nome: 'VITO', numero: 'U1N905728K', data_scadenza: '2030-05-01', data_nascita: '1986-01-01', data_rilascio: '2020-05-01', categorie: ['B'], paese: 'I', note: '' };

test('patente valida → verificata con numero e scadenza dal documento', () => {
    const r = valutaPatente(ok, anag, OGGI);
    assert.equal(r.stato, 'verificata');
    assert.equal(r.numero, 'U1N905728K');
    assert.equal(r.scadenza, '2030-05-01');
});

test('scaduta → respinta ma la scadenza letta viene restituita', () => {
    const r = valutaPatente({ ...ok, data_scadenza: '2026-09-06' }, anag, OGGI);
    assert.equal(r.stato, 'respinta');
    assert.match(r.motivo, /scaduta il 06\/09\/2026/);
    assert.equal(r.scadenza, '2026-09-06');
});

test('nome diverso → respinta', () => {
    const r = valutaPatente({ ...ok, cognome: 'ROSSI', nome: 'MARIO' }, anag, OGGI);
    assert.equal(r.stato, 'respinta');
    assert.match(r.motivo, /non corrisponde/);
});

test('non leggibile / non patente → respinta', () => {
    assert.equal(valutaPatente({ ...ok, leggibile: false, note: 'sfocata' }, anag, OGGI).stato, 'respinta');
    assert.equal(valutaPatente({ ...ok, is_patente: false }, anag, OGGI).stato, 'respinta');
});

test('numero o scadenza mancanti → respinta', () => {
    assert.match(valutaPatente({ ...ok, numero: '' }, anag, OGGI).motivo, /Numero/);
    assert.match(valutaPatente({ ...ok, data_scadenza: '' }, anag, OGGI).motivo, /scadenza/);
    assert.match(valutaPatente({ ...ok, data_scadenza: '12/05/2030' }, anag, OGGI).motivo, /scadenza/);
});

test('numero normalizzato (spazi, minuscole)', () => {
    assert.equal(valutaPatente({ ...ok, numero: 'u1n 905728 k' }, anag, OGGI).numero, 'U1N905728K');
});

test('nomeCoerente: cognomi composti, accenti, anagrafica senza nome', () => {
    assert.ok(nomeCoerente({ cognome: 'DAL PIN', nome: 'DARIO UMBERTO' }, { cognome: 'DAL PIN', nome: 'Dario Umberto' }));
    assert.ok(nomeCoerente({ cognome: 'ZAPPALÀ', nome: 'MICAEL' }, { cognome: 'ZAPPALA', nome: 'Micael' }));
    assert.ok(nomeCoerente({ cognome: 'DI MARCO', nome: 'LUCA' }, { cognome: 'DI MARCO', nome: '' }));
    assert.ok(nomeCoerente({ cognome: 'BRUNO', nome: 'NICOLÒ' }, { cognome: 'BRUNO', nome: 'Nicolo' }));
    assert.ok(!nomeCoerente({ cognome: 'BRUNO', nome: 'PAOLO' }, { cognome: 'BRUNO', nome: 'Nicolò' }));
    assert.ok(!nomeCoerente({ cognome: '', nome: '' }, anag));
});
