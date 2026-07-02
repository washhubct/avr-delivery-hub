/**
 * AVR LOGISTIC — GAS SYNC v4.2 (patch bug schema ID mutabile)
 * Filiali MENSILI (tutte tranne 940 e 524)
 *
 * DIFF vs v4.1:
 *   • parseMensile: docId non usa più `codDom || cognome` come discriminante.
 *     Schema ID stabile SEMPRE cognome+cents+indirizzoCore. codiceDomicilio
 *     resta come campo del documento, ma NON entra nell'ID.
 *
 *   PERCHÉ: se in un run la colonna codiceDomicilio è vuota → ID = _COGNOME_cents.
 *   Se in un run successivo viene compilata → nuovo ID = _CT01_cents.
 *   Il vecchio doc non viene mai eliminato → duplicati.
 *   Con schema stabile (cognome + cents + primi 10 char indirizzo) l'ID è
 *   idempotente anche se codiceDomicilio cambia dopo la prima sync.
 *
 *   Applicato lo stesso fix in parsePGS. parseRitorni non era affetto
 *   (usava già solo cognome).
 *
 * IN USO SU: Apps Script "AVR Sync Mensili v4" (rimpiazzare il codice esistente).
 * Deploy: copia-incolla, salva, testa con syncMensili() manuale.
 */

var FIREBASE_PROJECT_ID = 'avr-logistic-dashboard';
var BATCH_URL = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents:batchWrite';

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

function getMeseLabel() {
  var now = new Date();
  var mesi = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
  return mesi[now.getMonth()] + ' ' + String(now.getFullYear()).slice(2);
}

function getMeseFs() {
  var now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

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

function batchWriteDocs(docs) {
  var token = ScriptApp.getOAuthToken();
  var written = 0;
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
          name: 'projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/consegne/' + batch[b]._id,
          fields: toFs(docData)
        }
      });
    }
    var resp = UrlFetchApp.fetch(BATCH_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ writes: writes }),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() < 400) {
      written += batch.length;
    } else {
      Logger.log('Batch error: ' + resp.getContentText().substring(0, 300));
    }
    Utilities.sleep(300);
  }
  return written;
}

// ═══════════════════════════════════════════════════════════════════
// SCHEMA ID STABILE (v4.2 fix)
// Composto SEMPRE dagli stessi campi semantici, indipendente da campi
// mutabili come `codiceDomicilio` che possono essere compilati o
// modificati dopo la prima sync. Include un pezzo di indirizzo
// normalizzato per ridurre a ~0 le collisioni "stesso cognome + stesso
// importo + stesso giorno + stessa filiale".
// ═══════════════════════════════════════════════════════════════════
function buildStableId(codiceFiliale, dataYYYYMMDD, cognome, importo, indirizzo) {
  var cog = String(cognome || '').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
  var indir = String(indirizzo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
  var cents = Math.round((importo || 0) * 100);
  var id = codiceFiliale + '_' + dataYYYYMMDD + '_' + cog + '_' + cents;
  if (indir) id += '_' + indir;
  return id.substring(0, 100);
}

function parseMensile(filiale, sheetName) {
  var docs = [];
  var skipped = { noDate: 0, noCognome: 0, noImporto: 0, annullato: 0, wrongMonth: 0, dateParseErr: 0 };
  try {
    var ss = SpreadsheetApp.openById(filiale.sheetId);
    var ws = ss.getSheetByName(sheetName);
    if (!ws) return docs;
    var data = ws.getDataRange().getValues();
    if (data.length < 2) return docs;
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
    if (ci.cognome === -1 || ci.data === -1) return docs;
    var meseFs = getMeseFs();
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var cognome = String(row[ci.cognome] || '').trim();
      if (!cognome) { skipped.noCognome++; continue; }
      if (cognome.toUpperCase().indexOf('ANNULLAT') >= 0) { skipped.annullato++; continue; }

      var dv = parseDate(row[ci.data]);
      if (!dv) {
        skipped.dateParseErr++;
        Logger.log('  ⚠️ ' + filiale.codice + ' riga ' + (i + 1) + ': data non parsabile "' + row[ci.data] + '" — cognome: ' + cognome);
        continue;
      }

      var mese = dv.getFullYear() + '-' + String(dv.getMonth() + 1).padStart(2, '0');
      if (mese !== meseFs) { skipped.wrongMonth++; continue; }

      var importo = ci.importo >= 0 ? parseFloat(row[ci.importo]) || 0 : 0;
      if (importo === 0) { skipped.noImporto++; continue; }

      var rider = ci.rider >= 0 ? String(row[ci.rider] || '').trim() : '';
      var prest = ci.prestazione >= 0 ? String(row[ci.prestazione] || '').trim().toUpperCase() : 'AVR';
      var isAvr = isOurDriver(rider);
      var consegnata = ci.consegnata >= 0 ? String(row[ci.consegnata] || '').trim().toUpperCase() : '';
      var indirizzo = ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '';

      var ds = Utilities.formatDate(dv, 'Europe/Rome', 'yyyy-MM-dd');
      var docId = buildStableId(filiale.codice, ds.replace(/-/g, ''), cognome, importo, indirizzo);

      docs.push({
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
        fonte: 'gas_v4', sync: new Date().toISOString()
      });
    }
    var skipTotal = skipped.dateParseErr + skipped.noCognome + skipped.noImporto + skipped.annullato + skipped.wrongMonth;
    if (skipTotal > 0) {
      Logger.log('  ' + filiale.codice + ' skip: date=' + skipped.dateParseErr + ' cognome=' + skipped.noCognome + ' importo0=' + skipped.noImporto + ' annullati=' + skipped.annullato + ' altroMese=' + skipped.wrongMonth);
    }
  } catch (e) { Logger.log('Errore parseMensile ' + filiale.codice + ': ' + e.message); }
  return docs;
}

