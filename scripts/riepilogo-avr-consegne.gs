/**
 * AVR LOGISTIC — RIEPILOGO CONSEGNE AGGREGATO (standalone GAS)
 *
 * Scansiona una cartella Drive, apre ogni Google Sheet, per ogni tab riconosce
 * le colonne con la stessa logica del sync v4.1 FIX (data/cognome/filiale/importo
 * + flag cancellato = "ANNULLAT" nel cognome), aggrega consegne e importi per
 * giorno e per filiale e scrive un nuovo Sheet "RIEPILOGO AVR Consegne" con
 * due tab principali: "Per Giorno" e "Per Filiale" (+ Log errori e Stats).
 *
 * Eccezioni su file/tab vengono loggate e accumulate senza interrompere il run.
 */

// ═══════════════════════════════════════════════════════════
// CONFIG — compilare prima di eseguire
// ═══════════════════════════════════════════════════════════
var FOLDER_ID = 'METTI_QUI_ID_CARTELLA_DRIVE';  // cartella sorgente con i Google Sheet filiali
var OUTPUT_FOLDER_ID = '';                       // opzionale: ID cartella dove salvare il riepilogo (vuoto = root Drive)
var TIMEZONE = 'Europe/Rome';

// Filtri opzionali sui tab — se non vuoti processa solo i tab che matchano
// (lasciare array vuoto per processare TUTTI i tab dei file)
var INCLUDE_TAB_PATTERNS = [];  // es. ['GEN ', 'FEB ', 'MAR ', 'APR ', 'MAG ', 'GIU ', 'LUG ', 'AGO ', 'SET ', 'OTT ', 'NOV ', 'DIC ', 'RITORNI', 'PANE', 'GASTRO', 'SUSHI']
var EXCLUDE_TAB_PATTERNS = ['RIEPILOGO', 'TOTALI', 'PIVOT', 'GRAFIC'];

// ═══════════════════════════════════════════════════════════
// NORMALIZZAZIONE — stessa funzione di avr-delivery-hub/js/moduli/danni.js
// ═══════════════════════════════════════════════════════════
function normalizzaNome(s) {
  return (s || '').toString().toUpperCase().trim()
    .replace(/[ÀÁÂÃ]/g, 'A').replace(/[ÈÉÊË]/g, 'E')
    .replace(/[ÌÍÎÏ]/g, 'I').replace(/[ÒÓÔÕ]/g, 'O')
    .replace(/[ÙÚÛÜ]/g, 'U');
}

// ═══════════════════════════════════════════════════════════
// DETECTION COLONNE — stessa di GAS sync v4.1 FIX
// ═══════════════════════════════════════════════════════════
function findCol(header, names) {
  for (var i = 0; i < header.length; i++) {
    for (var j = 0; j < names.length; j++) {
      if (header[i].indexOf(names[j]) >= 0) return i;
    }
  }
  return -1;
}

// ═══════════════════════════════════════════════════════════
// PARSE DATE ROBUSTO — identico al v4.1 FIX (gestisce errori battitura)
// ═══════════════════════════════════════════════════════════
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val;
  }
  var s = String(val).trim();

  // Doppio carattere nel mese: "08/111/2025" → "08/11/2025"
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

// ═══════════════════════════════════════════════════════════
// FILIALE DA NOME FILE — es. "301 Carnazza", "FILIALE 301 Carnazza", "301_Carnazza"
// ═══════════════════════════════════════════════════════════
function filialeFromFileName(fileName) {
  var name = String(fileName || '').trim();
  var m = name.match(/\b(\d{3})\b/);
  var codice = m ? m[1] : '???';
  var nome = name.replace(/\bFILIALE\b/i, '').replace(/\b\d{3}\b/, '').replace(/[_\-]+/g, ' ').trim();
  return { codice: codice, nome: nome || name };
}

