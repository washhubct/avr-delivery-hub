// Scan duplicati Firestore per mese: stessa dedupKey, id diversi.
// Analizza pattern ID + fonte + timestamp per decidere quale tenere.
const admin = require('firebase-admin');

const MESE = process.env.MESE || '2026-06';

admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

function normalizzaNome(s) {
    return (s || '').toString().toUpperCase().trim()
        .replace(/[ÀÁÂÃ]/g, 'A').replace(/[ÈÉÊË]/g, 'E')
        .replace(/[ÌÍÎÏ]/g, 'I').replace(/[ÒÓÔÕ]/g, 'O')
        .replace(/[ÙÚÛÜ]/g, 'U');
}
function toCivilDate(d) { return new Date(d.getTime() + 12 * 3600 * 1000); }
function isoCivilDay(d) { return toCivilDate(d).toISOString().slice(0, 10); }

function dedupKey(c, d) {
    return [
        String(c.filiale || ''),
        isoCivilDay(d),
        normalizzaNome(c.cognome || '').replace(/\s+/g, ''),
        Math.round((c.importo || 0) * 100),
        normalizzaNome(c.indirizzo || '').replace(/\s+/g, '').slice(0, 30),
    ].join('|');
}

// Classifica il pattern dell'ID
function classifyId(id) {
    // Pattern noti:
    //  {fil}_{YYYYMMDD}_{NUM}_{cents}          -> schema numerico (vecchio?)
    //  {fil}_{YYYYMMDD}_{COGNOME10}_{cents}    -> schema cognome
    //  {fil}_{YYYYMMDD}_BACKFILL_{hash}        -> backfill script
    if (id.indexOf('_BACKFILL_') >= 0) return 'BACKFILL';
    const parts = id.split('_');
    if (parts.length < 4) return 'ALTRO';
    const p3 = parts[2];
    if (/^\d+$/.test(p3)) return 'NUM';         // es. 29
    if (/^[A-Z]+$/i.test(p3)) return 'COGNOME'; // es. ROSIDEMMA
    return 'MIX';
}

async function main() {
    console.log('\n═══ SCAN DUPLICATI mese=' + MESE + ' ═══\n');
    console.log('[1] Carico tutti i doc consegne mese=' + MESE + '...');
    const snap = await db.collection('consegne').where('mese', '==', MESE).get();
    console.log('  → ' + snap.size + ' doc\n');

    const perKey = {};
    snap.forEach(doc => {
        const c = doc.data();
        if (!c.data) return;
        const d = c.data.toDate ? c.data.toDate() : new Date(c.data);
        if (isNaN(d)) return;
        const k = dedupKey(c, d);
        if (!perKey[k]) perKey[k] = [];
        perKey[k].push({
            id: doc.id,
            fonte: c.fonte || '?',
            filiale: String(c.filiale || ''),
            sync: c.sync && c.sync.toDate ? c.sync.toDate() : null,
            importedAt: c.importedAt && c.importedAt.toDate ? c.importedAt.toDate() : null,
        });
    });

    const dupKeys = Object.entries(perKey).filter(([, v]) => v.length > 1);
    console.log('[2] Chiavi con >1 doc: ' + dupKeys.length);
    let totExtraDocs = 0;
    dupKeys.forEach(([, v]) => { totExtraDocs += (v.length - 1); });
    console.log('    Doc "extra" (duplicati): ' + totExtraDocs + '\n');

    // Distribuzione per pattern (nell'insieme dei duplicati)
    const patternPairs = {};
    const perFilDup = {};
    dupKeys.forEach(([, docs]) => {
        const pats = docs.map(d => classifyId(d.id)).sort().join('+');
        patternPairs[pats] = (patternPairs[pats] || 0) + 1;
        docs.forEach(d => {
            perFilDup[d.filiale] = (perFilDup[d.filiale] || 0) + 1;
        });
    });
    console.log('[3] Pattern coppie di duplicati (top):');
    Object.entries(patternPairs).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([p, n]) => {
        console.log('    ' + p.padEnd(30) + ' → ' + n + ' gruppi');
    });

    console.log('\n[4] Duplicati per filiale (top 20):');
    const totPerFil = {};
    snap.forEach(doc => {
        const f = String(doc.data().filiale || '?');
        totPerFil[f] = (totPerFil[f] || 0) + 1;
    });
    Object.entries(perFilDup).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([f, n]) => {
        const gruppi = dupKeys.filter(([, v]) => v[0].filiale === f).length;
        console.log('    ' + f.padEnd(6) + ' totDoc=' + String(totPerFil[f] || 0).padStart(5) +
            ' inGruppiDup=' + String(n).padStart(5) + ' gruppi=' + String(gruppi).padStart(4) +
            ' extra=' + String(n - gruppi).padStart(4));
    });

    console.log('\n[5] Sample 5 duplicati con timestamp:');
    dupKeys.slice(0, 5).forEach(([k, v]) => {
        console.log('  key=' + k);
        v.forEach(d => {
            const sync = d.sync ? d.sync.toISOString().slice(0, 19) : '-';
            const imp = d.importedAt ? d.importedAt.toISOString().slice(0, 19) : '-';
            console.log('    id=' + d.id.padEnd(45) + ' fonte=' + d.fonte.padEnd(15) + ' sync=' + sync + ' imp=' + imp);
        });
    });

    // Test criterio "quale tenere": preferisci pattern COGNOME > NUM, fonte gas_v4|gas > gas_giorn_v1, importedAt più recente
    console.log('\n[6] Simulazione criterio "keep":');
    console.log('    priorità: BACKFILL_XLSX (fonte) > gas_v4 > gas_giorn_v1;  pattern COGNOME > NUM;  più recente > vecchio');
    let coprono = 0, ambigui = 0;
    const fonteRank = { 'BACKFILL_XLSX': 1, 'gas_v4': 2, 'GAS': 3, 'gas_giorn_v1': 4, '?': 9 };
    const patRank = { 'COGNOME': 1, 'BACKFILL': 2, 'NUM': 3, 'MIX': 4, 'ALTRO': 5 };
    dupKeys.forEach(([, docs]) => {
        const scored = docs.map(d => ({
            ...d,
            score: (fonteRank[d.fonte] || 9) * 10 + (patRank[classifyId(d.id)] || 9),
            ts: d.importedAt ? d.importedAt.getTime() : (d.sync ? d.sync.getTime() : 0),
        }));
        scored.sort((a, b) => a.score - b.score || b.ts - a.ts);
        const bestScore = scored[0].score;
        const bestCount = scored.filter(s => s.score === bestScore).length;
        if (bestCount === 1) coprono++; else ambigui++;
    });
    console.log('    Gruppi con "vincitore unico": ' + coprono);
    console.log('    Gruppi ambigui (score identico): ' + ambigui);

    console.log('\n═════════════════════════════════════════════════\n');
}

main().catch(e => { console.error(e.message); console.error(e.stack); process.exit(1); });
