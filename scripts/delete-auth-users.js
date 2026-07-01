// Cancella account Firebase Auth per lista di email.
// Uso:
//   cd ~/Progetti/avr-delivery-hub/functions
//   export GOOGLE_APPLICATION_CREDENTIALS=".../claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   node ../scripts/delete-auth-users.js

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'avr-logistic-dashboard' });

const EMAILS = [
    'michela@avrlogisticarl.com',
    'alessandra@avrlogisticarl.com',
];

async function main() {
    console.log('\n═══ Cancellazione account Firebase Auth ═══\n');
    for (const email of EMAILS) {
        try {
            const user = await admin.auth().getUserByEmail(email);
            console.log(`Trovato: ${email} (uid=${user.uid}, created=${user.metadata.creationTime})`);
            await admin.auth().deleteUser(user.uid);
            console.log(`  ✓ Cancellato\n`);
        } catch (e) {
            if (e.code === 'auth/user-not-found') {
                console.log(`${email}: già inesistente\n`);
            } else {
                console.error(`${email}: ERRORE ${e.code || e.message}\n`);
            }
        }
    }
    console.log('═══ Done ═══\n');
}

main().catch(err => { console.error(err); process.exit(1); });
