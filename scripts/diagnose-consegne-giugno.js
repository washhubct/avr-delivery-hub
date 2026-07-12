// Script diagnostico consegne giugno 2026.
// Confronta count Firestore per filiale + rileva anomalie di sync.
//
// Uso:
//   cd ~/Progetti/avr-delivery-hub
//   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/legacy_credentials/claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   node scripts/diagnose-consegne-giugno.js
//
// Non modifica dati — solo READ.

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

const MESE = process.env.MESE || '2026-06';

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  DIAGNOSI CONSEGNE — mese ' + MESE);
    console.log('═════════════════════════════════════════════════\n');

    console.log('[1/4] Query consegne mese=' + MESE + '...');
    const t0 = Date.now();
    const snap = await db.collection('consegne').where('mese', '==', MESE).get();
    console.log('  → ' + snap.size + ' documenti in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');

    if (snap.empty) {
        console.log('❌ Nessuna consegna trovata per il mese ' + MESE);
        console.log('   Possibile causa: GAS sync non è mai partito per questo mese');
        console.log('   oppure il campo `mese` ha un formato diverso.\n');

        // Prova sample senza filtro per capire formato
        const sample = await db.collection('consegne').limit(5).get();
        if (!sample.empty) {
            console.log('   Sample doc (per capire schema):');
            const d = sample.docs[0].data();
            console.log('   fields:', Object.keys(d).slice(0, 20));
            console.log('   mese esempio:', JSON.stringify(d.mese));
            console.log('   data esempio:', JSON.stringify(d.data));
        }
        return;
    }

    // [2] Aggrega per filiale
    console.log('[2/4] Aggregazione per filiale...\n');
    const perFiliale = {};
    const perFilialeInterne = {};
    let totInterne = 0;
    let totConSpedizione = 0;
    let sampleFiliale300 = null;

    snap.forEach(doc => {
        const c = doc.data();
        const cod = String(c.codiceFiliale || c.filialeCodice || c.filiale || '???');
        const interna = !!(c.interna === true || c.tipoConsegna === 'interna');

        if (interna) {
            totInterne++;
            perFilialeInterne[cod] = (perFilialeInterne[cod] || 0) + 1;
        } else {
            totConSpedizione++;
            perFiliale[cod] = (perFiliale[cod] || 0) + 1;
        }

        if (cod === '300' && !sampleFiliale300) sampleFiliale300 = c;
    });

    if (sampleFiliale300) {
        console.log('  Sample doc filiale 300 (per verificare schema):');
        console.log('  ', JSON.stringify({
            codiceFiliale: sampleFiliale300.codiceFiliale,
            filiale: sampleFiliale300.filiale,
            interna: sampleFiliale300.interna,
            tipoConsegna: sampleFiliale300.tipoConsegna,
            driver: sampleFiliale300.driver || sampleFiliale300.driverEmail,
            importo: sampleFiliale300.importo,
            data: sampleFiliale300.data && sampleFiliale300.data.toDate
                ? sampleFiliale300.data.toDate().toISOString()
                : sampleFiliale300.data,
            mese: sampleFiliale300.mese
        }, null, 2));
        console.log('');
    }

    // [3] Top filiali per numero consegne
    console.log('[3/4] Top 15 filiali per numero consegne (esterne + interne)\n');
    const codici = new Set([
        ...Object.keys(perFiliale),
        ...Object.keys(perFilialeInterne)
    ]);
    const rows = Array.from(codici).map(cod => {
        const est = perFiliale[cod] || 0;
        const int = perFilialeInterne[cod] || 0;
        return { cod, est, int, tot: est + int };
    }).sort((a, b) => b.tot - a.tot);

    console.log('  Filiale   Esterne  Interne   Totale');
    console.log('  ─────────────────────────────────────');
    rows.slice(0, 15).forEach(r => {
        const flag = r.cod === '300' ? '  ← FILIALE 300' : '';
        console.log(
            '  ' + r.cod.padEnd(9) +
            String(r.est).padStart(7) + '  ' +
            String(r.int).padStart(7) + '  ' +
            String(r.tot).padStart(7) +
            flag
        );
    });

    // Riepilogo 300
    const f300Est = perFiliale['300'] || 0;
    const f300Int = perFilialeInterne['300'] || 0;
    const f300Tot = f300Est + f300Int;
    console.log('\n  ═══ FILIALE 300 ═══');
    console.log('  Esterne (Last Mile): ' + f300Est);
    console.log('  Interne:             ' + f300Int);
    console.log('  Totale:              ' + f300Tot);
    console.log('  Sheet dichiara:      2344');
    console.log('  Differenza:          ' + (2344 - f300Tot) + (f300Tot < 2344 ? ' (MANCANTI in Firestore)' : ' (extra in Firestore)'));

    // [4] Totali generali
    console.log('\n[4/4] Totali generali');
    console.log('  Filiali distinte:            ' + rows.length);
    console.log('  Consegne Last Mile:          ' + totConSpedizione);
    console.log('  Consegne interne (escluse):  ' + totInterne);
    console.log('  TOTALE Firestore:            ' + (totConSpedizione + totInterne));
    console.log('  Dashboard mostrava:          5722 (Last Mile) + 1146 (interne) = 6868');
    console.log('  Delta:                       ' + ((totConSpedizione + totInterne) - 6868));

    // Analisi range date del mese
    console.log('\n[bonus] Range date consegne trovate:');
    const dates = [];
    snap.forEach(doc => {
        const d = doc.data().data;
        const iso = d && d.toDate ? d.toDate().toISOString().slice(0, 10) : (typeof d === 'string' ? d.slice(0, 10) : null);
        if (iso && iso.startsWith('2026-06')) dates.push(iso);
    });
    dates.sort();
    if (dates.length) {
        console.log('  Prima data:  ' + dates[0]);
        console.log('  Ultima data: ' + dates[dates.length - 1]);
        // Conteggio per giorno
        const perGiorno = {};
        dates.forEach(d => { perGiorno[d] = (perGiorno[d] || 0) + 1; });
        const giorni = Object.keys(perGiorno).sort();
        console.log('  Giorni con almeno 1 consegna: ' + giorni.length + ' / 30');
        // Trova giorni mancanti/sospetti
        const missing = [];
        for (let d = 1; d <= 30; d++) {
            const iso = '2026-06-' + String(d).padStart(2, '0');
            if (!perGiorno[iso]) missing.push(iso);
        }
        if (missing.length) {
            console.log('  ⚠️  Giorni SENZA nessuna consegna:');
            missing.forEach(m => console.log('     - ' + m));
        }
    }

    console.log('\n═════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
