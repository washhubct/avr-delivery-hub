// DELIVERY HUB v2 — Dashboard (classificazione AVR/interna DEFINITIVA con alias)

// Mappa alias: nomi come appaiono nei fogli → cognome anagrafica AVR
var DRIVER_ALIAS = {
    // Varianti nome completo
    'FELIX': 'SIYAMBALA GAMAGE',
    'SIYAMBALAGAMAGE': 'SIYAMBALA GAMAGE',
    'SIYAMBALA GAMAGESHRENUKA': 'SIYAMBALA GAMAGE',
    // Cognomi con particella (DI, LA, LO, DAL)
    'LINOCE': 'LI NOCE',
    'DALPIN': 'DAL PIN',
    'DIGIORGI': 'DI GIORGI',
    'DIGIROGI': 'DI GIORGI',
    'DI GIROGI': 'DI GIORGI',
    'DICANDIA': 'DI CANDIA',
    'DIPRIMA': 'DI PRIMA',
    'DIMAGGIO': 'DI MAGGIO',
    'LAROCCA': 'LA ROCCA',
    'LAPORTA': 'LA PORTA',
    'LOPRESTI': 'LO PRESTI',
    // Alias corriere/filiale
    'CORRCATANIA': 'LA PORTA',
    'CORR CATANIA': 'LA PORTA',
    'CORR.CATANIA': 'LA PORTA',
    'CORR. CATANIA': 'LA PORTA',
    // Typo cognomi semplici
    'SCABOTI': 'SCABOTTI',
    // Cognome + nome insieme (VINCI VITO — in anagrafica come cognome VINCI)
    'VINCI VITO': 'VINCI',
    'VINCIVITO': 'VINCI',
    // Apostrofo/accento
    "ARICO'": 'ARICO',
    'ARICÒ': 'ARICO',
    // Errori ortografici frequenti
    'TUMMONIA': 'TUMMINIA',
    'MESSNA': 'MESSINA',
    'MESSIMNA': 'MESSINA',
    'DICANDA': 'DI CANDIA',
    // Corriere Catania → La Porta (tutte le varianti)
    'CORRIERE CATANIA': 'LA PORTA',
    'CORRIERECATANIA': 'LA PORTA'
};

function buildDriverAvrSet() {
    var set = new Set();

    // Da anagrafica Firestore
    if (state.driverList && state.driverList.length > 0) {
        state.driverList.forEach(function(d) {
            if (d.cognome) {
                set.add(d.cognome.toUpperCase().trim());
                set.add(d.cognome.toUpperCase().trim().replace(/\s+/g, ''));
            }
            if (d.cognome && d.nome) {
                set.add((d.cognome + ' ' + d.nome).toUpperCase().trim());
                set.add((d.nome + ' ' + d.cognome).toUpperCase().trim());
            }
            // Alias gestiti in anagrafica (es. FELIX → Siyambala): stessa fonte del GAS
            if (Array.isArray(d.alias)) {
                d.alias.forEach(function(a) {
                    if (a) { set.add(String(a).toUpperCase().trim()); set.add(String(a).toUpperCase().trim().replace(/\s+/g, '')); }
                });
            }
        });
    }

    // Archivio cessati: le consegne dei mesi in cui lavoravano restano nostre
    if (state.driverArchivio && state.driverArchivio.length > 0) {
        state.driverArchivio.forEach(function(d) {
            if (d.cognome) {
                set.add(d.cognome.toUpperCase().trim());
                set.add(d.cognome.toUpperCase().trim().replace(/\s+/g, ''));
            }
            if (Array.isArray(d.alias)) {
                d.alias.forEach(function(a) {
                    if (a) { set.add(String(a).toUpperCase().trim()); set.add(String(a).toUpperCase().trim().replace(/\s+/g, '')); }
                });
            }
        });
    }

    // Fallback da preload in state
    if (state.driverPreload) {
        state.driverPreload.forEach(function(d) {
            if (d.cognome) {
                set.add(d.cognome.toUpperCase().trim());
                set.add(d.cognome.toUpperCase().trim().replace(/\s+/g, ''));
            }
            if (d.cognome && d.nome) {
                set.add((d.cognome + ' ' + d.nome).toUpperCase().trim());
                set.add((d.nome + ' ' + d.cognome).toUpperCase().trim());
            }
        });
    }

    // Aggiungi tutti gli alias come riconosciuti
    Object.keys(DRIVER_ALIAS).forEach(function(alias) {
        set.add(alias.toUpperCase().trim());
    });

    return set;
}

