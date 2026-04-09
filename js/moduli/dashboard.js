// DELIVERY HUB v2 — Dashboard (con supporto tipoDriver avr/interna)

function renderDashboard() {
    var mese = state.meseCorrente;
    var allConsegne = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });

    // Separa AVR da interne
    var consegneAvr = allConsegne.filter(function(c) { return c.tipoDriver !== 'interna'; });
    var consegneInt = allConsegne.filter(function(c) { return c.tipoDriver === 'interna'; });

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
