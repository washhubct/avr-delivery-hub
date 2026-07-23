/**
 * AVR LOGISTIC - GAS SYNC v5.0 (riconciliazione + anti-timeout)
 * Filiali MENSILI (tutte tranne 940 e 524, che usano il Giornalieri v1)
 *
 * BUG RISOLTI vs v4.2 (verificati sul confronto file reale GIU 26):
 *
 *  1. DUPLICATI DA CORREZIONI (300 +75, 346 +42, 301 +23, 523 +14 sui >=250)
 *     L'ID contiene cognome+importo+indirizzo: se una riga viene corretta
 *     dopo la prima sync nasce un nuovo doc e il vecchio resta per sempre.
 *     FIX: fase di RICONCILIAZIONE. Dopo il parse di ogni filiale si
 *     scaricano gli ID esistenti su Firestore (mese + fonte gas_v4/gas_v5)
 *     e si CANCELLANO i doc che non risultano piu' nello sheet. Il sync
 *     diventa idempotente e auto-riparante: qualsiasi correzione converge.
 *
 *  2. TIMEOUT 6 MINUTI (966 -53, 516 -52, 522 -47, 528 -29: filiali in
 *     coda alla lista mai processate a mese pieno)
 *     FIX: checkpoint su ScriptProperties + trigger di continuazione
 *     one-shot. Se il tempo supera il budget, il run salva a che punto e'
 *     e riparte da li' dopo ~1 minuto. Nessuna filiale resta indietro.
 *
 *  3. FINE MESE PERSO (righe di giugno caricate a luglio mai sincate)
 *     FIX: nei primi GRACE_DAYS giorni del mese si sincronizza ANCHE il
 *     tab del mese precedente.
 *
 *  4. IMPORTI CON VIRGOLA: parseFloat("123,45") = 123.
 *     FIX: parseImporto() gestisce formato italiano (1.234,56).
 *
 *  5. COLLISIONI ID: due consegne identiche stesso giorno = stesso ID,
 *     una sovrascrive l'altra.
 *     FIX: suffisso deterministico _2, _3 sulle occorrenze duplicate.
 *
 *  6. BATCH WRITE SILENZIOSAMENTE PERSI su errore HTTP.
 *     FIX: un retry con backoff; conteggio scritture fallite nel log.
 *
 * SICUREZZA:
 *  - La riconciliazione cancella SOLO doc con fonte gas_v4/gas_v5 del
 *    mese target (mai BACKFILL_XLSX ne' gas_giorn_v1).
 *  - Se il parse di una filiale fallisce o produce 0 righe, la
 *    riconciliazione per quella filiale viene SALTATA.
 *  - Paracadute: se le cancellazioni superano 25 doc E il 30% dei doc
 *    esistenti della filiale, si salta e si logga ALERT (probabile
 *    problema sheet, non correzioni legittime).
 *
 * DEPLOY: Apps Script "AVR Sync Mensili" - sostituire il codice,
 * salvare, eseguire setupTriggers() una volta, poi test con syncMensili().
 * Il trigger di setupTriggers cancella SOLO i trigger di questo modulo
 * (syncMensili / syncMensiliContinua), non tocca altri script.
 */

var FIREBASE_PROJECT_ID = 'avr-logistic-dashboard';
var DOCS_BASE = 'projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents';
var BATCH_URL = 'https://firestore.googleapis.com/v1/' + DOCS_BASE + ':batchWrite';
var QUERY_URL = 'https://firestore.googleapis.com/v1/' + DOCS_BASE + ':runQuery';

var FONTE = 'gas_v5';
var FONTI_RECONCILE = { 'gas_v4': true, 'gas_v5': true, 'GAS': true };
var GRACE_DAYS = 5;              // primi N giorni del mese: sync anche mese precedente
var MAX_RUN_MS = 4.5 * 60 * 1000; // budget tempo prima di salvare checkpoint
var CKPT_KEY = 'SYNC_MENSILI_CKPT';

var DRIVER_LIST = [
  'VISCONTI','ARICO','GALEAZZO','ROTOLO','TUMMINIA','BUCCHERI','SCHILLACI',
  'CARDILE','IMMORMINO','DI GIORGI','DI CANDIA','AREZZIO','GALLO','STURIALE',
  'MESSINA','VINCI','LA PORTA','BRUNO','ZAPPALA','SCABOTTI','DAL PIN','MASSIMINO',
  'SIYAMBALA GAMAGE','PITTA','BELLUARDO','ZOCCO','CANNARELLA','LI NOCE','DI PRIMA'
];