function isDriverAvr(riderName, avrSet) {
    if (!riderName) return false;
    var name = riderName.toUpperCase().trim();
    if (!name) return false;

    // Match esatto
    if (avrSet.has(name)) return true;

    // Match senza spazi (es. LINOCE, DALPIN, DIGIORGI)
    var noSpaces = name.replace(/\s+/g, '');
    if (avrSet.has(noSpaces)) return true;

    // Check alias diretto
    if (DRIVER_ALIAS[name] || DRIVER_ALIAS[noSpaces]) return true;

    // Match parziale: controlla se un cognome AVR è contenuto nel nome rider
    var found = false;
    avrSet.forEach(function(avrName) {
        if (found) return;
        if (avrName.length < 3) return;
        if (name.indexOf(avrName) >= 0) found = true;
    });
    if (found) return true;

    // Fuzzy: typo con distanza ≤1 (o ≤2 per nomi ≥8 char)
    if (typeof fuzzyMatchDriver === 'function') {
        if (fuzzyMatchDriver(name) !== null) return true;
    }

    return false;
}

// Classificazione consegna: usa PRESTAZIONE dal foglio filiale quando
// presente (fonte autoritativa scritta dalla filiale), altrimenti
// euristica sul nome rider. Esclude ritorni e non-consegnate esplicite.
function isConsegnaAvr(c, avrSet) {
    if (c.tipo === 'ritorno') return false;
    if (c.nonConsegnata === true) return false;
    var p = (c.prestazione || '').toUpperCase().trim();
    if (p === 'AVR') return true;
    if (p.indexOf('INTERN') >= 0) return false;
    var rider = c.driver || c.rider || '';
    return isDriverAvr(rider, avrSet);
}

function isConsegnaInterna(c, avrSet) {
    var p = (c.prestazione || '').toUpperCase().trim();
    if (p.indexOf('INTERN') >= 0) return true;
    if (p === 'AVR') return false;
    var rider = c.driver || c.rider || '';
    if (!rider.trim()) return false;
    return !isDriverAvr(rider, avrSet);
}

// Consegne senza rider e senza prestazione esplicita (o marcate 'verifica'
// dal GAS): escluse dal fatturato automatico come le >€499, in attesa di
// classificazione manuale.
function isConsegnaDaVerificare(c) {
    if (c.tipo === 'ritorno' || c.tipo === 'pane_gastro_sushi') return false;
    if (c.tipoDriver === 'verifica') return true;
    var p = (c.prestazione || '').toUpperCase().trim();
    if (p === 'AVR' || p.indexOf('INTERN') >= 0) return false;
    var rider = String(c.driver || c.rider || '');
    return !rider.trim();
}

function normalizeRiderForDisplay(riderName) {
    if (!riderName) return '—';
    var name = riderName.toUpperCase().trim();
    var noSpaces = name.replace(/\s+/g, '');
    if (DRIVER_ALIAS[name]) return DRIVER_ALIAS[name];
    if (DRIVER_ALIAS[noSpaces]) return DRIVER_ALIAS[noSpaces];
    // Fuzzy fallback: restituisce il cognome canonico AVR se typo
    if (typeof fuzzyMatchDriver === 'function') {
        var fuzzy = fuzzyMatchDriver(name);
        if (fuzzy) return fuzzy;
    }
    return name;
}

