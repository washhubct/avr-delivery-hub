/**
 * AVR LOGISTIC — GAS SYNC GIORNALIERI v1 FINAL (BACKUP)
 * Filiali 940 e 524 (fogli DD_MM)
 * T-1: sync alle 21:00, dati fino a ieri (giornata completa)
 *
 * ✅ PULITO: nessuno dei bug del mensile v4.
 * Salvato come backup del progetto Apps Script "AVR Sync Giornalieri" (2026-07-02).
 */

var FIREBASE_PROJECT_ID = 'avr-logistic-dashboard';
var BATCH_URL = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents:batchWrite';

var DRIVER_LIST = [
  'VISCONTI','ARICO','GALEAZZO','ROTOLO','TUMMINIA','BUCCHERI','SCHILLACI',
  'CARDILE','IMMORMINO','DI GIORGI','DI GIROGI','DI CANDIA','AREZZIO','GALLO','STURIALE',
  'MESSINA','VINCI','LA PORTA','BRUNO','ZAPPALA','SCABOTTI','SCABOTI','DAL PIN','DALPIN','MASSIMINO',
  'SIYAMBALA GAMAGE','FELIX','PITTA','BELLUARDO','ZOCCO','CANNARELLA','LI NOCE','DI PRIMA'
];

var FILIALI_G = [
  { sheetId: '1iYh1Wo428fBbtNdsZYXb0zw_EpdvUHcF6dflfUWw25w', codice: '940', area: 'CT', nome: "D'Annunzio" },
  { sheetId: '1VPb8wzd4N2ia-VHDtN2dZlHOMwmKModXHagIde-4_OU', codice: '524', area: 'CT', nome: 'Sicilia' }
];

var FASCIA_LABELS = ['FASCIA 10/15','FASCIA 15/20','FASCIA 10/14','FASCIA 14/18','10/14','10/15','14/18','15/20'];

function getIeri() {
  var now = new Date();
  var ieri = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  var y = ieri.getFullYear();
  var m = ieri.getMonth() + 1;
  var d = ieri.getDate();
  return { year: y, month: m, day: d, monthStr: String(m).padStart(2, '0'), mese: y + '-' + String(m).padStart(2, '0') };
}

function isDriver(name) {
  if (!name) return false;
  var r = name.toString().trim().toUpperCase().replace(/['\u2019`]/g, '').replace(/\s+/g, ' ');
  for (var i = 0; i < DRIVER_LIST.length; i++) {
    if (r.indexOf(DRIVER_LIST[i]) >= 0 || DRIVER_LIST[i].indexOf(r) >= 0) return true;
  }
  return false;
}

function findC(header, names) {
  for (var i = 0; i < header.length; i++) for (var j = 0; j < names.length; j++)
    if (header[i].indexOf(names[j]) >= 0) return i;
  return -1;
}

function toFs(obj) {
  var f = {};
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]; var v = obj[k];
    if (v === null || v === undefined) f[k] = { nullValue: null };
    else if (typeof v === 'string') f[k] = { stringValue: v };
    else if (typeof v === 'number') f[k] = v === Math.floor(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === 'boolean') f[k] = { booleanValue: v };
    else f[k] = { stringValue: String(v) };
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
      for (var k = 0; k < keys.length; k++) if (keys[k] !== '_id') docData[keys[k]] = batch[b][keys[k]];
      writes.push({ update: { name: 'projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/consegne/' + batch[b]._id, fields: toFs(docData) } });
    }
    var resp = UrlFetchApp.fetch(BATCH_URL, { method: 'post', contentType: 'application/json', headers: { 'Authorization': 'Bearer ' + token }, payload: JSON.stringify({ writes: writes }), muteHttpExceptions: true });
    if (resp.getResponseCode() < 400) written += batch.length;
    else Logger.log('Batch error: ' + resp.getContentText().substring(0, 300));
    Utilities.sleep(300);
  }
  return written;
}