var FILIALI = [
  { sheetId: '1Mbog1enTD18W0r7Ie03EzBchYR9lCF5yvpW6dQL1aBM', codice: '300', area: 'CT', nome: 'Balatelle' },
  { sheetId: '1aIYZ5BIIlZvw1DDz5yCJTSAsRoCY7n9J7KV0bcFu2lw', codice: '301', area: 'CT', nome: 'Carnazza' },
  { sheetId: '1XgR7TovWgY-0pW_NIbCuB0eGZJGm8FNsEZEnWpq8K6c', codice: '342', area: 'PA', nome: 'Giotto' },
  { sheetId: '1nVZTP5OwBMIfTHIQywYt1GbjvsBbRQFvZ6LcPxjq1Bg', codice: '343', area: 'CT', nome: 'Pola' },
  { sheetId: '1ASFT3M9coo3Zuqf-iSgaoasoxThsto8hAoqojmf1Cxc', codice: '346', area: 'CT', nome: 'Leone' },
  { sheetId: '15dv1maX8zjteESUTi6QpQ9OnMK1tErm4qi7BytFcwrY', codice: '401', area: 'CT', nome: 'Messina' },
  { sheetId: '19xMyxxy5OfVIVtiSkfQ7XGFPtlW4NO7N2Hw3M65dRNI', codice: '411', area: 'SR', nome: 'Elorina' },
  { sheetId: '1yuhEDb6WORoTvp-htBg-Tv-XnYwg5m88fbIcch-LmIA', codice: '511', area: 'ME', nome: 'Ganzirri' },
  { sheetId: '1oLDgBBJk_m94scS23mdmsI4R2rvBgEb15A4MqfWRCwM', codice: '513', area: 'ME', nome: 'Palmara' },
  { sheetId: '1SalneCHKOgAM-qr5bUbvqWKiNZoR0ESemcAEYkulods', codice: '514', area: 'ME', nome: 'San Licandro' },
  { sheetId: '1NcuY2aAEsCtaMKcqY770LgWLQE5qZXGYKT8tCVwKfSI', codice: '515', area: 'ME', nome: 'San Martino' },
  { sheetId: '1WETOk-4_G_Xc4tpHrwDHfE5HMo9cTFJTux6qK7X4bDI', codice: '516', area: 'ME', nome: 'Tremestieri' },
  { sheetId: '1V4B3YVp-aljc4c2cYWj759Scg-qnhtOomQLZrq3aPnk', codice: '522', area: 'CT', nome: 'Tivoli' },
  { sheetId: '1-UFBbOdcqg7Q3TMIsWR4_joCQKZKrj8lq-KsesnxCgM', codice: '523', area: 'CT', nome: 'Acicastello' },
  { sheetId: '1xPMTMiVHApssS2TcLzMA1fKhr0xcWgyHS3eGRChnNZw', codice: '528', area: 'SR', nome: 'Scala Greca' },
  { sheetId: '1nrh8dCMbwPr0wWOpacAD4sZ4Nero8JLCKKZRhEeBaxw', codice: '529', area: 'SR', nome: 'Tisia' },
  { sheetId: '1-4vHi9UbeWbbWpC_HmgO8DyF5NOP57bjj9HgJEIkd4A', codice: '533', area: 'PA', nome: 'La Malfa' },
  { sheetId: '1yquijow8MODcyK70Xgt0ruK_oQZCBs0d4TYmMGOOc2w', codice: '537', area: 'PA', nome: 'Nebrodi' },
  { sheetId: '1-3PjLthjCIzX_L0J2jaTPs1eEUW-2dS11FauI3RD5D8', codice: '542', area: 'PA', nome: 'Leoni' },
  { sheetId: '1wm4FuvxlU2ZUKdrlJ4AVAJw1xY5yupKDSCShS7G0QyM', codice: '543', area: 'PA', nome: 'Sampolo' },
  { sheetId: '1988z2RSAZNrW3tGaRNOcc-TFimmJv4kkur55DqDJtbc', codice: '631', area: 'SR', nome: 'Gelone' },
  { sheetId: '1_u-7DJ5V65bgMuyYXi9ja55C1OrZbt9LlNE2tjITkzE', codice: '634', area: 'SR', nome: 'Terracati' },
  { sheetId: '104Mwqkc4rxptgKXZnsucJwL4NfQ0CgejQVU9DceMnpM', codice: '639', area: 'EN', nome: 'Enna Alta' },
  { sheetId: '1hkHikWmNv-Hr2z9dHm5Om7_ZuFtMHAZZsPuLm-wK-KQ', codice: '965', area: 'EN', nome: 'Libero Grassi' },
  { sheetId: '1p5DQZIny3p0fygmEy_hUGoe98WJ4dj7clS2PIfhm1Eg', codice: '966', area: 'EN', nome: 'Enna Mercato' }
];

