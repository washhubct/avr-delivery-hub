# Prompt per lovable.dev — App Driver "Last Mile"

> Copia tutto da qui in giù nel prompt di Lovable. Dove serve, i valori
> reali (config Firebase, regole) sono già inclusi: non modificarli,
> devono restare compatibili con la dashboard esistente.

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
- Niente librerie pesanti. PWA installabile (manifest + icona), mobile-first, deve funzionare bene su Android Chrome e iPhone Safari.
- Lingua interfaccia: **italiano**.

## Design

Brand "Last Mile": premium logistics. Palette: **midnight navy** (#0f1d3d / #080b12) + **electric teal** (#38bdf8), bianco per le card in tema chiaro. Font: DM Sans (testi) + JetBrains Mono (numeri/orari). Bottoni grandi (min 48px), una mano sola, bottom navigation con 6 tab: **Oggi, Nuova, Classifica, Segnala, Consegne, Profilo**. Tono amichevole ma professionale, microcopy in italiano colloquiale ("Ciao Marco!", "Si va! 🚀").

## Identità e accesso

- Login email/password Firebase Auth. Password reset: POST a `https://europe-west1-avr-logistic-dashboard.cloudfunctions.net/requestPasswordReset` con `{email}` (risposta sempre generica).
- Dopo il login, carica il profilo da `driverAnagrafica` con query `where('email','==', email.toLowerCase())`. Se non esiste: schermata di blocco "account non abilitato, contatta l'amministrazione" + logout. Campi profilo: `cognome, nome, citta (CT|ME|EN|SR|PA), contratto, email, attivo`.
- Il driver può aggiornare SOLO questi campi del proprio doc: `codiceFiscale, numeroPatente, scadenzaPatente, telefono, dataNascita, indirizzo, profiloCompletatoIl` (le security rules bloccano il resto).

## Flusso di inizio turno

All'apertura (dopo login) overlay "Inizia il turno": input targa furgone (obbligatoria, min 5 caratteri, uppercase). Alla conferma scrivi su `turniDriver`:
```
{ driver: COGNOME_UPPERCASE, driverNome: "Cognome Nome", email: lowercase,
  targa, citta, data: "YYYY-MM-DD", oraInizio: "HH:MM",
  timestamp: serverTimestamp() }
```
La targa resta in memoria per i report del giorno. Dal profilo si può cambiare targa.

## Tab "Nuova" — registrazione consegne (cuore dell'app)

I driver registrano le consegne **a blocchi per fascia oraria**, non singolarmente. Form:
- Data (default oggi, min 2026-04-01, max oggi, bottone "Oggi")
- Filiale: select caricata da collection `filiali` (campi `codice, nome, area`), filtrata sull'area del driver se disponibile, ordinata per nome
- Fascia oraria: select 10:00–12:00 / 12:00–14:00 / 14:00–16:00 / 16:00–18:00 / 18:00–20:00 (valore salvato: ora di inizio, es. "10:00")
- Numero consegne: 1–10
- **Orario del giro (obbligatorio)**: ora inizio (precompilata con l'inizio fascia) e ora fine. Validazioni: fine > inizio; durata ≤ 720 min; durata ≥ 2 min × numero consegne; se l'inizio è fuori dalla fascia di oltre 1h chiedi conferma soft.
- Note opzionali.
- Blocco duplicati: stessa data+filiale+fascia già inserita → errore.

Scrittura su `reportDriver` (le security rules validano questi campi, rispetta i tipi):
```
{ filiale: "301", filialeNome, fascia: "10:00", numConsegne: int 1-10,
  note, driver: COGNOME_UPPERCASE, driverEmail: lowercase, targa,
  data: Timestamp (mezzogiorno della data scelta), mese: "YYYY-MM",
  area, oraInizio: "HH:MM", oraFine: "HH:MM",
  durataMin: number 1-720, tempoMedioMin: number (durata/numConsegne, 1 decimale),
  fonte: "driver_app", createdAt: serverTimestamp() }
```
Il driver può eliminare i propri report. Successo → schermata di conferma con riepilogo + "Registra altra fascia".

## Tab "Oggi"

- KPI: consegne oggi, consegne mese (+ media/giorno sui giorni attivi), ritorni mese.
- Lista report di oggi (card con filiale, n° consegne, fascia, targa, badge ⏱ durata e ~min/consegna, cestino per eliminare) e report recenti raggruppati per giorno.
- Bottoni rapidi: "+ Consegne" e "🔄 Ritorno".
- Lettura report: `reportDriver` where `driverEmail == email` orderBy `data desc` limit 2000.

## Ritorni

Form separato: data, filiale, motivo (cliente assente / indirizzo errato / rifiuto merce / altro), cliente, note → collection `ritorni` con `{ filiale, motivo, motivoLabel, cliente, note, driver, driverEmail, data, mese, stato: 'in_attesa', createdAt }`. Lista con stato (⏳ in attesa / ✓ accettato / ✕ rifiutato — lo stato lo cambia l'admin). Eliminabile finché in attesa.

## Tab "Classifica" 🏆 (gamification con premi veri)

- Banner premi mensili in evidenza: **🥇 €100 · 🥈 €70 · 🥉 €40 in buoni pasto**.
- Leggi il doc `leaderboard/{YYYY-MM}` (mese corrente Europe/Rome). Campo `drivers`: array ordinato di `{ h, consegne, danni, bonusZeroDanni, tempoMedioMin, bonusVelocita, score, posPrec }`.
- **Anonimato**: `h` = primi 16 hex di SHA-256 dell'email del driver. Calcola l'hash della propria email (WebCrypto) per trovare la propria riga ("SEI TU!"); per gli altri mostra SOLO un nickname deterministico derivato da `h` (lista di ~40 nickname animali/epici con emoji, indice = hash della stringa). MAI mostrare nomi reali.
- Top 10 + la propria posizione se fuori top 10 (con percentile). Trend ↑↓ da `posPrec`. Badge ⚡ se `bonusVelocita>0`, 🛡️ se `bonusZeroDanni`.
- Legenda: 1 consegna = 1 pt · velocità (tempo medio <20 min = +30, <25 = +15, da 10 consegne con orari) · zero danni +50 · danno −30. Nota: "classifica riservata ai driver Last Mile, non condividerla all'esterno".
- **Popup primo accesso** (una volta per device, localStorage): spiega premi, punteggio, importanza di inserire gli orari del giro, e che la classifica è privata (niente screenshot sui social).

## Tab "Segnala"

Segnalazioni all'amministrazione: tipo (cliente assente, merce danneggiata, problema furgone, problema filiale, altro), filiale, descrizione → collection `segnalazioni` `{ tipo, filiale, descrizione, driver, driverEmail, data, stato:'aperta', createdAt }` + lista delle proprie con stato.

## Tab "Consegne" (storico)

Solo conteggi, **niente importi in €** (i driver sono a stipendio fisso): consegne mese corrente con giorni attivi e media/giorno, e storico mensile (mese, consegne, giorni attivi, media). Dati aggregati client-side dai propri `reportDriver`.

## Tab "Profilo"

Dati anagrafici modificabili (CF, patente + scadenza, telefono, data nascita, indirizzo), targa di oggi con "cambia", statistiche personali (totale consegne, giorni attivi), logout. Se CF/patente/telefono mancano, banner "completa il profilo".

## Timbratura

Nel tab Oggi un bottone "🕐 Timbra entrata/uscita" che apre `https://dashboard.avrlogisticarl.com/timbra/` in una nuova scheda (l'app di timbratura esiste già, non ricrearla).

## Sicurezza e regole (già attive lato server, l'app deve rispettarle)

- Ogni scrittura ha `driverEmail` (o `email`) = utente loggato, lowercase.
- `reportDriver`: `numConsegne` int 1–10, `mese` formato YYYY-MM, `durataMin` 1–720 se presente. Update vietato ai driver (solo create/delete propri).
- Il driver legge solo i propri documenti (query sempre filtrate su `driverEmail`).
- `leaderboard` è read-only.
- Gestisci con messaggi chiari i permission-denied.

## Qualità

- Stati di caricamento, errori di rete con retry gentile, empty state simpatici.
- Doppio-submit impedito ovunque.
- Auto-logout leggero: se il token scade, torna al login senza crash.
- Testi e toast in italiano.
