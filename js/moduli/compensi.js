// DELIVERY HUB v2 — Compensi Driver (allineato con logica alias dashboard)

async function renderCompensi() {
    var mese = state.meseCorrente;
    var cm = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });
    var searchTerm = document.getElementById('searchCompensi') ? document.getElementById('searchCompensi').value.toUpperCase().trim() : '';

    // Usa report driver pre-caricati
    var driverReports = {};
    (state.reportDriver || []).forEach(function(d) {
        var drv = (d.driver || '').toUpperCase().trim();
        if (!drv) return;
        if (!driverReports[drv]) driverReports[drv] = 0;
        driverReports[drv] += (d.numConsegne || 0);
    });

    // Tutte le consegne del mese — normalizeDriverName esclude già PDV/interni
    var driverData = {};
    cm.forEach(function(c) {
        var drv = normalizeDriverName(c.driver || c.rider);
        if (!drv) return;
        if (!driverData[drv]) driverData[drv] = { count: 0 };
        driverData[drv].count++;
    });

    // Unisci driver da entrambe le fonti
    Object.keys(driverReports).forEach(function(drv) {
        if (!driverData[drv]) driverData[drv] = { count: 0 };
    });

    var rows = [];
    var totConsegne = 0, totConsegneDriver = 0, totLordo = 0, totDanni = 0, totNetto = 0;

    Object.entries(driverData).forEach(function(entry) {
        var drv = entry[0], data = entry[1];
        var anagrafica = findDriverAnagrafica(drv);
        var costo = anagrafica ? (anagrafica.costoConsegna || state.costoPerConsegna) : state.costoPerConsegna;
        var citta = anagrafica ? anagrafica.citta : '—';
        var consegneDecò = data.count;
        var consegneDriver = driverReports[drv] || 0;
        var diff = consegneDriver - consegneDecò;
        var lordo = consegneDecò * costo;

        var danniDriver = typeof calcolaDanniMese === 'function' ? calcolaDanniMese(drv, mese) : 0;

        var netto = lordo - danniDriver;
        totConsegne += consegneDecò;
        totConsegneDriver += consegneDriver;
        totLordo += lordo;
        totDanni += danniDriver;
        totNetto += netto;

        rows.push({
            drv: drv,
            citta: citta,
            consegneDecò: consegneDecò,
            consegneDriver: consegneDriver,
            diff: diff,
            lordo: lordo,
            danni: danniDriver,
            netto: netto
        });
    });

    rows.sort(function(a, b) { return b.consegneDecò - a.consegneDecò; });

    if (searchTerm) {
        rows = rows.filter(function(r) { return r.drv.toUpperCase().indexOf(searchTerm) >= 0; });
    }

    document.getElementById('compTotale').textContent = formatCurrency(totLordo);
    document.getElementById('compDanni').textContent = formatCurrency(totDanni);
    document.getElementById('compNetto').textContent = formatCurrency(totNetto);

    document.getElementById('tblCompensi').innerHTML = rows.map(function(r) {
        var diffColor = r.diff === 0 ? 'var(--text-muted)' : (r.diff > 0 ? 'var(--warning)' : 'var(--danger)');
        var diffText = r.diff === 0 ? '—' : (r.diff > 0 ? '+' + r.diff : r.diff);
        var diffBg = r.diff !== 0 ? 'background:rgba(245,158,11,0.04);' : '';

        return '<tr style="' + diffBg + '">' +
            '<td><strong>' + r.drv + '</strong></td>' +
            '<td><span class="badge badge-info">' + r.citta + '</span></td>' +
            '<td>' + r.consegneDecò + '</td>' +
            '<td>' + (r.consegneDriver > 0 ? r.consegneDriver : '<span style="color:var(--text-light)">—</span>') + '</td>' +
            '<td style="color:' + diffColor + ';font-weight:700">' + diffText + '</td>' +
            '<td>' + formatCurrency(r.lordo) + '</td>' +
            '<td style="color:' + (r.danni > 0 ? 'var(--danger)' : 'var(--text-muted)') + '">' + (r.danni > 0 ? '-' + formatCurrency(r.danni) : '—') + '</td>' +
            '<td><strong>' + formatCurrency(r.netto) + '</strong></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Nessun risultato</td></tr>';

    document.getElementById('compTotConsegne').textContent = totConsegne;
    document.getElementById('compTotConsegneDriver').textContent = totConsegneDriver;
    var totDiff = totConsegneDriver - totConsegne;
    document.getElementById('compTotDiff').textContent = totDiff === 0 ? '—' : (totDiff > 0 ? '+' + totDiff : totDiff);
    document.getElementById('compTotLordo').textContent = formatCurrency(totLordo);
    document.getElementById('compTotDanniTab').textContent = totDanni > 0 ? '-' + formatCurrency(totDanni) : '—';
    document.getElementById('compTotNettoTab').innerHTML = '<strong>' + formatCurrency(totNetto) + '</strong>';
}

function normalizeDriverName(name) {
    if (!name) return null;
    var n = name.toUpperCase().trim();
    var escludi = ['RITIRO PDV','PDV','PV','N/D','','-','INTERNA','UNICA',
        'GAETANO','SERGIO','ROBERTO','CAPUTO','DI BENEDETTO','GIANMARCO',
        'PICADACI','PRIVITERA','TEST1APP'];
    if (escludi.indexOf(n) >= 0) return null;
    // Usa la stessa mappa alias del dashboard
    if (typeof DRIVER_ALIAS !== 'undefined') {
        if (DRIVER_ALIAS[n]) return DRIVER_ALIAS[n];
        var noSpaces = n.replace(/\s+/g, '');
        if (DRIVER_ALIAS[noSpaces]) return DRIVER_ALIAS[noSpaces];
    }
    n = n.replace(/['\u2019`]/g, '');
    return n;
}

function findDriverAnagrafica(driverName) {
    if (!driverName) return null;
    var name = driverName.toUpperCase().trim();
    return state.driverList.find(function(d) {
        var full = (d.cognome + ' ' + d.nome).toUpperCase();
        var cognome = (d.cognome || '').toUpperCase();
        return name === full || name === cognome || name.indexOf(cognome) >= 0 || cognome.indexOf(name) >= 0;
    });
}

function exportCompensi() {
    var mese = state.meseCorrente;
    var cm = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });
    if (cm.length === 0) { toast('Nessun dato', 'warning'); return; }

    var rows = [
        ['COMPENSI DRIVER — ' + meseLabel(mese)],
        [],
        ['Driver', 'Città', 'Consegne Decò', 'Consegne Driver', 'Diff.', 'Lordo (€3,50×n)', 'Danni (rata mese)', 'Netto']
    ];

    var driverData = {};
    cm.forEach(function(c) {
        var drv = normalizeDriverName(c.driver || c.rider);
        if (!drv) return;
        if (!driverData[drv]) driverData[drv] = 0;
        driverData[drv]++;
    });

    Object.entries(driverData).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(entry) {
        var drv = entry[0], count = entry[1];
        var ana = findDriverAnagrafica(drv);
        var lordo = count * (ana ? (ana.costoConsegna || state.costoPerConsegna) : state.costoPerConsegna);
        var danni = typeof calcolaDanniMese === 'function' ? calcolaDanniMese(drv, mese) : 0;
        rows.push([drv, ana ? ana.citta : '—', count, '', '', lordo.toFixed(2), danni.toFixed(2), (lordo - danni).toFixed(2)]);
    });

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Compensi');
    XLSX.writeFile(wb, 'compensi_' + mese + '.xlsx');
    toast('File scaricato', 'success');
}
