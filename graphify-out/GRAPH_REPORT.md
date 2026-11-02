# Graph Report - avr-delivery-hub  (2026-11-02)

## Corpus Check
- 76 files · ~86,450 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: (none) 5, .webmanifest 2, .rules 2)

## Summary
- 884 nodes · 1627 edges · 40 communities (36 shown, 4 thin omitted)
- Extraction: 87% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 201 edges (avg confidence: 0.87)
- Token cost: 280,051 input · 0 output

## Community Hubs (Navigation)
- Shell gestionale e sezioni driver
- Nav, ruoli e produttività app
- Fatturazione FIC Arena (CF)
- Parser F24 e patente
- Rapporti reportDriver e fatturazione attesa
- Bridge ZKTeco Flask
- Timbrature e punti timbratura
- fic-core condiviso (js/fic)
- fic-core copia functions
- Classifica driver per provincia
- PWA timbratura QR/NFC
- Cloud Functions index.js core
- Posta notturna e buste paga
- Buste paga, patente e dipendenze
- Azioni Firebase Auth
- Report finanziario P&L
- Main.js, manuali e responsabili
- Anagrafica driver
- Modulo FIC gestionale
- Danni, compensi e pricing
- Push, ritorni e turni
- Produttività driver
- Azienda, brand e deploy
- Sync FIC per competenza
- Precalcolo leaderboard (CF)
- Manifest PWA timbra
- Manuali HR e anagrafica
- Patente, rules e flusso app
- Guida Laura, state e Resend
- Sync FIC e reset password (CF)
- Manuale app driver e sessione
- Secrets e VAPID
- Collection e regole non negoziabili
- Firebase config
- Controlli automatici HR
- Push stimolo classifica
- ficProssimoNumero
- Storage rules
- Toast timbra

## God Nodes (most connected - your core abstractions)
1. `Last Mile Hub (gestionale index.html)` - 35 edges
2. `Nav Admin (Operatività + Gestione)` - 18 edges
3. `avviaTimbratura(tipo)` - 18 edges
4. `renderReportFinanziario()` - 14 edges
5. `parseRiepilogo()` - 13 edges
6. `createHandlers()` - 13 edges
7. `parseRiepilogo()` - 13 edges
8. `initAuth()` - 12 edges
9. `giornoInRome()` - 11 edges
10. `Classifica driver per provincia` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Segnalazioni dall'app` --shares_data_with--> `pushEsitoSegnalazione()`  [INFERRED]
  docs/prompt-lovable-app-driver.md → functions/index.js
- `Email transazionali Resend` --conceptually_related_to--> `requestPasswordReset()`  [INFERRED]
  BRAIN.md → functions/index.js
- `Primo accesso e password` --references--> `requestPasswordReset()`  [INFERRED]
  docs/manuali/manuale-app-driver.html → functions/index.js
- `Email transazionali Resend` --conceptually_related_to--> `inviaCredenzialiDriver()`  [INFERRED]
  BRAIN.md → functions/index.js
- `Anagrafica Driver (Laura)` --references--> `inviaCredenzialiDriver()`  [INFERRED]
  docs/manuali/guida-dashboard-laura.html → functions/index.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Flusso fattura elettronica Arena via Fatture in Cloud** — docs_fatturazione_fic_flusso_fatturazione, js_moduli_fatturazione_fic, js_fic_fic_core, functions_index_ficcreafattura, functions_index_ficinviasdi, functions_index_ficstato, docs_fatturazione_fic_fatturefic, brain_fattura_arena_mensile [EXTRACTED 1.00]
