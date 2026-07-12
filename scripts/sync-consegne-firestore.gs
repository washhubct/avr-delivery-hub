/**
 * AVR LOGISTIC — SYNC CONSEGNE → FIRESTORE (standalone GAS)
 *
 * Gira sull'account Google che ha già accesso ai fogli filiale Decò
 * (nessuna condivisione col service account necessaria): legge le tab
 * mensili dei fogli nella cartella FOLDER_ID e spinge i record alla
 * Cloud Function `ingestConsegne`, che li scrive in `consegne` con lo
 * stesso docId di dedup dell'import manuale → mai duplicati/perdite.
 *
 * Convenzioni di parsing allineate al GAS sync v4.1 FIX
 * (riepilogo-avr-consegne.gs) + regole fatturazione della dash:
 *   • header trovato cercando COGNOME/DATA nelle prime 5 righe
 *   • righe ANNULLAT nel cognome → escluse
 *   • righe RITORNO (colonna RICHIESTA o TARGA) → escluse (fatturate a parte)
 *   • PRESTAZIONE (AVR/INTERNA) importata
 *   • CONSEGNATA si/no → flag nonConsegnata se esplicito NO
 *   • filiale: colonna FIL. se presente, altrimenti dal nome file
 *
 * ── SETUP (una volta) ─────────────────────────────────────────
 * 1. script.google.com → Nuovo progetto → incolla questo file
 * 2. Compila FOLDER_ID qui sotto
 * 3. Project Settings → Script Properties → aggiungi:
 *      SYNC_SECRET = <stesso valore di `firebase functions:secrets:set SYNC_INGEST_SECRET`>
 * 4. Esegui `syncMeseCorrente` una volta a mano (autorizza i permessi)
 * 5. Trigger (orologio) → aggiungi trigger:
 *      funzione syncMeseCorrente · time-driven · Day timer · 3:00-4:00
 *
 * Per backfill di un mese specifico: esegui syncMeseSpecifico dopo aver
 * impostato MESE_BACKFILL, oppure chiama syncMesi(['2026-06']).
 */

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
var FOLDER_ID = 'METTI_QUI_ID_CARTELLA_DRIVE';   // cartella coi fogli filiale
var CF_INGEST_URL = 'https://europe-west1-avr-logistic-dashboard.cloudfunctions.net/ingestConsegne';
var TIMEZONE = 'Europe/Rome';
var MESE_BACKFILL = '';                          // es. '2026-06' per syncMeseSpecifico
var CHUNK_SIZE = 400;                            // record per POST (max CF: 500)

var MESI_TAB = { GEN: 1, FEB: 2, MAR: 3, APR: 4, MAG: 5, GIU: 6, LUG: 7, AGO: 8, SET: 9, OTT: 10, NOV: 11, DIC: 12 };
var MESI_NOMI = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];

// ═══════════════════════════════════════════════════════════
// ENTRY POINTS
// ═══════════════════════════════════════════════════════════

// Trigger notturno: mese corrente (+ precedente nei primi 10 giorni)
function syncMeseCorrente() {
  var now = new Date();
  var mese = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM');
  var giorno = parseInt(Utilities.formatDate(now, TIMEZONE, 'dd'), 10);
  var mesi = [mese];
  if (giorno <= 10) mesi.push(mesePrecedente(mese));
  syncMesi(mesi);
}

