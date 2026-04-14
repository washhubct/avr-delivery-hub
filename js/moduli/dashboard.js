// DELIVERY HUB v2 — Dashboard (con classificazione AVR/interna da anagrafica)

function buildDriverAvrSet() {
    // Costruisce un Set con tutti i cognomi driver AVR (da anagrafica Firestore + preload)
    var set = new Set();

    // Da anagrafica Firestore
    if (state.driverList && state.driverList.length > 0) {
        state.driverList.forEach(function(d) {
            if (d.cognome) set.add(d.cognome.toUpperCase().trim());
            // Aggiungi anche cognome+nome per match più preciso
            if (d.cognome && d.nome) {
                set.add((d.cognome + ' ' + d.nome).toUpperCase().trim());
                set.add((d.nome + ' ' + d.cognome).toUpperCase().trim());
            }
        });
    }

    // Fallback da preload in state
    if (state.driverPreload) {
        state.driverPreload.forEach(function(d) {
            if (d.cognome) set.add(d.cognome.toUpperCase().trim());
            if (d.cognome && d.nome) {
                set.add((d.cognome + ' ' + d.nome).toUpperCase().trim());
                set.add((d.nome + ' ' + d.cognome).toUpperCase().trim());
            }
        });
    }

    return set;
}

function isDriverAvr(riderName, avrSet) {
    if (!riderName) return false;
    var name = riderName.toUpperCase().trim();
    if (!name) return false;

    // Match esatto
    if (avrSet.has(name)) return true;

    // Match parziale: controlla se il cognome AVR è contenuto nel nome rider
    var found = false;
    avrSet.forEach(function(avrName) {
        if (found) return;
        // Controlla solo cognomi (parole singole o doppie tipo "LI NOCE")
        if (name.indexOf(avrName) >= 0) found = true;
        // Controlla anche se il cognome AVR è contenuto
        if (avrName.indexOf(' ') < 0 && name.split(/\s+/).indexOf(avrName) >= 0) found = true;
    });

    return found;
}