function parseRitorni(filiale) {
  var docs = [];
  try {
    var ss = SpreadsheetApp.openById(filiale.sheetId);
    var ws = ss.getSheetByName('RITORNI');
    if (!ws) return docs;
    var data = ws.getDataRange().getValues();
    if (data.length < 2) return docs;
    var header = [];
    for (var h = 0; h < data[0].length; h++) header.push(String(data[0][h]).trim().toUpperCase());
    var ci = {
      data: findCol(header, ['DATA']), cognome: findCol(header, ['COGNOME']), nome: findCol(header, ['NOME']),
      citta: findCol(header, ['CITTA']), indirizzo: findCol(header, ['INDIRIZZO']),
      rider: findCol(header, ['RIDER', 'DRIVER']), motivazione: findCol(header, ['MOTIVAZIONE'])
    };
    if (ci.cognome === -1 || ci.data === -1) return docs;
    var meseFs = getMeseFs();
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var cognome = String(row[ci.cognome] || '').trim();
      if (!cognome) continue;
      var dv = parseDate(row[ci.data]);
      if (!dv) {
        Logger.log('  ⚠️ ' + filiale.codice + ' RITORNI riga ' + (i + 1) + ': data non parsabile "' + row[ci.data] + '"');
        continue;
      }
      var mese = dv.getFullYear() + '-' + String(dv.getMonth() + 1).padStart(2, '0');
      if (mese !== meseFs) continue;
      var rider = ci.rider >= 0 ? String(row[ci.rider] || '').trim() : '';
      if (!isOurDriver(rider)) continue;
      var ds = Utilities.formatDate(dv, 'Europe/Rome', 'yyyy-MM-dd');
      var cc = cognome.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
      docs.push({
        _id: (filiale.codice + '_RIT_' + ds.replace(/-/g, '') + '_' + cc + '_690').substring(0, 100),
        filiale: filiale.codice, filialeNome: filiale.nome, area: filiale.area,
        data: dv.toISOString(), mese: mese, cognome: cognome.toUpperCase(),
        nome: ci.nome >= 0 ? String(row[ci.nome] || '').trim() : '',
        citta: ci.citta >= 0 ? String(row[ci.citta] || '').trim() : '',
        indirizzo: ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '',
        importo: 6.90, rider: rider.toUpperCase(), consegnata: 'SI', prestazione: 'AVR',
        tipo: 'ritorno', tipoDriver: 'avr',
        motivazione: ci.motivazione >= 0 ? String(row[ci.motivazione] || '').trim() : '',
        fonte: 'gas_v4', sync: new Date().toISOString()
      });
    }
  } catch (e) { Logger.log('Errore parseRitorni ' + filiale.codice + ': ' + e.message); }
  return docs;
}

