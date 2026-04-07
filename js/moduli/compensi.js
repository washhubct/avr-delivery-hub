// DELIVERY HUB v2 — Compensi Driver (con ricerca e rate danni)

function renderCompensi() {
    var mese = state.meseCorrente;
    var cm = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });
    var searchTerm = document.getElementById('searchCompensi') ? document.getElementById('searchCompensi').value.toUpperCase().trim() : '';

    var driverData = {};
    cm.forEach(function(c) {
        var drv = normalizeDriverName(c.driver);
        if (!drv) return;
        if (!driverData[drv]) driverData[drv] = { count: 0, citta: '' };
        driverData[drv].count++;
    });

    var rows = [];
    var totConsegne = 0, totLordo = 0, totDanni = 0, totNetto = 0;

    Object.entries(driverData).forEach(function(entry) {
        var drv = entry[0], data = entry[1];
        var anagrafica = findDriverAnagrafica(drv);
        var costo = anagrafica ? (anagrafica.costoConsegna || state.costoPerConsegna) : state.costoPerConsegna;
        var citta = anagrafica ? anagrafica.citta : '—';
        var lordo = data.count * costo;

        var danniDriver = typeof calcolaDanniMese === 'function' ? calcolaDanniMese(drv, mese) : 0;

        var netto = lordo - danniDriver;
        totConsegne += data.count;
        totLordo += lordo;
        totDanni += danniDriver;
        totNetto += netto;

        rows.push({ drv: drv, citta: citta, count: data.count, lordo: lordo, danni: danniDriver, netto: netto });
    });

    rows.sort(function(a, b) { return b.count - a.count; });

    if (searchTerm) {
        rows = rows.filter(function(r) { return r.drv.toUpperCase().indexOf(searchTerm) >= 0; });
    }

    document.getElementById('compTotale').textContent = formatCurrency(totLordo);
    document.getElementById('compDanni').textContent = formatCurrency(totDanni);
    document.getElementById('compNetto').textContent = formatCurrency(totNetto);

    document.getElementById('tblCompensi').innerHTML = rows.map(function(r) {
        return '<tr>' +
            '<td><strong>' + r.drv + '</strong></td>' +
            '<td><span class="badge badge-info">' + r.citta + '</span></td>' +
            '<td>' + r.count + '</td>' +
            '<td>' + formatCurrency(r.lordo) + '</td>' +
            '<td style="color:' + (r.danni > 0 ? 'var(--danger)' : 'var(--text-muted)') + '">' + (r.danni > 0 ? '-' + formatCurrency(r.danni) : '—') + '</td>' +
            '<td><strong>' + formatCurrency(r.netto) + '</strong></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nessun risultato</td></tr>';

    document.getElementById('compTotConsegne').textContent = totConsegne;
    document.getElementById('compTotLordo').textContent = formatCurrency(totLordo);
    document.getElementById('compTotDanniTab').textContent = totDanni > 0 ? '-' + formatCurrency(totDanni) : '—';
    document.getElementById('compTotNettoTab').innerHTML = '<strong>' + formatCurrency(totNetto) + '</strong>';
}

function normalizeDriverName(name) {
    if (!name) return null;
    var n = name.toUpperCase().trim();
    if (n === 'RITIRO PDV' || n === 'N/D' || n === '') return null;
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
        ['Driver', 'Città', 'Consegne', 'Lordo (€3,50×n)', 'Danni (rata mese)', 'Netto']
    ];

    var driverData = {};
    cm.forEach(function(c) {
        var drv = normalizeDriverName(c.driver);
        if (!drv) return;
        if (!driverData[drv]) driverData[drv] = 0;
        driverData[drv]++;
    });

    Object.entries(driverData).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(entry) {
        var drv = entry[0], count = entry[1];
        var ana = findDriverAnagrafica(drv);
        var lordo = count * (ana ? (ana.costoConsegna || state.costoPerConsegna) : state.costoPerConsegna);
        var danni = typeof calcolaDanniMese === 'function' ? calcolaDanniMese(drv, mese) : 0;
        rows.push([drv, ana ? ana.citta : '—', count, lordo.toFixed(2), danni.toFixed(2), (lordo - danni).toFixed(2)]);
    });

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Compensi');
    XLSX.writeFile(wb, 'compensi_' + mese + '.xlsx');
    toast('File scaricato', 'success');
}
