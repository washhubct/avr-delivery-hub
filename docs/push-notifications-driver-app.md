# Push notification per la Driver App — proposta

Stato: **client pronto** (branch `refactor/fase1-moduli-pwa` di driveravrapp), manca la parte server (questo repo) e una chiave.

## Cosa serve per attivarle

1. **Chiave VAPID** (2 minuti): Firebase Console → Impostazioni progetto → Cloud Messaging → Web Push certificates → "Generate key pair". La chiave **pubblica** va incollata in `driveravrapp/js/push.js` (`VAPID_PUBLIC_KEY`).
2. **Rules**: il blocco `pushSubscriptions` è già in questo branch (`firestore.rules`) — revisione + deploy da console.
3. **Cloud Functions di invio** (da implementare qui in `functions/index.js`, stack v2 già in uso):

| Trigger | Notifica |
|---|---|
| `onSchedule('0 21 * * *')` | Driver con turno aperto oggi e 0 report → "Ricordati di registrare le consegne di oggi 📦" |
| `onDocumentUpdated('ritorni/{id}')` se cambia `stato` | "Il tuo ritorno per CLIENTE è stato accettato ✓ / rifiutato ✕" |
| `onDocumentUpdated('segnalazioni/{id}')` se cambia `stato` | "La tua segnalazione è stata risolta" |
| `onSchedule` ultimo giorno del mese | Top 3 classifica → "Sei sul podio! 🏆" |

Invio: `firebase-admin` legge `pushSubscriptions` per email del driver e usa `web-push` (npm) con la coppia VAPID. Subscription scadute (410) → delete del doc.

## Flusso lato app (già implementato)

- Al primo avvio turno l'app chiede il permesso notifiche
- La subscription viene salvata in `pushSubscriptions/{auto}` con `email`, `driver`, `subscription`, `userAgent`
- Il service worker gestisce `push` (mostra la notifica) e `notificationclick` (apre l'app)
