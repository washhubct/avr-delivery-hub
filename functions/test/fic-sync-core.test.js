'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../fic-sync-core.js');

test('meseDaTesto riconosce i formati usati nelle fatture', () => {
    assert.equal(C.meseDaTesto('Consegne a domicilio agosto 2026'), '2026-08');
    assert.equal(C.meseDaTesto('Acconto ... relativi al mese di Agosto 2026 Giusto Contratto del 16/06/2026'), '2026-08');
    assert.equal(C.meseDaTesto("Contributo marketing competenza luglio 2026 - rif. Vs. fattura n. 002475/9D del 03/09/2026"), '2026-07');
    assert.equal(C.meseDaTesto('Canone noleggio 09/2026'), '2026-09');
    assert.equal(C.meseDaTesto('periodo 2026-10'), '2026-10');
    assert.equal(C.meseDaTesto("Carburante sett '26"), '2026-09');
    assert.equal(C.meseDaTesto("Servizio di pubblicizzazione mediante esposizione del marchio 'deco' a casa'"), null);
    assert.equal(C.meseDaTesto(''), null);
});

test('meseDaTesto: periodo "dal … al …" (carburante Q8 a quindicina)', () => {
    assert.equal(C.meseDaTesto('Fattura PJ 123 - Periodo dal 01/10/2026 al 15/10/2026'), '2026-10');
    assert.equal(C.meseDaTesto('Rifornimenti carburante 16/10/2026 - 31/10/2026 carta Q8'), '2026-10');
    assert.equal(C.meseDaTesto('Consumi dal 16.09.2026 al 15.10.2026'), '2026-09'); // 15 giorni di settembre contro 15 di ottobre → il primo
    assert.equal(C.meseDaTesto('Canone dal 25/09/2026 al 24/10/2026'), '2026-10');
    assert.equal(C.meseDaTesto('fattura del 02/11/2026 periodo dal 16/10/2026 al 31/10/2026'), '2026-10');
});

test('la data 16/06/2026 nel testo non viene scambiata per un mese', () => {
    // "16/06/2026" contiene "06/2026" ma preceduto da "16/": non deve matchare
    assert.equal(C.meseDaTesto('Giusto Contratto del 16/06/2026'), null);
});

test('emessa: competenza dal testo, poi fallback mese precedente, poi override', () => {
    const saldo = { id: 1, number: 113, date: '2026-09-22', subject: 'Consegne a domicilio agosto 2026', entity: { id: 1, name: 'ARENA' }, amount_net: 100, amount_vat: 22, amount_gross: 122, ei_status: 'sent' };
    assert.equal(C.normalizzaEmessa(saldo).meseCompetenza, '2026-08');
    assert.equal(C.normalizzaEmessa(saldo).competenzaFonte, 'testo');
    const pubb = { id: 2, number: 130, date: '2026-10-01', subject: 'Servizio di pubblicizzazione', entity: { id: 1, name: 'ARENA' }, amount_net: 9500, amount_vat: 2090, amount_gross: 11590 };
    const n = C.normalizzaEmessa(pubb);
    assert.equal(n.meseCompetenza, '2026-09');
    assert.equal(n.competenzaFonte, 'mese precedente');
    const o = C.normalizzaEmessa(pubb, { meseCompetenza: '2026-10' });
    assert.equal(o.meseCompetenza, '2026-10');
    assert.equal(o.competenzaFonte, 'manuale');
    assert.equal(n.descrizione, 'Servizio di pubblicizzazione');
});

test('ricevuta: competenza = data salvo testo/override; azienda e voce da fornitore/override', () => {
    const r = { id: 9, date: '2026-09-15', invoice_number: 'A/12', entity: { id: 77, name: 'ENI' }, description: 'Carburante', amount_net: 1000, amount_vat: 220, amount_gross: 1220 };
    const a = C.normalizzaRicevuta(r, null, null);
    assert.equal(a.meseCompetenza, '2026-09');
    assert.equal(a.azienda, 'da_classificare');
    assert.equal(a.voce, 'altro');
    const b = C.normalizzaRicevuta(r, { azienda: 'lastmile', voce: 'carburante' }, null);
    assert.equal(b.azienda, 'lastmile'); assert.equal(b.voce, 'carburante');
    const c = C.normalizzaRicevuta(r, { azienda: 'lastmile', voce: 'carburante' }, { azienda: 'washhub', voce: 'voceInesistente', meseCompetenza: '2026-08' });
    assert.equal(c.azienda, 'washhub'); assert.equal(c.voce, 'altro'); assert.equal(c.meseCompetenza, '2026-08');
});

