// DELIVERY HUB v2 — Fatturazione per Filiale (formato fattura Fratelli Arena)

function renderFatturazione() {
    var mese = state.meseCorrente;
    if (!mese) return;
    var cm = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });

    // Raggruppa per filiale
    var filialiData = {};
    cm.forEach(function(c) {
        var fil = String(c.filiale || '?').replace(/\.0$/, '');
        if (!filialiData[fil]) {
            filialiData[fil] = { 
                filiale: fil, 
                area: c.area || c.provincia || '?',
                sotto250: 0,    // consegne con importo < 250.01 (a €6,90)
                sopra250: 0     // consegne con importo >= 250.01 (a €10,00)
            };
        }
        var importo = parseFloat(c.importo) || 0;
        if (importo >= 250.01) {
            filialiData[fil].sopra250++;
        } else {
            filialiData[fil].sotto250++;
        }
    });

    // Ordina per area poi per codice filiale
    var areeOrdine = ['CT', 'EN', 'ME', 'SR', 'PA'];
    var righe = Object.values(filialiData).sort(function(a, b) {
        var idxA = areeOrdine.indexOf(a.area);
        var idxB = areeOrdine.indexOf(b.area);
        if (idxA === -1) idxA = 99;
        if (idxB === -1) idxB = 99;
        if (idxA !== idxB) return idxA - idxB;
        return parseInt(a.filiale) - parseInt(b.filiale);
    });

    // Calcola totali
    var totSotto = 0, totSopra = 0, totFattSotto = 0, totFattSopra = 0;
    righe.forEach(function(r) {
        r.fattSotto = r.sotto250 * 6.90;
        r.fattSopra = r.sopra250 * 10.00;
        r.fattTotale = r.fattSotto + r.fattSopra;
        r.consegneTotale = r.sotto250 + r.sopra250;
        totSotto += r.sotto250;
        totSopra += r.sopra250;
        totFattSotto += r.fattSotto;
        totFattSopra += r.fattSopra;
    });

    var totImponibile = totFattSotto + totFattSopra;
    var iva = totImponibile * 0.22;
    var totLordo = totImponibile + iva;

    // KPI
    document.getElementById('fatOrdinarie').textContent = formatNumber(totSotto);
    document.getElementById('fatFattOrdinarie').textContent = formatCurrency(totFattSotto);
    document.getElementById('fatSpeciali').textContent = formatNumber(totSopra);
    document.getElementById('fatFattSpeciali').textContent = formatCurrency(totFattSopra);

    // Tabella per filiale
    var lastArea = '';
    var html = '';
    righe.forEach(function(r) {
        // Riga separatore area
        if (r.area !== lastArea) {
            var areaName = state.aree[r.area] ? state.aree[r.area].nome : r.area;
            var gruppo = state.aree[r.area] ? state.aree[r.area].gruppo : '';
            html += '<tr style="background:rgba(34,197,94,0.05)"><td colspan="8" style="padding:10px 12px;font-weight:700;color:var(--accent);font-size:13px;text-transform:uppercase;letter-spacing:1px">' + r.area + ' — ' + areaName + '<span style="font-weight:400;color:var(--text-muted);margin-left:8px;font-size:11px;letter-spacing:0">' + gruppo + '</span></td></tr>';
            lastArea = r.area;
        }

        html += '<tr>' +
            '<td><strong>FILIALE ' + r.filiale + '</strong></td>' +
            '<td style="text-align:center">' + r.area + '</td>' +
            '<td style="text-align:right">' + r.sotto250 + '</td>' +
            '<td style="text-align:right">' + formatCurrency(r.fattSotto) + '</td>' +
            '<td style="text-align:right">' + r.sopra250 + '</td>' +
            '<td style="text-align:right">' + formatCurrency(r.fattSopra) + '</td>' +
            '<td style="text-align:right"><strong>' + r.consegneTotale + '</strong></td>' +
            '<td style="text-align:right"><strong>' + formatCurrency(r.fattTotale) + '</strong></td>' +
        '</tr>';
    });

    document.getElementById('tblFattBody').innerHTML = html;

    // Totali footer
    document.getElementById('fatTotSotto').textContent = totSotto;
    document.getElementById('fatTotFattSotto').textContent = formatCurrency(totFattSotto);
    document.getElementById('fatTotSopra').textContent = totSopra;
    document.getElementById('fatTotFattSopra').textContent = formatCurrency(totFattSopra);
    document.getElementById('fatTotConsegne').innerHTML = '<strong>' + (totSotto + totSopra) + '</strong>';
    document.getElementById('fatTotTotale').innerHTML = '<strong>' + formatCurrency(totImponibile) + '</strong>';

    // Riepilogo fattura
    document.getElementById('fatRiepilogo').innerHTML = 
        '<div style="margin-top:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px">' +
            '<h4 style="margin-bottom:12px;color:var(--text)">Riepilogo Fattura</h4>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">' +
                '<span style="color:var(--text-muted)">Totale imponibile</span>' +
                '<span style="font-weight:600">' + formatCurrency(totImponibile) + '</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">' +
                '<span style="color:var(--text-muted)">IVA 22%</span>' +
                '<span style="font-weight:600">' + formatCurrency(iva) + '</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px">' +
                '<span style="font-weight:700;color:var(--accent)">Totale da pagare</span>' +
                '<span style="font-weight:800;color:var(--accent)">' + formatCurrency(totLordo) + '</span>' +
            '</div>' +
        '</div>';
}

