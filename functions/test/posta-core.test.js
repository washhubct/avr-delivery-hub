'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../posta-core.js');

test('meseDaOggetto: nome mese, abbreviazioni, anno a 2 cifre, numerico, assente', () => {
    assert.equal(P.meseDaOggetto('Fwd: INVIO DOCUMENTI MESE LUGLIO 2026'), '2026-07');
    assert.equal(P.meseDaOggetto('BOZZE BUSTE PAGA SETTEMBRE 2026'), '2026-09');
    assert.equal(P.meseDaOggetto('F24 Ott 26'), '2026-10');
    assert.equal(P.meseDaOggetto("cedolini dicembre '26"), '2026-12');
    assert.equal(P.meseDaOggetto('Cedolini 09/2026'), '2026-09');
    assert.equal(P.meseDaOggetto('Documenti'), null);
    assert.equal(P.meseDaOggetto('F24 settembre'), null);
});

test('isBozza e tipoAllegato', () => {
    assert.equal(P.isBozza('BOZZE BUSTE PAGA'), true);
    assert.equal(P.isBozza('INVIO DOCUMENTI MESE'), false);
    assert.equal(P.tipoAllegato('F24 LUGLIO 2026.pdf'), 'f24');
    assert.equal(P.tipoAllegato('Delega_0920.PDF'), 'f24');
    assert.equal(P.tipoAllegato('CEDOLINI LUGLIO.pdf'), 'buste');
    assert.equal(P.tipoAllegato('LUL 07-2026.pdf'), 'buste');
    assert.equal(P.tipoAllegato('image001.png', 'image/png'), null);
    assert.equal(P.tipoAllegato('allegato', 'application/pdf'), 'buste');
    assert.equal(P.tipoAllegato('doc0937812.pdf', 'application/pdf', 'INVIO QUIETANZA AGOSTO 2026'), 'f24');
    assert.equal(P.tipoAllegato('doc0937812.pdf', 'application/pdf', 'Re: INVIO DOCUMENTI MESE LUGLIO 2026'), 'buste');
});

test('pertinente: solo mail di cedolini / F24', () => {
    ['INVIO DOCUMENTI MESE LUGLIO 2026', 'Re: INVIO BOZZE BUSTE PAGA MESE AGOSTO 2026', 'INVIO QUIETANZA AGOSTO 2026', 'F24 settembre', 'Cedolini 09/2026', 'LUL ottobre'].forEach((s) => assert.equal(P.pertinente(s), true, s));
    ['UNILAV E LETTERA DI PROROGA DI PRIMA AL 30/11/2026', 'DOCUMENTI ASSUNZIONE BASILE', 'AVVISI DI PAGAMENTO IN SOSPESO LUGLIO-SETTEMBRE 2026', 'MALATTIA DI CANDIA'].forEach((s) => assert.equal(P.pertinente(s), false, s));
});

test('mesiVicini e trovaModuloUguale', () => {
    assert.deepEqual(P.mesiVicini('2026-01', 2, 1), ['2025-11', '2025-12', '2026-02']);
    const a = { id: 'x', dataVersamento: '2026-08-20', saldo: 19370.16 };
    assert.equal(P.trovaModuloUguale([{ id: 'y', dataVersamento: '2026-08-20', saldo: 19370.16 }], a).id, 'y');
    assert.equal(P.trovaModuloUguale([a], a), null);
});

test('allegatiDaPayload: ricorsivo, salta le parti senza attachmentId', () => {
    const payload = { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'X' }], parts: [
        { mimeType: 'text/plain', body: { size: 10 } },
        { filename: 'F24.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a1', size: 100 } },
        { mimeType: 'message/rfc822', parts: [{ filename: 'CEDOLINI.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a2', size: 200 } }] },
    ] };
    assert.deepEqual(P.allegatiDaPayload(payload).map((a) => a.nome + ':' + a.attachmentId), ['F24.pdf:a1', 'CEDOLINI.pdf:a2']);
    assert.equal(P.header(payload, 'subject'), 'X');
});

test('queryGmail: mittenti sia come from: sia come testo libero (inoltri)', () => {
    assert.equal(P.queryGmail(['a@x.it'], '2026-07-01'), 'has:attachment filename:pdf after:2026/07/01 (from:a@x.it OR "a@x.it")');
});

test('descrizioneF24Fic e trovaTaxFic', () => {
    const m = { dataVersamento: '2026-08-20', saldo: 19370.16 };
    assert.equal(P.descrizioneF24Fic(m, '2026-07'), 'F24 AGOSTO 2026 (retribuzioni luglio 2026)');
    assert.equal(P.descrizioneF24Fic({ dataVersamento: null, saldo: 1 }, '2026-07'), 'F24 LUGLIO 2026 (retribuzioni luglio 2026)');
    const taxes = [{ id: 1, due_date: '2026-08-20', amount: 19370.16 }, { id: 2, due_date: '2026-09-16', amount: 20326.27 }];
    assert.equal(P.trovaTaxFic(taxes, m).id, 1);
    assert.equal(P.trovaTaxFic(taxes, { dataVersamento: '2026-08-20', saldo: 100 }), null);
    assert.equal(P.trovaTaxFic(taxes, { dataVersamento: '2026-09-21', saldo: 20345.51 }).id, 2, 'quietanza pagata 5 gg dopo con 19 € di interessi = stesso F24');
    assert.equal(P.trovaTaxFic(taxes, { dataVersamento: '2026-09-21', saldo: 20500 }), null);
    assert.equal(P.nomeFileSicuro('F24 LUGLIO 2026 (1).pdf'), 'F24_LUGLIO_2026_1_.pdf');
});
