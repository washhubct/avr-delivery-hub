"""Helper Firestore REST per script da CLI (service account gcloud claude-cli).

Uso:  from firestore_rest import coll, doc, run_query, TOKEN, BASE
      coll('driverAnagrafica')                                  → lista di dict (+ '_id')
      coll('reportDriver', ('mese', 'EQUAL', {'stringValue': '2026-10'}))

Nessun secret nel file: il token arriva da `gcloud auth print-access-token`.
Nota: usare l'URL con '(default)' letterale, la forma %28default%29 dà 404.
"""
import json, subprocess, urllib.request

PROJ = "avr-logistic-dashboard"
SA = "claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com"
TOKEN = subprocess.check_output(["gcloud", "auth", "print-access-token", "--account=" + SA], text=True, stderr=subprocess.DEVNULL).strip()
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJ}/databases/(default)/documents"
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def _val(v):
    if "stringValue" in v: return v["stringValue"]
    if "integerValue" in v: return int(v["integerValue"])
    if "doubleValue" in v: return v["doubleValue"]
    if "booleanValue" in v: return v["booleanValue"]
    if "timestampValue" in v: return v["timestampValue"]
    if "nullValue" in v: return None
    if "mapValue" in v: return {k: _val(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    if "arrayValue" in v: return [_val(x) for x in (v["arrayValue"].get("values") or [])]
    return v


def doc(d):
    out = {k: _val(v) for k, v in (d.get("fields") or {}).items()}
    out["_id"] = d["name"].rsplit("/", 1)[1]
    return out


def get(path):
    req = urllib.request.Request(BASE + "/" + path, headers=H)
    return doc(json.load(urllib.request.urlopen(req)))


def run_query(q):
    req = urllib.request.Request(BASE + ":runQuery", method="POST", data=json.dumps({"structuredQuery": q}).encode(), headers=H)
    with urllib.request.urlopen(req) as r:
        return [doc(x["document"]) for x in json.load(r) if "document" in x]


def coll(name, where=None, limit=None):
    q = {"from": [{"collectionId": name}]}
    if where:
        f, op, val = where
        q["where"] = {"fieldFilter": {"field": {"fieldPath": f}, "op": op, "value": val}}
    if limit: q["limit"] = limit
    return run_query(q)
