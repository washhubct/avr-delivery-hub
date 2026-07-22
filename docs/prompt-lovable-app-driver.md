# Prompt DEFINITIVO per lovable.dev — App Driver "Last Mile"

> Copia tutto da qui in giù nel prompt di Lovable. I valori reali
> (config Firebase, nomi di campi e collezioni) sono inclusi e NON
> vanno cambiati: devono restare compatibili con la dashboard esistente.

---

Costruisci una **PWA mobile-first per i driver di Last Mile (AVR Logistic)**, azienda di consegne last-mile in Sicilia (~30 driver dipendenti). L'app si collega a un **backend Firebase già esistente e in produzione** condiviso con la dashboard admin: NON creare un nuovo backend, NON modificare lo schema dati. Usa esattamente collezioni e campi indicati sotto, altrimenti la dashboard smette di funzionare.

## Stack e vincoli

- React + Tailwind (stack Lovable standard), **Firebase JS SDK**: Auth (email/password) + Firestore.
- Config Firebase da usare così com'è:
```js
{
  apiKey: "AIzaSyCleejDdWN6w41TcBw4fvyAPr_6rxU8Bgs",
  authDomain: "avr-logistic-dashboard.firebaseapp.com",
  projectId: "avr-logistic-dashboard",
  storageBucket: "avr-logistic-dashboard.firebasestorage.app",
  messagingSenderId: "323721042739",
  appId: "1:323721042739:web:a9fa1710eeb8cfe3357c46"
}
```
- Tutte le date "di lavoro" (oggi, mese corrente) calcolate nel fuso **Europe/Rome**, mai con `toISOString()` diretto.
- PWA installabile (manifest + icona), deve funzionare bene su Android Chrome e iPhone Safari. Lingua: **italiano**.
- **Sessione persistente**: Firebase Auth con persistenza locale. Il driver fa il login UNA volta; mai signOut automatici. Alle 01:00 di notte fai solo un refresh dello stato del giorno (reload), SENZA logout: la mattina il driver apre l'app e lavora subito.

## Design

