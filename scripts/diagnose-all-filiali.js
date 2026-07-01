// Diagnosi consegne per TUTTE le filiali giugno 2026:
//   - giorni con zero consegne per filiale
//   - ultimo timestamp `sync` scritto per filiale (quando il GAS ha toccato per l'ultima volta)
//   - anomalie di ampiezza
//
// Uso:
//   cd ~/Progetti/avr-delivery-hub/functions
//   export GOOGLE_APPLICATION_CREDENTIALS=".../claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   node ../scripts/diagnose-all-filiali.js

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

const MESE = '2026-06';
const MESE_GIORNI = 30; // giugno

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  DIAGNOSI TUTTE LE FILIALI — mese ' + MESE);
    console.log('═════════════════════════════════════════════════\n');

    // Carica anagrafica filiali per avere elenco atteso
    const filialiSnap = await db.collection('filiali').get();
    const filialiMap = {};
    filialiSnap.forEach(doc => {
        const d = doc.data();
        filialiMap[String(d.codice || doc.id)] = { nome: d.nome || '?', area: d.area || '?' };
    });

    console.log('[1/3] Anagrafica: ' + Object.keys(filialiMap).length + ' filiali\n');

    console.log('[2/3] Query consegne mese=' + MESE + '...');
    const t0 = Date.now();
    const snap = await db.collection('consegne').where('mese', '==', MESE).get();
    console.log('  → ' + snap.size + ' documenti in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');

    // Aggrego: per (filiale, giorno) → count. Per filiale → ultimo sync timestamp.
    const perFilialeGiorno = {}; // { "300": { "2026-06-01": 21, ... } }
    const ultimoSyncPerFiliale = {}; // { "300": "2026-06-30T14:00:00Z" }
    const conteggioSyncValues = {}; // distribution del campo `sync`

    snap.forEach(doc => {
        const c = doc.data();
        const cod = String(c.filiale || c.codiceFiliale || '???');
        const d = c.data;
        const iso = d && d.toDate ? d.toDate().toISOString().slice(0, 10) : (typeof d === 'string' ? d.slice(0, 10) : null);
        if (!iso) return;

        perFilialeGiorno[cod] = perFilialeGiorno[cod] || {};
        perFilialeGiorno[cod][iso] = (perFilialeGiorno[cod][iso] || 0) + 1;

        // sync field
        const sv = c.sync;
        if (sv !== undefined) {
            let key;
            if (sv && sv.toDate) key = sv.toDate().toISOString();
            else if (typeof sv === 'string') key = sv;
            else key = String(sv);
            if (!ultimoSyncPerFiliale[cod] || key > ultimoSyncPerFiliale[cod]) {
                ultimoSyncPerFiliale[cod] = key;
            }
            conteggioSyncValues[key] = (conteggioSyncValues[key] || 0) + 1;
        }
    });

    // [3] Report per filiale
    console.log('[3/3] Report per filiale (giugno 2026)\n');
    console.log('  Cod  Area  Consegne  Giorni-zero              Ultimo sync');
    console.log('  ────────────────────────────────────────────────────────────');

    const codiciConsegne = Object.keys(perFilialeGiorno);
    // Aggiungi anche filiali con 0 consegne
    Object.keys(filialiMap).forEach(cod => {
        if (!perFilialeGiorno[cod]) perFilialeGiorno[cod] = {};
    });

    const rows = Object.keys(perFilialeGiorno).map(cod => {
        const perGiorno = perFilialeGiorno[cod];
        const tot = Object.values(perGiorno).reduce((a, b) => a + b, 0);
        const info = filialiMap[cod] || { area: '??', nome: '?' };
        const giorniPresenti = new Set(Object.keys(perGiorno));
        const giorniZero = [];
        for (let g = 1; g <= MESE_GIORNI; g++) {
            const iso = '2026-06-' + String(g).padStart(2, '0');
            if (!giorniPresenti.has(iso)) giorniZero.push(g);
        }
        return {
            cod, area: info.area, nome: info.nome,
            tot,
            giorniZero,
            ultimoSync: ultimoSyncPerFiliale[cod] || '—',
            mediaGiorno: tot / MESE_GIORNI
        };
    }).sort((a, b) => b.tot - a.tot);

    const anomalie = [];
    rows.forEach(r => {
        const zeroStr = r.giorniZero.length === 0
            ? '—'
            : r.giorniZero.length + ' giorni: ' + r.giorniZero.slice(0, 8).join(',') + (r.giorniZero.length > 8 ? '...' : '');
        const syncStr = r.ultimoSync !== '—' ? r.ultimoSync.slice(0, 10) : '—';
        console.log(
            '  ' + r.cod.padEnd(5) +
            r.area.padEnd(6) +
            String(r.tot).padStart(8) + '  ' +
            zeroStr.padEnd(24) + ' ' +
            syncStr
        );
        // Anomalia: giorni-zero sospetti (>3 non consecutivi coi weekend)
        if (r.tot > 0 && r.giorniZero.length >= 3) anomalie.push(r);
        if (r.tot === 0 && filialiMap[r.cod]) {
            anomalie.push({ ...r, tipoAnomalia: 'ZERO_CONSEGNE' });
        }
    });

    console.log('\n═══ ANOMALIE ═══');
    if (anomalie.length === 0) {
        console.log('  Nessuna filiale con gap sospetti.');
    } else {
        anomalie.forEach(a => {
            const flag = a.tipoAnomalia === 'ZERO_CONSEGNE'
                ? '(anagrafica ma nessuna consegna nel mese)'
                : '(giorni mancanti: ' + a.giorniZero.join(',') + ')';
            console.log('  ⚠️  ' + a.cod + ' — ' + (a.nome || '?') + ' ' + flag);
        });
    }

    // Analisi campo `sync`
    console.log('\n═══ CAMPO `sync` (quando il GAS ha scritto) ═══');
    const syncEntries = Object.entries(conteggioSyncValues).sort((a, b) => a[0].localeCompare(b[0]));
    if (syncEntries.length === 0) {
        console.log('  Il campo `sync` non è presente nei doc.');
    } else if (syncEntries.length <= 30) {
        syncEntries.forEach(([k, v]) => console.log('  ' + k + ' → ' + v + ' doc'));
    } else {
        console.log('  ' + syncEntries.length + ' valori distinti. Primi 5 e ultimi 5:');
        syncEntries.slice(0, 5).forEach(([k, v]) => console.log('  ' + k + ' → ' + v + ' doc'));
        console.log('  ...');
        syncEntries.slice(-5).forEach(([k, v]) => console.log('  ' + k + ' → ' + v + ' doc'));
    }

    // Distribuzione GLOBALE dei giorni mancanti
    console.log('\n═══ MAPPA GLOBALE — giorni con anomalia diffusa ═══');
    console.log('  (giorno: filiali che dovrebbero aver consegnato ma non l\'hanno fatto)');
    const filialiAssenzaPerGiorno = {};
    for (let g = 1; g <= MESE_GIORNI; g++) {
        const iso = '2026-06-' + String(g).padStart(2, '0');
        filialiAssenzaPerGiorno[iso] = 0;
    }
    // Solo per le filiali che hanno consegnato almeno una volta nel mese
    rows.filter(r => r.tot > 0).forEach(r => {
        r.giorniZero.forEach(g => {
            const iso = '2026-06-' + String(g).padStart(2, '0');
            filialiAssenzaPerGiorno[iso]++;
        });
    });
    console.log('  Giorno       Filiali senza consegna (su ' + rows.filter(r => r.tot > 0).length + ' attive)');
    console.log('  ─────────────────────────────────────────');
    Object.entries(filialiAssenzaPerGiorno)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .forEach(([g, n]) => {
            const bar = '█'.repeat(n);
            const flag = n >= 15 ? '  ← sync fallito quasi totale' : (n >= 5 ? '  ← sospetto' : '');
            console.log('  ' + g + '   ' + String(n).padStart(3) + '  ' + bar + flag);
        });

    console.log('\n═════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
