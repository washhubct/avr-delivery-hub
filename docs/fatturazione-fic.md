# Fattura elettronica — Fatture in Cloud

Modulo nel tab **Fatturazione** (card "Fattura elettronica"), visibile solo a superadmin e `amministratore`, solo sui mesi a schema flat (≥ luglio 2026).

## Flusso

1. Upload dell'xlsx mensile (foglio riepilogo `<mese> <aa>`, `speciali`, opzionale `Foglio1`).
2. Parsing tollerante (ricerca etichette), ricalcolo totali dal dettaglio, riconciliazione → scostamenti in rosso con impatto €.
3. Anteprima: numero, data, scadenza (default +5 gg), metodo di pagamento, acconto (importo + riferimento). Righe: per area/filiale feriali+festivi (zero saltate), poi speciali per filiale, poi acconto negativo.
4. **Approva** (spunta scostamenti obbligatoria) → CF `ficCreaFattura` → bozza su FIC, doc `fattureFic/{YYYY-MM}` con audit (chi/quando).
5. **Verifica e invia allo SDI** → CF `ficInviaSdi`: dry-run XML, poi invio. Retry senza duplicare (riusa `ficDocumentId`).
6. **Aggiorna stato** → CF `ficStato`: `ei_status` + motivo scarto.

## Configurazione

### 1. Token Fatture in Cloud
1. Accedi a Fatture in Cloud con l'account Last Mile.
2. **Impostazioni → Applicazioni collegate → Collega una nuova applicazione** (o "Genera token manuale").
3. Nome: `Dashboard Last Mile`. Permessi minimi: **Documenti emessi (lettura/scrittura)**, **Anagrafica clienti (lettura)**, **Impostazioni/Info (lettura)**.
4. Copia il token (non scade; revocabile dalla stessa pagina).

### 2. Company ID
```bash
curl -s https://api-v2.fattureincloud.it/user/companies -H "Authorization: Bearer <TOKEN>" | python3 -m json.tool
```
Prendi `data.companies[].id` di Last Mile Srl.

### 3. Secrets Firebase (mai nel repo)
```bash
firebase functions:secrets:set FIC_TOKEN --project avr-logistic-dashboard
firebase functions:secrets:set FIC_COMPANY_ID --project avr-logistic-dashboard
firebase deploy --only functions:ficCreaFattura,functions:ficInviaSdi,functions:ficStato --project avr-logistic-dashboard
```

### 4. Firestore `config/fic`
```json
{
  "cliente": {
    "piva": "<P.IVA Fratelli Arena>",
    "ragioneSociale": "Fratelli Arena S.r.l.",
    "eiCode": "<codice destinatario SDI, 7 caratteri>",
    "indirizzo": "...", "cap": "...", "citta": "...", "provincia": "CT"
  },
  "core": {
    "tariffe": { "feriale": "9.70", "festivo": "12.61" },
    "scadenzaGiorni": 5,
    "metodoPagamento": "Bonifico bancario",
    "eiPaymentMethod": "MP05"
  }
}
```
`core` è opzionale (default in `js/fic/fic-core.js`). Se il cliente esiste già su FIC con quella P.IVA viene usato l'id esistente; altrimenti serve l'anagrafica completa.

### 5. Firestore rules (da deployare dopo revisione)
```
match /fattureFic/{mese} {
  allow read: if isSuperAdmin() || isAmministratore();
  allow write: if false; // solo Cloud Functions (Admin SDK)
}
```

## Test
```bash
cd functions && npm test           # 28 test: core, parser (oracolo luglio 2026), client FIC mockato, handler
FIC_XLSX="/percorso/lug 26 fatture.xlsx" npm test   # se il file non è in ~/Desktop
```

## Note
- `js/fic/fic-core.js` è la fonte; `functions/fic-core.js` è una copia sincronizzata da `npm run copy-core` (predeploy) e verificata da un test.
- Aritmetica in centesimi BigInt, half-up. L'id aliquota IVA 22% viene letto da `info/vat_types` a ogni creazione.
- Il body del dry-run è `{ data: { options: { dry_run: true } } }` (`functions/fic-client.js`): se FIC cambiasse schema, è l'unico punto da toccare.