// Backfill manuale di un mese specifico (imposta MESE_BACKFILL)
function syncMeseSpecifico() {
  if (!/^\d{4}-\d{2}$/.test(MESE_BACKFILL)) {
    throw new Error('Imposta MESE_BACKFILL nel formato YYYY-MM');
  }
  syncMesi([MESE_BACKFILL]);
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
function syncMesi(mesiTarget) {
  if (!FOLDER_ID || FOLDER_ID === 'METTI_QUI_ID_CARTELLA_DRIVE') {
    throw new Error('Compila FOLDER_ID in testa allo script.');
  }
  var secret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!secret) throw new Error('Imposta SYNC_SECRET nelle Script Properties.');

  Logger.log('=== SYNC CONSEGNE → FIRESTORE — mesi ' + mesiTarget.join(', ') + ' ===');

  var folder = DriveApp.getFolderById(FOLDER_ID);
  var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);

  var dettagli = [];
  var totUpserted = 0, totRitorni = 0, totScarti = 0, errori = 0;

  while (files.hasNext()) {
    var file = files.next();
    var filiale = filialeFromFileName(file.getName());
    var det = { nome: file.getName(), tabs: [], upserted: 0, errore: null };

    var ss;
    try {
      ss = SpreadsheetApp.openById(file.getId());
    } catch (errOpen) {
      det.errore = errOpen.message;
      errori++;
      dettagli.push(det);
      Logger.log('❌ ' + file.getName() + ': ' + errOpen.message);
      continue;
    }

    var tabs = ss.getSheets();
    for (var t = 0; t < tabs.length; t++) {
      var tabName = tabs[t].getName();
      var meseTab = meseFromTabName(tabName);
      if (!meseTab || mesiTarget.indexOf(meseTab) < 0) continue;

      try {
        var res = processTab(tabs[t], filiale, file.getName(), tabName);
        totRitorni += res.ritorni;
        totScarti += res.scarti;

        var sent = 0;
        for (var i = 0; i < res.records.length; i += CHUNK_SIZE) {
          sent += postRecords(res.records.slice(i, i + CHUNK_SIZE), secret);
        }
        det.tabs.push({ tab: tabName, consegne: sent, ritorniEsclusi: res.ritorni, scarti: res.scarti });
        det.upserted += sent;
        Logger.log('   ✓ ' + file.getName() + ' / ' + tabName + ': ' + sent + ' consegne' +
          (res.ritorni ? ' (+' + res.ritorni + ' ritorni esclusi)' : ''));
      } catch (errTab) {
        det.tabs.push({ tab: tabName, warn: errTab.message });
        errori++;
        Logger.log('   ⚠️ ' + file.getName() + ' / ' + tabName + ': ' + errTab.message);
      }
    }
    totUpserted += det.upserted;
    dettagli.push(det);
  }

  // Riepilogo finale → syncStatus/last nella dash
  postSummary({
    type: 'summary',
    mesi: mesiTarget,
    totUpserted: totUpserted,
    totRitorniEsclusi: totRitorni,
    totScarti: totScarti,
    errori: errori,
    dettagli: dettagli,
  }, secret);

  Logger.log('=== DONE === consegne=' + totUpserted + ' ritorni-esclusi=' + totRitorni + ' errori=' + errori);
}

