// Trova e cancella doc con codice filiale palesemente sbagliato (barcode/codice cliente
// interpretato per errore dal parser XLSX come colonna FIL).
//
// Uso: node cleanup-anomalie.js --dry-run
//      node cleanup-anomalie.js

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    const snap = await db.collection('consegne').where('mese', '==', '2026-06').get();
    const anomali = [];
    snap.forEach(doc => {
        const c = doc.data();
        const fil = String(c.filiale || '');
        // Filiali vere: 3-4 cifre. Anomalie: >5 char o non-numeriche
        if (fil.length > 5 || !/^\d+$/.test(fil)) {
            anomali.push({ id: doc.id, filiale: fil, fonte: c.fonte, sync: c.sync });
        }
    });
    console.log('Doc anomali giugno 2026:', anomali.length);
    anomali.forEach(a => console.log(' -', a.id, '  fil=', a.filiale.slice(0, 30), '  fonte=', a.fonte));

    if (DRY_RUN || anomali.length === 0) return;

    for (let i = 0; i < anomali.length; i += 400) {
        const batch = db.batch();
        anomali.slice(i, i + 400).forEach(a => batch.delete(db.collection('consegne').doc(a.id)));
        await batch.commit();
    }
    console.log('✅ Cancellati', anomali.length, 'doc');
}

main().catch(err => { console.error(err); process.exit(1); });