function tabIsIncluded(tabName) {
  var n = String(tabName || '').toUpperCase();
  for (var i = 0; i < EXCLUDE_TAB_PATTERNS.length; i++) {
    if (n.indexOf(EXCLUDE_TAB_PATTERNS[i]) >= 0) return false;
  }
  if (INCLUDE_TAB_PATTERNS.length === 0) return true;
  for (var j = 0; j < INCLUDE_TAB_PATTERNS.length; j++) {
    if (n.indexOf(INCLUDE_TAB_PATTERNS[j].toUpperCase()) >= 0) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
function generaRiepilogo() {
  if (!FOLDER_ID || FOLDER_ID === 'METTI_QUI_ID_CARTELLA_DRIVE') {
    throw new Error('Compila FOLDER_ID in testa allo script.');
  }

  var folder = DriveApp.getFolderById(FOLDER_ID);
  var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);

  var perGiorno = {};   // 'YYYY-MM-DD' → { consegne, importo }
  var perFiliale = {};  // codice → { codice, nome, area, consegne, importo }
  var errori = [];
  var stats = { files: 0, tabs: 0, tabsSkipped: 0, rowsOk: 0, rowsCancellati: 0, rowsNoData: 0, rowsNoCognome: 0 };

  Logger.log('=== RIEPILOGO AVR CONSEGNE — scan cartella ' + FOLDER_ID + ' ===');

  while (files.hasNext()) {
    var file = files.next();
    stats.files++;
    var filiale = filialeFromFileName(file.getName());
    Logger.log('📂 ' + file.getName() + ' → filiale ' + filiale.codice);

    var ss;
    try {
      ss = SpreadsheetApp.openById(file.getId());
    } catch (errOpen) {
      var msgO = '[apertura] ' + file.getName() + ': ' + errOpen.message;
      Logger.log('  ❌ ' + msgO);
      errori.push(msgO);
      continue;
    }

    var tabs = ss.getSheets();
    for (var t = 0; t < tabs.length; t++) {
      var ws = tabs[t];
      var tabName = ws.getName();

      if (!tabIsIncluded(tabName)) { stats.tabsSkipped++; continue; }

      try {
        var res = processTab(ws, filiale, perGiorno, perFiliale);
        stats.tabs++;
        stats.rowsOk += res.ok;
        stats.rowsCancellati += res.cancellati;
        stats.rowsNoData += res.noData;
        stats.rowsNoCognome += res.noCognome;
        if (res.ok > 0 || res.cancellati > 0) {
          Logger.log('   ✓ ' + tabName + ': ok=' + res.ok + ' cancellati=' + res.cancellati + ' no-data=' + res.noData);
        }
      } catch (errTab) {
        var msgT = '[tab] ' + file.getName() + ' / ' + tabName + ': ' + errTab.message;
        Logger.log('   ⚠️ ' + msgT);
        errori.push(msgT);
      }
    }
  }

  var url = writeRiepilogo(perGiorno, perFiliale, errori, stats);
  Logger.log('=== DONE === file=' + stats.files + ' tab=' + stats.tabs + ' righe=' + stats.rowsOk + ' errori=' + errori.length);
  Logger.log('📄 Output: ' + url);
}

// ═══════════════════════════════════════════════════════════
// PROCESS TAB — detect colonne, aggrega
// ═══════════════════════════════════════════════════════════
function processTab(ws, filiale, perGiorno, perFiliale) {
  var out = { ok: 0, cancellati: 0, noData: 0, noCognome: 0 };
  var data = ws.getDataRange().getValues();
  if (data.length < 2) return out;

  // Cerca header nelle prime 5 righe (come parsePGS del v4.1)
  var headerRow = -1;
  for (var r = 0; r < Math.min(5, data.length); r++) {
    for (var c = 0; c < data[r].length; c++) {
      if (String(data[r][c] || '').toUpperCase().indexOf('COGNOME') >= 0) { headerRow = r; break; }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return out;

  var header = [];
  for (var h = 0; h < data[headerRow].length; h++) {
    header.push(String(data[headerRow][h] || '').trim().toUpperCase());
  }

  var ci = {
    data: findCol(header, ['DATA']),
    cognome: findCol(header, ['COGNOME']),
    filiale: findCol(header, ['FIL']),          // opzionale: colonna FILIALE/FIL nel foglio
    importo: findCol(header, ['IMPORTO']),
    consegnata: findCol(header, ['CONSEGNATA'])  // letta solo come info, non filtra
  };
  if (ci.cognome === -1 || ci.data === -1) return out;

  for (var i = headerRow + 1; i < data.length; i++) {
    var row = data[i];
    var cognomeRaw = String(row[ci.cognome] || '').trim();
    if (!cognomeRaw) { out.noCognome++; continue; }

    // Flag cancellato — stessa logica del v4.1
    var cognomeNorm = normalizzaNome(cognomeRaw);
    if (cognomeNorm.indexOf('ANNULLAT') >= 0) { out.cancellati++; continue; }

    var dv = parseDate(row[ci.data]);
    if (!dv) { out.noData++; continue; }

    var importo = ci.importo >= 0 ? (parseFloat(row[ci.importo]) || 0) : 0;

    // Filiale: override dal foglio se colonna FIL presente e valorizzata
    var codiceFil = filiale.codice;
    var nomeFil = filiale.nome;
    if (ci.filiale >= 0) {
      var vFil = String(row[ci.filiale] || '').trim().replace(/\.0$/, '');
      if (vFil) codiceFil = vFil;
    }

    var gKey = Utilities.formatDate(dv, TIMEZONE, 'yyyy-MM-dd');
    if (!perGiorno[gKey]) perGiorno[gKey] = { consegne: 0, importo: 0 };
    perGiorno[gKey].consegne++;
    perGiorno[gKey].importo += importo;

    if (!perFiliale[codiceFil]) {
      perFiliale[codiceFil] = { codice: codiceFil, nome: nomeFil, consegne: 0, importo: 0 };
    }
    perFiliale[codiceFil].consegne++;
    perFiliale[codiceFil].importo += importo;

    out.ok++;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// OUTPUT — crea Sheet con i 2 tab richiesti + diagnostica
// ═══════════════════════════════════════════════════════════
function writeRiepilogo(perGiorno, perFiliale, errori, stats) {
  var outName = 'RIEPILOGO AVR Consegne — ' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm');
  var ss = SpreadsheetApp.create(outName);

  if (OUTPUT_FOLDER_ID) {
    try {
      var f = DriveApp.getFileById(ss.getId());
      DriveApp.getFolderById(OUTPUT_FOLDER_ID).addFile(f);
      DriveApp.getRootFolder().removeFile(f);
    } catch (eMove) {
      Logger.log('⚠️ move output in OUTPUT_FOLDER_ID fallito: ' + eMove.message);
    }
  }

  // Tab "Per Giorno"
  var shGiorno = ss.getSheets()[0];
  shGiorno.setName('Per Giorno');
  shGiorno.getRange(1, 1, 1, 3)
    .setValues([['Data', 'Consegne', 'Importo totale']])
    .setFontWeight('bold').setBackground('#e8f5e9');
  var giorniKeys = Object.keys(perGiorno).sort();
  var giorniRows = [];
  var totGiornoC = 0, totGiornoI = 0;
  for (var gi = 0; gi < giorniKeys.length; gi++) {
    var gk = giorniKeys[gi];
    giorniRows.push([gk, perGiorno[gk].consegne, Math.round(perGiorno[gk].importo * 100) / 100]);
    totGiornoC += perGiorno[gk].consegne;
    totGiornoI += perGiorno[gk].importo;
  }
  if (giorniRows.length > 0) {
    shGiorno.getRange(2, 1, giorniRows.length, 3).setValues(giorniRows);
    shGiorno.getRange(giorniRows.length + 2, 1, 1, 3)
      .setValues([['TOTALE', totGiornoC, Math.round(totGiornoI * 100) / 100]])
      .setFontWeight('bold').setBackground('#fff3e0');
  }
  shGiorno.autoResizeColumns(1, 3);

  // Tab "Per Filiale"
  var shFil = ss.insertSheet('Per Filiale');
  shFil.getRange(1, 1, 1, 4)
    .setValues([['Codice filiale', 'Nome', 'Consegne', 'Importo totale']])
    .setFontWeight('bold').setBackground('#e8f5e9');
  var filKeys = Object.keys(perFiliale).sort();
  var filRows = [];
  var totFilC = 0, totFilI = 0;
  for (var fi = 0; fi < filKeys.length; fi++) {
    var r = perFiliale[filKeys[fi]];
    filRows.push([r.codice, r.nome || '', r.consegne, Math.round(r.importo * 100) / 100]);
    totFilC += r.consegne;
    totFilI += r.importo;
  }
  if (filRows.length > 0) {
    shFil.getRange(2, 1, filRows.length, 4).setValues(filRows);
    shFil.getRange(filRows.length + 2, 1, 1, 4)
      .setValues([['TOTALE', '', totFilC, Math.round(totFilI * 100) / 100]])
      .setFontWeight('bold').setBackground('#fff3e0');
  }
  shFil.autoResizeColumns(1, 4);

  // Tab "Log errori" (solo se presenti)
  if (errori.length > 0) {
    var shErr = ss.insertSheet('Log errori');
    shErr.getRange(1, 1, 1, 1).setValues([['Errore']]).setFontWeight('bold').setBackground('#ffebee');
    var errRows = errori.map(function(e) { return [e]; });
    shErr.getRange(2, 1, errRows.length, 1).setValues(errRows);
    shErr.autoResizeColumns(1, 1);
  }

  // Tab "Stats"
  var shStats = ss.insertSheet('Stats');
  shStats.getRange(1, 1, 9, 2).setValues([
    ['Eseguito il', Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm')],
    ['Cartella sorgente', FOLDER_ID],
    ['File processati', stats.files],
    ['Tab processati', stats.tabs],
    ['Tab saltati (filtro)', stats.tabsSkipped],
    ['Righe aggregate OK', stats.rowsOk],
    ['Righe cancellate (ANNULLAT)', stats.rowsCancellati],
    ['Righe senza data', stats.rowsNoData],
    ['Errori totali', errori.length]
  ]);
  shStats.getRange(1, 1, 9, 1).setFontWeight('bold');
  shStats.autoResizeColumns(1, 2);

  return ss.getUrl();
}