- **Sorgenti della collection timbrature (terminali ZKTeco, app NFC, PWA QR) e vista gestionale** — bridge_zkteco_readme_bridge_zkteco, docs_prompt_lovable_app_driver_timbratura_nfc_geo, docs_manuali_manuale_app_driver_timbratura_nfc, brain_timbra_pwa, bridge_zkteco_readme_collection_timbrature, js_moduli_timbrature [INFERRED 0.95]
- **Pipeline Web Push driver: VAPID, pushSubscriptions, Cloud Functions mittenti, service worker** — docs_push_notifications_driver_app_vapid_keys, docs_push_notifications_driver_app_pushsubscriptions, functions_index_pushpromemoriareport, functions_index_pushesitoritorno, functions_index_pushesitosegnalazione, functions_index_pushpodiomensile, functions_index_pushinvia, docs_push_notifications_driver_app_payload [EXTRACTED 1.00]
- **Area Gestione del gestionale (nav section 'Gestione')** — index_sezione_anagrafica_driver, index_sezione_compensi, index_sezione_produttivita, index_sezione_danni, index_sezione_ritorni, index_sezione_classifica, index_sezione_segnalazioni, index_sezione_filiali, index_sezione_utenti, index_sezione_timbrature, index_sezione_punti_timbratura, index_sezione_log_accessi [EXTRACTED 1.00]
- **Area Operatività del gestionale (nav section 'Operatività')** — index_sezione_dashboard, index_sezione_archivio_consegne, index_sezione_fatturazione, index_sezione_report_finanziario [EXTRACTED 1.00]
- **Flusso timbratura: QR/NFC → hash token → GPS geofence → scrittura timbrature** — timbra_index_avviatimbratura, timbra_index_scansionaqr, timbra_index_nfcparams, timbra_index_sha256hex, timbra_index_collection_puntitimbratura, timbra_index_leggiposizione, timbra_index_distanzamt, timbra_index_collection_timbrature, timbra_index_qr_token_hash_avrt1, timbra_index_geofencing, timbra_index_euristiche_mock_gps [EXTRACTED 1.00]

## Communities (40 total, 4 thin omitted)

