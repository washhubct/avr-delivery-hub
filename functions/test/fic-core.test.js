'use strict';
// node --test — core: parser, calcolo, riconciliazione, aritmetica
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx'); // risolto da ../node_modules (root repo)
const Core = require('../fic-core.js');

const XLSX_LUGLIO = process.env.FIC_XLSX || path.join(os.homedir(), 'Desktop', 'lug 26 fatture.xlsx');
const haFileLuglio = fs.existsSync(XLSX_LUGLIO);

test('functions/fic-core.js è identico a js/fic/fic-core.js', () => {
    const a = fs.readFileSync(path.join(__dirname, '..', 'fic-core.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'fic', 'fic-core.js'), 'utf8');
    assert.equal(a, b, 'esegui: npm --prefix functions run copy-core');
});

// ── Aritmetica ─────────────────────────────────────────────────────
test('toCents: decimali, float rumorosi, formato italiano, half-up', () => {
    assert.equal(Core.toCents('9.70'), 970n);
    assert.equal(Core.toCents(12.61), 1261n);
    assert.equal(Core.toCents(74040.09999999999), 7404010n);
    assert.equal(Core.toCents('1.234,56'), 123456n);
    assert.equal(Core.toCents('0.005'), 1n);
    assert.equal(Core.toCents('0.004'), 0n);
    assert.equal(Core.toCents('-50000'), -5000000n);
    assert.equal(Core.toCents(0.1 + 0.2), 30n);
    assert.throws(() => Core.toCents('abc'));
});
test('percentOf half-up e centsToString', () => {
    assert.equal(Core.percentOf(4570538n, 22), 1005518n); // 10055.1836
    assert.equal(Core.percentOf(5n, 22), 1n);            // 1.1 → 1
    assert.equal(Core.percentOf(25n, 22), 6n);           // 5.5 → 6
    assert.equal(Core.centsToString(5n), '0.05');
    assert.equal(Core.centsToString(-1005518n), '-10055.18');
    assert.equal(Core.centsToEuroIt(4570538n), '€ 45.705,38');
});

test('aritmetica: nessun errore di arrotondamento su centinaia di righe', () => {
    const righe = [];
    let atteso = 0n;
    for (let i = 0; i < 700; i++) {
        const qty = (i % 37) + 1;
        const prezzo = i % 3 === 0 ? 970n : i % 3 === 1 ? 1261n : BigInt(1000 + (i * 7919) % 50000) + 1n; // prezzi "sporchi"
        righe.push({ tipo: 'x', descrizione: 'r' + i, qty, prezzoCents: prezzo, totaleCents: BigInt(qty) * prezzo });
        atteso += BigInt(qty) * prezzo;
    }
    const t = Core.totali(righe, 22);
    assert.equal(t.imponibile, atteso);
    assert.equal(t.iva, Core.percentOf(atteso, 22));
    assert.equal(t.totale, t.imponibile + t.iva);
    // roundtrip JSON (stringhe) senza perdita
    const back = Core.righeFromJson(Core.righeToJson(righe));
    assert.equal(Core.totali(back, 22).imponibile, atteso);
    // confronto con somma in float delle stringhe: deve coincidere ai centesimi
    const sommaFloat = Core.righeToJson(righe).reduce((s, r) => s + Number(r.totale), 0);
    assert.equal(Core.centsToString(atteso), sommaFloat.toFixed(2));
});

// ── Parser / oracolo luglio 2026 ───────────────────────────────────
test('luglio 2026: 52 righe, 8892 feriali, 698 festivi, 23 speciali €651,20; totali con acconto 50.000', { skip: !haFileLuglio && 'file xlsx luglio non presente (FIC_XLSX)' }, () => {
    const wb = XLSX.readFile(XLSX_LUGLIO);
    const p = Core.parseWorkbook(XLSX, wb);
    assert.equal(p.riepilogo.mese, 7);
    assert.equal(p.riepilogo.anno, 2026);
    assert.equal(p.riepilogo.filiali.length, 27);
    const c = Core.ricalcola(p);
    assert.equal(c.feriali, 8892);
    assert.equal(c.festivi, 698);
    assert.equal(c.nSpeciali, 23);
    assert.equal(Core.centsToString(c.euroSpeciali), '651.20');
    assert.equal(p.speciali.righe.length, 23);

    const righe = Core.buildRighe(p, { acconto: { importo: '50000', riferimento: 'FT 10/2026' } });
    assert.equal(righe.length, 52);
    const t = Core.totali(righe, 22);
    assert.equal(Core.centsToString(t.imponibile), '45705.38');
    assert.equal(Core.centsToString(t.iva), '10055.18');
    assert.equal(Core.centsToString(t.totale), '55760.56');
    // ordine: aree, poi codice; speciali dopo; acconto ultimo; niente righe a zero
    assert.equal(righe[0].descrizione, 'Filiale 300 (CT) - consegne giorni feriali luglio 2026');
    assert.equal(righe[1].descrizione, 'Filiale 300 (CT) - consegne giorni festivi luglio 2026');
    assert.ok(righe.every(r => r.qty > 0 && r.prezzoCents !== 0n));
    assert.equal(righe[righe.length - 1].tipo, 'acconto');
    assert.equal(righe[righe.length - 1].prezzoCents, -5000000n);
    const speciali = righe.filter(r => r.tipo === 'speciali');
    assert.equal(speciali.length, 5);
    assert.equal(speciali[0].descrizione, 'Filiale 524 (CT) - n. 7 consegne speciali luglio 2026');
    // senza acconto
    assert.equal(Core.buildRighe(p, {}).length, 51);
    // nessuno scostamento reale sul file (Foglio1 assente → solo info)
    const sc = Core.riconcilia(p);
    assert.ok(sc.every(s => s.livello === 'info'), JSON.stringify(sc));
});

// ── Fixture sintetica ──────────────────────────────────────────────
function wbSintetico(opts) {
    opts = opts || {};
    const riep = [
        [null, null, null, null, 'FILIALE', 'consegne', null, 'consegne speciali'],
        [null, null, null, null, null, 'giorni feriali', 'festivi', null],
        ['TARIFFE', null, null, null, 'CT', null, null, null, null, null, null, 'giorni feriali', 'festivi', 'consegne  speciali', 'TOTALE'],
        [12.61, null, null, null, 300, 100, 10, 2, null, 'TOTALONE', null, opts.totFer ?? 320, opts.totFes ?? 30, 2, 352],
        [9.7, null, null, null, 301, 50, 0, null],
        [null, null, null, null, 'totali', 150, 10, null],
        [null, null, null, null, 'SR', null, null, null],
        [null, null, null, null, 634, 170, 20, null],
        [null, null, null, null, 'totali', 170, 20, null],
        [null, null, null, null, 'TOTALE COMPLESSIVO', opts.totFer ?? 320, opts.totFes ?? 30, null],
        [null, null, null, null, 'TOTALE', 350, null, null],
        [null, null, null, null, 'Consegne speciali'],
        [null, null, null, null, 'Gruppo Arena'],
        [null, null, null, null, 'FILIALE ', 'IMPORTO RICONOSCIUTO'],
        [null, null, null, null, 300, opts.spec300 ?? 37.6],
        [null, null, null, null, 'Totale', 37.6],
    ];
    const speciali = [
        ['FEBBRAIO', 'PDV', 'DATA', 'NOME', 'IMPORTO', 'Colonna1', 'Colonna2'],
        [300, 'CT x', 45000, 'A', 300.5, 'LUGLIO', 10],
        [300, 'CT x', 45001, 'B', 520, 'LUGLIO', 27.6],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riep), opts.nome || 'agosto 26');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(speciali), 'speciali');
    if (opts.foglio1) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(opts.foglio1), 'Foglio1');
    return wb;
}

