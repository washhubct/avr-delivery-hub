// AVR — Pulizia duplicati Firestore mese=MESE
//
// Scansiona consegne del mese, raggruppa per dedupKey, per ogni gruppo con >1 doc
// sceglie UN doc da tenere e cancella gli altri.
//
// Criterio "keep" (ordine di priorità):
//   1. Fonte:      BACKFILL_XLSX > gas_v4 > GAS > gas_giorn_v1 > altro
//   2. ID pattern: COGNOME-based > BACKFILL > MIX > NUM
//   3. Timestamp:  importedAt più recente
//   4. Tiebreak:   ID lessicograficamente maggiore (deterministico)
//
// Uso:
//   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/legacy_credentials/claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   MESE=2026-06 node pulisci-duplicati.js              # dry-run (report only)
//   MESE=2026-06 node pulisci-duplicati.js --apply      # cancella davvero
//   MESE=2026-06 FILIALE=533 node pulisci-duplicati.js  # limita a una filiale

const admin = require('firebase-admin');

const MESE = process.env.MESE || '2026-06';
const FILIALE = process.env.FILIALE || null;
const APPLY = process.argv.includes('--apply');

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

function classifyId(id) {
    if (id.indexOf('_BACKFILL_') >= 0) return 'BACKFILL';
    const parts = id.split('_');
    if (parts.length < 4) return 'ALTRO';
    const p3 = parts[2];
    if (/^\d+$/.test(p3)) return 'NUM';
    if (/^[A-Z]+$/i.test(p3)) return 'COGNOME';
    return 'MIX';
}

const FONTE_RANK = { 'BACKFILL_XLSX': 1, 'gas_v4': 2, 'GAS': 3, 'gas_giorn_v1': 4 };
const PATTERN_RANK = { 'COGNOME': 1, 'BACKFILL': 2, 'MIX': 3, 'NUM': 4, 'ALTRO': 5 };

function scoreDoc(d) {
    return {
        fonte: FONTE_RANK[d.fonte] || 9,
        pattern: PATTERN_RANK[classifyId(d.id)] || 9,
        // timestamp asc: -ms per "più recente = meno" con sort asc
        neg_ts: -(d.importedAt || d.sync || 0),
        // tiebreak: ID desc via "-charCodeSum"
        id_neg: -d.id,
    };
}

function pickKeep(docs) {
    // Ordina per (fonte, pattern, -ts, -id_lex); primo è il "keep"
    const withScore = docs.map(d => ({
        d,
        s: {
            fonte: FONTE_RANK[d.fonte] || 9,
            pattern: PATTERN_RANK[classifyId(d.id)] || 9,
            ts: d.importedAt || d.sync || 0,
            id: d.id,
        },
    }));
    withScore.sort((a, b) => {
        if (a.s.fonte !== b.s.fonte) return a.s.fonte - b.s.fonte;
        if (a.s.pattern !== b.s.pattern) return a.s.pattern - b.s.pattern;
        if (a.s.ts !== b.s.ts) return b.s.ts - a.s.ts;  // più recente prima
        return b.s.id.localeCompare(a.s.id);            // ID maggiore prima (deterministico)
    });
    return { keep: withScore[0].d, drop: withScore.slice(1).map(w => w.d) };
}

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  PULIZIA DUPLICATI Firestore');
    console.log('  Mese: ' + MESE + (FILIALE ? '  Filiale: ' + FILIALE : ''));
    console.log('  Mode: ' + (APPLY ? '🔴 APPLY (cancella)' : '🟡 DRY-RUN (solo report)'));
    console.log('═════════════════════════════════════════════════\n');

    let q = db.collection('consegne').where('mese', '==', MESE);
    if (FILIALE) q = q.where('filiale', '==', String(FILIALE));

    console.log('[1] Carico doc...');
    const snap = await q.get();
    console.log('  → ' + snap.size + ' doc\n');

    console.log('[2] Raggruppa per dedupKey...');
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
            importedAt: c.importedAt && c.importedAt.toMillis ? c.importedAt.toMillis() : 0,
            sync: c.sync && c.sync.toMillis ? c.sync.toMillis() : 0,
        });
    });

    const dupGroups = Object.entries(perKey).filter(([, v]) => v.length > 1);
    console.log('  → ' + dupGroups.length + ' gruppi con >1 doc\n');

    console.log('[3] Analizzo criterio "keep" per ogni gruppo:');
    const toDelete = [];
    const perFilStats = {};
    dupGroups.forEach(([, docs]) => {
        const { keep, drop } = pickKeep(docs);
        toDelete.push(...drop);
        const fil = docs[0].filiale;
        if (!perFilStats[fil]) perFilStats[fil] = { gruppi: 0, deleteCount: 0 };
        perFilStats[fil].gruppi++;
        perFilStats[fil].deleteCount += drop.length;
    });
    console.log('  Doc da cancellare: ' + toDelete.length + '\n');

    console.log('  Per filiale:');
    console.log('    FIL   GRUPPI  DELETE');
    Object.entries(perFilStats).sort((a, b) => b[1].deleteCount - a[1].deleteCount).forEach(([f, s]) => {
        console.log('    ' + f.padEnd(6) + String(s.gruppi).padStart(6) + String(s.deleteCount).padStart(8));
    });

    console.log('\n[4] Sample 5 gruppi (keep/drop):');
    dupGroups.slice(0, 5).forEach(([k, docs]) => {
        const { keep, drop } = pickKeep(docs);
        console.log('  key=' + k);
        console.log('    KEEP  id=' + keep.id.padEnd(45) + ' fonte=' + keep.fonte.padEnd(15) + ' pattern=' + classifyId(keep.id));
        drop.forEach(d => {
            console.log('    DROP  id=' + d.id.padEnd(45) + ' fonte=' + d.fonte.padEnd(15) + ' pattern=' + classifyId(d.id));
        });
    });

    if (!APPLY) {
        console.log('\n  🟡 DRY-RUN — nessuna cancellazione. Rilancia con --apply per procedere.\n');
        return;
    }

    if (!toDelete.length) {
        console.log('\n  ✅ Nulla da cancellare.\n');
        return;
    }

    console.log('\n[5] Cancello ' + toDelete.length + ' doc (batch 400)...');
    let done = 0;
    for (let i = 0; i < toDelete.length; i += 400) {
        const chunk = toDelete.slice(i, i + 400);
        const batch = db.batch();
        chunk.forEach(d => {
            batch.delete(db.collection('consegne').doc(d.id));
        });
        await batch.commit();
        done += chunk.length;
        process.stdout.write('  ' + done + '/' + toDelete.length + '\r');
    }
    console.log('\n  ✅ Cancellati ' + done + ' doc.\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
