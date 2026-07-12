// Analisi mirata:
//   1. I 9 doc con schema diverso (driver, cliente, orderId)
//   2. I doc con sync 2026-04-07 ma data giugno (perché?)
//   3. Anagrafica ID doc per filiale 300 — quali "buchi" nella sequenza?
//
// Uso:
//   cd ~/Progetti/avr-delivery-hub/functions
//   node ../scripts/deep-sync-analysis.js

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  ANALISI PROFONDA SYNC BUG');
    console.log('═════════════════════════════════════════════════\n');

    const snap = await db.collection('consegne').where('mese', '==', '2026-06').get();
    console.log('Doc totali giugno: ' + snap.size + '\n');

    // [1] Doc schema diverso (senza cognome)
    console.log('[1/4] Doc con schema DIVERSO (senza `cognome` field):\n');
    const senzaCognome = [];
    snap.forEach(doc => {
        const c = doc.data();
        if (c.cognome === undefined) senzaCognome.push({ id: doc.id, data: c });
    });
    senzaCognome.forEach(x => {
        console.log('  ID: ' + x.id);
        console.log('  ', JSON.stringify(x.data, null, 2).split('\n').slice(0, 40).join('\n  '));
        console.log('  ─────────────────────────────');
    });

    // [2] Doc con sync 2026-04 (ma data giugno)
    console.log('\n[2/4] Doc con sync APRILE ma data giugno (anomalia temporale):\n');
    const anomTemporal = [];
    snap.forEach(doc => {
        const c = doc.data();
        const sv = c.sync;
        const syncStr = sv && sv.toDate ? sv.toDate().toISOString() : (typeof sv === 'string' ? sv : String(sv));
        if (syncStr && syncStr.startsWith('2026-04')) {
            anomTemporal.push({ id: doc.id, sync: syncStr, data: c });
        }
    });
    console.log('  Trovati ' + anomTemporal.length + ' doc con sync aprile');
    console.log('  Primi 5:');
    anomTemporal.slice(0, 5).forEach(x => {
        const dataStr = x.data.data && x.data.data.toDate ? x.data.data.toDate().toISOString().slice(0, 10) : String(x.data.data).slice(0, 10);
        console.log('    ' + x.id + '  data=' + dataStr + '  sync=' + x.sync.slice(0, 19) + '  cognome=' + (x.data.cognome || '—') + '  importo=' + x.data.importo);
    });

    // [3] Filiale 300 — sequence gap analysis
    console.log('\n[3/4] Filiale 300 — anagrafica dettagliata ID doc per giorno:\n');
    const doc300 = [];
    snap.forEach(doc => {
        const c = doc.data();
        if (String(c.filiale) === '300') {
            doc300.push({ id: doc.id, data: c });
        }
    });
    console.log('  Trovati ' + doc300.length + ' doc filiale 300\n');

    // Raggruppa per giorno + prefisso driver (CT01, CT02, ecc)
    const perGiornoDriver = {};
    const prefissoUnici = new Set();
    doc300.forEach(x => {
        const parts = x.id.split('_'); // 300_20260603_CT01_11104
        if (parts.length !== 4) return;
        const giorno = parts[1]; // 20260603
        const prefisso = parts[2]; // CT01
        const rowId = parts[3]; // 11104
        prefissoUnici.add(prefisso);
        const key = giorno + '_' + prefisso;
        perGiornoDriver[key] = perGiornoDriver[key] || [];
        perGiornoDriver[key].push({ id: x.id, rowId, cognome: x.data.cognome, tipoDriver: x.data.tipoDriver, importo: x.data.importo });
    });

    console.log('  Prefissi CT** unici trovati nella filiale 300: ' + prefissoUnici.size);
    console.log('  ', Array.from(prefissoUnici).sort().join(', '));

    console.log('\n  Distribuzione (giorno × prefisso → n righe):');
    console.log('  Legenda: · = 0 righe   • = 1-20   ● = 21-50   █ = >50');
    console.log('           Prefissi ordinati alfabeticamente\n');
    const prefissiSort = Array.from(prefissoUnici).sort();
    const giorniAll = [];
    for (let g = 1; g <= 30; g++) giorniAll.push('202606' + String(g).padStart(2, '0'));

    console.log('  giorno   ' + prefissiSort.map(p => p.padEnd(5)).join(' '));
    giorniAll.forEach(g => {
        const gDisplay = g.slice(0, 4) + '-' + g.slice(4, 6) + '-' + g.slice(6);
        const cells = prefissiSort.map(p => {
            const key = g + '_' + p;
            const n = perGiornoDriver[key] ? perGiornoDriver[key].length : 0;
            let ch = '·';
            if (n > 50) ch = '█';
            else if (n > 20) ch = '●';
            else if (n > 0) ch = '•';
            return (ch + ' ' + String(n)).padEnd(5);
        });
        console.log('  ' + gDisplay + ' ' + cells.join(' '));
    });

    // [4] Rider distribution nella 300 (chi consegna quando)
    console.log('\n[4/4] Filiale 300 — driver top per giorno:');
    const driversPerGiorno = {};
    doc300.forEach(x => {
        const parts = x.id.split('_');
        if (parts.length !== 4) return;
        const giorno = parts[1];
        driversPerGiorno[giorno] = driversPerGiorno[giorno] || {};
        const rider = (x.data.rider || '(vuoto)').substring(0, 15);
        driversPerGiorno[giorno][rider] = (driversPerGiorno[giorno][rider] || 0) + 1;
    });
    for (let g = 1; g <= 30; g++) {
        const gk = '202606' + String(g).padStart(2, '0');
        const gDisplay = gk.slice(0, 4) + '-' + gk.slice(4, 6) + '-' + gk.slice(6);
        const drivers = driversPerGiorno[gk] || {};
        const dEntries = Object.entries(drivers).sort((a, b) => b[1] - a[1]);
        if (dEntries.length === 0) {
            console.log('  ' + gDisplay + '  (vuoto)');
        } else {
            const summary = dEntries.slice(0, 5).map(([d, n]) => d + '(' + n + ')').join(' ');
            console.log('  ' + gDisplay + '  tot=' + dEntries.reduce((s, x) => s + x[1], 0) + '  ' + summary);
        }
    }

    console.log('\n═════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
