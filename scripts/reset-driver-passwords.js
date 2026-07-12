/**
 * Script: reset-driver-passwords.js
 *
 * Invia email di reset password a tutti i driver presenti in `driverAnagrafica`
 * che hanno un'email valida.
 *
 * ═══ COME USARLO ═══
 * 1. Vai su https://dashboard.avrlogisticarl.com
 * 2. Fai login come amministrazione@avrlogisticarl.com (superadmin)
 * 3. Apri la console del browser (F12 → Console, oppure Cmd+Opt+J su Mac)
 * 4. Copia-incolla TUTTO il contenuto di questo file e premi Invio
 * 5. Conferma il popup
 * 6. Aspetta che lo script finisca (circa 1 secondo per driver)
 *
 * Lo script ha rate limiting di 1 richiesta/secondo per rispettare i limiti di Firebase.
 * Al termine vedrai un riepilogo dei successi e degli eventuali errori.
 */

(async () => {
    console.log('%c🔄 Reset password driver — Last Mile', 'font-size:14px;font-weight:bold;color:#38bdf8');

    // ── Safety: deve esserci un utente loggato ──
    if (typeof auth === 'undefined' || !auth.currentUser) {
        console.error('❌ Devi essere loggato. Fai login come superadmin e riprova.');
        return;
    }
    if (typeof db === 'undefined') {
        console.error('❌ Firestore non disponibile. Sei sulla pagina giusta?');
        return;
    }

    const currentEmail = auth.currentUser.email.toLowerCase();
    const SUPER_ADMIN_EMAILS = ['amministrazione@avrlogisticarl.com'];
    if (SUPER_ADMIN_EMAILS.indexOf(currentEmail) < 0) {
        console.error('❌ Solo il superadmin può lanciare questo script. Utente corrente:', currentEmail);
        return;
    }

    // ── Fetch driver anagrafica ──
    console.log('📥 Carico anagrafica driver...');
    const snap = await db.collection('driverAnagrafica').get();
    const drivers = [];
    snap.forEach(doc => {
        const d = doc.data();
        const email = (d.email || '').toLowerCase().trim();
        if (email && email.indexOf('@') > 0) {
            drivers.push({
                id: doc.id,
                email,
                nome: d.nome || '',
                cognome: d.cognome || '',
                attivo: d.attivo !== false
            });
        }
    });

    if (drivers.length === 0) {
        console.warn('⚠️ Nessun driver con email trovato');
        return;
    }

    // Deduplica per email (evita invii multipli se stesso indirizzo)
    const uniq = new Map();
    drivers.forEach(d => { if (!uniq.has(d.email)) uniq.set(d.email, d); });
    const uniqueDrivers = Array.from(uniq.values());

    const skipped = drivers.length - uniqueDrivers.length;
    console.log(`📋 ${uniqueDrivers.length} driver con email uniche${skipped > 0 ? ' (' + skipped + ' duplicati saltati)' : ''}`);
    console.table(uniqueDrivers.map(d => ({ cognome: d.cognome, nome: d.nome, email: d.email, attivo: d.attivo })));

    // ── Conferma ──
    const ok = confirm(
        '⚠️ Stai per inviare ' + uniqueDrivers.length + ' email di reset password.\n\n' +
        'Ogni driver riceverà un link per impostare una nuova password.\n' +
        'Durata stimata: ~' + Math.ceil(uniqueDrivers.length) + ' secondi.\n\n' +
        'Continuare?'
    );
    if (!ok) {
        console.log('❌ Operazione annullata dall\'utente');
        return;
    }

    // ── Invio con throttling ──
    const results = { ok: [], fail: [] };
    const startedAt = Date.now();

    for (let i = 0; i < uniqueDrivers.length; i++) {
        const d = uniqueDrivers[i];
        const idx = `[${i + 1}/${uniqueDrivers.length}]`;
        try {
            await auth.sendPasswordResetEmail(d.email);
            results.ok.push(d);
            console.log(`%c✅ ${idx} ${d.cognome} ${d.nome} — ${d.email}`, 'color:#10b981');
        } catch (err) {
            results.fail.push({ ...d, error: err.message, code: err.code });
            console.warn(`⚠️ ${idx} ${d.email} → ${err.code}: ${err.message}`);
        }
        // Throttle: 1 richiesta/secondo (Firebase limite ~5/sec ma restiamo conservativi)
        if (i < uniqueDrivers.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    const durata = Math.round((Date.now() - startedAt) / 1000);

    // ── Riepilogo ──
    console.log('\n' + '═'.repeat(50));
    console.log('%c📊 RIEPILOGO', 'font-size:13px;font-weight:bold');
    console.log('═'.repeat(50));
    console.log(`✅ Email inviate: ${results.ok.length}`);
    console.log(`❌ Errori:        ${results.fail.length}`);
    console.log(`⏱️  Durata:        ${durata}s`);

    if (results.fail.length > 0) {
        console.log('\n%cErrori:', 'font-weight:bold;color:#f43f5e');
        console.table(results.fail.map(f => ({ email: f.email, cognome: f.cognome, errore: f.code || f.error })));
        console.log('\nCodici errore comuni:');
        console.log('  • auth/user-not-found  → l\'email non ha un account Firebase Auth (serve crearlo)');
        console.log('  • auth/too-many-requests → Firebase ha bloccato per rate limit, riprova tra qualche minuto');
        console.log('  • auth/invalid-email   → formato email non valido');
    }

    return results;
})();