// -- Mesi target -----------------------------------------------------
// offset 0 = mese corrente, -1 = mese precedente.
function getMeseInfo(offset) {
  var now = new Date();
  var d = new Date(now.getFullYear(), now.getMonth() + (offset || 0), 1);
  var mesi = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
  return {
    label: mesi[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2),   // es. "LUG 26"
    meseFs: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') // es. "2026-07"
  };
}

function getTargets() {
  var targets = [];
  var day = new Date().getDate();
  if (day <= GRACE_DAYS) targets.push(getMeseInfo(-1)); // coda mese precedente
  targets.push(getMeseInfo(0));
  return targets;
}

// -- Helpers parsing -------------------------------------------------
function isOurDriver(name) {
  if (!name) return false;
  var r = name.toString().trim().toUpperCase().replace(/['\u2019`]/g, '').replace(/\s+/g, ' ');
  if (!r) return false;
  for (var i = 0; i < DRIVER_LIST.length; i++) {
    if (r.indexOf(DRIVER_LIST[i]) >= 0 || DRIVER_LIST[i].indexOf(r) >= 0) return true;
  }
  return false;
}

function findCol(header, names) {
  for (var i = 0; i < header.length; i++) {
    for (var j = 0; j < names.length; j++) {
      if (header[i].indexOf(names[j]) >= 0) return i;
    }
  }
  return -1;
}

// Importo robusto: numeri nativi, "123,45", "1.234,56", "1,234.56", "EUR 12"
function parseImporto(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  var s = String(val === null || val === undefined ? '' : val).trim();
  if (!s) return 0;
  s = s.replace(/[^0-9.,\-]/g, '');
  if (!s) return 0;
  var lastComma = s.lastIndexOf(',');
  var lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else s = s.replace(/,/g, '');                                        // 1,234.56
  } else if (lastComma >= 0) {
    s = s.replace(/\./g, '').replace(',', '.');                          // 123,45
  }
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

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
    var day = parseInt(match[1]);
    var month = parseInt(match[2]) - 1;
    var year = parseInt(match[3]);
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
    var day3 = parseInt(digits.substring(0, 2));
    var month3 = parseInt(digits.substring(2, 4)) - 1;
    var year3 = parseInt(digits.substring(4, 8));
    if (day3 >= 1 && day3 <= 31 && month3 >= 0 && month3 <= 11 && year3 >= 2020 && year3 <= 2030) {
      var d3 = new Date(year3, month3, day3);
      if (!isNaN(d3.getTime())) return d3;
    }
  }

  if (/^\d{7}$/.test(digits)) {
    var day4 = parseInt(digits.substring(0, 2));
    var month4 = parseInt(digits.substring(2, 4)) - 1;
    var yearPartial = digits.substring(4);
    var year4 = parseInt('202' + yearPartial.charAt(yearPartial.length - 1));
    if (day4 >= 1 && day4 <= 31 && month4 >= 0 && month4 <= 11) {
      var d4 = new Date(year4, month4, day4);
      if (!isNaN(d4.getTime())) return d4;
    }
  }

  if (/^\d{6}$/.test(digits)) {
    var day5 = parseInt(digits.substring(0, 2));
    var month5 = parseInt(digits.substring(2, 4)) - 1;
    var year5 = 2000 + parseInt(digits.substring(4, 6));
    if (day5 >= 1 && day5 <= 31 && month5 >= 0 && month5 <= 11) {
      var d5 = new Date(year5, month5, day5);
      if (!isNaN(d5.getTime())) return d5;
    }
  }

  var matchPartial = s.match(/^(\d{1,2})[\/\-\.](\d{2,6})$/);
  if (matchPartial) {
    var dayP = parseInt(matchPartial[1]);
    var rest = matchPartial[2];
    if (rest.length >= 6) {
      var monthP = parseInt(rest.substring(0, 2)) - 1;
      var yearP = parseInt(rest.substring(2));
      if (yearP < 100) yearP += 2000;
      if (dayP >= 1 && dayP <= 31 && monthP >= 0 && monthP <= 11) {
        var dP = new Date(yearP, monthP, dayP);
        if (!isNaN(dP.getTime())) return dP;
      }
    }
  }

  var matchPartial2 = s.match(/^(\d{4,6})[\/\-\.](\d{2,4})$/);
  if (matchPartial2) {
    var left = matchPartial2[1];
    var right = matchPartial2[2];
    if (left.length === 4 && right.length === 4) {
      var dayP2 = parseInt(left.substring(0, 2));
      var monthP2 = parseInt(left.substring(2, 4)) - 1;
      var yearP2 = parseInt(right);
      if (dayP2 >= 1 && dayP2 <= 31 && monthP2 >= 0 && monthP2 <= 11) {
        var dP2 = new Date(yearP2, monthP2, dayP2);
        if (!isNaN(dP2.getTime())) return dP2;
      }
    }
  }

  var num = parseFloat(s);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    var d6 = new Date((num - 25569) * 86400 * 1000);
    if (!isNaN(d6.getTime())) return d6;
  }

  return null;
}