function parsePGS(filiale) {
  var docs = [];
  try {
    var ss = SpreadsheetApp.openById(filiale.sheetId);
    var ws = null;
    var sheets = ss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      var sn = sheets[s].getName().toUpperCase();
      if (sn.indexOf('PANE') >= 0 || sn.indexOf('GASTRO') >= 0 || sn.indexOf('SUSHI') >= 0) { ws = sheets[s]; break; }
    }
    if (!ws) return docs;
    Logger.log('PGS in ' + filiale.codice + ': ' + ws.getName());
    var data = ws.getDataRange().getValues();
    if (data.length < 2) return docs;
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
    var meseFs = getMeseFs();
    for (var i = headerRow + 1; i < data.length; i++) {
      var row = data[i];
      var cognome = ci.cognome >= 0 ? String(row[ci.cognome] || '').trim() : '';
      if (!cognome) continue;
      var dv = parseDate(ci.data >= 0 ? row[ci.data] : null);
      if (!dv) {
        Logger.log('  ⚠️ ' + filiale.codice + ' PGS riga ' + (i + 1) + ': data non parsabile');
        continue;
      }
      var mese = dv.getFullYear() + '-' + String(dv.getMonth() + 1).padStart(2, '0');
      if (mese !== meseFs) continue;
      var rider = ci.rider >= 0 ? String(row[ci.rider] || '').trim() : '';
      if (!isOurDriver(rider)) continue;
      var ds = Utilities.formatDate(dv, 'Europe/Rome', 'yyyy-MM-dd');
      var imp = ci.importo >= 0 ? parseFloat(row[ci.importo]) || 0 : 0;
      var indirizzo = ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '';
      var docId = ('PGS_' + buildStableId(filiale.codice, ds.replace(/-/g, ''), cognome, imp, indirizzo)).substring(0, 100);
      docs.push({
        _id: docId,
        filiale: filiale.codice, filialeNome: filiale.nome, area: filiale.area,
        data: dv.toISOString(), mese: mese, cognome: cognome.toUpperCase(),
        nome: ci.nome >= 0 ? String(row[ci.nome] || '').trim() : '',
        citta: ci.citta >= 0 ? String(row[ci.citta] || '').trim() : '',
        indirizzo: indirizzo,
        importo: imp, oraConsegna: ci.ora >= 0 ? String(row[ci.ora] || '').trim() : '',
        rider: rider.toUpperCase(), consegnata: 'SI', prestazione: 'AVR',
        tipo: 'pane_gastro_sushi', tipoDriver: 'avr',
        fonte: 'gas_v4', sync: new Date().toISOString()
      });
    }
  } catch (e) { Logger.log('Errore parsePGS ' + filiale.codice + ': ' + e.message); }
  return docs;
}

function syncMensili() {
  var meseLabel = getMeseLabel();
  Logger.log('=== SYNC MENSILI v4.2 — ' + meseLabel + ' ===');
  var tC = 0, tR = 0, tP = 0, tInt = 0;
  for (var f = 0; f < FILIALI.length; f++) {
    var fil = FILIALI[f];
    try {
      var c = parseMensile(fil, meseLabel);
      if (c.length > 0) {
        var avr = 0, intCount = 0;
        for (var x = 0; x < c.length; x++) { if (c[x].tipoDriver === 'avr') avr++; else intCount++; }
        var w = batchWriteDocs(c);
        tC += avr; tInt += intCount;
        Logger.log('  ' + fil.codice + ' ' + fil.nome + ': ' + avr + ' AVR, ' + intCount + ' interne (written: ' + w + ')');
      }
      var r = parseRitorni(fil);
      if (r.length > 0) { var w2 = batchWriteDocs(r); tR += w2; Logger.log('  ' + fil.codice + ' RITORNI: ' + w2); }
      var p = parsePGS(fil);
      if (p.length > 0) { var w3 = batchWriteDocs(p); tP += w3; Logger.log('  ' + fil.codice + ' PGS: ' + w3); }
      Utilities.sleep(300);
    } catch (e) { Logger.log('ERRORE ' + fil.codice + ': ' + e.message); }
  }
  Logger.log('=== TOTALE: ' + tC + ' AVR, ' + tInt + ' interne, ' + tR + ' ritorni, ' + tP + ' PGS ===');
}

function setupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) ScriptApp.deleteTrigger(triggers[i]);
  ScriptApp.newTrigger('syncMensili').timeBased().atHour(20).everyDays(1).create();
  Logger.log('Trigger: giornaliero ore 20:00');
}