test('raggruppaPerMese: totali solo su righe valide, costi washhub esclusi, da_classificare contati', () => {
    const emesse = [
        C.normalizzaEmessa({ id: 1, number: 81, date: '2026-09-02', items_list: [{ description: 'Acconto mese di Agosto 2026' }], entity: { id: 1, name: 'ARENA' }, amount_net: 50000, amount_vat: 11000, amount_gross: 61000 }),
        C.normalizzaEmessa({ id: 2, number: 113, date: '2026-09-22', subject: 'Consegne a domicilio agosto 2026', entity: { id: 1, name: 'ARENA' }, amount_net: 40362.11, amount_vat: 8879.66, amount_gross: 49241.77 }),
        C.normalizzaEmessa({ id: 3, number: 95, date: '2026-09-14', subject: 'Contributo marketing competenza luglio 2026', entity: { id: 1, name: 'ARENA' }, amount_net: 11000, amount_vat: 2420, amount_gross: 13420 }),
        C.normalizzaEmessa({ id: 4, number: 99, date: '2026-09-30', subject: 'Storno agosto 2026', entity: { id: 1, name: 'ARENA' }, amount_net: 1, amount_vat: 0.22, amount_gross: 1.22 }, { escludi: true }),
    ];
    const ricevute = [
        C.normalizzaRicevuta({ id: 10, date: '2026-08-10', entity: { id: 5, name: 'ENI' }, amount_net: 100, amount_vat: 22, amount_gross: 122 }, { azienda: 'lastmile', voce: 'carburante' }),
        C.normalizzaRicevuta({ id: 11, date: '2026-08-11', entity: { id: 6, name: 'SAPONI SRL' }, amount_net: 50, amount_vat: 11, amount_gross: 61 }, { azienda: 'washhub', voce: 'altro' }),
        C.normalizzaRicevuta({ id: 12, date: '2026-08-12', entity: { id: 7, name: 'IGNOTO' }, amount_net: 30, amount_vat: 6.6, amount_gross: 36.6 }, null),
    ];
    const g = C.raggruppaPerMese(emesse, ricevute);
    assert.deepEqual(Object.keys(g).sort(), ['2026-07', '2026-08']);
    const ago = g['2026-08'];
    assert.equal(ago.emesse.length, 3);
    assert.equal(ago.totali.nEmesse, 2);
    assert.equal(ago.totali.ricaviImponibile, 90362.11);
    assert.equal(ago.totali.ricaviLordo, 110241.77);
    assert.equal(ago.totali.costiImponibile, 130);
    assert.equal(ago.totali.nRicevute, 2);
    assert.equal(ago.totali.nDaClassificare, 1);
    assert.deepEqual(ago.totali.costiPerVoce, { carburante: 100, altro: 30 });
    assert.equal(g['2026-07'].totali.ricaviImponibile, 11000);
});

test('da registrare: solo fornitori in elenco, competenza dalle righe XML, costo Last Mile', () => {
    assert.equal(C.daRegistrareAmmessa({ supplier_name: 'FRATELLI ARENA S.R.L.' }), true);
    assert.equal(C.daRegistrareAmmessa({ supplier_name: 'M&R CONSULTING SRL STP' }), true);
    assert.equal(C.daRegistrareAmmessa({ supplier_name: 'KUWAIT PETROLEUM ITALIA SPA' }), true);
    assert.equal(C.daRegistrareAmmessa({ supplier_name: 'GURGONE GIANLUCA' }), false);
    assert.equal(C.daRegistrareAmmessa({ supplier_name: 'GURGONE GIANLUCA' }, ['Gurgone']), true);
    assert.equal(C.daRegistrareAmmessa({ supplier_name: '' }), false);

    const xml = '<?xml version="1.0"?><ns3:FatturaElettronica><DettaglioLinee><Descrizione>RIADDEBITO CANONE NOLEGGIO</Descrizione></DettaglioLinee>' +
        '<DettaglioLinee><Descrizione>COMPETENZA ottobre 2026</Descrizione></DettaglioLinee><DettaglioLinee><Descrizione>RIADDEBITO CANONE NOLEGGIO</Descrizione></DettaglioLinee>' +
        '<Causale>Rif. contratto A&amp;B</Causale></ns3:FatturaElettronica>';
    const righe = C.testoDaXml(xml);
    assert.deepEqual(righe, ['RIADDEBITO CANONE NOLEGGIO', 'COMPETENZA ottobre 2026', 'Rif. contratto A&B']);

    const doc = { id: 656903798, date: '2026-11-05 09:20:31', emission_date: '2026-11-04', ei_number: '002913/9D', supplier_name: 'FRATELLI ARENA S.R.L.', amount_net: 16883.03, amount_vat: 3714.27, amount_gross: 20597.3, subject: 'Fattura 002913/9D da FRATELLI ARENA S.R.L.' };
    const r = C.normalizzaDaRegistrare(doc, righe, undefined, undefined);
    assert.equal(r.ficId, 'P656903798');
    assert.equal(r.meseCompetenza, '2026-10');
    assert.equal(r.competenzaFonte, 'testo');
    assert.equal(r.data, '2026-11-04');
    assert.equal(r.numero, '002913/9D');
    assert.equal(r.descrizione, 'RIADDEBITO CANONE NOLEGGIO');
    assert.equal(r.azienda, 'lastmile');
    assert.equal(r.voce, 'altro');
    assert.equal(r.imponibile, 16883.03);
    assert.equal(r.daRegistrare, true);

    // senza XML: mese della data di emissione; fornitore configurato e override vincono
    const k = C.normalizzaDaRegistrare({ ...doc, id: 1, supplier_name: 'KUWAIT PETROLEUM ITALIA SPA', emission_date: '2026-10-31' }, [], { id: 54761920, azienda: 'lastmile', voce: 'carburante' });
    assert.equal(k.meseCompetenza, '2026-10');
    assert.equal(k.voce, 'carburante');
    assert.equal(k.fornitoreId, 54761920);
    const o = C.normalizzaDaRegistrare(doc, righe, undefined, { azienda: 'washhub', meseCompetenza: '2026-11' });
    assert.equal(o.azienda, 'washhub');
    assert.equal(o.meseCompetenza, '2026-11');
});