// -- Firestore I/O ---------------------------------------------------
function toFs(obj) {
  var f = {};
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = obj[k];
    if (v === null || v === undefined) { f[k] = { nullValue: null }; }
    else if (typeof v === 'string') { f[k] = { stringValue: v }; }
    else if (typeof v === 'number') { f[k] = v === Math.floor(v) ? { integerValue: String(v) } : { doubleValue: v }; }
    else if (typeof v === 'boolean') { f[k] = { booleanValue: v }; }
    else { f[k] = { stringValue: String(v) }; }
  }
  return f;
}

// Esegue un batchWrite con 1 retry su errore. writes = array gia' in formato API.
function sendBatch_(writes) {
  var token = ScriptApp.getOAuthToken();
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var resp = UrlFetchApp.fetch(BATCH_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify({ writes: writes }),
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() < 400) return true;
      Logger.log('Batch error (tentativo ' + (attempt + 1) + '): ' + resp.getContentText().substring(0, 300));
    } catch (e) {
      Logger.log('Batch exception (tentativo ' + (attempt + 1) + '): ' + e.message);
    }
    Utilities.sleep(1000);
  }
  return false;
}

// Upsert dei documenti (ognuno con _id). Ritorna { written, failed }.
function batchWriteDocs(docs) {
  var written = 0, failed = 0;
  for (var i = 0; i < docs.length; i += 200) {
    var batch = docs.slice(i, i + 200);
    var writes = [];
    for (var b = 0; b < batch.length; b++) {
      var docData = {};
      var keys = Object.keys(batch[b]);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k] !== '_id') docData[keys[k]] = batch[b][keys[k]];
      }
      writes.push({
        update: {
          name: DOCS_BASE + '/consegne/' + batch[b]._id,
          fields: toFs(docData)
        }
      });
    }
    if (sendBatch_(writes)) written += batch.length;
    else failed += batch.length;
    Utilities.sleep(200);
  }
  return { written: written, failed: failed };
}

// Cancella per ID. Ritorna il numero di doc cancellati.
function batchDeleteIds(ids) {
  var deleted = 0;
  for (var i = 0; i < ids.length; i += 200) {
    var batch = ids.slice(i, i + 200);
    var writes = [];
    for (var b = 0; b < batch.length; b++) {
      writes.push({ delete: DOCS_BASE + '/consegne/' + batch[b] });
    }
    if (sendBatch_(writes)) deleted += batch.length;
    Utilities.sleep(200);
  }
  return deleted;
}

// Scarica gli ID esistenti su Firestore per il mese target, SOLO fonti
// del sync mensile (gas_v4/gas_v5/GAS). Ritorna { filiale: [id, ...] }.
function fetchExistingIds(meseFs) {
  var token = ScriptApp.getOAuthToken();
  var byFiliale = {};
  var startAfter = null;
  var pages = 0;
  while (pages < 50) { // hard cap di sicurezza (50 x 2000 = 100k doc)
    pages++;
    var q = {
      from: [{ collectionId: 'consegne' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'mese' }, op: 'EQUAL',
          value: { stringValue: meseFs }
        }
      },
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      select: { fields: [{ fieldPath: 'filiale' }, { fieldPath: 'fonte' }] },
      limit: 2000
    };
    if (startAfter) q.startAt = { values: [{ referenceValue: startAfter }], before: false };
    var resp = UrlFetchApp.fetch(QUERY_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ structuredQuery: q }),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 400) {
      Logger.log('fetchExistingIds error: ' + resp.getContentText().substring(0, 300));
      return null; // segnale: NON riconciliare senza la lista
    }
    var rows = JSON.parse(resp.getContentText());
    var got = 0, last = null;
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].document;
      if (!d) continue;
      got++;
      last = d.name;
      var f = d.fields || {};
      var fonte = f.fonte && f.fonte.stringValue ? f.fonte.stringValue : '';
      if (!FONTI_RECONCILE[fonte]) continue; // mai toccare backfill/giornalieri
      var fil = f.filiale && f.filiale.stringValue ? f.filiale.stringValue : '??';
      var id = d.name.substring(d.name.lastIndexOf('/') + 1);
      if (!byFiliale[fil]) byFiliale[fil] = [];
      byFiliale[fil].push(id);
    }
    if (got < 2000 || !last) break;
    startAfter = last;
  }
  return byFiliale;
}