function renderDashboard() {
    var mese = state.meseCorrente;
    var allConsegne = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });

    var avrSet = buildDriverAvrSet();

    var consegneAvr = allConsegne.filter(function(c) { return isConsegnaAvr(c, avrSet); });
    var consegneInt = allConsegne.filter(function(c) { return isConsegnaInterna(c, avrSet); });

    // ═══ KPI — stessa classificazione del resto della dashboard (prestazione
    // + alias anagrafica), NON il tipoDriver grezzo del GAS: i rider scritti
    // senza spazi (LINOCE, LAPORTA...) sono nostri e fatturabili.
    // Rider vuoto senza prestazione → 'da verificare', escluso dal fatturato.
    var daVerificareArr = allConsegne.filter(isConsegnaDaVerificare);
    var consegneFatturabili = allConsegne.filter(function(c) {
        return !isConsegnaInterna(c, avrSet) && !isConsegnaDaVerificare(c);
    });
    var totale = consegneFatturabili.length;
    var daVerificareN = daVerificareArr.length;
    var totaleInterne = allConsegne.length - totale - daVerificareN;
    var maggiori = 0, minori = 0, speciali = 0, prezziario = 0, fattPrezziario = 0;
    var fatturato = 0;
    var schemaFlat = mese >= MESE_SCHEMA_FLAT;

    consegneFatturabili.forEach(function(c) {
        var imp = c.importo || 0;
        var p = prezzoConsegnaMese(imp, mese, c.tipo, c.data);
        if (schemaFlat && imp > 499) { prezziario++; fattPrezziario += p; }
        else if (c.tipo === 'ritorno' || c.tipo === 'pane_gastro_sushi') speciali++;
        else if (imp >= 250) maggiori++;
        else minori++;
        if (p !== null) fatturato += p;
    });

    document.getElementById('kpiConsegneMese').textContent = totale;
    document.getElementById('kpiConsegneDetail').innerHTML = (schemaFlat
        ? (maggiori + minori + speciali) + ' ordinarie (ritorni inclusi) · ' + prezziario + ' >€499 a prezziario'
        : maggiori + ' ≥€250 · ' + minori + ' <€250 · ' + speciali + ' speciali')
        + (daVerificareN > 0 ? ' · <span style="color:var(--warning)">' + daVerificareN + ' da verificare</span>' : '')
        + (totaleInterne > 0 ? ' · <span style="color:var(--text-muted)">' + totaleInterne + ' interne escluse</span>' : '');
    document.getElementById('kpiFatturato').textContent = formatCurrency(fatturato);
    document.getElementById('kpiFatturatoDetail').textContent = schemaFlat
        ? (maggiori + minori + speciali) + '×€9,70 + ' + formatCurrency(fattPrezziario) + ' prezziario (' + prezziario + ' speciali)'
        : maggiori + '×€10 + ' + (minori + speciali) + '×€6,90';

    // Media consegne/giorno (giorni con almeno una consegna nel mese)
    var giorniAttivi = {};
    consegneFatturabili.forEach(function(c) {
        var d = c.data instanceof Date ? c.data : new Date(c.data);
        if (!isNaN(d)) giorniAttivi[d.toISOString().slice(0, 10)] = true;
    });
    var nGiorni = Object.keys(giorniAttivi).length;
    document.getElementById('kpiMediaGiorno').textContent = nGiorni > 0 ? Math.round(totale / nGiorni) : '—';
    document.getElementById('kpiMediaGiornoDetail').textContent = nGiorni + ' giorni lavorati nel mese';

    // Driver attivi: driver AVR distinti con almeno una consegna nel mese
    var driverAttiviSet = {};
    consegneAvr.forEach(function(c) {
        var drv = normalizeRiderForDisplay(c.driver || c.rider || '');
        if (drv && drv !== '—') driverAttiviSet[drv] = true;
    });
    var nDriverAttivi = Object.keys(driverAttiviSet).length;
    document.getElementById('kpiDriverAttivi').textContent = nDriverAttivi;
    document.getElementById('kpiDriverAttiviDetail').textContent = nDriverAttivi > 0 ? '~' + Math.round(consegneAvr.length / nDriverAttivi) + ' consegne/driver' : '';

    // ═══ Consegne per area (solo AVR) ═══
    var aree = {};
    var AREA_NAMES = { 'CT': 'Catania', 'ME': 'Messina', 'SR': 'Siracusa', 'PA': 'Palermo', 'EN': 'Enna' };

    // Nello schema flat la colonna "speciali" conta le >€499 (prezzo manuale),
    // in quello storico le ≥€250
    consegneAvr.forEach(function(c) {
        var area = c.area || '?';
        if (!aree[area]) aree[area] = { filiali: new Set(), maggiori: 0, minori: 0, fatturato: 0 };
        aree[area].filiali.add(c.filiale);
        var imp = c.importo || 0;
        var p = prezzoConsegnaMese(imp, mese, c.tipo, c.data);
        var isExtra = c.tipo === 'ritorno' || c.tipo === 'pane_gastro_sushi';
        var sogliaSup = schemaFlat ? imp > 499 : imp >= 250;
        if (sogliaSup && !isExtra) aree[area].maggiori++;
        else aree[area].minori++;
        if (p !== null) aree[area].fatturato += p;
    });

    var tblAree = document.getElementById('tblAree');
    var rowsHtml = '';
    var tFiliali = 0, tMagg = 0, tMin = 0, tTot = 0, tFatt = 0;

    Object.keys(aree).sort().forEach(function(area) {
        var a = aree[area];
        var tot = a.maggiori + a.minori;
        var nFil = a.filiali.size;
        tFiliali += nFil; tMagg += a.maggiori; tMin += a.minori; tTot += tot;
        tFatt += a.fatturato;

        rowsHtml += '<tr>'
            + '<td><strong>' + area + '</strong> — ' + (AREA_NAMES[area] || area)
            + '<div style="font-size:11px;color:var(--text-muted)">Fratelli Arena</div></td>'
            + '<td>' + nFil + '</td>'
            + '<td>' + a.maggiori + '</td>'
            + '<td>' + a.minori + '</td>'
            + '<td><strong>' + tot + '</strong></td>'
            + '<td>' + formatCurrency(a.fatturato) + '</td>'
            + '</tr>';
    });
    tblAree.innerHTML = rowsHtml;

    document.getElementById('totFiliali').textContent = tFiliali;
    document.getElementById('totMaggiori').textContent = tMagg;
    document.getElementById('totMinori').textContent = tMin;
    document.getElementById('totConsegne').innerHTML = '<strong>' + tTot + '</strong>';
    document.getElementById('totFatturato').textContent = formatCurrency(tFatt);

    // ═══ Top 10 filiali (solo AVR) ═══
    var byFiliale = {};
    consegneAvr.forEach(function(c) {
        var key = c.filiale || '?';
        if (!byFiliale[key]) byFiliale[key] = { nome: c.filialeNome || key, area: c.area || '?', count: 0, fatturato: 0 };
        byFiliale[key].count++;
        var p = prezzoConsegnaMese(c.importo || 0, mese, c.tipo, c.data);
        if (p !== null) byFiliale[key].fatturato += p;
    });

    var topFil = Object.entries(byFiliale).sort(function(a, b) { return b[1].count - a[1].count; }).slice(0, 10);
    document.getElementById('tblTopFiliali').innerHTML = topFil.map(function(e) {
        return '<tr><td>' + e[0] + ' ' + e[1].nome + '</td><td><span class="badge">' + e[1].area + '</span></td><td>' + e[1].count + '</td><td>' + formatCurrency(e[1].fatturato) + '</td></tr>';
    }).join('');

    // ═══ Performance driver (solo AVR) — con normalizzazione nomi ═══
    var byDriver = {};
    consegneAvr.forEach(function(c) {
        var rawName = c.driver || c.rider || '';
        var drv = normalizeRiderForDisplay(rawName);
        if (!drv || drv === '—') return;
        if (typeof normalizeDriverName === 'function') {
            var nd = normalizeDriverName(rawName);
            if (nd) drv = nd;
        }
        if (!byDriver[drv]) byDriver[drv] = { count: 0, filiali: new Set() };
        byDriver[drv].count++;
        byDriver[drv].filiali.add(c.filiale);
    });

    var topDrv = Object.entries(byDriver).sort(function(a, b) { return b[1].count - a[1].count; }).slice(0, 10);
    document.getElementById('tblTopDriver').innerHTML = topDrv.map(function(e) {
        var media = nGiorni > 0 ? (e[1].count / nGiorni).toFixed(1) : '—';
        return '<tr><td>' + e[0] + '</td><td>' + e[1].count + '</td><td>' + media + '</td><td>' + e[1].filiali.size + '</td></tr>';
    }).join('');

    // ═══ Consegne Interne ═══
    var cardInterne = document.getElementById('cardInterne');
    if (consegneInt.length > 0) {
        cardInterne.style.display = '';
        document.getElementById('kpiInterneTot').textContent = consegneInt.length;

        var intByFiliale = {};
        consegneInt.forEach(function(c) {
            var key = (c.filiale || '?') + '_' + (c.rider || c.driver || '?').toUpperCase();
            if (!intByFiliale[key]) intByFiliale[key] = {
                filiale: c.filiale, filialeNome: c.filialeNome || '', area: c.area || '?',
                driver: (c.rider || c.driver || '—').toUpperCase(), count: 0
            };
            intByFiliale[key].count++;
        });

        var intFiliali = new Set();
        consegneInt.forEach(function(c) { intFiliali.add(c.filiale); });
        document.getElementById('kpiInterneFiliali').textContent = intFiliali.size;

        var intRows = Object.values(intByFiliale).sort(function(a, b) { return b.count - a.count; });
        document.getElementById('tblInterne').innerHTML = intRows.map(function(r) {
            return '<tr><td>' + r.filiale + ' ' + r.filialeNome + '</td><td><span class="badge">' + r.area + '</span></td><td>' + r.driver + '</td><td>' + r.count + '</td></tr>';
        }).join('');
    } else {
        cardInterne.style.display = 'none';
    }
}