function parseGiornalieri(filiale, ieri) {
  var docs = [];
  try {
    var ss = SpreadsheetApp.openById(filiale.sheetId);
    var allSheets = ss.getSheets();
    var dailySheets = [];
    for (var s = 0; s < allSheets.length; s++) {
      var name = allSheets[s].getName().trim();
      var match = name.match(/^(\d{2})_(\d{2})$/);
      if (match && match[2] === ieri.monthStr && parseInt(match[1]) <= ieri.day) dailySheets.push(name);
    }
    Logger.log(filiale.codice + ': ' + dailySheets.length + ' fogli (fino al ' + ieri.day + '/' + ieri.monthStr + ')');
    for (var d = 0; d < dailySheets.length; d++) {
      var ws = ss.getSheetByName(dailySheets[d]);
      if (!ws) continue;
      var data = ws.getDataRange().getValues();
      if (data.length < 2) continue;
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var col0 = String(row[0] || '').trim().toUpperCase();
        var isFascia = false;
        for (var fl = 0; fl < FASCIA_LABELS.length; fl++) if (col0.indexOf(FASCIA_LABELS[fl]) >= 0) { isFascia = true; break; }
        if (isFascia) continue;
        var allEmpty = true;
        for (var c = 0; c < row.length; c++) if (row[c] !== null && row[c] !== '' && row[c] !== undefined) { allEmpty = false; break; }
        if (allEmpty) continue;
        var cognome = String(row[3] || '').trim();
        if (!cognome) continue;
        var cogUp = cognome.toUpperCase();
        if (cogUp === 'COGNOME' || cogUp === 'FIL.' || cogUp === 'FIL') continue;
        if (cogUp.indexOf('ANNULLAT') >= 0) continue;
        var dataVal = row[2];
        var dataObj, dataStr;
        if (dataVal instanceof Date) {
          if (dataVal.getMonth() + 1 !== ieri.month || dataVal.getFullYear() !== ieri.year) continue;
          if (dataVal.getDate() > ieri.day) continue;
          dataObj = dataVal;
          dataStr = Utilities.formatDate(dataVal, 'Europe/Rome', 'yyyy-MM-dd');
        } else if (typeof dataVal === 'string' && dataVal.indexOf('/') >= 0) {
          var parts = dataVal.split('/');
          if (parts.length >= 2) {
            var dd = parseInt(parts[0]);
            var mm = parseInt(parts[1]);
            if (mm !== ieri.month || dd > ieri.day) continue;
            dataObj = new Date(ieri.year, mm - 1, dd, 12, 0, 0);
            dataStr = ieri.year + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
          } else continue;
        } else continue;
        var rider = String(row[14] || '').trim();
        var isAvr = isDriver(rider);
        var importo = parseFloat(row[11]) || 0;
        var codDom = String(row[12] || '').trim().replace(/[^A-Z0-9]/gi, '').substring(0, 15);
        var cc = cogUp.replace(/[^A-Z0-9]/g, '').substring(0, 10);
        var idRef = codDom || cc;
        var docId = (filiale.codice + '_' + dataStr.replace(/-/g, '') + '_' + idRef + '_' + Math.round(importo * 100)).substring(0, 100);
        docs.push({
          _id: docId,
          filiale: filiale.codice, filialeNome: filiale.nome, area: filiale.area,
          data: dataObj.toISOString(), mese: ieri.mese, cognome: cogUp,
          nome: String(row[4] || '').trim(), citta: String(row[6] || '').trim(),
          indirizzo: String(row[7] || '').trim(), importo: importo,
          codiceDomicilio: String(row[12] || '').trim(), oraConsegna: String(row[13] || '').trim(),
          rider: rider.toUpperCase(), targa: String(row[15] || '').trim(),
          consegnata: String(row[16] || '').trim().toUpperCase(),
          prestazione: String(row[17] || '').trim().toUpperCase() || 'AVR',
          tipo: 'consegna', tipoDriver: isAvr ? 'avr' : 'interna',
          fonte: 'gas_giorn_v1', sync: new Date().toISOString()
        });
      }
    }
  } catch (e) { Logger.log('Errore parseGiornalieri ' + filiale.codice + ': ' + e.message); }
  return docs;
}

function parseRitorniG(filiale, ieri) {
  var docs = [];
  try {
    var ss = SpreadsheetApp.openById(filiale.sheetId);
    var ws = ss.getSheetByName('RITORNI');
    if (!ws) return docs;
    var data = ws.getDataRange().getValues();
    if (data.length < 2) return docs;
    var header = [];
    for (var h = 0; h < data[0].length; h++) header.push(String(data[0][h]).trim().toUpperCase());
    var ci = { data: findC(header, ['DATA']), cognome: findC(header, ['COGNOME']), nome: findC(header, ['NOME']), citta: findC(header, ['CITTA']), indirizzo: findC(header, ['INDIRIZZO']), rider: findC(header, ['RIDER', 'DRIVER']), motivazione: findC(header, ['MOTIVAZIONE']) };
    if (ci.cognome === -1 || ci.data === -1) return docs;
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var cognome = String(row[ci.cognome] || '').trim();
      if (!cognome) continue;
      var dv = row[ci.data];
      if (!dv || !(dv instanceof Date)) continue;
      var rowMese = dv.getFullYear() + '-' + String(dv.getMonth() + 1).padStart(2, '0');
      if (rowMese !== ieri.mese || dv.getDate() > ieri.day) continue;
      var rider = ci.rider >= 0 ? String(row[ci.rider] || '').trim() : '';
      if (!isDriver(rider)) continue;
      var ds = Utilities.formatDate(dv, 'Europe/Rome', 'yyyy-MM-dd');
      var cc = cognome.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
      docs.push({
        _id: (filiale.codice + '_RIT_' + ds.replace(/-/g, '') + '_' + cc + '_690').substring(0, 100),
        filiale: filiale.codice, filialeNome: filiale.nome, area: filiale.area,
        data: dv.toISOString(), mese: ieri.mese, cognome: cognome.toUpperCase(),
        nome: ci.nome >= 0 ? String(row[ci.nome] || '').trim() : '',
        citta: ci.citta >= 0 ? String(row[ci.citta] || '').trim() : '',
        indirizzo: ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '',
        importo: 6.90, rider: rider.toUpperCase(), consegnata: 'SI', prestazione: 'AVR',
        tipo: 'ritorno', tipoDriver: 'avr',
        motivazione: ci.motivazione >= 0 ? String(row[ci.motivazione] || '').trim() : '',
        fonte: 'gas_giorn_v1', sync: new Date().toISOString()
      });
    }
  } catch (e) { Logger.log('Errore parseRitorniG ' + filiale.codice + ': ' + e.message); }
  return docs;
}

