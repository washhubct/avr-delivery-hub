// Focus filiale 300 giugno 2026: distribuzione per giorno + campi mancanti.
// Uso:
//   cd ~/Progetti/avr-delivery-hub/functions
//   export GOOGLE_APPLICATION_CREDENTIALS=".../claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   node ../scripts/diagnose-filiale-300.js

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

const MESE = '2026-06';
const FILIALE = '300';

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  DIAGNOSI APPROFONDITA FILIALE ' + FILIALE + ' — mese ' + MESE);
    console.log('═════════════════════════════════════════════════\n');

    const snap = await db.collection('consegne').where('mese', '==', MESE).get();
    const soloF = snap.docs.filter(d => String(d.data().filiale) === FILIALE || String(d.data().codiceFiliale) === FILIALE);
    console.log('Trovate ' + soloF.length + ' consegne filiale ' + FILIALE + ' in Firestore\n');

    // Distribuzione per giorno
    const perGiorno = {};
    const perDriverCount = {};
    let conTipoDriver = 0;
    let conTipoDriverInterna = 0;
    let senzaDriverField = 0;
    let senzaImporto = 0;
    let importiZero = 0;
    const campiPresenti = new Set();

    soloF.forEach(doc => {
        const c = doc.data();
        Object.keys(c).forEach(k => campiPresenti.add(k));

        const d = c.data;
        const iso = d && d.toDate ? d.toDate().toISOString().slice(0, 10) : (typeof d === 'string' ? d.slice(0, 10) : 'N/A');
        perGiorno[iso] = (perGiorno[iso] || 0) + 1;

        const drv = (c.driver || c.rider || '').trim();
        if (!drv) senzaDriverField++;
        else perDriverCount[drv] = (perDriverCount[drv] || 0) + 1;

        if (c.tipoDriver !== undefined) conTipoDriver++;
        if (c.tipoDriver === 'interna') conTipoDriverInterna++;

        if (c.importo === undefined || c.importo === null) senzaImporto++;
        else if (c.importo === 0) importiZero++;
    });

    console.log('Campi presenti nei doc filiale ' + FILIALE + ':');
    console.log('  ', Array.from(campiPresenti).sort().join(', '));

    console.log('\nSemantica campi:');
    console.log('  Con campo `tipoDriver`:      ' + conTipoDriver + ' / ' + soloF.length);
    console.log('  di cui tipoDriver=interna:   ' + conTipoDriverInterna);
    console.log('  Senza driver/rider popolato: ' + senzaDriverField);
    console.log('  Senza campo importo:         ' + senzaImporto);
    console.log('  Importo=0:                   ' + importiZero);

    console.log('\nDistribuzione per giorno (giugno 2026):');
    console.log('  Giorno       Consegne');
    console.log('  ────────────────────');
    for (let d = 1; d <= 30; d++) {
        const iso = '2026-06-' + String(d).padStart(2, '0');
        const n = perGiorno[iso] || 0;
        const bar = '█'.repeat(Math.min(60, Math.floor(n / 3)));
        const flag = n === 0 ? '  ← VUOTO' : (n < 20 ? '  ← basso' : '');
        console.log('  ' + iso + '  ' + String(n).padStart(4) + '  ' + bar + flag);
    }
    const tot = Object.values(perGiorno).reduce((a, b) => a + b, 0);
    const media = tot / Object.keys(perGiorno).length;
    console.log('  ────────────────────');
    console.log('  TOTALE          ' + tot);
    console.log('  Media/giorno    ' + media.toFixed(1));
    console.log('  Sheet dichiara  2344');
    console.log('  Mancanti stimati ' + (2344 - tot));

    console.log('\nTop 10 driver in filiale ' + FILIALE + ':');
    const drivers = Object.entries(perDriverCount).sort((a, b) => b[1] - a[1]);
    drivers.slice(0, 10).forEach(([d, n]) => {
        console.log('  ' + d.padEnd(30) + ' ' + String(n).padStart(4));
    });
    console.log('  ... totale driver distinti: ' + drivers.length);

    // Verifica: se manca importo o driver, sono skippate dal GAS oppure sono in DB con schema parziale?
    if (senzaDriverField > 0) {
        console.log('\n⚠️  ' + senzaDriverField + ' consegne SENZA campo driver — probabilmente non fatturabili né classificabili');
    }

    console.log('\n═════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