// -- Schema ID stabile (come v4.2) + suffisso anti-collisione --------
function buildStableId(codiceFiliale, dataYYYYMMDD, cognome, importo, indirizzo) {
  var cog = String(cognome || '').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
  var indir = String(indirizzo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
  var cents = Math.round((importo || 0) * 100);
  var id = codiceFiliale + '_' + dataYYYYMMDD + '_' + cog + '_' + cents;
  if (indir) id += '_' + indir;
  return id.substring(0, 100);
}

// Applica suffissi _2, _3... alle occorrenze con lo stesso ID (due
// consegne identiche stesso giorno). Deterministico a parita' di righe.
function dedupeIds(docs) {
  var seen = {};
  for (var i = 0; i < docs.length; i++) {
    var id = docs[i]._id;
    if (seen[id]) {
      seen[id]++;
      docs[i]._id = id + '_' + seen[id];
    } else {
      seen[id] = 1;
    }
  }
  return docs;
}

// -- Parser (come v4.2, con parseImporto e meseFs parametrico) -------
function parseMensile(filiale, sheetName, meseFs) {
  var out = { ok: false, docs: [] };
  var skipped = { noDate: 0, noCognome: 0, noImporto: 0, annullato: 0, wrongMonth: 0, dateParseErr: 0 };
  try {
    var ss = SpreadsheetApp.openById(filiale.sheetId);
    var ws = ss.getSheetByName(sheetName);
    if (!ws) { out.ok = true; return out; } // tab assente = nessun dato, legittimo
    var data = ws.getDataRange().getValues();
    if (data.length < 2) { out.ok = true; return out; }
    var header = [];
    for (var h = 0; h < data[0].length; h++) header.push(String(data[0][h]).trim().toUpperCase());
    var ci = {
      data: findCol(header, ['DATA']), cognome: findCol(header, ['COGNOME']), nome: findCol(header, ['NOME']),
      citta: findCol(header, ['CITTA']), indirizzo: findCol(header, ['INDIRIZZO']),
      importo: findCol(header, ['IMPORTO']),
      codiceDom: findCol(header, ['CODICE DOMICILIO', 'COD. DOMICILIO', 'CODICE DOM', 'COD DOM']),
      ora: findCol(header, ['ORA CONSEGNA']), rider: findCol(header, ['RIDER', 'DRIVER']),
      consegnata: findCol(header, ['CONSEGNATA']), prestazione: findCol(header, ['PRESTAZIONE'])
    };
    if (ci.cognome === -1 || ci.data === -1) { out.ok = true; return out; }
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var cognome = String(row[ci.cognome] || '').trim();
      if (!cognome) { skipped.noCognome++; continue; }
      if (cognome.toUpperCase().indexOf('ANNULLAT') >= 0) { skipped.annullato++; continue; }

      var dv = parseDate(row[ci.data]);
      if (!dv) {
        skipped.dateParseErr++;
        Logger.log('  WARN ' + filiale.codice + ' riga ' + (i + 1) + ': data non parsabile "' + row[ci.data] + '" - cognome: ' + cognome);
        continue;
      }

      var mese = dv.getFullYear() + '-' + String(dv.getMonth() + 1).padStart(2, '0');
      if (mese !== meseFs) { skipped.wrongMonth++; continue; }

      var importo = ci.importo >= 0 ? parseImporto(row[ci.importo]) : 0;
      if (importo === 0) { skipped.noImporto++; continue; }

      var rider = ci.rider >= 0 ? String(row[ci.rider] || '').trim() : '';
      var prest = ci.prestazione >= 0 ? String(row[ci.prestazione] || '').trim().toUpperCase() : 'AVR';
      var isAvr = isOurDriver(rider);
      var consegnata = ci.consegnata >= 0 ? String(row[ci.consegnata] || '').trim().toUpperCase() : '';
      var indirizzo = ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '';

      var ds = Utilities.formatDate(dv, 'Europe/Rome', 'yyyy-MM-dd');
      var docId = buildStableId(filiale.codice, ds.replace(/-/g, ''), cognome, importo, indirizzo);

      out.docs.push({
        _id: docId,
        filiale: filiale.codice, filialeNome: filiale.nome, area: filiale.area,
        data: dv.toISOString(), mese: mese, cognome: cognome.toUpperCase(),
        nome: ci.nome >= 0 ? String(row[ci.nome] || '').trim() : '',
        citta: ci.citta >= 0 ? String(row[ci.citta] || '').trim() : '',
        indirizzo: indirizzo,
        importo: importo,
        codiceDomicilio: ci.codiceDom >= 0 ? String(row[ci.codiceDom] || '').trim() : '',
        oraConsegna: ci.ora >= 0 ? String(row[ci.ora] || '').trim() : '',
        rider: rider.toUpperCase(), consegnata: consegnata,
        prestazione: prest || 'AVR', tipo: 'consegna', tipoDriver: isAvr ? 'avr' : 'interna',
        fonte: FONTE, sync: new Date().toISOString()
      });
    }
    var skipTotal = skipped.dateParseErr + skipped.noCognome + skipped.noImporto + skipped.annullato + skipped.wrongMonth;
    if (skipTotal > 0) {
      Logger.log('  ' + filiale.codice + ' skip: date=' + skipped.dateParseErr + ' cognome=' + skipped.noCognome + ' importo0=' + skipped.noImporto + ' annullati=' + skipped.annullato + ' altroMese=' + skipped.wrongMonth);
    }
    out.ok = true;
  } catch (e) {
    Logger.log('Errore parseMensile ' + filiale.codice + ': ' + e.message);
  }
  return out;
}