function exportFatturazione() {
    var mese = state.meseCorrente;
    var cm = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });
    if (cm.length === 0) { toast('Nessun dato', 'warning'); return; }

    // Raggruppa per filiale
    var filialiData = {};
    cm.forEach(function(c) {
        var fil = String(c.filiale || '?').replace(/\.0$/, '');
        if (!filialiData[fil]) {
            filialiData[fil] = { filiale: fil, area: c.area || '?', sotto250: 0, sopra250: 0 };
        }
        var importo = parseFloat(c.importo) || 0;
        if (importo >= 250.01) {
            filialiData[fil].sopra250++;
        } else {
            filialiData[fil].sotto250++;
        }
    });

    var areeOrdine = ['CT', 'EN', 'ME', 'SR', 'PA'];
    var righe = Object.values(filialiData).sort(function(a, b) {
        var idxA = areeOrdine.indexOf(a.area); if (idxA === -1) idxA = 99;
        var idxB = areeOrdine.indexOf(b.area); if (idxB === -1) idxB = 99;
        if (idxA !== idxB) return idxA - idxB;
        return parseInt(a.filiale) - parseInt(b.filiale);
    });

    var rows = [
        ['FATTURAZIONE — ' + meseLabel(mese)],
        ['Formato fattura Fratelli Arena / Palermo Retail'],
        [],
        ['Prodotto', 'Quantità', 'Prezzo unitario', 'Importo (netto)', 'IVA']
    ];

    var totImponibile = 0;
    righe.forEach(function(r) {
        // Riga consegne < 250
        if (r.sotto250 > 0) {
            var netto1 = r.sotto250 * 6.90;
            rows.push(['FILIALE ' + r.filiale, r.sotto250, '6,90', netto1.toFixed(2), '22%']);
            totImponibile += netto1;
        }
        // Riga consegne >= 250.01
        if (r.sopra250 > 0) {
            var netto2 = r.sopra250 * 10.00;
            rows.push(['FILIALE ' + r.filiale + ' CONSEGNE 250,01', r.sopra250, '10,00', netto2.toFixed(2), '22%']);
            totImponibile += netto2;
        }
    });

    var iva = totImponibile * 0.22;
    rows.push([]);
    rows.push(['Totale imponibile', '', '', totImponibile.toFixed(2), '']);
    rows.push(['IVA 22%', '', '', iva.toFixed(2), '']);
    rows.push(['TOTALE DA PAGARE', '', '', (totImponibile + iva).toFixed(2), '']);

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    
    // Imposta larghezza colonne
    ws['!cols'] = [
        { wch: 35 },
        { wch: 12 },
        { wch: 15 },
        { wch: 18 },
        { wch: 8 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Fattura');
    XLSX.writeFile(wb, 'fattura_' + mese + '.xlsx');
    toast('File fattura scaricato', 'success');
}
