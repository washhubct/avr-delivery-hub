// Bug hunt: perché il sync GAS perde consegne?
//
// Analizza:
//   - Aggregato consegne per giorno GLOBALE (tutte filiali)
//   - Schema ID doc (per capire idempotenza)
//   - Correlazione data consegna ↔ timestamp `sync` (quando è stato scritto)
//   - Campo `data` sospetto (Date? String? malformato?)
//
// Uso:
//   cd ~/Progetti/avr-delivery-hub/functions
//   export GOOGLE_APPLICATION_CREDENTIALS=".../claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   node ../scripts/diagnose-sync-bug.js

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

const MESE = '2026-06';

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  BUG HUNT SYNC GAS — mese ' + MESE);
    console.log('═════════════════════════════════════════════════\n');

    const snap = await db.collection('consegne').where('mese', '==', MESE).get();
    console.log('Doc totali: ' + snap.size + '\n');

    // [1] Distribuzione GLOBALE per giorno (tutte le filiali)
    const perGiorno = {};
    const idPattern = { count: 0, samples: [] };
    const syncPerGiorno = {}; // giorno consegna → array di timestamp sync
    const campiPresenti = {};

    snap.forEach(doc => {
        const c = doc.data();
        const id = doc.id;
        if (idPattern.count < 20) {
            idPattern.samples.push(id);
        }
        idPattern.count++;

        const d = c.data;
        let iso;
        if (d && d.toDate) iso = d.toDate().toISOString().slice(0, 10);
        else if (typeof d === 'string') iso = d.slice(0, 10);
        else iso = 'INVALID';

        perGiorno[iso] = (perGiorno[iso] || 0) + 1;

        // Sync timestamp
        if (c.sync !== undefined) {
            const sv = c.sync;
            let syncIso;
            if (sv && sv.toDate) syncIso = sv.toDate().toISOString();
            else if (typeof sv === 'string') syncIso = sv;
            else syncIso = String(sv);
            if (!syncPerGiorno[iso]) syncPerGiorno[iso] = [];
            syncPerGiorno[iso].push(syncIso);
        }

        // Presenza campi
        Object.keys(c).forEach(k => {
            campiPresenti[k] = (campiPresenti[k] || 0) + 1;
        });
    });

    // [2] Aggregato giorno per giorno GLOBALE
    console.log('[1/5] Aggregato GLOBALE consegne per giorno (tutte le filiali):\n');
    console.log('  Giorno         Consegne  Bar');
    console.log('  ─────────────────────────────────');
    let totMese = 0;
    for (let g = 1; g <= 30; g++) {
        const iso = '2026-06-' + String(g).padStart(2, '0');
        const n = perGiorno[iso] || 0;
        totMese += n;
        // Giorno settimana
        const date = new Date('2026-06-' + String(g).padStart(2, '0') + 'T12:00:00');
        const dow = ['DOM','LUN','MAR','MER','GIO','VEN','SAB'][date.getDay()];
        const bar = '█'.repeat(Math.min(60, Math.floor(n / 15)));
        const flag = n === 0 ? '  ← ZERO' : (n < 100 ? '  ← BASSO' : '');
        console.log('  ' + iso + ' ' + dow + '  ' + String(n).padStart(4) + '  ' + bar + flag);
    }
    console.log('  ─────────────────────────────────');
    console.log('  TOTALE                 ' + totMese);
    const mediaFeriale = totMese / 26; // circa
    console.log('  Media/giorno feriale ~ ' + Math.round(mediaFeriale));

    // [3] Sample ID doc pattern
    console.log('\n[2/5] Sample ID doc (per capire idempotenza sync):\n');
    idPattern.samples.slice(0, 10).forEach(id => console.log('  ' + id));

    // [4] Timestamp sync per giorno consegna
    console.log('\n[3/5] Correlazione data consegna ↔ ultimo sync (quando GAS ha scritto):');
    console.log('  Giorno         Primo sync         Ultimo sync        Delta ore');
    console.log('  ──────────────────────────────────────────────────────────────');
    for (let g = 1; g <= 30; g++) {
        const iso = '2026-06-' + String(g).padStart(2, '0');
        const arr = syncPerGiorno[iso] || [];
        if (arr.length === 0) {
            const totC = perGiorno[iso] || 0;
            if (totC > 0) console.log('  ' + iso + '        (nessun sync ts)');
            continue;
        }
        arr.sort();
        const primo = arr[0];
        const ultimo = arr[arr.length - 1];
        const delta = (new Date(ultimo) - new Date(primo)) / (1000 * 3600);
        console.log('  ' + iso + '  ' + primo.slice(0, 19) + '  ' + ultimo.slice(0, 19) + '  ' + delta.toFixed(1) + 'h');
    }

    // [5] Campi presenti (per capire schema)
    console.log('\n[4/5] Frequenza campi (su ' + snap.size + ' doc):');
    Object.entries(campiPresenti)
        .sort((a, b) => b[1] - a[1])
        .forEach(([k, n]) => {
            const pct = ((n / snap.size) * 100).toFixed(1);
            const flag = pct < 100 ? '  ← non 100%' : '';
            console.log('  ' + k.padEnd(20) + String(n).padStart(6) + '  (' + pct + '%)' + flag);
        });

    // [6] Recupero: giorni bassi/zero — analisi dettagliata
    console.log('\n[5/5] Giorni sospetti (feriali con <100 consegne globali):');
    for (let g = 1; g <= 30; g++) {
        const iso = '2026-06-' + String(g).padStart(2, '0');
        const n = perGiorno[iso] || 0;
        const date = new Date(iso + 'T12:00:00');
        const dow = date.getDay();
        if (dow === 0) continue; // domenica esclusa (normale)
        if (n < 100) {
            const dowStr = ['DOM','LUN','MAR','MER','GIO','VEN','SAB'][dow];
            console.log('  ' + iso + ' ' + dowStr + ' → ' + n + ' consegne — sync ts unico? ' +
                (syncPerGiorno[iso] ? syncPerGiorno[iso].length + ' timestamps' : 'nessuno'));
        }
    }

    console.log('\n═════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
