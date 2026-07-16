# Push notification per la Driver App

Stato: **client pronto** (branch `refactor/fase1-moduli-pwa` di driveravrapp) e
**server pronto** (le 4 Cloud Functions sono in `functions/index.js` su questo
branch). Per attivare mancano solo le chiavi VAPID e i deploy (passi sotto).

## Attivazione — passi manuali (Guido)

1. **Genera la coppia VAPID** (una volta sola — la console Firebase non espone
   la chiave privata, quindi si genera in locale):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. **Salva le chiavi come secret** delle Functions:
   ```bash
   cd avr-delivery-hub
   firebase functions:secrets:set VAPID_PUBLIC_KEY --project avr-logistic-dashboard
   firebase functions:secrets:set VAPID_PRIVATE_KEY --project avr-logistic-dashboard
   ```
3. **Chiave pubblica nel client**: incolla la stessa chiave pubblica in
   `driveravrapp/js/push.js` → `VAPID_PUBLIC_KEY` (finché è vuota il modulo è
   un no-op). Poi bump `CACHE_VERSION` + `?v=` come da convenzione.
4. **Rules**: il blocco `pushSubscriptions` è già in `firestore.rules` su
   questo branch — revisione + deploy da console.
5. **Deploy functions**: `cd functions && npm run deploy`.

## Cloud Functions implementate

| Function | Trigger | Notifica |
|---|---|---|
| `pushPromemoriaReport` | `onSchedule` 21:00 Rome | Driver con turno ancora aperto oggi e 0 report → "Ricordati di registrare le consegne di oggi 📦" |
| `pushEsitoRitorno` | `onDocumentUpdated('ritorni/{id}')` quando `stato` diventa accettato/rifiutato | "Il tuo ritorno per CLIENTE è stato accettato ✓ / rifiutato ✕" |
| `pushEsitoSegnalazione` | `onDocumentUpdated('segnalazioni/{id}')` quando `stato` diventa `risolta` | "La tua segnalazione «TIPO» è stata risolta ✓" |
| `pushPodioMensile` | `onSchedule` 18:00 del 28–31, scatta solo se domani è il giorno 1 | Top 3 di `leaderboardFull/{mese}` → "🥇 Sei sul podio! 🏆" (match per cognome su `pushSubscriptions.driver`) |

Invio con `web-push` (npm) + coppia VAPID nei secret. Subscription morte
(404/410) → delete del doc `pushSubscriptions`. Payload: `{ title, body, url }`
— il formato che il service worker dell'app si aspetta.

## Flusso lato app (già implementato)

- Al primo avvio turno l'app chiede il permesso notifiche
- La subscription viene salvata in `pushSubscriptions/{auto}` con `email`, `driver`, `subscription`, `userAgent`
- Il service worker gestisce `push` (mostra la notifica) e `notificationclick` (apre l'app)