Brand "Last Mile": premium logistics. Palette: **midnight navy** (#0f1d3d / #080b12) + **electric teal** (#38bdf8), card bianche. Font: DM Sans (testi) + JetBrains Mono (numeri/orari). Bottoni grandi (min 48px), uso a una mano, bottom navigation con 6 tab: **Oggi, Nuova, Classifica, Segnala, Consegne, Profilo**. Microcopy italiano colloquiale ("Ciao Marco!", "Si va! 🚀").

## Identità e accesso

- Login email/password Firebase Auth. Password reset: POST a `https://europe-west1-avr-logistic-dashboard.cloudfunctions.net/requestPasswordReset` con `{email}` (risposta sempre generica).
- Dopo il login carica il profilo da `driverAnagrafica` con `where('email','==', email.toLowerCase())`. Se non esiste: schermata di blocco "account non abilitato — contatta amministrazione@avrlogisticarl.com" + logout.
- Campi profilo gestiti dall'admin: `cognome, nome, citta (CT|ME|EN|SR|PA), contratto, email, attivo`.

## FLUSSO DI APERTURA GIORNALIERO (ordine obbligatorio)

Ogni giorno, all'apertura dell'app (sessione già attiva, niente login):

1. **TIMBRATURA INGRESSO — viene PRIMA di tutto.** Controlla se oggi esiste già una timbratura `in` del driver (query su `timbrature`: `driverId == email` AND `giorno == oggi`). Se NON esiste, mostra a schermo intero la schermata "Timbra il tuo ingresso" (dettagli nella sezione Timbratura sotto). Contiene anche un bottone secondario "Timbro col badge in sede →" per chi usa il terminale fisico dell'hub: salta al passo 2 senza scrivere nulla.
2. **TARGA / INIZIO TURNO.** Overlay "Inizia il turno": input targa furgone (obbligatoria, min 5 caratteri, uppercase). Alla conferma scrivi su `turniDriver`:
```
{ driver: COGNOME_UPPERCASE, driverNome, email: lowercase, targa, citta,
  data: "YYYY-MM-DD", oraInizio: "HH:MM", timestamp: serverTimestamp() }
```
3. **PROFILO OBBLIGATORIO.** Se il profilo non è completo (vedi sezione Profilo), overlay bloccante "Completa il tuo profilo" con UNICO bottone "Completa ora →" che porta al form profilo. **Niente "più tardi"**: l'overlay ricompare a ogni apertura finché i dati non sono completi.
4. Home (tab Oggi).

## TIMBRATURA — solo tag NFC, niente fotocamera e niente QR

In ogni sede provinciale (CT, ME, EN, SR, PA) c'è un **tag NFC** scritto con un URL del tipo:
```
https://<dominio-app>/?timbra=CT&t=TOKEN&via=nfc
```
Il driver avvicina il telefono al tag → il sistema operativo (Android e iPhone) apre l'app con quei parametri. NON implementare scanner QR né accesso alla fotocamera.

Alla ricezione dei parametri (`timbra` = provincia, `t` = token):
1. Pulisci l'URL con `history.replaceState` (il token non deve restare nella barra).
2. Leggi `puntiTimbratura/{provincia}`: `{ provincia, nome, geo:{lat,lng,raggioMt}, qrTokenHash, attivo }`. Se `attivo === false` → blocca con messaggio.
3. Verifica il token: `SHA-256(t)` in hex (WebCrypto) deve essere uguale a `qrTokenHash`. Diverso → blocca: "Tag non valido o scaduto, segnalalo in sede".
4. **Verso automatico**: la prima timbratura del giorno è `in`, le successive sono `out` (se c'è già una out, chiedi conferma "aggiorno l'orario di uscita?"). Mostra conferma grande: "Registro il tuo INGRESSO 🟢" / "USCITA 🔴" + bottone conferma.
5. **Geolocalizzazione**: leggi la posizione (high accuracy, timeout 10s). Calcola la distanza haversine dal punto: se > `raggioMt` + accuratezza (max 50m di tolleranza) oppure GPS negato/assente → NON bloccare ma marca `sospetto: true` con `note` esplicativa (es. "Fuori raggio: 340m" / "GPS non disponibile"). Accuratezza > 150m → `sospetto: true`.
6. Scrivi su `timbrature` (le security rules validano questi campi esatti):
```
{ driverId: email lowercase, driverNome: "Cognome Nome",
  filialeId: provincia, citta: provincia, tipo: 'in'|'out',
  timestamp: serverTimestamp(), giorno: 'YYYY-MM-DD' (Europe/Rome),
  mese: 'YYYY-MM', fonte: 'app', metodo: 'app-nfc-geo',
  qrTokenLetto: primi 12 hex dell'hash, lat, lng, accuracy,
  idTerminale: null, sospetto: bool, note: string|null }
```
7. Dopo l'ingresso, se il turno non è ancora iniziato → passa direttamente all'overlay targa.

**PRIVACY TIMBRATURE — IMPORTANTE**: il driver NON deve vedere le proprie timbrature. Niente storico, niente orari IN/OUT visualizzati, niente elenco: solo il toast di conferma al momento della timbratura ("🟢 Ingresso timbrato!"). I dati li vede solo l'amministrazione in dashboard. In app al massimo un promemoria statico "Ricordati di timbrare con il tag in sede".

## PROFILO OBBLIGATORIO (i dati arrivano automaticamente in dashboard)

Tab Profilo con form dati personali, TUTTI obbligatori:
- **Codice fiscale** (16 caratteri, uppercase, validazione formato)
- **Numero patente** (uppercase, obbligatorio)
- **Scadenza patente** (data, obbligatoria; se scaduta mostra avviso rosso)
- **Telefono** (obbligatorio)
- **Data di nascita** (obbligatoria)
- **Indirizzo di residenza** (obbligatorio)

Salvataggio: `updateDoc` sul PROPRIO doc `driverAnagrafica` con SOLO questi campi (le rules bloccano tutto il resto): `codiceFiscale, numeroPatente, scadenzaPatente, telefono, dataNascita, indirizzo, profiloCompletatoIl: serverTimestamp()`. La dashboard legge lo stesso documento: nessun'altra sincronizzazione necessaria. Profilo completo = tutti e sei i campi valorizzati; finché manca qualcosa, overlay bloccante a ogni apertura (vedi flusso). Nel profilo mostra anche: nome, città, contratto (sola lettura), targa di oggi con "cambia", statistiche personali (totale consegne, giorni attivi), logout manuale.

## Tab "Nuova" — registrazione consegne (cuore dell'app)

I driver registrano le consegne **a blocchi per fascia oraria**. Form:
- Data (default oggi, min 2026-04-01, max oggi, bottone "Oggi")
- Filiale: select da collection `filiali` (`codice, nome, area`), filtrata sull'area del driver, ordinata per nome
- Fascia oraria: 10:00–12:00 / 12:00–14:00 / 14:00–16:00 / 16:00–18:00 / 18:00–20:00 (valore salvato: ora inizio, es. "10:00")
- Numero consegne: 1–10
- **Orario del giro (obbligatorio)**: ora inizio (precompilata con l'inizio fascia) e ora fine. Validazioni: fine > inizio; durata ≤ 720 min; durata ≥ 2 min × n° consegne; inizio fuori fascia oltre 1h → conferma soft.
- Note opzionali. Blocco duplicati stessa data+filiale+fascia.

Scrittura su `reportDriver` (rules rigide, rispetta i tipi):
```
{ filiale: "301", filialeNome, fascia: "10:00", numConsegne: int 1-10,
  note, driver: COGNOME_UPPERCASE, driverEmail: lowercase, targa,
  data: Timestamp (mezzogiorno della data scelta), mese: "YYYY-MM",
  area, oraInizio: "HH:MM", oraFine: "HH:MM",
  durataMin: number 1-720, tempoMedioMin: number (1 decimale),
  fonte: "driver_app", createdAt: serverTimestamp() }
```
Il driver può eliminare i propri report. Successo → conferma con riepilogo + "Registra altra fascia".

## Tab "Oggi"

- KPI: consegne oggi, consegne mese (+ media/giorno), ritorni mese. **Niente importi in €** e **niente orari di timbratura**.
- Lista report di oggi (filiale, n° consegne, fascia, targa, badge ⏱ durata e ~min/consegna, cestino) + report recenti per giorno.
- Bottoni rapidi "+ Consegne" e "🔄 Ritorno", bottone "Chiudi turno" (aggiorna il doc `turniDriver` aperto con `oraFine`, `durataTurnoMin`, `chiusoIl` — e ricorda al driver di timbrare l'uscita col tag).
- Lettura report: `reportDriver` where `driverEmail == email` orderBy `data desc` limit 2000.

## Ritorni

Form: data, filiale, motivo (cliente assente / indirizzo errato / rifiuto merce / altro), cliente, note → collection `ritorni`: `{ filiale, motivo, motivoLabel, cliente, note, driver, driverEmail, data, mese, stato:'in_attesa', createdAt }`. Lista con stato (⏳/✓/✕ — lo stato lo cambia l'admin), eliminabile finché in attesa.

## Tab "Classifica" 🏆

- Banner premi mensili: **🥇 €100 · 🥈 €70 · 🥉 €40 in buoni pasto**.
- Leggi `leaderboard/{YYYY-MM}` (mese corrente Europe/Rome). `drivers`: array ordinato di `{ h, consegne, danni, bonusZeroDanni, tempoMedioMin, bonusVelocita, score, posPrec }`.
- **Anonimato**: `h` = primi 16 hex di SHA-256 dell'email. Calcola l'hash della propria email per trovare la riga "SEI TU!"; per gli altri SOLO nickname deterministico derivato da `h` (lista ~40 nickname animali/epici con emoji). MAI nomi reali.
- Top 10 + propria posizione se fuori (con percentile). Trend ↑↓ da `posPrec`. Badge ⚡ `bonusVelocita>0`, 🛡️ `bonusZeroDanni`.
- Legenda: 1 consegna = 1 pt · velocità (tempo medio <20 min = +30, <25 = +15, da 10 consegne con orari) · zero danni +50 · danno −30. Nota "classifica riservata, non condividerla all'esterno".
- **Popup primo accesso** (una volta per device, localStorage): premi, punteggio, orari del giro, privacy.

## Tab "Segnala"

Tipo (cliente assente, merce danneggiata, problema furgone, problema filiale, altro), filiale, descrizione → `segnalazioni`: `{ tipo, filiale, descrizione, driver, driverEmail, data, stato:'aperta', createdAt }` + elenco delle proprie con stato.

## Tab "Consegne" (storico)

Solo conteggi, niente €: consegne mese corrente con giorni attivi e media/giorno + storico mensile (mese, consegne, giorni attivi, media). Aggregazione client-side dai propri `reportDriver`.

## Sicurezza e regole (già attive lato server)

- Ogni scrittura ha `driverEmail`/`driverId`/`email` = utente loggato, lowercase.
- `reportDriver`: `numConsegne` int 1–10, `mese` YYYY-MM, `durataMin` 1–720. No update (solo create/delete propri).
- `timbrature`: create con `fonte:'app'`, `metodo` 'app-nfc-geo' o 'app-qr-geo', `tipo` in|out, `giorno`/`mese` nei formati indicati, `timestamp` = serverTimestamp. No update/delete.
- Il driver legge solo i propri documenti (query sempre filtrate sulla propria email). `leaderboard` e `puntiTimbratura` sono read-only.
- Gestisci i permission-denied con messaggi chiari, mai crash.

## Qualità

- Stati di caricamento, retry gentile sugli errori di rete, empty state simpatici, doppio-submit impedito ovunque.
- Se il token Auth scade davvero, torna al login senza crash (ma non forzare mai il logout).
- Testi e toast in italiano.
