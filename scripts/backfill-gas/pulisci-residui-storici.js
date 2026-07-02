// AVR — Pulisci residui storici GAS v3 dalla collection consegne
//
// Elimina 2 categorie di doc obsoleti generati da versioni precedenti del sync:
//   1) ID pattern v3 `_GEN26_r77` / `_FEB26_r123` (row-index, non idempotente).
//      Sempre da rimuovere: la v4.x li ha sostituiti con schema content-based.
//   2) Doc con importo=0 di fonte `gas_v4` o `GAS` (la v4.1+ skippa importo 0,
//      quindi ogni doc di quella fonte con importo 0 è residuo di v3).
//
// Uso:
//   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/legacy_credentials/claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   MESE=2026-06 node pulisci-residui-storici.js              # dry-run
//   MESE=2026-06 node pulisci-residui-storici.js --apply      # cancella

const admin = require('firebase-admin');

const MESE = process.env.MESE || '2026-06';
const APPLY = process.argv.includes('--apply');

admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

// Regex ID v3 row-index: {fil}_{MESE_LABEL}_r{index}
// es. 342_FEB26_r295, 343_GEN26_r77
const V3_ID_RE = /^\d{3,4}_[A-Z]{3}\d{2}_r\d+$/;

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  PULIZIA RESIDUI STORICI GAS v3');
    console.log('  Mese: ' + MESE);
    console.log('  Mode: ' + (APPLY ? '🔴 APPLY' : '🟡 DRY-RUN'));
    console.log('═════════════════════════════════════════════════\n');

    console.log('[1] Carico doc mese=' + MESE + '...');
    const snap = await db.collection('consegne').where('mese', '==', MESE).get();
    console.log('  → ' + snap.size + ' doc\n');

    const toDelete = [];
    const stats = { v3_row_index: 0 };
    const perFil = {};

    snap.forEach(doc => {
        const c = doc.data();
        const fil = String(c.filiale || '?');
        const fonte = c.fonte || '?';
        const importo = c.importo || 0;

        // Categoria 1: ID v3 row-index
        if (V3_ID_RE.test(doc.id)) {
            toDelete.push({ id: doc.id, fil, fonte, reason: 'v3_row_index', importo });
            stats.v3_row_index++;
            perFil[fil] = (perFil[fil] || 0) + 1;
            return;
        }

        // Categoria 2: importo=0 su qualsiasi fonte (nessuno dovrebbe scriverne)
        if (importo === 0) {
            const bucket = 'importo0_' + (fonte || 'unknown').toLowerCase();
            toDelete.push({ id: doc.id, fil, fonte, reason: bucket, importo });
            stats[bucket] = (stats[bucket] || 0) + 1;
            perFil[fil] = (perFil[fil] || 0) + 1;
        }
    });

    console.log('[2] Doc candidati alla rimozione:');
    Object.entries(stats).sort().forEach(([k, v]) => {
        console.log('  ' + k.padEnd(35) + ' ' + v);
    });
    console.log('  ' + 'TOTALE'.padEnd(35) + ' ' + toDelete.length + '\n');

    console.log('[3] Distribuzione per filiale:');
    Object.entries(perFil).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => {
        console.log('  ' + f.padEnd(6) + n);
    });

    console.log('\n[4] Sample 10:');
    toDelete.slice(0, 10).forEach(d => {
        console.log('  ' + d.id.padEnd(45) + ' fil=' + d.fil.padEnd(5) + ' fonte=' + d.fonte.padEnd(15) + ' €' + d.importo + ' motivo=' + d.reason);
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
        chunk.forEach(d => batch.delete(db.collection('consegne').doc(d.id)));
        await batch.commit();
        done += chunk.length;
        process.stdout.write('  ' + done + '/' + toDelete.length + '\r');
    }
    console.log('\n  ✅ Cancellati ' + done + ' doc.\n');
}

main().catch(err => { console.error('❌ Errore:', err.message); console.error(err.stack); process.exit(1); });
