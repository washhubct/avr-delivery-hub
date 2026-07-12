// Diagnosi CORRETTA: uso l'ID doc (che ha data in Europe/Rome) invece del campo
// `data` in UTC che shifta di un giorno.
//
// Uso:
//   cd ~/Progetti/avr-delivery-hub/functions
//   node ../scripts/diagnose-corretto.js

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  DIAGNOSI CORRETTA (parsing ID doc)');
    console.log('═════════════════════════════════════════════════\n');

    const snap = await db.collection('consegne').where('mese', '==', '2026-06').get();
    console.log('Doc totali: ' + snap.size + '\n');

    // Parso ID: filiale_YYYYMMDD_prefix_rowid
    // Alcuni ID hanno formato diverso (es. 342_FEB26_r295) → questi sono i 9 anomali

    const idParsableCount = { ok: 0, altro: 0 };
    const perGiornoGlob = {};
    const perFiliale = {};
    const idAltri = [];

    snap.forEach(doc => {
        const id = doc.id;
        // Match "300_20260603_CT01_11104"
        const m = id.match(/^(\d{3,4})_(\d{8})_/);
        if (m) {
            idParsableCount.ok++;
            const filiale = m[1];
            const giorno = m[2];
            const iso = giorno.slice(0, 4) + '-' + giorno.slice(4, 6) + '-' + giorno.slice(6);
            perGiornoGlob[iso] = (perGiornoGlob[iso] || 0) + 1;
            perFiliale[filiale] = perFiliale[filiale] || {};
            perFiliale[filiale][iso] = (perFiliale[filiale][iso] || 0) + 1;
        } else {
            idParsableCount.altro++;
            idAltri.push(id);
        }
    });

    console.log('Parsing ID: ' + idParsableCount.ok + ' ok, ' + idParsableCount.altro + ' anomali');
    if (idAltri.length > 0 && idAltri.length <= 15) {
        console.log('  IDs anomali:');
        idAltri.forEach(i => console.log('    ' + i));
    }

    // Distribuzione giorno per giorno GLOBALE (corretta)
    console.log('\n[1] Aggregato GLOBALE per giorno (parsing ID = TZ Europe/Rome):\n');
    console.log('  Giorno         Consegne  Bar');
    console.log('  ─────────────────────────────────');
    let totMese = 0;
    for (let g = 1; g <= 30; g++) {
        const iso = '2026-06-' + String(g).padStart(2, '0');
        const n = perGiornoGlob[iso] || 0;
        totMese += n;
        const date = new Date(iso + 'T12:00:00');
        const dow = ['DOM','LUN','MAR','MER','GIO','VEN','SAB'][date.getDay()];
        const bar = '█'.repeat(Math.min(60, Math.floor(n / 15)));
        const flag = n === 0 ? '  ← ZERO' : (n < 100 ? '  ← BASSO' : '');
        console.log('  ' + iso + ' ' + dow + '  ' + String(n).padStart(4) + '  ' + bar + flag);
    }
    console.log('  ─────────────────────────────────');
    console.log('  TOTALE                 ' + totMese);

    // [2] Filiale 300 giorno per giorno (corretta)
    console.log('\n[2] Filiale 300 giorno per giorno (TZ Europe/Rome):\n');
    console.log('  Giorno         Consegne  Bar');
    console.log('  ─────────────────────────────────');
    const f300 = perFiliale['300'] || {};
    let tot300 = 0;
    for (let g = 1; g <= 30; g++) {
        const iso = '2026-06-' + String(g).padStart(2, '0');
        const n = f300[iso] || 0;
        tot300 += n;
        const date = new Date(iso + 'T12:00:00');
        const dow = ['DOM','LUN','MAR','MER','GIO','VEN','SAB'][date.getDay()];
        const bar = '█'.repeat(Math.min(60, Math.floor(n / 3)));
        const flag = n === 0 ? '  ← ZERO' : '';
        console.log('  ' + iso + ' ' + dow + '  ' + String(n).padStart(4) + '  ' + bar + flag);
    }
    console.log('  ─────────────────────────────────');
    console.log('  TOTALE                 ' + tot300 + '     (Sheet dichiara 2344 — delta ' + (2344 - tot300) + ')');

    // [3] Top filiali con verifica gap
    console.log('\n[3] Riepilogo filiali con almeno un gap sospetto (giorni feriali con 0 consegne):\n');
    console.log('  Cod   Consegne  Feriali-zero  Zero-giorni');
    const rows = Object.entries(perFiliale).map(([cod, giorni]) => {
        const tot = Object.values(giorni).reduce((a, b) => a + b, 0);
        const zeroFeriali = [];
        for (let g = 1; g <= 30; g++) {
            const iso = '2026-06-' + String(g).padStart(2, '0');
            const date = new Date(iso + 'T12:00:00');
            const dow = date.getDay();
            const n = giorni[iso] || 0;
            if (n === 0) zeroFeriali.push(g + (dow === 0 ? '(dom)' : ''));
        }
        return { cod, tot, zeroFeriali };
    }).sort((a, b) => b.tot - a.tot);

    rows.forEach(r => {
        if (r.zeroFeriali.length >= 2) {
            console.log('  ' + r.cod.padEnd(5) + String(r.tot).padStart(8) + '  ' + String(r.zeroFeriali.length).padStart(3) + '           ' + r.zeroFeriali.slice(0, 12).join(','));
        }
    });

    // [4] Mappa globale giorni con anomalia + info giorno settimana
    console.log('\n[4] Anomalia diffusa per giorno (filiali attive con zero consegne quel giorno):\n');
    const attive = rows.filter(r => r.tot > 100); // filiali con almeno 100 consegne mese
    console.log('  Filiali "attive" considerate: ' + attive.length + ' (>100 consegne mese)\n');
    console.log('  Giorno         Attive-zero  Dettaglio');
    for (let g = 1; g <= 30; g++) {
        const iso = '2026-06-' + String(g).padStart(2, '0');
        const date = new Date(iso + 'T12:00:00');
        const dow = ['DOM','LUN','MAR','MER','GIO','VEN','SAB'][date.getDay()];
        const zeroCodici = attive.filter(a => !(perFiliale[a.cod] && perFiliale[a.cod][iso])).map(a => a.cod);
        if (zeroCodici.length >= 5) {
            const flag = zeroCodici.length >= 15 ? '  ← BUG SYNC' : '';
            console.log('  ' + iso + ' ' + dow + '     ' + String(zeroCodici.length).padStart(3) + '        ' + zeroCodici.slice(0, 12).join(',') + (zeroCodici.length > 12 ? '...' : '') + flag);
        }
    }

    console.log('\n═════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