test('fixture sintetica: righe, salto zero, totali', () => {
    const p = Core.parseWorkbook(XLSX, wbSintetico());
    assert.equal(p.riepilogo.mese, 8);
    const righe = Core.buildRighe(p, {});
    // 300 fer+fes, 301 fer (fes=0 saltata), 634 fer+fes, speciali 300 → 6
    assert.equal(righe.length, 6);
    assert.equal(righe[5].descrizione, 'Filiale 300 (CT) - n. 2 consegne speciali agosto 2026');
    const t = Core.totali(righe, 22);
    // 320*9.70 + 30*12.61 + 37.60 = 3104 + 378.30 + 37.60 = 3519.90
    assert.equal(Core.centsToString(t.imponibile), '3519.90');
    assert.equal(Core.riconcilia(p).filter(s => s.livello !== 'info').length, 0);
});

test('riconciliazione: totale precalcolato stantio → warning con impatto € corretto', () => {
    // il file dichiara 330 feriali ma la somma è 320 → +10 × 9,70 = 97,00
    const p = Core.parseWorkbook(XLSX, wbSintetico({ totFer: 330 }));
    const sc = Core.riconcilia(p).filter(s => s.tipo === 'totale_file');
    assert.ok(sc.length >= 1);
    assert.equal(Core.centsToString(sc[0].deltaCents), '97.00');
    // la fattura usa comunque il ricalcolo
    assert.equal(Core.ricalcola(p).feriali, 320);
});