function renderDashboard() {
    var mese = state.meseCorrente;
    var allConsegne = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });

    // Costruisci set driver AVR da anagrafica
    var avrSet = buildDriverAvrSet();

    // Separa AVR da interne usando l'anagrafica reale
    var consegneAvr = allConsegne.filter(function(c) {
        var rider = c.driver || c.rider || '';
        return isDriverAvr(rider, avrSet);
    });
    var consegneInt = allConsegne.filter(function(c) {
        var rider = c.driver || c.rider || '';
        // Se non ha rider, non è né AVR né interna — skip
        if (!rider.trim()) return false;
        return !isDriverAvr(rider, avrSet);
    });

    // ═══ KPI (solo AVR) ═══
    var totale = consegneAvr.length;
    var maggiori = 0, minori = 0, speciali = 0;
    var fatturato = 0;

    consegneAvr.forEach(function(c) {
        var imp = c.importo || 0;
        if (c.tipo === 'ritorno' || c.tipo === 'pane_gastro_sushi') {
            speciali++;
            fatturato += 6.90;
        } else if (imp >= 250) {
            maggiori++;
            fatturato += 10.00;
        } else {
            minori++;
            fatturato += 6.90;
        }
    });

    var costoDriver = totale * (state.costoPerConsegna || 3.50);
    var margine = fatturato - costoDriver;

    document.getElementById('kpiConsegneMese').textContent = totale;
    document.getElementById('kpiConsegneDetail').innerHTML = maggiori + ' ≥€250 · ' + minori + ' <€250 · ' + speciali + ' speciali';
    document.getElementById('kpiFatturato').textContent = formatCurrency(fatturato);
    document.getElementById('kpiFatturatoDetail').textContent = maggiori + '×€10 + ' + (minori + speciali) + '×€6,90';
    document.getElementById('kpiCostoDriver').textContent = formatCurrency(costoDriver);
    document.getElementById('kpiCostoDriverDetail').textContent = totale + ' × €' + ((state.costoPerConsegna || 3.50).toFixed(2).replace('.', ','));
    document.getElementById('kpiMargine').textContent = formatCurrency(margine);
    var margPerc = fatturato > 0 ? ((margine / fatturato) * 100).toFixed(1) : '0';
    document.getElementById('kpiMargineDetail').textContent = margPerc + '% del fatturato';

    // ═══ Consegne per area (solo AVR) ═══
    var aree = {};
    var AREA_NAMES = { 'CT': 'Catania', 'ME': 'Messina', 'SR': 'Siracusa', 'PA': 'Palermo', 'EN': 'Enna' };

    consegneAvr.forEach(function(c) {
        var area = c.area || '?';
        if (!aree[area]) aree[area] = { filiali: new Set(), maggiori: 0, minori: 0, fatturato: 0 };
        aree[area].filiali.add(c.filiale);
        var imp = c.importo || 0;
        if (c.tipo === 'ritorno' || c.tipo === 'pane_gastro_sushi') {
            aree[area].minori++;
            aree[area].fatturato += 6.90;
        } else if (imp >= 250) {
            aree[area].maggiori++;
            aree[area].fatturato += 10.00;
        } else {
            aree[area].minori++;
            aree[area].fatturato += 6.90;
        }
    });

    var tblAree = document.getElementById('tblAree');
    var rowsHtml = '';
    var tFiliali = 0, tMagg = 0, tMin = 0, tTot = 0, tFatt = 0, tCosto = 0, tMarg = 0;

    Object.keys(aree).sort().forEach(function(area) {
        var a = aree[area];
        var tot = a.maggiori + a.minori;
        var nFil = a.filiali.size;
        var costo = tot * (state.costoPerConsegna || 3.50);
        var marg = a.fatturato - costo;
        tFiliali += nFil; tMagg += a.maggiori; tMin += a.minori; tTot += tot;
        tFatt += a.fatturato; tCosto += costo; tMarg += marg;

        rowsHtml += '<tr>'
            + '<td><strong>' + area + '</strong> — ' + (AREA_NAMES[area] || area)
            + '<div style="font-size:11px;color:var(--text-muted)">Fratelli Arena</div></td>'
            + '<td>' + nFil + '</td>'
            + '<td>' + a.maggiori + '</td>'
            + '<td>' + a.minori + '</td>'
            + '<td><strong>' + tot + '</strong></td>'
            + '<td>' + formatCurrency(a.fatturato) + '</td>'
            + '<td>' + formatCurrency(costo) + '</td>'
            + '<td style="color:' + (marg >= 0 ? 'var(--success)' : 'var(--danger)') + ';font-weight:600">' + formatCurrency(marg) + '</td>'
            + '</tr>';
    });
    tblAree.innerHTML = rowsHtml;

    document.getElementById('totFiliali').textContent = tFiliali;
    document.getElementById('totMaggiori').textContent = tMagg;
    document.getElementById('totMinori').textContent = tMin;
    document.getElementById('totConsegne').innerHTML = '<strong>' + tTot + '</strong>';
    document.getElementById('totFatturato').textContent = formatCurrency(tFatt);
    document.getElementById('totCostoDriver').textContent = formatCurrency(tCosto);
    document.getElementById('totMargine').innerHTML = '<strong style="color:' + (tMarg >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + formatCurrency(tMarg) + '</strong>';

    // ═══ Top 10 filiali (solo AVR) ═══
    var byFiliale = {};
    consegneAvr.forEach(function(c) {
        var key = c.filiale || '?';
        if (!byFiliale[key]) byFiliale[key] = { nome: c.filialeNome || key, area: c.area || '?', count: 0, fatturato: 0 };
        byFiliale[key].count++;
        var imp = c.importo || 0;
        if (c.tipo === 'ritorno' || c.tipo === 'pane_gastro_sushi') {
            byFiliale[key].fatturato += 6.90;
        } else {
            byFiliale[key].fatturato += imp >= 250 ? 10 : 6.90;
        }
    });

    var topFil = Object.entries(byFiliale).sort(function(a, b) { return b[1].count - a[1].count; }).slice(0, 10);
    document.getElementById('tblTopFiliali').innerHTML = topFil.map(function(e) {
        return '<tr><td>' + e[0] + ' ' + e[1].nome + '</td><td><span class="badge">' + e[1].area + '</span></td><td>' + e[1].count + '</td><td>' + formatCurrency(e[1].fatturato) + '</td></tr>';
    }).join('');

    // ═══ Performance driver (solo AVR) ═══
    var byDriver = {};
    consegneAvr.forEach(function(c) {
        var drv = normalizeDriverName(c.driver || c.rider);
        if (!drv) return;
        if (!byDriver[drv]) byDriver[drv] = { count: 0, filiali: new Set() };
        byDriver[drv].count++;
        byDriver[drv].filiali.add(c.filiale);
    });

    var topDrv = Object.entries(byDriver).sort(function(a, b) { return b[1].count - a[1].count; }).slice(0, 10);
    document.getElementById('tblTopDriver').innerHTML = topDrv.map(function(e) {
        var compenso = e[1].count * (state.costoPerConsegna || 3.50);
        return '<tr><td>' + e[0] + '</td><td>' + e[1].count + '</td><td>' + formatCurrency(compenso) + '</td><td>' + e[1].filiali.size + '</td></tr>';
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
    var consegneInt = allConsegne.filter(function(c) {
        var rider = c.driver || c.rider || '';
        if (!rider.trim()) return false;
        return !isDriverAvr(rider, avrSet);
    });

    if (consegneInt.length === 0) { toast('Nessuna consegna interna', 'warning'); return; }

    consegneInt.sort(function(a, b) {
        var fa = (a.filiale || '').localeCompare(b.filiale || '');
        if (fa !== 0) return fa;
        var da = a.data instanceof Date ? a.data.getTime() : 0;
        var db2 = b.data instanceof Date ? b.data.getTime() : 0;
        return da - db2;
    });

    var rows = [
        ['CONSEGNE INTERNE (NON AVR) — ' + meseLabel(mese)],
        ['Consegne effettuate da personale interno filiale, non da driver AVR Logistic'],
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