function parseRitorni(filiale, meseFs) {
  var out = { ok: false, docs: [] };
  try {
    var ss = SpreadsheetApp.openById(filiale.sheetId);
    var ws = ss.getSheetByName('RITORNI');
    if (!ws) { out.ok = true; return out; }
    var data = ws.getDataRange().getValues();
    if (data.length < 2) { out.ok = true; return out; }
    var header = [];
    for (var h = 0; h < data[0].length; h++) header.push(String(data[0][h]).trim().toUpperCase());
    var ci = {
      data: findCol(header, ['DATA']), cognome: findCol(header, ['COGNOME']), nome: findCol(header, ['NOME']),
      citta: findCol(header, ['CITTA']), indirizzo: findCol(header, ['INDIRIZZO']),
      rider: findCol(header, ['RIDER', 'DRIVER']), motivazione: findCol(header, ['MOTIVAZIONE'])
    };
    if (ci.cognome === -1 || ci.data === -1) { out.ok = true; return out; }
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var cognome = String(row[ci.cognome] || '').trim();
      if (!cognome) continue;
      var dv = parseDate(row[ci.data]);
      if (!dv) {
        Logger.log('  WARN ' + filiale.codice + ' RITORNI riga ' + (i + 1) + ': data non parsabile "' + row[ci.data] + '"');
        continue;
      }
      var mese = dv.getFullYear() + '-' + String(dv.getMonth() + 1).padStart(2, '0');
      if (mese !== meseFs) continue;
      var rider = ci.rider >= 0 ? String(row[ci.rider] || '').trim() : '';
      if (!isOurDriver(rider)) continue;
      var ds = Utilities.formatDate(dv, 'Europe/Rome', 'yyyy-MM-dd');
      var cc = cognome.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
      out.docs.push({
        _id: (filiale.codice + '_RIT_' + ds.replace(/-/g, '') + '_' + cc + '_690').substring(0, 100),
        filiale: filiale.codice, filialeNome: filiale.nome, area: filiale.area,
        data: dv.toISOString(), mese: mese, cognome: cognome.toUpperCase(),
        nome: ci.nome >= 0 ? String(row[ci.nome] || '').trim() : '',
        citta: ci.citta >= 0 ? String(row[ci.citta] || '').trim() : '',
        indirizzo: ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '',
        importo: 6.90, rider: rider.toUpperCase(), consegnata: 'SI', prestazione: 'AVR',
        tipo: 'ritorno', tipoDriver: 'avr',
        motivazione: ci.motivazione >= 0 ? String(row[ci.motivazione] || '').trim() : '',
        fonte: FONTE, sync: new Date().toISOString()
      });
    }
    out.ok = true;
  } catch (e) {
    Logger.log('Errore parseRitorni ' + filiale.codice + ': ' + e.message);
  }
  return out;
}