test('riconciliazione: importo speciali riepilogo ≠ foglio speciali → error con delta', () => {
    const p = Core.parseWorkbook(XLSX, wbSintetico({ spec300: 40 }));
    const sc = Core.riconcilia(p).filter(s => s.tipo === 'speciali_importo');
    assert.equal(sc.length, 1);
    assert.equal(Core.centsToString(sc[0].deltaCents), '2.40');
    assert.equal(sc[0].livello, 'error');
});

test('riconciliazione Foglio1: split diverso e Arena vs Last Mile con impatto €', () => {
    const foglio1 = [
        ['FRATELLI ARENA', null, null, null, null, null, null, null, 'LAST MILE'],
        ['filiale', 'ecom feriali', 'ecom festivi', 'ritorni feriali', 'ritorni festivi', 'gastro feriali', 'gastro festivi', 'diff', 'filiale', 'ecom feriali', 'ecom festivi', 'ritorni feriali', 'ritorni festivi', 'gastro feriali', 'gastro festivi'],
        [300, 90, 10, 5, 0, 5, 0, 0, 300, 90, 10, 5, 0, 5, 0],
        [301, 50, 0, 0, 0, 0, 0, 0, 301, 50, 0, 0, 0, 0, 0],
        // Arena conta 3 festivi in più su 634 (e -0 feriali); LM riclassifica 4 feriali→festivi rispetto al riepilogo (170/20 → 166/24)
        [634, 166, 27, 0, 0, 0, 0, 3, 634, 166, 24, 0, 0, 0, 0],
        ['TOTALE', 306, 37, 5, 0, 5, 0, 3, 'TOTALE', 999, 999, 0, 0, 0, 0], // totale stantio, deve essere ignorato
    ];
    const p = Core.parseWorkbook(XLSX, wbSintetico({ foglio1 }));
    assert.ok(p.confronto);
    assert.equal(p.confronto.lastMile.totale, 350);
    assert.equal(p.confronto.lastMile.festivi, 34);
    const sc = Core.riconcilia(p);
    const split = sc.find(s => s.tipo === 'confronto_split');
    assert.ok(split, 'atteso scostamento split');
    // 4 consegne feriali→festive: (−4 × 9,70) + (4 × 12,61) = +11,64
    assert.equal(Core.centsToString(split.deltaCents), '11.64');
    const arena = sc.find(s => s.tipo === 'confronto_arena');
    assert.ok(arena);
    assert.equal(Core.centsToString(arena.deltaCents), '37.83'); // 3 × 12,61
    assert.equal(arena.dettagli[0].codice, '634');
    assert.ok(!sc.find(s => s.tipo === 'confronto_totale'));
});

test('parser tollerante: righe spostate e area alias', () => {
    const wb = wbSintetico();
    const ws = wb.Sheets['agosto 26'];
    // inserisce 3 righe vuote in cima e rinomina area
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    rows[2][4] = 'CT';
    rows[6][4] = 'Palermo';
    const shifted = [[], [], []].concat(rows);
    wb.Sheets['agosto 26'] = XLSX.utils.aoa_to_sheet(shifted);
    const p = Core.parseWorkbook(XLSX, wb);
    assert.equal(p.riepilogo.filiali.length, 3);
    assert.equal(p.riepilogo.filiali[2].area, 'PALERMO RETAIL');
    assert.equal(Core.ricalcola(p).feriali, 320);
});

test('righeFromJson rifiuta righe manomesse', () => {
    assert.throws(() => Core.righeFromJson([{ descrizione: 'x', qty: 0, prezzo: '1.00' }]));
    assert.throws(() => Core.righeFromJson([{ descrizione: 'x', qty: 2, prezzo: '1.00', totale: '3.00' }]));
    assert.throws(() => Core.righeFromJson([{ descrizione: '', qty: 1, prezzo: '1.00' }]));
    assert.equal(Core.righeFromJson([{ descrizione: 'ok', qty: 2, prezzo: '1.00', totale: '2.00' }])[0].totaleCents, 200n);
});
