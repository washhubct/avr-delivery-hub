# BRAIN.md — Last Mile Delivery Hub

> Unica fonte di memoria del progetto. Solo fatti durevoli, una riga ciascuno. Aggiornare la riga che cambia, mai riscrivere tutto, mai log di sessione.

## 1. Guido e come lavora con Claude

- Guido Consoli, imprenditore siciliano; Claude è il CTO di fatto: propone architettura, segnala bug e codice fragile, non esegue soltanto.
- Comunicazione: italiano informale, diretto, niente preamboli né spiegazioni enciclopediche; per fix piccoli procedere subito, per cose complesse proporre prima l'architettura.
- Lavora spesso di notte, sessioni lunghe su Mac Mini M4 (utente macOS `macia`, tmux `avr`), spesso da remoto via claude.ai/code.
- Testare prima di dire "fatto"; commit atomici conventional (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- Chiedere conferma prima di operazioni distruttive (delete, drop, force push, rm -rf, rules/indexes Firestore, script su reportDriver/consegne).
- Push su `main` solo con ok esplicito di Guido, ogni volta (l'ok vale per i commit indicati, non per i successivi).
- UI sobria e non "troppo"; nel dubbio preferisce vedere l'anteprima prima di inviare o pubblicare.
- Email canoniche: guido@last-mile.it (admin, Owner GCP), risorse.umane@last-mile.it (HR); account personale guidoconsoli@live.it.
- Le fatture SDI preferisce inviarle lui dalla UI FIC (creare bozza e fermarsi) salvo richiesta esplicita.
- Altre aziende di Guido (Wash Hub Lungomare, FidelAI, domotica) hanno sessioni/repo propri: questo progetto non mischia i dati del lavaggio.

## 2. Progetto

- Last Mile Delivery Hub: gestionale interno di Last Mile S.r.l. (P.IVA 06183200879, ex AVR Logistic), consegne a domicilio per i supermercati Decò / Gruppo Arena (Fratelli Arena) in Sicilia.
- Scala: ~27 filiali nelle province CT, ME, EN, SR, PA; ~27-30 driver attivi; Firestore 118k+ documenti.
- Produzione: https://dashboard.last-mile.it (GitHub Pages, repo `washhubct/avr-delivery-hub`, branch `main`, CNAME nel repo).
- App driver gemella: https://appdriver.last-mile.it, repo `washhubct/driveravrapp`, file `index.html` monolitico con compat SDK su `main` (il branch refactor/fase1-moduli-pwa NON è live); stesso progetto Firebase, quindi ogni cambio di schema impatta entrambi.
- Firebase project `avr-logistic-dashboard`: Firestore, Auth, Storage (bucket avr-logistic-dashboard.firebasestorage.app), Cloud Functions v2 Node 22 in europe-west1.
- Frontend: vanilla JS ES6 modules + HTML + CSS, nessun framework; tema midnight navy + electric teal, font DM Sans (UI) e JetBrains Mono (dati), dark-first.
- Deploy frontend = `git push origin main` (Pages compila in 2-5 min); le Firestore/Storage rules e le Functions NON vengono deployate da Pages.
- Deploy Functions senza login utente: `firebase logout` + `GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/legacy_credentials/claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json firebase deploy --only functions:<nome> --project avr-logistic-dashboard --non-interactive`.
- gcloud sul Mac richiede `CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14` e `--account=claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com` (python 3.9 di sistema lo fa fallire in silenzio).
- Rules senza firebase login: Firebase Rules REST API (POST rulesets + PATCH releases/cloud.firestore) con access token del SA claude-cli; verifica con GET sulla release.
- Secrets (solo nomi, in Secret Manager): FIC_TOKEN, FIC_COMPANY_ID, ANTHROPIC_API_KEY, RESEND_API_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (VAPID alla versione 2, la 1 era corrotta); i secret sono pinnati alla versione al momento del deploy, quindi dopo una rotazione ridistribuire tutte le CF che li usano.
- Test backend: `cd functions && npm test` (node --test, copia prima `js/fic/fic-core.js` in functions via `copy-core`).
- Lettura Firestore da Python senza SDK: `scripts/firestore_rest.py` importato come modulo (`fr.get(path)`, `fr.coll(name)`); per runQuery REST usare `(default)` letterale nell'URL.
- Email transazionali via Resend, solo dominio last-mile.it: from `Last Mile <noreply@last-mile.it>`, reply-to risorse.umane@; serve header User-Agent o Cloudflare risponde 403.
- Posta aziendale: Google Workspace su last-mile.it; la CF postaNotturna legge Gmail con delega di dominio keyless (signJwt del SA runtime 323721042739-compute@developer.gserviceaccount.com, client ID 104095269684873041762, scope gmail.readonly).
- Connettore Gmail di claude.ai (MCP) usato per leggere la posta in sessione: scade e si riattiva con `/mcp`.
- CF HTTP: le URL run.app rispondono subito, quelle cloudfunctions.net dopo qualche minuto dalla creazione; trigger manuali con identity token del SA claude-cli.

## 3. Architettura e file chiave

- `index.html` — shell del gestionale (nav, sezioni, modali); `css/style.css` tema.
- `js/main.js` — bootstrap, routing `navigateTo`, filtro `filtraPerProvince()` per i responsabili (client-side, non isolamento).
- `js/state.js` — stato globale (utente, ruolo, mese, cache dataset).
- `js/utils.js` — `prezzoConsegnaMese`, `rapportiMese`, `fatturatoAttesoRapporti`, `normalizzaNome`/`fuzzyMatchDriver`, `oggiIta`, toast/modal, festivi.
- `js/firebase-config.js` — init Firebase (chiave web pubblica, nessun secret).
- `js/moduli/auth.js` — login, ruoli e guardie menu (`canSeeFatturato`, `nav-superadmin`, `nav-fatturato`).
- `js/moduli/dashboard.js`, `fatturazione.js` — consegne e fatturato atteso dai rapporti app (`reportDriver`).
- `js/moduli/fatturazione-fic.js` + `js/fic/fic-core.js` — fattura mensile Arena da file xlsx, parser e totali (fic-core condiviso con le CF).
- `js/moduli/report-finanziario.js` — P&L: ricavi da `fattureMese`, costi da fatture ricevute + `costiMensili` (buste paga, F24), grafico SVG storico.
- `js/moduli/classifica.js` — classifica driver per provincia da `leaderboardFull/{mese}`.
- `js/moduli/anagrafica-driver.js` — driver (`driverAnagrafica`), patente con foto/verifica AI, colonna Push, bottoni 🔔 pushInvia.
- `js/moduli/danni.js`, `ritorni.js`, `segnalazioni-admin.js`, `produttivita.js`, `timbrature.js`, `punti-timbratura.js`, `utenti.js`, `log-accessi.js`, `filiali.js`, `compensi.js`, `consegne.js` — moduli di sezione.
- `js/moduli/push-gestionale.js` + `sw.js` — Web Push del gestionale (stessa VAPID dell'app driver).
- `functions/index.js` — tutte le CF: auth (requestPasswordReset, inviaCredenzialiDriver, creaUtenzaGestionale), classifica (precalcolaLeaderboard oraria, rebuildLeaderboard, pushPodioMensile, pushStimoloClassifica 19:30 lun-sab, pushPromemoriaReport 21:00), push (pushInvia, pushEsitoRitorno, pushEsitoSegnalazione, pushRitorniDaConfermare 18:30, pushPatenteSettimanale lun 9:00), controlliAutomatici, syncStatoDriver, pulisciAnagrafica, FIC (ficCreaFattura, ficInviaSdi, ficStato, ficProssimoNumero, ficSyncFatture, ficSyncNotturno 03:30), costi (elaboraBustePaga, elaboraF24, postaNotturna 04:00), verificaPatente, emailRitorniMensili (1° del mese 8:00), presenze (presenzaDaTurno, presenzaDaRapporto: trigger su turniDriver/reportDriver); export CLI non-CF `cliPrecalcoloMese`, `cliStimoloClassifica`.
- `functions/leaderboard-core.js` — regole classifica pure (REGOLE, classificaProvincia, messaggioStimolo) con test.
- `functions/fic-client.js`, `fic-handlers.js`, `fic-sync-core.js` — client API Fatture in Cloud v2, handler CF, competenza mese dal testo fattura.
- `functions/bustepaga-core.js`, `f24-core.js`, `patente-core.js` — parsing con Claude (structured output) di cedolini, F24 e foto patente.
- `functions/gmail-dwd.js`, `posta-core.js` — Gmail delega dominio e classificazione mail buste/F24.
- `functions/test/*.test.js` — test node:test dei core.
- `firestore.rules`, `storage.rules`, `firestore.indexes.json` — sicurezza; allowlist email hardcoded ancora @avrlogisticarl.com (da mantenere finché le email reali non cambiano).
- `scripts/firestore_rest.py`, `delete-auth-users.js`, `reset-driver-passwords.js` — utilità operative.
- `timbra/` — PWA timbratura QR; `bridge-zkteco/` — bridge Flask + Cloudflare Tunnel dai 5 terminali ZKTeco (solo card/PIN, niente biometria) alla collection `timbrature`.
- `app-hosting/` — shell Firebase Hosting dell'app driver (target `app`); `auth/action/` — pagina azioni Auth (reset password).
- `docs/manuali/` — guide HTML+PDF (Laura/HR, responsabili, app driver); `docs/*.md` note FIC e push.
- Collection Firestore principali: `reportDriver` (rapporti giornalieri, indicizzata per `mese`, fonte unica dal 09/10/2026), `driverAnagrafica`, `utenti` (mansione, province), `danni`, `ritorni`, `segnalazioni`, `timbrature`, `turniDriver`, `presenzeDriver` (`{email}_{YYYY-MM-DD}`, campi app dalle CF, causale/nota dal gestionale), `presenzeMesi` (chiusura mese), `leaderboard`/`leaderboardFull`, `pushSubscriptions`, `fattureFic`, `fattureMese`, `fattureOverride`, `fornitori`, `bustePaga`, `costiMensili`, `config` (fic, bustePaga), `consegne`/`driverArchivio` (archivio fino ad agosto 2026), `accessLog`/`driverAccessLog`, `postaElaborata`, `pushLog`.
- Dataset grandi sempre filtrati con `.where('mese', '==', mese)`.

## 4. Decisioni prese e perché

- Brand: dal 01/07/2026 "Last Mile"; dal 09/10/2026 la parola AVR non deve comparire in nessun testo visibile (restano i nomi tecnici: project Firebase, repo, prefisso QR `AVRT1`, `tipoDriver:'avr'` nell'archivio); chiave fornitori P&L = `lastmile`.
- Last Mile SRL fattura su Fatture in Cloud (company 1457794, numerazione unica 2026) sia Arena sia i clienti Wash Hub: Wash Hub è un'attività di Last Mile SRL.
- Fonte dati operativa = rapporti app driver (`reportDriver`): fogli Google Decò e sync GAS dismessi perché non più compilati.
- Pricing Arena flat da luglio 2026 (`prezzoConsegnaMese`): ≤499 € → 9,70; 500-600 → 27,60; 601-1000 → fasce da 100 (34,50/41,40/48,30/55,20); 1001-7000+ → 100/200/250/300; prima: ≤250 6,90 / ≥250 10, ritorni 6,90. Driver pagati 3,50 netti/consegna fino a giugno 2026 (modulo Compensi storico).
- Ruoli: superadmin (Guido) → tutto; amministratore (Laura HR, risorse.umane@) → tutto tranne costiMensili; responsabile (Alessio Rizzuto ME/PA/EN, Alfio Faro CT/SR/EN) → solo Gestione filtrata per province; driver → rimandati all'app; risorse_umane puro non vede il fatturato; auto-logout a mezzanotte.
- Nuovi responsabili = doc `utenti/{email}` con mansione `responsabile` e `province`, nessun codice.
- Ritorni: l'app li crea `da_fatturare`, il responsabile li conferma, il 1° del mese emailRitorniMensili li manda a HR con CSV e Laura li aggiunge alla fattura Arena: in fattura entrano solo i confermati.
- P&L per competenza da FIC (non stime da consegne): costi = fatture ricevute per voce + buste paga NETTE lette da Claude + F24 da PDF; netti + F24 ≈ costo pieno (scelta di Guido); correzioni via UI (override) perché la sync riscrive `fattureMese` da 2026-07.
- Buste paga: bozze mai sopra un mese con cedolini definitivi, definitive mai sovrascritte da bozze; cedolino ricaricato sovrascrive lo stesso id.
- Dipendenti Wash Hub nei cedolini classificati con `config/bustePaga.washhub`; driver assunti fuori anagrafica si aggiungono `attivo:false` con città = luogo di nascita.
- Fattura Arena mensile dal file xlsx Arena (modulo FIC); Arena conta più consegne dell'app e non si contesta; l'acconto del mese viene scalato come ANTICIPO nella fattura consegne.
- Acconto mensile Arena: 50.000 € + IVA 22% = 61.000 €, riga "Servizio logistica", dicitura copiata dalla loro email ("Acconto di fornitura di servizi di trasporto e consegna relativi al mese di <mese> 2026 Giusto Contratto del 16/06/2026"), pagamento bonifico MP05 a 5 gg, conto BANCO BPM id 1557165 (IBAN in payment_method.details + ei_data.bank_*).
- Convenzioni FIC Arena: entity id 112652741 (P.IVA 00097560866, SDI SUBM70N), template Light Smoke 2821, IVA id 15911831 (22%); il POST richiede `entity` completa (solo id → 422); controllare `q=number = N` perché il contatore può essere avanti.
- Patente driver: dato autodichiarato nel profilo app, blocco app se scaduta/mancante, verifica foto fronte/retro con Claude (CF verificaPatente) e non da HR; data limite verifica foto PATENTE_VERIFICA_DAL 2026-10-06; il driver non può scrivere numeroPatente/scadenzaPatente (rules).
- Push: Web Push su app e gestionale con VAPID v2; iPhone riceve solo con app aggiunta alla Home; la risposta di pushInvia elenca i non raggiunti, per loro email.
- Classifica driver per provincia (CT, ME, PA, SR; Enna esclusa perché un solo driver), attiva dal 2026-11: montepremi fisso CT 200 / ME 70 / PA 60 / SR 40 €, 50/30/20 con ≥5 driver, 60/40 con 3-4, nulla sotto 3 (arrotondamento 5 €); premiabile solo con zero danni e patente verificata, altrimenti il premio passa al successivo; nessuna soglia consegne né requisito giorni (i driver sono dipendenti a ore e il volume lo decide Arena); premio = buono Q8 o Amazon a scelta; tetto fringe benefit 1.000 €/anno per driver (premio ridotto al residuo).
- Punteggio classifica = consegne + bonus velocità (30 se <20 min, 15 se <25 min, con ≥10 consegne) + 50 zero danni − 30 × danno; documenti anonimi `leaderboard/{mese}_{PROV}` per l'app (id = sha256(email)[0:16]), nominativi in `leaderboardFull/{mese}` per il gestionale.
- Timbrature (ZKTeco e NFC in app) abbandonate dal 09/11/2026: `timbrature` vuota da ottobre; presenze = giorni con turno o rapporto in app driver, senza ore. L'app driver diventa il punto unico per i dipendenti (presenze, malattia/assenze/permessi, buste paga con conservazione 30 giorni).
- Il file xlsx mensile Arena NON si committa (dati clienti).
- Organigramma e Modello 231: file in `~/Progetti/_condivisi/organigramma-lastmile/`; dal 23/10/2026 Alfio Faro è Amministratore Unico (soci G Holding 95%, Guido 5%); commercialista Fabio Alberto Bonanno, consulente lavoro M&R Consulting, RSPP Giuseppe Murabito, medico competente Andrea Marconi.

## 5. Regole non negoziabili

- Mai committare secrets, chiavi SA, token: se compaiono in un commit bloccare tutto e avvisare; mai toccare `.env`, `functions/.env`, service account keys.
- Firestore/Storage rules e indici: modifiche solo con revisione e ok esplicito di Guido.
- Niente push su `main` senza ok esplicito; niente force push.
- Backup (export) prima di script di migrazione/ricalcolo su `reportDriver`, `consegne` o dati di produzione.
- Non modificare `normalizzaNome()` (match driver/multe) né il CNAME `dashboard.last-mile.it`.
- "AVR" mai in testi visibili a driver o clienti.
- Nessuna dipendenza nuova senza avvisare; niente riscritture di moduli interi per fix chirurgici.
- `costiMensili` leggibile solo dal superadmin; HR puro non vede il fatturato.
- Dati del Wash Hub fuori da questo progetto.

## 6. Stato attuale e prossimi passi

- Gestionale e app driver live con classifica per provincia dal 02/11/2026; CF precalcolaLeaderboard, rebuildLeaderboard, pushPodioMensile, pushStimoloClassifica deployate; classifiche di provincia precedenti a novembre cancellate.
- Adozione push: il 02/11/2026 solo 10 driver su 27 attivi erano iscritti; invito nell'app a ogni ingresso, email ai 17 mancanti, colonna Push in anagrafica per monitorare.
- Fattura acconto Arena n. 204/2026 (ottobre, id FIC 564457493) inviata allo SDI il 02/11/2026: controllare la ricevuta SDI.
- Aperto: premio di ottobre 2026 (vecchie regole buoni pasto 100/70/40 al podio generale) da decidere con Guido.
- Aperto: chiarire con Bonanno se altri fringe (buoni pasto) erodono il tetto 1.000 €.
- Aperto: F24 di settembre 2026 non ancora arrivato per mail; mail F24 senza mese nell'oggetto finiscono in `mese_non_trovato` (TODO: mese dai periodi del PDF).
- Aperto: token FIC in sola lettura su Fatture ricevute (centri di costo DECO/WASH HUB da creare da UI o dando scrittura al modulo).
- Aperto: manuali in `docs/manuali` citano ancora fogli Decò/Riconciliazione, da riscrivere.
- Aperto: doc `utenti/risorse.umane@last-mile.it` ancora intestato ad Alessandra Asero, da rinominare per Laura Castiglia.
- Aperto: upload foto patente ok, verifica documentale delle scadenze resta di HR; sentinella controlliAutomatici elenca patenti ogni lunedì.
- Aperto: dopo il 23/10/2026 aggiornare organigramma (html + PDF) e chiedere a Guido se resta datore di lavoro/legale rappresentante.
- Presenze fase 1 (09/11/2026): CF trigger deployate e storico da 2026-10-01 caricato (693 giorni); sezione Presenze nel gestionale e pulsante "Oggi non lavoro" nell'app pronti ma da pubblicare dopo il deploy delle rules presenzeDriver/presenzeMesi (in attesa di ok). Prossime fasi: malattia/ferie/permessi in app con approvazione del responsabile di provincia, buste paga in app (PDF M&R già diviso per pagina in elaboraBustePagaCore) con cancellazione a 30 giorni, bacheca, documenti, controllo furgone, rimborsi spese.
- Aperto: blocco vuoto `costiMensili/2026-10.bustePaga` da eliminare solo con ok; voce `consulenteLavoro` per fornitore M&R.