function parsePGS(filiale, meseFs) {
  var out = { ok: false, docs: [] };
  try {
    var ss = SpreadsheetApp.openById(filiale.sheetId);
    var ws = null;
    var sheets = ss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      var sn = sheets[s].getName().toUpperCase();
      if (sn.indexOf('PANE') >= 0 || sn.indexOf('GASTRO') >= 0 || sn.indexOf('SUSHI') >= 0) { ws = sheets[s]; break; }
    }
    if (!ws) { out.ok = true; return out; }
    var data = ws.getDataRange().getValues();
    if (data.length < 2) { out.ok = true; return out; }
    var headerRow = 0;
    for (var r = 0; r < Math.min(3, data.length); r++) {
      for (var c = 0; c < data[r].length; c++) {
        if (String(data[r][c]).toUpperCase().indexOf('COGNOME') >= 0) { headerRow = r; break; }
      }
    }
    var header = [];
    for (var h = 0; h < data[headerRow].length; h++) header.push(String(data[headerRow][h]).trim().toUpperCase());
    var ci = {
      data: findCol(header, ['DATA']), cognome: findCol(header, ['COGNOME']), nome: findCol(header, ['NOME']),
      citta: findCol(header, ['CITTA']), indirizzo: findCol(header, ['INDIRIZZO']),
      importo: findCol(header, ['IMPORTO']), ora: findCol(header, ['ORA CONSEGNA', 'ORA']),
      rider: findCol(header, ['RIDER', 'DRIVER']), prestazione: findCol(header, ['PRESTAZIONE'])
    };
    for (var i = headerRow + 1; i < data.length; i++) {
      var row = data[i];
      var cognome = ci.cognome >= 0 ? String(row[ci.cognome] || '').trim() : '';
      if (!cognome) continue;
      var dv = parseDate(ci.data >= 0 ? row[ci.data] : null);
      if (!dv) {
        Logger.log('  WARN ' + filiale.codice + ' PGS riga ' + (i + 1) + ': data non parsabile');
        continue;
      }
      var mese = dv.getFullYear() + '-' + String(dv.getMonth() + 1).padStart(2, '0');
      if (mese !== meseFs) continue;
      var rider = ci.rider >= 0 ? String(row[ci.rider] || '').trim() : '';
      if (!isOurDriver(rider)) continue;
      var ds = Utilities.formatDate(dv, 'Europe/Rome', 'yyyy-MM-dd');
      var imp = ci.importo >= 0 ? parseImporto(row[ci.importo]) : 0;
      var indirizzo = ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '';
      var docId = ('PGS_' + buildStableId(filiale.codice, ds.replace(/-/g, ''), cognome, imp, indirizzo)).substring(0, 100);
      out.docs.push({
        _id: docId,
        filiale: filiale.codice, filialeNome: filiale.nome, area: filiale.area,
        data: dv.toISOString(), mese: mese, cognome: cognome.toUpperCase(),
        nome: ci.nome >= 0 ? String(row[ci.nome] || '').trim() : '',
        citta: ci.citta >= 0 ? String(row[ci.citta] || '').trim() : '',
        indirizzo: indirizzo,
        importo: imp, oraConsegna: ci.ora >= 0 ? String(row[ci.ora] || '').trim() : '',
        rider: rider.toUpperCase(), consegnata: 'SI', prestazione: 'AVR',
        tipo: 'pane_gastro_sushi', tipoDriver: 'avr',
        fonte: FONTE, sync: new Date().toISOString()
      });
    }
    out.ok = true;
  } catch (e) {
    Logger.log('Errore parsePGS ' + filiale.codice + ': ' + e.message);
  }
  return out;
}

// -- Riconciliazione per filiale -------------------------------------
// existingIds: array di ID gas_v4/gas_v5 gia' su Firestore per la filiale.
// producedIds: set degli ID prodotti da questo run (sheet = verita').
function reconcileFiliale(filiale, existingIds, producedIdSet, producedCount) {
  if (!existingIds || existingIds.length === 0) return 0;
  if (producedCount === 0) {
    Logger.log('  ' + filiale.codice + ' reconcile SKIP: 0 righe prodotte (prudenza)');
    return 0;
  }
  var toDelete = [];
  for (var i = 0; i < existingIds.length; i++) {
    if (!producedIdSet[existingIds[i]]) toDelete.push(existingIds[i]);
  }
  if (toDelete.length === 0) return 0;
  // Paracadute anti-svuotamento
  if (toDelete.length > 25 && toDelete.length > existingIds.length * 0.3) {
    Logger.log('  ALERT ' + filiale.codice + ': reconcile chiederebbe ' + toDelete.length + '/' + existingIds.length + ' cancellazioni - SKIP (verificare sheet)');
    return 0;
  }
  var deleted = batchDeleteIds(toDelete);
  Logger.log('  ' + filiale.codice + ' reconcile: -' + deleted + ' doc obsoleti');
  return deleted;
}