function parsePGSG(filiale, ieri) {
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
    for (var r = 0; r < Math.min(3, data.length); r++) for (var c = 0; c < data[r].length; c++)
      if (String(data[r][c]).toUpperCase().indexOf('COGNOME') >= 0) { headerRow = r; break; }
    var header = [];
    for (var h = 0; h < data[headerRow].length; h++) header.push(String(data[headerRow][h]).trim().toUpperCase());
    var ci = { data: findC(header, ['DATA']), cognome: findC(header, ['COGNOME']), nome: findC(header, ['NOME']), citta: findC(header, ['CITTA']), indirizzo: findC(header, ['INDIRIZZO']), importo: findC(header, ['IMPORTO']), ora: findC(header, ['ORA CONSEGNA', 'ORA']), rider: findC(header, ['RIDER', 'DRIVER']), prestazione: findC(header, ['PRESTAZIONE']) };
    for (var i = headerRow + 1; i < data.length; i++) {
      var row = data[i];
      var cognome = ci.cognome >= 0 ? String(row[ci.cognome] || '').trim() : '';
      if (!cognome) continue;
      var dv = ci.data >= 0 ? row[ci.data] : null;
      if (!dv || !(dv instanceof Date)) continue;
      var rowMese = dv.getFullYear() + '-' + String(dv.getMonth() + 1).padStart(2, '0');
      if (rowMese !== ieri.mese || dv.getDate() > ieri.day) continue;
      var rider = ci.rider >= 0 ? String(row[ci.rider] || '').trim() : '';
      if (!isDriver(rider)) continue;
      var ds = Utilities.formatDate(dv, 'Europe/Rome', 'yyyy-MM-dd');
      var imp = ci.importo >= 0 ? parseFloat(row[ci.importo]) || 0 : 0;
      var cc = cognome.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
      docs.push({
        _id: (filiale.codice + '_PGS_' + ds.replace(/-/g, '') + '_' + cc + '_' + Math.round(imp * 100)).substring(0, 100),
        filiale: filiale.codice, filialeNome: filiale.nome, area: filiale.area,
        data: dv.toISOString(), mese: ieri.mese, cognome: cognome.toUpperCase(),
        nome: ci.nome >= 0 ? String(row[ci.nome] || '').trim() : '',
        citta: ci.citta >= 0 ? String(row[ci.citta] || '').trim() : '',
        indirizzo: ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '',
        importo: imp, oraConsegna: ci.ora >= 0 ? String(row[ci.ora] || '').trim() : '',
        rider: rider.toUpperCase(), consegnata: 'SI', prestazione: 'AVR',
        tipo: 'pane_gastro_sushi', tipoDriver: 'avr',
        fonte: 'gas_giorn_v1', sync: new Date().toISOString()
      });
    }
  } catch (e) { Logger.log('Errore parsePGSG ' + filiale.codice + ': ' + e.message); }
  return docs;
}

function syncGiornalieri() {
  var ieri = getIeri();
  Logger.log('=== SYNC GIORNALIERI v1 — T-1: dati fino al ' + ieri.day + '/' + ieri.monthStr + '/' + ieri.year + ' ===');
  var tC = 0, tR = 0, tP = 0, tInt = 0;
  for (var f = 0; f < FILIALI_G.length; f++) {
    var fil = FILIALI_G[f];
    try {
      var c = parseGiornalieri(fil, ieri);
      if (c.length > 0) {
        var avr = 0, intCount = 0;
        for (var x = 0; x < c.length; x++) { if (c[x].tipoDriver === 'avr') avr++; else intCount++; }
        batchWriteDocs(c);
        tC += avr; tInt += intCount;
        Logger.log('  ' + fil.codice + ' ' + fil.nome + ': ' + avr + ' AVR, ' + intCount + ' interne');
      }
      var r = parseRitorniG(fil, ieri);
      if (r.length > 0) { var w2 = batchWriteDocs(r); tR += w2; Logger.log('  ' + fil.codice + ' RITORNI: ' + w2); }
      var p = parsePGSG(fil, ieri);
      if (p.length > 0) { var w3 = batchWriteDocs(p); tP += w3; Logger.log('  ' + fil.codice + ' PGS: ' + w3); }
      Utilities.sleep(300);
    } catch (e) { Logger.log('ERRORE ' + fil.codice + ': ' + e.message); }
  }
  Logger.log('=== TOTALE: ' + tC + ' AVR, ' + tInt + ' interne, ' + tR + ' ritorni, ' + tP + ' PGS ===');
}

function setupTriggersG() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncGiornalieri') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('syncGiornalieri').timeBased().atHour(21).everyDays(1).create();
  Logger.log('Trigger impostato: ogni giorno ore 21:00 (T-1)');
}
