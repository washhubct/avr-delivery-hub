#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AVR LOGISTIC — Bridge ZKTeco → Firestore (timbrature)
═══════════════════════════════════════════════════════════════════

Riceve i push ADMS/iclock dai 5 terminali ZKTeco (uno per hub: CT,
ME, EN, SR, PA), normalizza i record e li scrive nella collezione
Firestore `timbrature` con lo STESSO schema dell'app QR (fonte
diversa: "terminale"). Stesso modello del bridge cassa VNE: Flask +
Cloudflare Tunnel.

⚠️ CONFORMITÀ: i terminali vanno configurati SOLO in modalità
   card/QR + PIN. NIENTE biometria (impronta/volto/palmo): illegale
   in Italia per la rilevazione presenze (art. 9 GDPR).

Protocollo ADMS (PUSH SDK) — il terminale, configurato con
  Comm. → Cloud Server Setting → Server Address: <host tunnel>, Port 443, HTTPS on
chiama:
  GET  /iclock/cdata?SN=...&options=all   → handshake iniziale
  GET  /iclock/getrequest?SN=...          → polling comandi (rispondiamo OK)
  POST /iclock/cdata?SN=...&table=ATTLOG  → righe timbrature TSV:
       PIN <TAB> 2026-07-13 08:01:22 <TAB> status <TAB> verify <TAB> ...
       status: 0=check-in, 1=check-out (2/3/4/5 straordinari → mappati in/out)
       verify: 1=impronta(NO!), 2=PIN, 3/4=card/QR — logghiamo un warning se biometrico

Avvio:
  python3 app.py                      (default porta 8090)
  BRIDGE_PORT=9000 python3 app.py