// -- Motore con checkpoint anti-timeout ------------------------------
function runSync_(isContinuation) {
  var startTs = Date.now();
  var props = PropertiesService.getScriptProperties();

  // pulizia trigger di continuazione (se questo run e' una continuazione)
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    if (triggers[t].getHandlerFunction() === 'syncMensiliContinua') ScriptApp.deleteTrigger(triggers[t]);
  }

  var targets = getTargets();
  var ckpt = { t: 0, f: 0 };
  if (isContinuation) {
    try {
      var saved = props.getProperty(CKPT_KEY);
      if (saved) ckpt = JSON.parse(saved);
    } catch (e) { ckpt = { t: 0, f: 0 }; }
  } else {
    props.deleteProperty(CKPT_KEY);
  }
  if (ckpt.t >= targets.length) ckpt = { t: 0, f: 0 };

  Logger.log('=== SYNC MENSILI v5.0 ' + (isContinuation ? '(continua da t=' + ckpt.t + ' f=' + ckpt.f + ')' : '') + ' ===');

  for (var ti = ckpt.t; ti < targets.length; ti++) {
    var target = targets[ti];
    Logger.log('--- Target: ' + target.label + ' (' + target.meseFs + ') ---');

    // ID esistenti per il mese (una query per target, non per filiale)
    var existingByFiliale = fetchExistingIds(target.meseFs);
    if (existingByFiliale === null) {
      Logger.log('  WARN: lista esistenti non disponibile - riconciliazione disattivata per questo run');
      existingByFiliale = {};
      var reconcileEnabled = false;
    } else {
      var reconcileEnabled = true;
    }

    var startF = (ti === ckpt.t) ? ckpt.f : 0;
    for (var f = startF; f < FILIALI.length; f++) {
      // Checkpoint PRIMA della filiale: se il budget e' finito, riparti da qui
      if (Date.now() - startTs > MAX_RUN_MS) {
        props.setProperty(CKPT_KEY, JSON.stringify({ t: ti, f: f }));
        ScriptApp.newTrigger('syncMensiliContinua').timeBased().after(60 * 1000).create();
        Logger.log('=== BUDGET TEMPO ESAURITO: checkpoint t=' + ti + ' f=' + f + ' (' + FILIALI[f].codice + '), continuo tra ~1 min ===');
        return;
      }

      var fil = FILIALI[f];
      try {
        var c = parseMensile(fil, target.label, target.meseFs);
        var r = parseRitorni(fil, target.meseFs);
        var p = parsePGS(fil, target.meseFs);

        var all = dedupeIds(c.docs.concat(r.docs, p.docs));
        var res = { written: 0, failed: 0 };
        if (all.length > 0) res = batchWriteDocs(all);

        // Riconciliazione: solo se TUTTI i parser sono andati a buon fine
        // e nessuna scrittura e' fallita (altrimenti il quadro e' parziale)
        var producedIdSet = {};
        for (var x = 0; x < all.length; x++) producedIdSet[all[x]._id] = true;
        var removed = 0;
        if (reconcileEnabled && c.ok && r.ok && p.ok && res.failed === 0) {
          removed = reconcileFiliale(fil, existingByFiliale[fil.codice], producedIdSet, all.length);
        }

        var avr = 0, intCount = 0;
        for (var y = 0; y < c.docs.length; y++) { if (c.docs[y].tipoDriver === 'avr') avr++; else intCount++; }
        Logger.log('  ' + fil.codice + ' ' + fil.nome + ': ' + avr + ' AVR + ' + intCount + ' interne, ' +
                   r.docs.length + ' ritorni, ' + p.docs.length + ' PGS' +
                   ' (scritti ' + res.written + (res.failed ? ', FALLITI ' + res.failed : '') +
                   (removed ? ', rimossi ' + removed : '') + ')');
      } catch (e) {
        Logger.log('ERRORE ' + fil.codice + ': ' + e.message);
      }
      Utilities.sleep(200);
    }
  }

  props.deleteProperty(CKPT_KEY);
  Logger.log('=== SYNC MENSILI v5.0 COMPLETATO in ' + Math.round((Date.now() - startTs) / 1000) + 's ===');
}

function syncMensili() { runSync_(false); }
function syncMensiliContinua() { runSync_(true); }

function setupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var h = triggers[i].getHandlerFunction();
    if (h === 'syncMensili' || h === 'syncMensiliContinua') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('syncMensili').timeBased().atHour(20).everyDays(1).create();
  Logger.log('Trigger: syncMensili giornaliero ore 20:00');
}
