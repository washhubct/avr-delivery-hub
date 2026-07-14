// BACKFILL driverEmail sui doc `danni` esistenti.
//
// COME SI USA (una tantum, ~2 minuti):
//   1. Apri la dashboard (dashboard.avrlogisticarl.com) loggato come ADMIN
//   2. Apri la console del browser (⌥⌘J) e incolla tutto questo file
//   3. Lo script stampa un'anteprima; per applicare davvero esegui:  backfillDanni(false)
//
// Matcha danni.driver (cognome) con driverAnagrafica.cognome e scrive
// driverEmail in lowercase. I danni senza match restano invariati (elencati).
// Le rules permettono la write perché sei admin. Nessun altro campo toccato.

async function backfillDanni(dryRun) {
  if (dryRun === undefined) dryRun = true;
  const anag = await db.collection('driverAnagrafica').get();
  const byCognome = {};
  anag.docs.forEach(function (d) {
    const x = d.data();
    if (x.cognome && x.email) byCognome[String(x.cognome).toUpperCase().trim()] = String(x.email).toLowerCase();
  });

  const danni = await db.collection('danni').get();
  let daAggiornare = 0, senzaMatch = [];
  for (const doc of danni.docs) {
    const d = doc.data();
    if (d.driverEmail) continue; // già fatto
    const email = byCognome[String(d.driver || '').toUpperCase().trim()];
    if (!email) { senzaMatch.push(doc.id + ' → driver "' + d.driver + '"'); continue; }
    daAggiornare++;
    console.log((dryRun ? '[DRY] ' : '[OK]  ') + doc.id + ': ' + d.driver + ' → ' + email);
    if (!dryRun) await db.collection('danni').doc(doc.id).update({ driverEmail: email });
  }
  console.log('---');
  console.log('Totale danni: ' + danni.size + ' · da aggiornare: ' + daAggiornare + ' · senza match: ' + senzaMatch.length);
  if (senzaMatch.length) console.log('Senza match (verifica a mano):\n' + senzaMatch.join('\n'));
  if (dryRun) console.log('\n⚠️ ANTEPRIMA — per applicare: backfillDanni(false)');
}

backfillDanni(true);
