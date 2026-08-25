// LAST MILE — Fatturazione elettronica: core puro (parser xlsx + calcolo + riconciliazione)
//
// Modulo condiviso browser/Node (UMD leggero). Nessuna dipendenza: riceve
// il workbook già letto da SheetJS (`XLSX.read`) e lavora sui fogli.
//
// ARITMETICA: tutti gli importi sono CENTESIMI in BigInt. Mai float.
// Arrotondamento half-up. Il totale documento quadra sempre:
//   somma righe = imponibile; imponibile × 22% = imposta; imponibile + imposta = totale.
//
// SOURCE OF TRUTH: js/fic/fic-core.js. La copia functions/fic-core.js viene
// allineata da `npm --prefix functions run copy-core` (predeploy) e un test
// verifica che siano identiche.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FicCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ══════════════════════════════════════════════════════════
    // CONFIGURAZIONE DI DEFAULT (sovrascrivibile da config/fic in Firestore)
    // ══════════════════════════════════════════════════════════
    var DEFAULT_CONFIG = {
        tariffe: { feriale: '9.70', festivo: '12.61' },   // stringhe decimali, IVA esclusa
        ivaPercento: 22,
        areeOrdine: ['CT', 'EN', 'ME', 'SR', 'AFFILIATI GRUPPO ARENA', 'PALERMO RETAIL'],
        // Nomi alternativi trovati nei file → area canonica
        areeAlias: {
            'AFFILIATI': 'AFFILIATI GRUPPO ARENA',
            'GRUPPO ARENA': 'AFFILIATI GRUPPO ARENA',
            'PA': 'PALERMO RETAIL',
            'PALERMO': 'PALERMO RETAIL'
        },
        scadenzaGiorni: 5,
        metodoPagamento: 'Bonifico bancario',
        eiPaymentMethod: 'MP05',
        eiVatKind: 'I',
        misura: 'nr'
    };

    var MESI_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
        'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    var MESI_ABBR = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

    function mergeConfig(cfg) {
        var out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        if (!cfg) return out;
        Object.keys(cfg).forEach(function (k) {
            if (cfg[k] === undefined || cfg[k] === null) return;
            if (k === 'tariffe' || k === 'areeAlias') {
                Object.keys(cfg[k]).forEach(function (j) { out[k][j] = cfg[k][j]; });
            } else out[k] = cfg[k];
        });
        return out;
    }

    // ══════════════════════════════════════════════════════════
    // DECIMALE IN CENTESIMI (BigInt)
    // ══════════════════════════════════════════════════════════
    var ZERO = BigInt(0);

    // Converte numero/stringa in centesimi BigInt, half-up sulla 3ª cifra.
    // I numeri passano da toPrecision(15) per eliminare il rumore float
    // delle celle formula Excel (74040.09999999999 → 74040.1).
    function toCents(v) {
        if (v === null || v === undefined || v === '') return ZERO;
        if (typeof v === 'bigint') return v;
        var s;
        if (typeof v === 'number') {
            if (!isFinite(v)) throw new Error('Importo non finito: ' + v);
            s = v.toPrecision(15);
            if (s.indexOf('e') !== -1) s = v.toFixed(6);
        } else {
            s = String(v).trim().replace(/\s|€/g, '');
            // "1.234,56" (it) → "1234.56"; "1234,56" → "1234.56"
            if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
        }
        if (!/^[-+]?\d*(\.\d*)?$/.test(s) || s === '' || s === '-' || s === '.') {
            throw new Error('Importo non valido: ' + JSON.stringify(v));
        }
        var neg = s[0] === '-';
        if (neg || s[0] === '+') s = s.slice(1);
        var parts = s.split('.');
        var intPart = parts[0] || '0';
        var frac = (parts[1] || '') + '000';
        var cents = BigInt(intPart) * BigInt(100) + BigInt(frac.slice(0, 2));
        if (frac.charCodeAt(2) >= 53) cents += BigInt(1); // 3ª cifra ≥ 5 → half-up
        return neg ? -cents : cents;
    }

    // Percentuale di un importo in centesimi, half-up. perc intero (22).
    function percentOf(cents, perc) {
        var num = cents * BigInt(perc);
        var q = num / BigInt(100);
        var r = num % BigInt(100);
        if (r < ZERO) r = -r;
        if (r * BigInt(2) >= BigInt(100)) q += (num < ZERO ? BigInt(-1) : BigInt(1));
        return q;
    }

    function centsToString(c) {
        var neg = c < ZERO;
        if (neg) c = -c;
        var s = c.toString();
        while (s.length < 3) s = '0' + s;
        return (neg ? '-' : '') + s.slice(0, -2) + '.' + s.slice(-2);
    }

    function centsToNumber(c) { return Number(centsToString(c)); }

    function centsToEuroIt(c) {
        var s = centsToString(c);
        var neg = s[0] === '-';
        if (neg) s = s.slice(1);
        var p = s.split('.');
        var intPart = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (neg ? '-' : '') + '€ ' + intPart + ',' + p[1];
    }

    // ══════════════════════════════════════════════════════════
    // UTILITY FOGLI
    // ══════════════════════════════════════════════════════════
    function norm(v) {
        if (v === null || v === undefined) return '';
        return String(v).replace(/\s+/g, ' ').trim().toUpperCase();
    }
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function isCodiceFiliale(v) {
        if (isNum(v)) return Number.isInteger(v) && v > 0;
        return /^\d{2,5}$/.test(String(v || '').trim());
    }
    function toInt(v) {
        if (v === null || v === undefined || v === '') return 0;
        if (isNum(v)) return Math.round(v);
        var n = parseInt(String(v).trim(), 10);
        return isNaN(n) ? 0 : n;
    }
    function codice(v) { return String(v).trim(); }

    // Ricerca cella per etichetta (match esatto normalizzato o predicate)
    function findCell(rows, pred, fromRow) {
        for (var r = fromRow || 0; r < rows.length; r++) {
            var row = rows[r] || [];
            for (var c = 0; c < row.length; c++) {
                if (pred(row[c], r, c, row)) return { r: r, c: c };
            }
        }
        return null;
    }

    // Cella con etichetta `needle` nelle 3 righe da `anchor`, più vicina (a destra) alla colonna di anchor
    function findNear(rows, anchor, needle) {
        var best = null;
        for (var r = anchor.r; r <= anchor.r + 2 && r < rows.length; r++) {
            var row = rows[r] || [];
            for (var c = anchor.c; c < row.length; c++) {
                if (norm(row[c]).indexOf(needle) === -1) continue;
                if (!best || (c - anchor.c) < (best.c - anchor.c)) best = { r: r, c: c };
            }
        }
        return best;
    }

    // Deduce mese/anno dal nome foglio ("luglio 26", "lug 26", "2026-07")
    function parseMeseAnno(nome) {
        var s = String(nome || '').toLowerCase().trim();
        var m = s.match(/^(\d{4})-(\d{2})$/);
        if (m) return { mese: parseInt(m[2], 10), anno: parseInt(m[1], 10) };
        var yy = s.match(/(\d{2,4})\s*$/);
        var anno = yy ? parseInt(yy[1], 10) : null;
        if (anno !== null && anno < 100) anno += 2000;
        for (var i = 0; i < 12; i++) {
            if (s.indexOf(MESI_IT[i]) === 0 || s.indexOf(MESI_ABBR[i]) === 0) {
                return { mese: i + 1, anno: anno };
            }
        }
        return null;
    }

    function sheetRows(XLSX, ws) {
        return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    }

    // ══════════════════════════════════════════════════════════
    // PARSER — FOGLIO RIEPILOGO
    // ══════════════════════════════════════════════════════════
    function canonArea(label, cfg) {
        var n = norm(label);
        if (cfg.areeOrdine.indexOf(n) !== -1) return n;
        if (cfg.areeAlias[n]) return cfg.areeAlias[n];
        return null;
    }

    function parseRiepilogo(rows, cfg, nomeFoglio) {
        // Header: cella 'FILIALE' + sotto/accanto 'giorni feriali' / 'festivi'
        var hFil = findCell(rows, function (v) { return norm(v) === 'FILIALE'; });
        if (!hFil) throw new Error('Foglio riepilogo: etichetta FILIALE non trovata');
        // Header più vicino alla colonna FILIALE (a destra ci sono altri blocchi con le stesse etichette)
        var hFer = findNear(rows, hFil, 'FERIAL'), hFes = findNear(rows, hFil, 'FESTIV'), hSpe = findNear(rows, hFil, 'SPECIAL');
        if (!hFer || !hFes) throw new Error('Foglio riepilogo: colonne feriali/festivi non trovate');
        var cFil = hFil.c, cFer = hFer.c, cFes = hFes.c, cSpe = hSpe ? hSpe.c : null;

        var filiali = [];
        var totaliArea = {};
        var totaleFile = null;      // 'TOTALE COMPLESSIVO' (feriali, festivi) precalcolati
        var totaleFileUnico = null; // 'TOTALE' singolo
        var area = null;
        var r = Math.max(hFer.r, hFes.r) + 1;
        var endRow = rows.length;
        for (; r < rows.length; r++) {
            var row = rows[r] || [];
            var v = row[cFil];
            var n = norm(v);
            if (n === '') continue;
            if (n === 'TOTALE COMPLESSIVO') {
                totaleFile = { feriali: toInt(row[cFer]), festivi: toInt(row[cFes]) };
                continue;
            }
            if (n === 'TOTALE') { totaleFileUnico = toInt(row[cFer]); endRow = r; break; }
            if (n.indexOf('CONSEGNE SPECIALI') === 0) { endRow = r; break; }
            if (n === 'TOTALI') {
                if (area) totaliArea[area] = { feriali: toInt(row[cFer]), festivi: toInt(row[cFes]) };
                continue;
            }
            if (isCodiceFiliale(v)) {
                if (!area) throw new Error('Foglio riepilogo: filiale ' + v + ' senza intestazione area (riga ' + (r + 1) + ')');
                filiali.push({
                    area: area,
                    codice: codice(v),
                    feriali: toInt(row[cFer]),
                    festivi: toInt(row[cFes]),
                    nSpeciali: cSpe !== null ? toInt(row[cSpe]) : 0,
                    riga: r + 1
                });
                continue;
            }
            var a = canonArea(v, cfg);
            if (a) { area = a; continue; }
            // etichetta sconosciuta: ignora (tollerante)
        }

        // Sezione "Consegne speciali": blocchi con FILIALE / IMPORTO RICONOSCIUTO
        var speciali = {};   // codice → cents
        var specialiBlocchi = [];
        var start = endRow;
        while (true) {
            var h = findCell(rows, function (v, rr, cc, rw) {
                return rr > start && norm(v).indexOf('IMPORTO RICONOSCIUTO') !== -1;
            }, start);
            if (!h) break;
            // etichetta blocco = prima cella non vuota nella riga sopra (Gruppo Arena / Palermo Retail)
            var lbl = '';
            for (var k = h.r - 1; k >= 0 && k >= h.r - 3; k--) {
                var rowK = rows[k] || [];
                var cand = rowK[h.c - 1] !== null && rowK[h.c - 1] !== undefined ? rowK[h.c - 1] : rowK[h.c];
                if (cand && !isNum(cand) && norm(cand) !== 'FILIALE') { lbl = String(cand).trim(); break; }
            }
            var blocco = { etichetta: lbl, righe: [], totaleFile: null };
            var cCod = h.c - 1, cImp = h.c;
            for (var rr = h.r + 1; rr < rows.length; rr++) {
                var rw = rows[rr] || [];
                var cod = rw[cCod];
                if (norm(cod) === 'TOTALE') { blocco.totaleFile = toCents(rw[cImp]); start = rr; break; }
                if (isCodiceFiliale(cod)) {
                    var cents = toCents(rw[cImp]);
                    blocco.righe.push({ codice: codice(cod), importo: cents });
                    speciali[codice(cod)] = (speciali[codice(cod)] || ZERO) + cents;
                } else if (norm(cod) !== '' && !isCodiceFiliale(cod)) { start = rr; break; }
                start = rr;
            }
            specialiBlocchi.push(blocco);
        }

        // Blocchi riepilogo precalcolati a destra (FRATELLI ARENA / PALERMO RETAIL / TOTALONE)
        var blocchiFile = {};
        ['FRATELLI ARENA', 'PALERMO RETAIL', 'TOTALONE'].forEach(function (label) {
            var cell = findCell(rows, function (v, rr, cc, rw) {
                if (norm(v) !== label) return false;
                var nums = 0;
                for (var i = cc + 1; i < rw.length; i++) if (isNum(rw[i])) nums++;
                return nums >= 3;
            });
            if (!cell) return;
            var rw = rows[cell.r], rw2 = rows[cell.r + 1] || [];
            var idx = [];
            for (var i = cell.c + 1; i < rw.length; i++) if (isNum(rw[i])) idx.push(i);
            blocchiFile[label] = {
                feriali: toInt(rw[idx[0]]), festivi: toInt(rw[idx[1]]), speciali: toInt(rw[idx[2]]), totale: toInt(rw[idx[3]]),
                euroFeriali: toCents(rw2[idx[0]]), euroFestivi: toCents(rw2[idx[1]]),
                euroSpeciali: toCents(rw2[idx[2]]), euroTotale: toCents(rw2[idx[3]])
            };
        });

        // Tariffe indicate nel file (cella TARIFFE + valori sotto) — solo informativo
        var tariffeFile = [];
        var hT = findCell(rows, function (v) { return norm(v) === 'TARIFFE'; });
        if (hT) {
            for (var t = hT.r + 1; t < rows.length && t <= hT.r + 4; t++) {
                var tv = (rows[t] || [])[hT.c];
                if (isNum(tv)) tariffeFile.push(centsToString(toCents(tv)));
            }
        }

        var ma = parseMeseAnno(nomeFoglio);
        return {
            nomeFoglio: nomeFoglio,
            mese: ma ? ma.mese : null,
            anno: ma ? ma.anno : null,
            filiali: filiali,
            totaliArea: totaliArea,
            totaleFile: totaleFile,
            totaleFileUnico: totaleFileUnico,
            speciali: speciali,
            specialiBlocchi: specialiBlocchi,
            blocchiFile: blocchiFile,
            tariffeFile: tariffeFile
        };
    }

    // ══════════════════════════════════════════════════════════
    // PARSER — FOGLIO SPECIALI (dettaglio riga per riga)
    // ══════════════════════════════════════════════════════════
    function parseSpeciali(rows) {
        var h = findCell(rows, function (v) { return norm(v) === 'PDV' || norm(v) === 'FILIALE'; });
        if (!h) return null;
        // La colonna codice si rileva per contenuto: l'header può essere disallineato
        var hits = {};
        for (var rr = h.r + 1; rr < rows.length; rr++) {
            var rw = rows[rr] || [];
            for (var cc = 0; cc < Math.min(rw.length, 4); cc++) if (isCodiceFiliale(rw[cc])) hits[cc] = (hits[cc] || 0) + 1;
        }
        var cPdv = h.c;
        Object.keys(hits).forEach(function (k) { if (hits[k] > (hits[cPdv] || 0)) cPdv = parseInt(k, 10); });
        var out = { righe: [], perFiliale: {} };
        for (var r = h.r + 1; r < rows.length; r++) {
            var row = rows[r] || [];
            var pdv = row[cPdv];
            if (!isCodiceFiliale(pdv)) continue;
            // importo riconosciuto = ultima cella numerica della riga
            var imp = null;
            for (var c = row.length - 1; c > cPdv; c--) {
                if (isNum(row[c])) { imp = row[c]; break; }
            }
            if (imp === null) continue;
            var cod = codice(pdv);
            var cents = toCents(imp);
            out.righe.push({ codice: cod, importo: cents, riga: r + 1 });
            if (!out.perFiliale[cod]) out.perFiliale[cod] = { n: 0, importo: ZERO };
            out.perFiliale[cod].n++;
            out.perFiliale[cod].importo += cents;
        }
        return out;
    }

    // ══════════════════════════════════════════════════════════
    // PARSER — FOGLIO1 (confronto Fratelli Arena A–G vs Last Mile I–O)
    // Opzionale: se manca, la riconciliazione Arena/LM non è disponibile.
    // ══════════════════════════════════════════════════════════
    function parseConfronto(rows) {
        // Trova la riga header con almeno due celle 'feriali' (una per lato)
        var hr = -1;
        for (var r = 0; r < rows.length && r < 15; r++) {
            var row = rows[r] || [];
            var nFer = row.filter(function (v) { return norm(v).indexOf('FERIAL') !== -1; }).length;
            if (nFer >= 2) { hr = r; break; }
        }
        if (hr === -1) return null;
        var header = rows[hr];
        // Colonne-codice rilevate per contenuto (≥2 righe con codice filiale): ogni colonna
        // codice apre un lato; le colonne header successive (fino alla prossima) gli appartengono.
        var hits = {};
        for (var rr0 = hr + 1; rr0 < rows.length; rr0++) {
            var rw0 = rows[rr0] || [];
            for (var c0 = 0; c0 < rw0.length; c0++) if (isCodiceFiliale(rw0[c0])) hits[c0] = (hits[c0] || 0) + 1;
        }
        var conHits = Object.keys(hits).map(Number).filter(function (c) { return hits[c] >= 2; }).sort(function (a, b) { return a - b; });
        // Preferisci le colonne con header "filiale/pdv/codice"; altrimenti la prima colonna
        // e quelle che seguono una colonna vuota o "differenza" (i numeri di consegne sono interi anche loro)
        var codeCols = conHits.filter(function (c) { return /FILIAL|PDV|CODIC|PUNTO|NEGOZ/.test(norm(header[c])); });
        if (codeCols.length < 2) {
            codeCols = conHits.filter(function (c, i) {
                if (i === 0) return true;
                var prev = norm(header[c - 1]);
                return prev === '' || prev.indexOf('DIFF') !== -1 || prev.indexOf('SCOST') !== -1;
            });
        }
        var lati = [];
        var cur = null;
        for (var c = 0; c < header.length; c++) {
            var hn = norm(header[c]);
            if (codeCols.indexOf(c) !== -1) {
                cur = { firstCol: c, lastCol: c, feriali: [], festivi: [] };
                lati.push(cur);
                continue;
            }
            if (!cur || hn === '') continue;
            cur.lastCol = c;
            if (hn.indexOf('FERIAL') !== -1) cur.feriali.push(c);
            else if (hn.indexOf('FESTIV') !== -1) cur.festivi.push(c);
        }
        // Un lato è valido solo se ha colonne feriali/festivi; la colonna "differenza" (H) viene ignorata
        lati = lati.filter(function (l) { return l.feriali.length > 0; });
        if (lati.length < 2) {
            // fallback: header a due righe (etichette sopra, feriali/festivi sotto)
            return null;
        }
        // Label lato: cerca testo nelle righe sopra header nella prima colonna del lato
        function labelLato(l) {
            for (var rr = hr - 1; rr >= 0; rr--) {
                var v = (rows[rr] || [])[l.firstCol];
                if (v && !isNum(v)) return String(v).trim();
            }
            return null;
        }
        var arena = lati[0], lm = lati[1];
        var la = labelLato(arena), ll = labelLato(lm);
        var out = { arena: { label: la || 'Fratelli Arena', perFiliale: {} }, lastMile: { label: ll || 'Last Mile', perFiliale: {} } };
        function sumCols(row, cols) { var s = 0; cols.forEach(function (c) { s += toInt(row[c]); }); return s; }
        for (var r2 = hr + 1; r2 < rows.length; r2++) {
            var rw = rows[r2] || [];
            [[arena, out.arena], [lm, out.lastMile]].forEach(function (pair) {
                var l = pair[0], dst = pair[1];
                var cod = rw[l.firstCol];
                if (!isCodiceFiliale(cod)) return;
                var k = codice(cod);
                if (!dst.perFiliale[k]) dst.perFiliale[k] = { feriali: 0, festivi: 0 };
                dst.perFiliale[k].feriali += sumCols(rw, l.feriali);
                dst.perFiliale[k].festivi += sumCols(rw, l.festivi);
            });
        }
        function tot(side) {
            var f = 0, s = 0;
            Object.keys(side.perFiliale).forEach(function (k) { f += side.perFiliale[k].feriali; s += side.perFiliale[k].festivi; });
            side.feriali = f; side.festivi = s; side.totale = f + s;
        }
        tot(out.arena); tot(out.lastMile);
        return out;
    }

    // ══════════════════════════════════════════════════════════
    // PARSER WORKBOOK
    // ══════════════════════════════════════════════════════════
    function parseWorkbook(XLSX, wb, cfg) {
        cfg = mergeConfig(cfg);
        var names = wb.SheetNames;
        var nomeRiep = null, nomeSpec = null, nomeConf = null;
        names.forEach(function (n) {
            var l = n.toLowerCase().trim();
            if (l === 'speciali') nomeSpec = n;
            else if (l === 'foglio1') nomeConf = n;
            else if (!nomeRiep && parseMeseAnno(n)) nomeRiep = n;
        });
        if (!nomeRiep) {
            // fallback: primo foglio con etichetta FILIALE
            for (var i = 0; i < names.length; i++) {
                if (names[i] === nomeSpec || names[i] === nomeConf) continue;
                var rws = sheetRows(XLSX, wb.Sheets[names[i]]);
                if (findCell(rws, function (v) { return norm(v) === 'FILIALE'; })) { nomeRiep = names[i]; break; }
            }
        }
        if (!nomeRiep) throw new Error('Nessun foglio riepilogo trovato (atteso es. "luglio 26")');

        var riep = parseRiepilogo(sheetRows(XLSX, wb.Sheets[nomeRiep]), cfg, nomeRiep);
        var spec = nomeSpec ? parseSpeciali(sheetRows(XLSX, wb.Sheets[nomeSpec])) : null;
        var conf = nomeConf ? parseConfronto(sheetRows(XLSX, wb.Sheets[nomeConf])) : null;
        return { config: cfg, riepilogo: riep, speciali: spec, confronto: conf, fogli: names };
    }

    // ══════════════════════════════════════════════════════════
    // TOTALI RICALCOLATI (mai dalle celle di totale)
    // ══════════════════════════════════════════════════════════
    function ricalcola(parsed) {
        var cfg = parsed.config;
        var tFer = toCents(cfg.tariffe.feriale), tFes = toCents(cfg.tariffe.festivo);
        var feriali = 0, festivi = 0, nSpeciali = 0, euroSpeciali = ZERO;
        var perArea = {};
        parsed.riepilogo.filiali.forEach(function (f) {
            feriali += f.feriali; festivi += f.festivi; nSpeciali += f.nSpeciali;
            if (!perArea[f.area]) perArea[f.area] = { feriali: 0, festivi: 0, nSpeciali: 0, euroSpeciali: ZERO };
            perArea[f.area].feriali += f.feriali; perArea[f.area].festivi += f.festivi; perArea[f.area].nSpeciali += f.nSpeciali;
            var sp = parsed.riepilogo.speciali[f.codice];
            if (sp) { perArea[f.area].euroSpeciali += sp; }
        });
        Object.keys(parsed.riepilogo.speciali).forEach(function (k) { euroSpeciali += parsed.riepilogo.speciali[k]; });
        return {
            feriali: feriali, festivi: festivi, totale: feriali + festivi,
            nSpeciali: nSpeciali, euroSpeciali: euroSpeciali,
            euroFeriali: BigInt(feriali) * tFer, euroFestivi: BigInt(festivi) * tFes,
            perArea: perArea
        };
    }

    // ══════════════════════════════════════════════════════════
    // RICONCILIAZIONE — restituisce scostamenti con impatto in €
    // ══════════════════════════════════════════════════════════
    function riconcilia(parsed) {
        var cfg = parsed.config;
        var tFer = toCents(cfg.tariffe.feriale), tFes = toCents(cfg.tariffe.festivo);
        var calc = ricalcola(parsed);
        var out = [];
        function add(tipo, livello, msg, delta, dettagli) {
            out.push({ tipo: tipo, livello: livello, messaggio: msg, deltaCents: delta === undefined ? null : delta, dettagli: dettagli || null });
        }
        var riep = parsed.riepilogo;

        // 1. Totali precalcolati nel file vs ricalcolo dal dettaglio
        if (riep.totaleFile) {
            var dF = riep.totaleFile.feriali - calc.feriali, dS = riep.totaleFile.festivi - calc.festivi;
            if (dF !== 0 || dS !== 0) {
                add('totale_file', 'warning',
                    'Cella "TOTALE COMPLESSIVO" del file (' + riep.totaleFile.feriali + ' feriali / ' + riep.totaleFile.festivi + ' festivi) diversa dalla somma delle filiali (' + calc.feriali + ' / ' + calc.festivi + '). Uso il ricalcolo.',
                    BigInt(dF) * tFer + BigInt(dS) * tFes);
            }
        }
        if (riep.totaleFileUnico !== null && riep.totaleFileUnico !== calc.totale) {
            add('totale_file', 'warning', 'Cella "TOTALE" del file (' + riep.totaleFileUnico + ') diversa dal ricalcolo (' + calc.totale + ').', null);
        }
        Object.keys(riep.totaliArea).forEach(function (a) {
            var t = riep.totaliArea[a], c = calc.perArea[a] || { feriali: 0, festivi: 0 };
            if (t.feriali !== c.feriali || t.festivi !== c.festivi) {
                add('totale_area', 'warning', 'Riga "totali" area ' + a + ' (' + t.feriali + '/' + t.festivi + ') diversa dalla somma filiali (' + c.feriali + '/' + c.festivi + ').',
                    BigInt(t.feriali - c.feriali) * tFer + BigInt(t.festivi - c.festivi) * tFes);
            }
        });
        var tot = riep.blocchiFile['TOTALONE'];
        if (tot) {
            if (tot.feriali !== calc.feriali || tot.festivi !== calc.festivi || tot.speciali !== calc.nSpeciali) {
                add('totale_file', 'warning', 'Blocco "TOTALONE" (' + tot.feriali + '/' + tot.festivi + '/' + tot.speciali + ' spec.) diverso dal ricalcolo (' + calc.feriali + '/' + calc.festivi + '/' + calc.nSpeciali + ').',
                    BigInt(tot.feriali - calc.feriali) * tFer + BigInt(tot.festivi - calc.festivi) * tFes);
            }
            var euroCalc = calc.euroFeriali + calc.euroFestivi + calc.euroSpeciali;
            if (tot.euroTotale !== ZERO && tot.euroTotale !== euroCalc) {
                add('totale_file', 'warning', 'Importo "TOTALONE" del file ' + centsToEuroIt(tot.euroTotale) + ' diverso dal ricalcolo ' + centsToEuroIt(euroCalc) + ' (tariffe file: ' + riep.tariffeFile.join(' / ') + ').', tot.euroTotale - euroCalc);
            }
        }

        // 2. Speciali: colonna H (numero) vs foglio speciali (righe) e importi riepilogo vs foglio speciali
        var sp = parsed.speciali;
        if (sp) {
            var codici = {};
            riep.filiali.forEach(function (f) { if (f.nSpeciali) codici[f.codice] = true; });
            Object.keys(sp.perFiliale).forEach(function (k) { codici[k] = true; });
            Object.keys(riep.speciali).forEach(function (k) { codici[k] = true; });
            Object.keys(codici).sort().forEach(function (k) {
                var f = riep.filiali.filter(function (x) { return x.codice === k; })[0];
                var nRiep = f ? f.nSpeciali : 0;
                var d = sp.perFiliale[k] || { n: 0, importo: ZERO };
                var impRiep = riep.speciali[k] || ZERO;
                if (nRiep !== d.n) {
                    add('speciali_numero', 'warning', 'Filiale ' + k + ': ' + nRiep + ' consegne speciali nel riepilogo, ' + d.n + ' righe nel foglio speciali.', null);
                }
                if (impRiep !== d.importo) {
                    add('speciali_importo', 'error', 'Filiale ' + k + ': importo speciali riepilogo ' + centsToEuroIt(impRiep) + ' vs foglio speciali ' + centsToEuroIt(d.importo) + '. In fattura va l\'importo del riepilogo.', impRiep - d.importo);
                }
            });
        } else {
            add('speciali_assente', 'info', 'Foglio "speciali" assente: importi speciali presi solo dal riepilogo.', null);
        }
        // Filiali con speciali in H ma senza importo riconosciuto
        riep.filiali.forEach(function (f) {
            if (f.nSpeciali > 0 && !riep.speciali[f.codice]) {
                add('speciali_importo', 'error', 'Filiale ' + f.codice + ': ' + f.nSpeciali + ' consegne speciali ma nessun importo riconosciuto nel riepilogo.', null);
            }
        });

        // 3. Confronto Foglio1 (Arena vs Last Mile) — se presente
        var conf = parsed.confronto;
        if (conf) {
            var lm = conf.lastMile, ar = conf.arena;
            if (lm.totale !== calc.totale) {
                add('confronto_totale', 'error', 'Totale consegne: riepilogo ' + calc.totale + ' vs Foglio1 (' + lm.label + ') ' + lm.totale + '.',
                    BigInt(lm.totale - calc.totale) * tFer);
            }
            if (lm.feriali !== calc.feriali || lm.festivi !== calc.festivi) {
                add('confronto_split', 'warning', 'Split feriali/festivi: riepilogo ' + calc.feriali + '/' + calc.festivi + ' vs Foglio1 (' + lm.label + ') ' + lm.feriali + '/' + lm.festivi + ' (' + Math.abs(lm.festivi - calc.festivi) + ' consegne riclassificate).',
                    BigInt(lm.feriali - calc.feriali) * tFer + BigInt(lm.festivi - calc.festivi) * tFes);
            }
            var keys = {};
            Object.keys(ar.perFiliale).forEach(function (k) { keys[k] = 1; });
            Object.keys(lm.perFiliale).forEach(function (k) { keys[k] = 1; });
            var deltaTot = ZERO, dett = [];
            Object.keys(keys).sort().forEach(function (k) {
                var a = ar.perFiliale[k] || { feriali: 0, festivi: 0 }, l = lm.perFiliale[k] || { feriali: 0, festivi: 0 };
                if (a.feriali !== l.feriali || a.festivi !== l.festivi) {
                    var dlt = BigInt(a.feriali - l.feriali) * tFer + BigInt(a.festivi - l.festivi) * tFes;
                    deltaTot += dlt;
                    dett.push({ codice: k, arenaFeriali: a.feriali, arenaFestivi: a.festivi, lmFeriali: l.feriali, lmFestivi: l.festivi, deltaCents: dlt });
                }
            });
            if (dett.length) {
                add('confronto_arena', 'error', ar.label + ' conta ' + (ar.totale - lm.totale >= 0 ? '+' : '') + (ar.totale - lm.totale) + ' consegne rispetto a ' + lm.label + ' su ' + dett.length + ' filiali (' +
                    dett.map(function (d) { return d.codice + ': ' + (d.arenaFeriali - d.lmFeriali) + ' fer / ' + (d.arenaFestivi - d.lmFestivi) + ' fest'; }).join('; ') + ').', deltaTot, dett);
            }
        } else {
            add('confronto_assente', 'info', 'Foglio1 (confronto Fratelli Arena / Last Mile) assente: confronto non disponibile.', null);
        }
        return out;
    }

    // ══════════════════════════════════════════════════════════
    // RIGHE FATTURA
    // ══════════════════════════════════════════════════════════
    function labelMese(mese, anno) {
        return MESI_IT[(mese || 1) - 1] + ' ' + anno;
    }

    function ordinaFiliali(filiali, cfg) {
        return filiali.slice().sort(function (a, b) {
            var ia = cfg.areeOrdine.indexOf(a.area), ib = cfg.areeOrdine.indexOf(b.area);
            if (ia === -1) ia = 99; if (ib === -1) ib = 99;
            if (ia !== ib) return ia - ib;
            var na = parseInt(a.codice, 10), nb = parseInt(b.codice, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0;
        });
    }

    // opts: { mese, anno, acconto: { importo (cents|string), riferimento } }
    function buildRighe(parsed, opts) {
        opts = opts || {};
        var cfg = parsed.config;
        var mese = opts.mese || parsed.riepilogo.mese;
        var anno = opts.anno || parsed.riepilogo.anno;
        if (!mese || !anno) throw new Error('Mese/anno non determinati (nome foglio: ' + parsed.riepilogo.nomeFoglio + ')');
        var periodo = labelMese(mese, anno);
        var tFer = toCents(cfg.tariffe.feriale), tFes = toCents(cfg.tariffe.festivo);
        var righe = [];
        var ordinate = ordinaFiliali(parsed.riepilogo.filiali, cfg);
        ordinate.forEach(function (f) {
            if (f.feriali > 0) righe.push(riga('feriali', f, 'Filiale ' + f.codice + ' (' + f.area + ') - consegne giorni feriali ' + periodo, f.feriali, tFer));
            if (f.festivi > 0) righe.push(riga('festivi', f, 'Filiale ' + f.codice + ' (' + f.area + ') - consegne giorni festivi ' + periodo, f.festivi, tFes));
        });
        ordinate.forEach(function (f) {
            var imp = parsed.riepilogo.speciali[f.codice];
            if (imp === undefined || imp === ZERO) return;
            var n = f.nSpeciali || (parsed.speciali && parsed.speciali.perFiliale[f.codice] ? parsed.speciali.perFiliale[f.codice].n : 0);
            righe.push(riga('speciali', f, 'Filiale ' + f.codice + ' (' + f.area + ') - n. ' + n + ' consegne speciali ' + periodo, 1, imp));
        });
        // speciali per filiali non presenti nel dettaglio (tollerante)
        Object.keys(parsed.riepilogo.speciali).forEach(function (k) {
            if (ordinate.some(function (f) { return f.codice === k; })) return;
            righe.push(riga('speciali', { codice: k, area: '?' }, 'Filiale ' + k + ' - consegne speciali ' + periodo, 1, parsed.riepilogo.speciali[k]));
        });
        if (opts.acconto && opts.acconto.importo !== undefined && opts.acconto.importo !== null && opts.acconto.importo !== '') {
            var acc = toCents(opts.acconto.importo);
            if (acc < ZERO) acc = -acc;
            if (acc > ZERO) {
                var rif = opts.acconto.riferimento ? ' (' + opts.acconto.riferimento + ')' : '';
                righe.push({ tipo: 'acconto', area: null, codice: null, descrizione: 'Detrazione acconto già fatturato' + rif, qty: 1, prezzoCents: -acc, totaleCents: -acc });
            }
        }
        return righe;
    }
    function riga(tipo, f, descr, qty, prezzo) {
        return { tipo: tipo, area: f.area, codice: f.codice, descrizione: descr, qty: qty, prezzoCents: prezzo, totaleCents: BigInt(qty) * prezzo };
    }

    function totali(righe, ivaPercento) {
        var imponibile = ZERO;
        righe.forEach(function (r) {
            var t = BigInt(r.qty) * toCents(r.prezzoCents);
            if (r.totaleCents !== undefined && toCents(r.totaleCents) !== t) throw new Error('Riga incoerente: ' + r.descrizione);
            imponibile += t;
        });
        var iva = percentOf(imponibile, ivaPercento === undefined ? DEFAULT_CONFIG.ivaPercento : ivaPercento);
        return { imponibile: imponibile, iva: iva, totale: imponibile + iva };
    }

    function subtotaliArea(righe) {
        var out = {};
        righe.forEach(function (r) {
            var k = r.tipo === 'acconto' ? 'ACCONTO' : (r.tipo === 'speciali' ? 'SPECIALI' : r.area);
            if (!out[k]) out[k] = { righe: 0, qty: 0, totaleCents: ZERO };
            out[k].righe++; out[k].qty += r.qty; out[k].totaleCents += toCents(r.totaleCents);
        });
        return out;
    }

    // Serializzazione JSON-safe (BigInt → stringa decimale) e ritorno
    function righeToJson(righe) {
        return righe.map(function (r) {
            return { tipo: r.tipo, area: r.area, codice: r.codice, descrizione: r.descrizione, qty: r.qty, prezzo: centsToString(toCents(r.prezzoCents)), totale: centsToString(toCents(r.totaleCents)) };
        });
    }
    function righeFromJson(arr) {
        if (!Array.isArray(arr)) throw new Error('righe non valide');
        return arr.map(function (r, i) {
            if (!r || typeof r.descrizione !== 'string' || !r.descrizione.trim()) throw new Error('Riga ' + (i + 1) + ': descrizione mancante');
            if (!Number.isInteger(r.qty) || r.qty <= 0) throw new Error('Riga ' + (i + 1) + ': quantità non valida');
            var p = toCents(r.prezzo);
            var t = BigInt(r.qty) * p;
            if (r.totale !== undefined && toCents(r.totale) !== t) throw new Error('Riga ' + (i + 1) + ': totale non coerente');
            return { tipo: r.tipo || 'altro', area: r.area || null, codice: r.codice || null, descrizione: r.descrizione.trim(), qty: r.qty, prezzoCents: p, totaleCents: t };
        });
    }

    function addDays(iso, n) {
        var d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }

    return {
        DEFAULT_CONFIG: DEFAULT_CONFIG, mergeConfig: mergeConfig,
        toCents: toCents, percentOf: percentOf, centsToString: centsToString, centsToNumber: centsToNumber, centsToEuroIt: centsToEuroIt,
        parseWorkbook: parseWorkbook, parseRiepilogo: parseRiepilogo, parseSpeciali: parseSpeciali, parseConfronto: parseConfronto, parseMeseAnno: parseMeseAnno,
        ricalcola: ricalcola, riconcilia: riconcilia,
        buildRighe: buildRighe, totali: totali, subtotaliArea: subtotaliArea, ordinaFiliali: ordinaFiliali,
        righeToJson: righeToJson, righeFromJson: righeFromJson, labelMese: labelMese, addDays: addDays,
        MESI_IT: MESI_IT
    };
}));