Dipendenze: pip install -r requirements.txt
Config: copia config.example.json → config.json e compila i mapping.
"""

import hashlib
import json
import logging
import os
import sys
import threading
import time
from datetime import datetime, timezone, timedelta

from flask import Flask, request, Response

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print("Manca firebase-admin: pip install -r requirements.txt")
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
QUEUE_PATH = os.path.join(BASE_DIR, "retry-queue.jsonl")   # coda locale per retry
SERVICE_ACCOUNT = os.path.join(BASE_DIR, "service-account.json")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(os.path.join(BASE_DIR, "bridge.log")),
    ],
)
log = logging.getLogger("bridge-zkteco")

if not os.path.exists(CONFIG_PATH):
    print(f"Manca {CONFIG_PATH} — copia config.example.json in config.json e compilalo.")
    sys.exit(1)

with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = json.load(f)

TERMINALI = CFG.get("terminali", {})        # SN terminale → {citta, puntoId, nome}
PIN_DRIVER = CFG.get("pinDriver", {})       # PIN utente → {driverId(email), nome}
TZ_ROME_OFFSET = CFG.get("utcOffsetOre", None)  # None = usa offset Europe/Rome automatico

# Fuso Europe/Rome senza dipendenze: usa zoneinfo (py3.9+)
try:
    from zoneinfo import ZoneInfo
    TZ_ROME = ZoneInfo("Europe/Rome")
except Exception:
    TZ_ROME = timezone(timedelta(hours=TZ_ROME_OFFSET if TZ_ROME_OFFSET is not None else 2))

# ═══════════════════════════════════════════════════════════════
# FIRESTORE
# ═══════════════════════════════════════════════════════════════
if not os.path.exists(SERVICE_ACCOUNT):
    print(f"Manca {SERVICE_ACCOUNT} — scaricalo da Firebase Console → Impostazioni progetto → Account di servizio.")
    sys.exit(1)

firebase_admin.initialize_app(credentials.Certificate(SERVICE_ACCOUNT))
db = firestore.client()

# ═══════════════════════════════════════════════════════════════
# CORE
# ═══════════════════════════════════════════════════════════════
app = Flask(__name__)

STATUS_MAP = {  # status ADMS → tipo
    "0": "in", "1": "out",
    "2": "out",  # break-out
    "3": "in",   # break-in
    "4": "in",   # overtime-in
    "5": "out",  # overtime-out
}
VERIFY_BIOMETRICI = {"1": "impronta", "15": "volto", "16": "palmo"}


def doc_id_record(sn: str, pin: str, ts: str) -> str:
    """ID deterministico → il rinvio dello stesso record dal terminale non duplica."""
    return "zk_" + hashlib.sha1(f"{sn}|{pin}|{ts}".encode()).hexdigest()[:32]


def normalizza_record(sn: str, riga: str):
    """Riga ATTLOG TSV → doc timbratura (schema unificato) oppure None."""
    parti = riga.strip().split("\t")
    if len(parti) < 2:
        return None
    pin = parti[0].strip()
    ts_raw = parti[1].strip()
    status = parti[2].strip() if len(parti) > 2 else "0"
    verify = parti[3].strip() if len(parti) > 3 else ""

    try:
        # Il terminale manda l'ora locale (impostare TZ Europe/Rome sul device)
        dt_locale = datetime.strptime(ts_raw, "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ_ROME)
    except ValueError:
        log.warning("Timestamp non parsabile da %s: %r", sn, ts_raw)
        return None

    term = TERMINALI.get(sn)
    if not term:
        log.warning("Terminale sconosciuto SN=%s — aggiungilo in config.json", sn)
        return None

    driver = PIN_DRIVER.get(pin)
    sospetto = False
    note = []

    if not driver:
        # Registra comunque: l'admin vede il PIN da mappare invece di perdere il dato
        sospetto = True
        note.append(f"PIN {pin} non mappato a nessun driver")

    if verify in VERIFY_BIOMETRICI:
        # Non deve succedere: terminali configurati solo card/QR+PIN
        sospetto = True
        note.append(f"ATTENZIONE verifica biometrica ({VERIFY_BIOMETRICI[verify]}) — disattivarla sul terminale")

    giorno = dt_locale.strftime("%Y-%m-%d")
    return {
        "_docId": doc_id_record(sn, pin, ts_raw),
        "driverId": (driver or {}).get("driverId", f"pin:{pin}"),
        "driverNome": (driver or {}).get("nome", f"PIN {pin}"),
        "filialeId": term.get("puntoId", term.get("citta", "?")),
        "citta": term.get("citta", "?"),
        "tipo": STATUS_MAP.get(status, "in"),
        "timestamp": dt_locale,          # datetime tz-aware → Firestore Timestamp
        "giorno": giorno,
        "mese": giorno[:7],
        "fonte": "terminale",
        "metodo": "terminale-zkteco",
        "qrTokenLetto": None,
        "lat": None, "lng": None, "accuracy": None,
        "idTerminale": sn,
        "sospetto": sospetto,
        "note": " · ".join(note),
    }


def scrivi_firestore(rec: dict) -> bool:
    doc_id = rec.pop("_docId")
    try:
        db.collection("timbrature").document(doc_id).set(rec, merge=True)  # merge → dedup
        log.info("✓ %s %s %s %s (%s)", rec["giorno"], rec["tipo"], rec["driverNome"], rec["citta"], doc_id)
        return True
    except Exception as e:  # noqa: BLE001
        log.error("Firestore KO (%s): %s — accodo per retry", doc_id, e)
        rec["_docId"] = doc_id
        rec["timestamp"] = rec["timestamp"].isoformat()
        with open(QUEUE_PATH, "a", encoding="utf-8") as fq:
            fq.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return False


def retry_worker():
    """Ogni 60s riprova i record in coda (rete/Firestore giù)."""
    while True:
        time.sleep(60)
        if not os.path.exists(QUEUE_PATH):
            continue
        try:
            with open(QUEUE_PATH, encoding="utf-8") as fq:
                righe = [r for r in fq.read().splitlines() if r.strip()]
            if not righe:
                continue
            os.remove(QUEUE_PATH)
            log.info("Retry di %d record in coda…", len(righe))
            for r in righe:
                rec = json.loads(r)
                rec["timestamp"] = datetime.fromisoformat(rec["timestamp"])
                scrivi_firestore(rec)
        except Exception as e:  # noqa: BLE001
            log.error("Retry worker: %s", e)


threading.Thread(target=retry_worker, daemon=True).start()

# ═══════════════════════════════════════════════════════════════
# ENDPOINT ADMS / ICLOCK
# ═══════════════════════════════════════════════════════════════
@app.route("/iclock/cdata", methods=["GET", "POST"])
def iclock_cdata():
    sn = request.args.get("SN", "")
    if request.method == "GET":
        # Handshake: il terminale chiede le opzioni → risposta minima standard
        log.info("Handshake terminale SN=%s (%s)", sn, TERMINALI.get(sn, {}).get("citta", "SCONOSCIUTO"))
        body = (
            f"GET OPTION FROM: {sn}\n"
            "ATTLOGStamp=None\nOPERLOGStamp=None\nATTPHOTOStamp=None\n"
            "ErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\n"
            "TransFlag=1111000000\nTimeZone=1\nRealtime=1\nEncrypt=None\n"
        )
        return Response(body, mimetype="text/plain")

    table = request.args.get("table", "")
    payload = request.get_data(as_text=True) or ""
    if table == "ATTLOG":
        n_ok = 0
        for riga in payload.splitlines():
            if not riga.strip():
                continue
            rec = normalizza_record(sn, riga)
            if rec:
                scrivi_firestore(rec)
                n_ok += 1
        log.info("ATTLOG da SN=%s: %d record", sn, n_ok)
        return Response(f"OK: {n_ok}\n", mimetype="text/plain")

    # OPERLOG e altre tabelle: acknowledge senza elaborare
    return Response("OK\n", mimetype="text/plain")


@app.route("/iclock/getrequest", methods=["GET"])
def iclock_getrequest():
    # Nessun comando da inviare al terminale
    return Response("OK\n", mimetype="text/plain")


@app.route("/iclock/devicecmd", methods=["POST"])
def iclock_devicecmd():
    return Response("OK\n", mimetype="text/plain")


@app.route("/iclock/registry", methods=["GET", "POST"])
def iclock_registry():
    return Response("RegistryCode=OK\n", mimetype="text/plain")


# ═══════════════════════════════════════════════════════════════
# HEALTH CHECK
# ═══════════════════════════════════════════════════════════════
@app.route("/health", methods=["GET"])
def health():
    coda = 0
    if os.path.exists(QUEUE_PATH):
        with open(QUEUE_PATH, encoding="utf-8") as fq:
            coda = sum(1 for r in fq if r.strip())
    return {
        "status": "ok",
        "terminaliConfigurati": len(TERMINALI),
        "pinMappati": len(PIN_DRIVER),
        "recordInRetry": coda,
        "ora": datetime.now(TZ_ROME).isoformat(),
    }


if __name__ == "__main__":
    port = int(os.environ.get("BRIDGE_PORT", "8090"))
    log.info("Bridge ZKTeco avviato su :%d — terminali: %s", port, ", ".join(TERMINALI.keys()) or "NESSUNO")
    app.run(host="0.0.0.0", port=port)
