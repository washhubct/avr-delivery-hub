# Bridge ZKTeco → Firestore (timbrature)

Riceve i push ADMS dai 5 terminali ZKTeco degli hub (CT, ME, EN, SR, PA)
e scrive le timbrature nella collezione Firestore `timbrature`, con lo
stesso schema dell'app QR (`fonte: "terminale"`). Stesso modello del
bridge cassa VNE: Flask locale + Cloudflare Tunnel.

## ⚠️ Conformità (leggere prima di configurare i terminali)

**Niente biometria.** In Italia usare impronta/volto/palmo per la
rilevazione presenze è illegale (art. 9 GDPR, sanzioni Garante).
Configurare i terminali **solo in modalità card/QR + PIN**:

- Menu terminale → Gestione utenti → per ogni driver: assegnare **N. utente (PIN)** e **card RFID** (o codice QR se il modello lo supporta). **Non registrare impronte.**
- Menu → Sistema → Presenze: verifica → «Card o PIN».
- Se una timbratura arriva con verifica biometrica, il bridge la salva comunque ma la marca `sospetto` con nota di disattivare la biometria.

## Setup (una volta)

1. **Service account**: Firebase Console → avr-logistic-dashboard →
   Impostazioni progetto → Account di servizio → «Genera nuova chiave
   privata» → salva come `service-account.json` in questa cartella.
   (Non committarlo: è già in .gitignore.)

2. **Config**: `cp config.example.json config.json` e compila:
   - `terminali`: SN di ciascun terminale (Menu → Info sistema → N. serie) → città;
   - `pinDriver`: PIN utente sul terminale → email del driver (la stessa dell'app driver) + nome.

3. **Dipendenze**: `pip3 install -r requirements.txt`

## Avvio

```bash
python3 app.py                 # porta 8090
BRIDGE_PORT=9000 python3 app.py
```

Health check: `curl http://localhost:8090/health`
(mostra terminali configurati, PIN mappati, record in coda retry).

### Cloudflare Tunnel (come la cassa VNE)

```bash
cloudflared tunnel --url http://localhost:8090
# oppure, con tunnel permanente già configurato:
cloudflared tunnel run avr-zkteco
```

Aggiungi al config del tunnel un hostname tipo `zkteco.avrlogisticarl.com`
→ `http://localhost:8090`.

### Config terminali ZKTeco (ognuno dei 5)

Menu → Comunicazione → Cloud Server / ADMS:

| Campo          | Valore                        |
| -------------- | ----------------------------- |
| Server Address | `zkteco.avrlogisticarl.com`   |
| Server Port    | `443`                         |
| Enable HTTPS   | Sì                            |
| Enable Domain  | Sì                            |

Imposta anche **fuso orario Europe/Rome (UTC+1/+2)** sul terminale:
il bridge interpreta i timestamp come ora locale italiana.

## Come funziona

- `POST /iclock/cdata?table=ATTLOG` → righe TSV `PIN  timestamp  status  verify` → normalizzazione → doc `timbrature/zk_<hash>`.
- **Dedup**: l'ID documento è l'hash di SN+PIN+timestamp → se il terminale rimanda lo stesso record (retry ADMS), sovrascrive lo stesso doc.
- **Retry**: se Firestore non è raggiungibile, i record finiscono in `retry-queue.jsonl` e vengono riprovati ogni 60s.
- **PIN sconosciuto**: il record viene salvato comunque con `sospetto: true` e nota «PIN x non mappato» — lo vedi nella vista Timbrature e aggiungi il PIN in `config.json`.
- Log su `bridge.log`.

## Avvio automatico (macOS, launchd)

```bash
# ~/Library/LaunchAgents/com.avr.bridge-zkteco.plist con ProgramArguments:
#   /usr/bin/python3 /percorso/bridge-zkteco/app.py
launchctl load ~/Library/LaunchAgents/com.avr.bridge-zkteco.plist
```