### Community 0 - "Shell gestionale e sezioni driver"
Cohesion: 0.05
Nodes (48): Costo pieno personale = netti buste paga + F24, Aree operative CT, ME, SR, PA, EN, Last Mile Hub (gestionale index.html), Modal generico (#modal), Nav Driver (Le mie attività), Normalizzazione hostname con punto finale, Ruolo driver, Sezione Archivio consegne (+40 more)

### Community 1 - "Nav, ruoli e produttività app"
Cohesion: 0.06
Nodes (48): Shell SSR App Driver (Last Mile — App Driver), Hydration TanStack Router ($_TSR, scroll restoration), Index App Driver (copia della shell SSR), Riconciliazione app vs fogli Decò, Sezioni dell'app (Oggi, Compensi, Segnala, Ritorni, Classifica, Profilo), Giro di controllo quotidiano (10 minuti), Produttività: App driver vs File Decò, Segnalazioni dall'app (+40 more)

### Community 2 - "Fatturazione FIC Arena (CF)"
Cohesion: 0.07
Nodes (40): Acconto mensile Arena, Convenzioni FIC per Arena, Firestore config/fic, Dry-run FIC, Collection fattureFic/{YYYY-MM}, Flusso fatturazione FIC, Struttura righe fattura, Rules fattureFic (+32 more)

### Community 3 - "Parser F24 e patente"
Cohesion: 0.05
Nodes (35): DELEGA_SCHEMA, F24_SCHEMA, idDelega(), moduloDaDelega(), r2(), riepilogoF24(), SEZIONI, isYMD() (+27 more)

### Community 4 - "Rapporti reportDriver e fatturazione attesa"
Cohesion: 0.07
Nodes (23): Collection reportDriver, Salvataggio offline con invio differito, Tab Nuova — registrare il giro, Schema reportDriver dall'app, Topbar (hamburger, titolo, tema, selettore mese), exportFatturazione(), fatAreaHeaderRow(), fatKpi() (+15 more)

### Community 5 - "Bridge ZKTeco Flask"
Cohesion: 0.08
Nodes (18): doc_id_record(), health(), iclock_cdata(), iclock_devicecmd(), iclock_getrequest(), iclock_registry(), normalizza_record(), retry_worker() (+10 more)

### Community 6 - "Timbrature e punti timbratura"
Cohesion: 0.09
Nodes (30): bridge-zkteco (Flask + Cloudflare Tunnel), timbra/ PWA timbratura QR, Endpoint ADMS /iclock/cdata ATTLOG, Bridge cassa VNE, Bridge ZKTeco → Firestore, Cloudflare Tunnel, Collection timbrature, config.json (terminali, pinDriver) (+22 more)

### Community 7 - "fic-core condiviso (js/fic)"
Cohesion: 0.13
Nodes (32): buildRighe(), canonArea(), centsToEuroIt(), centsToNumber(), centsToString(), codice(), findCell(), findNear() (+24 more)

### Community 8 - "fic-core copia functions"
Cohesion: 0.13
Nodes (32): buildRighe(), canonArea(), centsToEuroIt(), centsToNumber(), centsToString(), codice(), findCell(), findNear() (+24 more)

### Community 9 - "Classifica driver per provincia"
Cohesion: 0.10
Nodes (27): Collection leaderboard / leaderboardFull, Fine mese: classifica e buoni pasto 100/70/40, precalcolaLeaderboard(), CHIUSURE, classificaProvincia(), messaggioStimolo(), montepremi(), MOTIVI_BREVI (+19 more)

### Community 10 - "PWA timbratura QR/NFC"
Cohesion: 0.09
Nodes (33): Un punto di timbratura per provincia (NFC + QR + geofence), Timbrature ZKTeco + app QR/NFC e riconciliazione con consegne, Sezione Punti Timbratura provinciali, Sezione Timbrature (admin/HR), oggiIta, annullaFlow(), avviaTimbratura(tipo), caricaJsQR() — lazy load jsQR 1.4.0 (+25 more)

### Community 11 - "Cloud Functions index.js core"
Cohesion: 0.07
Nodes (32): admin, allineaF24SuFic(), ALLOWED_ORIGINS, ANTHROPIC_API_KEY, buildEmailHtml(), buildInvitoEmailHtml(), creaUtenzaGestionale(), crypto (+24 more)

### Community 12 - "Posta notturna e buste paga"
Cohesion: 0.08
Nodes (20): Gmail delega di dominio keyless, RFC-822, BUSTA_SCHEMA, categoriaDipendente(), idBusta(), norm(), creaGmail(), identitaRuntime() (+12 more)

### Community 13 - "Buste paga, patente e dipendenze"
Cohesion: 0.07
Nodes (29): elaboraBustePagaCore(), ricalcolaCostiMese(), verificaPatente(), dependencies, @anthropic-ai/sdk@^0.127.0, firebase-admin@^13.0.0, firebase-functions@^6.0.0, pdf-lib@^1.17.1 (+21 more)

### Community 14 - "Azioni Firebase Auth"
Cohesion: 0.09
Nodes (30): Modalità azione: resetPassword, verifyEmail, recoverEmail, doResetPassword(), Firebase Auth (compat 10.12.2) — verifyPasswordResetCode / confirmPasswordReset / applyActionCode / checkActionCode, Form Nuova password (stateResetForm), goToLogin(), init() — smista mode/oobCode, isValidPassword(pw), onPasswordInput() (+22 more)

### Community 15 - "Report finanziario P&L"
Cohesion: 0.14
Nodes (25): Assegnazione fornitori Last Mile / Wash Hub, P&L per mese di competenza da Fatture in Cloud, Sezione Report Finanziario (P&L), doSaveCosti(), formatDateIt(), loadCostiMese(), loadFattureMese(), openEditCosti() (+17 more)

### Community 16 - "Main.js, manuali e responsabili"
Cohesion: 0.16
Nodes (21): Manuali docs/manuali, Modulo Fattura elettronica (FIC), Accesso con province di competenza, Controlli settimanali (responsabile), Manuale Responsabili di Area, Permessi per sezione (responsabile), ensureConsegne(), filtraPerProvince() (+13 more)

### Community 17 - "Anagrafica driver"
Cohesion: 0.15
Nodes (19): Fatturato e margine per città pro-quota, Sezione Anagrafica Driver, caricaPushEmails(), contrattoOptions(), creaAccessoDriver(), editDriver(), eliminaDriver(), inviaAccessoBrandizzato() (+11 more)

### Community 18 - "Modulo FIC gestionale"
Cohesion: 0.20
Nodes (19): Card Fattura elettronica — Fatture in Cloud, Flusso fattura FIC: xlsx Arena → ricalcolo → approvazione → SDI, SheetJS xlsx 0.18.5, ficAggiornaBottoni(), ficAggiornaStato(), ficApprova(), ficCall(), ficField() (+11 more)

### Community 19 - "Danni, compensi e pricing"
Cohesion: 0.15
Nodes (15): Registrazione multe e danni, Rateizzazione 1-6 rate, Costo consegna driver €3,50, exportCompensi(), findDriverAnagrafica(), normalizeDriverName(), renderCompensi(), calcolaDanniMese() (+7 more)

### Community 20 - "Push, ritorni e turni"
Cohesion: 0.22
Nodes (16): Ritorni dall'app, Collection turniDriver, Push notification per la Driver App, Collection pushSubscriptions, Rules pushSubscriptions, canManageDriverAccess(), initWebpush(), inviaPushASubs() (+8 more)

### Community 21 - "Produttività driver"
Cohesion: 0.24
Nodes (9): Copertura orari (tempo medio per consegna), Sezione Produttività driver, exportProduttivita(), fmtMinuti(), prodAggrega(), prodOggiRoma(), prodToDay(), prodToggle() (+1 more)

### Community 22 - "Azienda, brand e deploy"
Cohesion: 0.21
Nodes (11): App driver (appdriver.last-mile.it), Firebase project avr-logistic-dashboard, Fratelli Arena / Decò, Deploy frontend via GitHub Pages, Guido Consoli, Last Mile Delivery Hub, Last Mile S.r.l., Organigramma e Modello 231 (+3 more)

### Community 23 - "Sync FIC per competenza"
Cohesion: 0.32
Nodes (11): meseDaTesto(), meseShift(), MESI, MESI_ABBR, normalizzaEmessa(), normalizzaRicevuta(), num(), pad2() (+3 more)

### Community 24 - "Precalcolo leaderboard (CF)"
Cohesion: 0.27
Nodes (12): buildLeaderboardForMese(), caricaAnagByCognome(), cliPrecalcoloMese(), emailRitorniMensili(), eseguiPrecalcolo(), giornoInRome(), loadPremiAnno(), loadPrevMesePositions() (+4 more)

### Community 25 - "Manifest PWA timbra"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 26 - "Manuali HR e anagrafica"
Cohesion: 0.22
Nodes (6): Anagrafica Driver (Laura), Problemi frequenti (HR), Manuale Risorse Umane, Problemi frequenti (HR, luglio 2026), Procedura nuovo dipendente driver, pulisciAnagrafica

### Community 27 - "Patente, rules e flusso app"
Cohesion: 0.28
Nodes (6): Colonna Patente (badge giallo/rosso), Flusso di apertura giornaliero, Profilo obbligatorio (6 campi), Regole di sicurezza lato server per l'app, Tab Oggi, firestore.rules

### Community 28 - "Guida Laura, state e Resend"
Cohesion: 0.22
Nodes (8): Email transazionali Resend, Accesso al gestionale (Laura), Guida al gestionale — Laura, Mappa del gestionale per ruolo amministratore, Invia credenziali, navigateTo, ADMIN_EMAILS, state

### Community 29 - "Sync FIC e reset password (CF)"
Cohesion: 0.25
Nodes (9): Accesso e profilo da driverAnagrafica, canFatturare(), checkRateLimit(), eseguiFicSync(), ficEndpoint(), ficListaTutta(), ficSyncFatture(), ficSyncNotturno() (+1 more)

### Community 30 - "Manuale app driver e sessione"
Cohesion: 0.33
Nodes (5): Sessione scade a mezzanotte, Installazione PWA sulla Home, Manuale App Driver, Primo accesso e password, Problemi frequenti (driver)

### Community 31 - "Secrets e VAPID"
Cohesion: 0.33
Nodes (6): Secrets in Secret Manager, Web Push con VAPID v2, Company ID FIC, Token Fatture in Cloud, Payload push {title, body, url}, Coppia VAPID come secret

### Community 32 - "Collection e regole non negoziabili"
Cohesion: 0.33
Nodes (3): Collection costiMensili, Collection Firestore principali, normalizzaNome

### Community 33 - "Firebase config"
Cohesion: 0.40
Nodes (4): auth, COLLECTIONS, db, firebaseConfig

### Community 34 - "Controlli automatici HR"
Cohesion: 0.50
Nodes (4): Controlli settimanali del lunedì, Email report Controlli Last Mile 8:30, Controlli periodici HR, controlliAutomatici()

### Community 35 - "Push stimolo classifica"
Cohesion: 0.67
Nodes (3): cliStimoloClassifica(), eseguiStimoloClassifica(), pushStimoloClassifica()

## Ambiguous Edges - Review These
- `Collection reportDriver` → `Riconciliazione app vs fogli Decò`  [AMBIGUOUS]
  docs/manuali/guida-dashboard-laura.html · relation: conceptually_related_to
- `Rebrand AVR → Last Mile` → `Design brand Last Mile per l'app`  [AMBIGUOUS]
  docs/prompt-lovable-app-driver.md · relation: conceptually_related_to
- `Auto-logout a mezzanotte` → `Sessione persistente senza logout automatico`  [AMBIGUOUS]
  docs/prompt-lovable-app-driver.md · relation: conceptually_related_to
- `Flusso ritorni` → `Ritorni dall'app`  [AMBIGUOUS]
  docs/prompt-lovable-app-driver.md · relation: conceptually_related_to
- `Classifica driver per provincia` → `Fine mese: classifica e buoni pasto 100/70/40`  [AMBIGUOUS]
  docs/manuali/guida-dashboard-laura.html · relation: conceptually_related_to
- `Primo accesso e password` → `Sessione persistente senza logout automatico`  [AMBIGUOUS]
  docs/prompt-lovable-app-driver.md · relation: conceptually_related_to

## Knowledge Gaps
- **32 isolated node(s):** `RFC-822`, `Guido Consoli`, `Fratelli Arena / Decò`, `Deploy frontend via GitHub Pages`, `Organigramma e Modello 231` (+27 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 225 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Last Mile Hub (gestionale index.html)` connect `Shell gestionale e sezioni driver` to `Firebase config`, `Nav, ruoli e produttività app`, `Rapporti reportDriver e fatturazione attesa`, `Timbrature e punti timbratura`, `fic-core condiviso (js/fic)`, `Classifica driver per provincia`, `Azioni Firebase Auth`, `Report finanziario P&L`, `Main.js, manuali e responsabili`, `Anagrafica driver`, `Modulo FIC gestionale`, `Danni, compensi e pricing`, `Produttività driver`, `Guida Laura, state e Resend`?**
  _High betweenness centrality (0.502) - this node is a cross-community bridge._
- **What connects `RFC-822`, `Guido Consoli`, `Fratelli Arena / Decò` to the rest of the system?**
  _32 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Shell gestionale e sezioni driver` be split into smaller, more focused modules?**
  _Cohesion score 0.05141242937853107 - nodes in this community are weakly interconnected._
- **Why does `pushInvia()` connect `Push, ritorni e turni` to `Precalcolo leaderboard (CF)`, `Anagrafica driver`, `Cloud Functions index.js core`, `Secrets e VAPID`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Should `Nav, ruoli e produttività app` be split into smaller, more focused modules?**
  _Cohesion score 0.06079664570230608 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Collection reportDriver` and `Riconciliazione app vs fogli Decò`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Rebrand AVR → Last Mile` and `Design brand Last Mile per l'app`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._