// ═══════════════════════════════════════════════════════════
// PARSING TAB → RECORDS
// ═══════════════════════════════════════════════════════════
function processTab(ws, filiale, fileName, tabName) {
  var out = { records: [], ritorni: 0, scarti: 0 };
  var data = ws.getDataRange().getValues();
  if (data.length < 2) return out;

  // Header nelle prime 5 righe: ancora su COGNOME o FIL + DATA
  var headerRow = -1;
  for (var r = 0; r < Math.min(5, data.length); r++) {
    var rowUp = data[r].map(function(v) { return String(v || '').toUpperCase().trim(); });
    var hasData = rowUp.indexOf('DATA') >= 0;
    var hasAncora = rowUp.some(function(h) { return h.indexOf('COGNOME') >= 0 || h === 'FIL' || h === 'FIL.'; });
    if (hasData && hasAncora) { headerRow = r; break; }
  }
  if (headerRow < 0) throw new Error('struttura non riconosciuta');

  var header = data[headerRow].map(function(v) { return String(v || '').toUpperCase().trim(); });
  var ci = {
    filiale: findColExact(header, ['FIL', 'FIL.', 'FIL. PARTENZA']),
    data: findColExact(header, ['DATA']),
    orderId: findCol(header, ['ORDER ID']),
    fascia: findColExact(header, ['FASCIA']),
    cognome: findColExact(header, ['COGNOME']),
    nome: findColExact(header, ['NOME']),
    provincia: findColExact(header, ['PR']),
    citta: findCol(header, ['CITTA']),
    indirizzo: findColExact(header, ['INDIRIZZO']),
    importo: findColImporto(header),
    pagamento: findColExact(header, ['PAGAMENTO']),
    codiceDom: findCol(header, ['CODICE DOMICILIO', 'CODICE_DOM']),
    driver: findColExact(header, ['RIDER', 'DRIVER']),
    targa: findCol(header, ['TARGA']),
    consegnata: findCol(header, ['CONSEGNATA']),
    prestazione: findColExact(header, ['PRESTAZIONE']),
    richiesta: findCol(header, ['RICHIESTA']),
    oraConsegna: findCol(header, ['ORA CONSEGNA']),
  };
  if (ci.data < 0) throw new Error('colonna DATA mancante');

  for (var i = headerRow + 1; i < data.length; i++) {
    var row = data[i];

    var filialeRaw = val(row, ci.filiale);
    var cognome = val(row, ci.cognome);
    if (!filialeRaw && !cognome) continue;
    if (!row[ci.data]) continue;

    // ANNULLAT nel cognome → riga cancellata (convenzione v4.1)
    if (normalizzaNome(cognome).indexOf('ANNULLAT') >= 0) { out.scarti++; continue; }

    // RITORNO → escluso (fatturato a parte)
    var richiesta = (val(row, ci.richiesta) || '').toUpperCase();
    var targa = (val(row, ci.targa) || '').toUpperCase();
    if (richiesta.indexOf('RITORNO') >= 0 || targa === 'RITORNO') { out.ritorni++; continue; }

    var dv = parseDate(row[ci.data]);
    if (!dv) { out.scarti++; continue; }

    var consegnataRaw = (val(row, ci.consegnata) || '').toUpperCase();

    out.records.push({
      filiale: (filialeRaw || filiale.codice || '').replace(/\.0$/, ''),
      data: Utilities.formatDate(dv, TIMEZONE, 'yyyy-MM-dd'),
      cliente: [cognome, val(row, ci.nome)].filter(Boolean).join(' ').trim() || null,
      provincia: val(row, ci.provincia),
      citta: val(row, ci.citta),
      indirizzo: val(row, ci.indirizzo),
      importo: parseImporto(row[ci.importo]),
      fascia: val(row, ci.fascia) || val(row, ci.oraConsegna),
      driver: val(row, ci.driver),
      targa: val(row, ci.targa),
      consegnata: consegnataRaw === 'SI',
      nonConsegnata: consegnataRaw === 'NO',
      prestazione: val(row, ci.prestazione),
      orderId: val(row, ci.orderId),
      pagamento: val(row, ci.pagamento),
      codiceDomicilio: val(row, ci.codiceDom),
      fonte: fileName,
      sheetName: tabName,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// HTTP → CLOUD FUNCTION
// ═══════════════════════════════════════════════════════════
function postRecords(records, secret) {
  var resp = UrlFetchApp.fetch(CF_INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sync-secret': secret },
    payload: JSON.stringify({ type: 'records', records: records }),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error('CF ' + code + ': ' + resp.getContentText().substring(0, 200));
  var body = JSON.parse(resp.getContentText());
  return body.upserted || 0;
}

function postSummary(summary, secret) {
  try {
    UrlFetchApp.fetch(CF_INGEST_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sync-secret': secret },
      payload: JSON.stringify(summary),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('⚠️ summary non inviato: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS (allineati a riepilogo-avr-consegne.gs / v4.1 FIX)
// ═══════════════════════════════════════════════════════════
function val(row, idx) {
  if (idx == null || idx < 0 || idx >= row.length) return null;
  var v = row[idx];
  if (v === null || v === undefined || v === '') return null;
  return String(v).trim();
}

function findCol(header, names) {
  for (var i = 0; i < header.length; i++) {
    for (var j = 0; j < names.length; j++) {
      if (header[i].indexOf(names[j]) >= 0) return i;
    }
  }
  return -1;
}

function findColExact(header, names) {
  for (var i = 0; i < header.length; i++) {
    for (var j = 0; j < names.length; j++) {
      if (header[i] === names[j]) return i;
    }
  }
  return -1;
}

// IMPORTO EFFETTIVO ha priorità su IMPORTO
function findColImporto(header) {
  var eff = findCol(header, ['IMPORTO EFFETTIVO']);
  if (eff >= 0) return eff;
  return findColExact(header, ['IMPORTO']);
}

function normalizzaNome(s) {
  return (s || '').toString().toUpperCase().trim()
    .replace(/[ÀÁÂÃ]/g, 'A').replace(/[ÈÉÊË]/g, 'E')
    .replace(/[ÌÍÎÏ]/g, 'I').replace(/[ÒÓÔÕ]/g, 'O')
    .replace(/[ÙÚÛÜ]/g, 'U');
}

function parseImporto(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  var s = String(v).trim().replace(/[€\s]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function filialeFromFileName(fileName) {
  var name = String(fileName || '').trim();
  var m = name.match(/\b(\d{3})\b/);
  var codice = m ? m[1] : '';
  var nome = name.replace(/\bFILIALE\b/i, '').replace(/\b\d{3}\b/, '').replace(/[_\-]+/g, ' ').trim();
  return { codice: codice, nome: nome || name };
}

// "LUG 26" / "LUG26" → "2026-07"
function meseFromTabName(name) {
  var m = String(name || '').toUpperCase().trim()
    .match(/^(GEN|FEB|MAR|APR|MAG|GIU|LUG|AGO|SET|OTT|NOV|DIC)\s?(\d{2})$/);
  if (!m) return null;
  return '20' + m[2] + '-' + ('0' + MESI_TAB[m[1]]).slice(-2);
}

function mesePrecedente(meseStr) {
  var parts = meseStr.split('-');
  var y = parseInt(parts[0], 10), mm = parseInt(parts[1], 10) - 1;
  if (mm === 0) { y--; mm = 12; }
  return y + '-' + ('0' + mm).slice(-2);
}

// parseDate robusto — identico al v4.1 FIX (gestisce errori di battitura)
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val;
  }
  var s = String(val).trim();

  var cleaned = s.replace(/(\d{1,2})[\/\-\.](\d{3})[\/\-\.](\d{4})/, function(m, d, mm, y) {
    return d + '/' + mm.substring(0, 2) + '/' + y;
  });
  if (cleaned !== s) s = cleaned;

  var match = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (match) {
    var day = parseInt(match[1]), month = parseInt(match[2]) - 1, year = parseInt(match[3]);
    if (year < 100) year += 2000;
    var d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  var matchIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matchIso) {
    var d2 = new Date(parseInt(matchIso[1]), parseInt(matchIso[2]) - 1, parseInt(matchIso[3]));
    if (!isNaN(d2.getTime())) return d2;
  }

  var digits = s.replace(/[\/\-\.\s]/g, '');
  if (/^\d{8}$/.test(digits)) {
    var d3 = new Date(parseInt(digits.substring(4, 8)), parseInt(digits.substring(2, 4)) - 1, parseInt(digits.substring(0, 2)));
    if (!isNaN(d3.getTime())) return d3;
  }
  if (/^\d{6}$/.test(digits)) {
    var d5 = new Date(2000 + parseInt(digits.substring(4, 6)), parseInt(digits.substring(2, 4)) - 1, parseInt(digits.substring(0, 2)));
    if (!isNaN(d5.getTime())) return d5;
  }

  var num = parseFloat(s);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    var d6 = new Date((num - 25569) * 86400 * 1000);
    if (!isNaN(d6.getTime())) return d6;
  }
  return null;
}