function exportConsegneInterne() {
    var mese = state.meseCorrente;
    var allConsegne = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });
    var avrSet = buildDriverAvrSet();
    var consegneInt = allConsegne.filter(function(c) { return isConsegnaInterna(c, avrSet); });

    if (consegneInt.length === 0) { toast('Nessuna consegna interna', 'warning'); return; }

    consegneInt.sort(function(a, b) {
        var fa = (a.filiale || '').localeCompare(b.filiale || '');
        if (fa !== 0) return fa;
        var da = a.data instanceof Date ? a.data.getTime() : 0;
        var db2 = b.data instanceof Date ? b.data.getTime() : 0;
        return da - db2;
    });

    var rows = [
        ['CONSEGNE INTERNE (NON LAST MILE) — ' + meseLabel(mese)],
        ['Consegne effettuate da personale interno filiale, non da driver Last Mile'],
        [],
        ['Data', 'Filiale', 'Nome Filiale', 'Area', 'Cliente', 'Città', 'Indirizzo', 'Importo', 'Driver Interno', 'Prestazione']
    ];

    consegneInt.forEach(function(c) {
        var dataStr = '';
        if (c.data instanceof Date) {
            dataStr = c.data.toLocaleDateString('it-IT');
        } else if (typeof c.data === 'string') {
            dataStr = new Date(c.data).toLocaleDateString('it-IT');
        }
        rows.push([
            dataStr,
            c.filiale || '',
            c.filialeNome || '',
            c.area || '',
            c.cognome || c.cliente || '',
            c.citta || '',
            c.indirizzo || '',
            c.importo || 0,
            (c.rider || c.driver || '—').toUpperCase(),
            c.prestazione || ''
        ]);
    });

    rows.push([]);
    rows.push(['TOTALE CONSEGNE INTERNE:', consegneInt.length]);

    rows.push([]);
    rows.push(['RIEPILOGO PER FILIALE']);
    rows.push(['Filiale', 'Nome', 'Area', 'N. Consegne', 'Driver interni']);

    var riepilogo = {};
    consegneInt.forEach(function(c) {
        var f = c.filiale || '?';
        if (!riepilogo[f]) riepilogo[f] = { nome: c.filialeNome || '', area: c.area || '', count: 0, drivers: new Set() };
        riepilogo[f].count++;
        var drv = (c.rider || c.driver || '').toUpperCase().trim();
        if (drv) riepilogo[f].drivers.add(drv);
    });

    Object.keys(riepilogo).sort().forEach(function(f) {
        var r = riepilogo[f];
        rows.push([f, r.nome, r.area, r.count, Array.from(r.drivers).join(', ') || '—']);
    });

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);

    ws['!cols'] = [
        { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 6 }, { wch: 22 },
        { wch: 14 }, { wch: 30 }, { wch: 10 }, { wch: 16 }, { wch: 12 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Consegne Interne');
    XLSX.writeFile(wb, 'consegne_interne_' + mese + '.xlsx');
    toast('File scaricato', 'success');
}
