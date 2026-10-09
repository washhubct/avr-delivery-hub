// DELIVERY HUB v2 — Fatturazione per Filiale
// Fonte: rapporti giornalieri dell'app driver (reportDriver), non più i fogli Decò.
// Serve come PRE-FATTURA: quante consegne ci aspettiamo che Arena riconosca
// e il fatturato atteso con il listino flat (€9,70 feriali / €12,61 festivi).
// La fattura elettronica vera si genera dal file mensile Arena nella card
// sotto (js/moduli/fatturazione-fic.js): qui si confronta e si contesta.

function fatOrdinaSort(righe) {
    var areeOrdine = ['CT', 'EN', 'ME', 'SR', 'PA'];
    return righe.sort(function(a, b) {
        var idxA = areeOrdine.indexOf(a.area); if (idxA === -1) idxA = 99;
        var idxB = areeOrdine.indexOf(b.area); if (idxB === -1) idxB = 99;
        if (idxA !== idxB) return idxA - idxB;
        return parseInt(a.filiale) - parseInt(b.filiale);
    });
}

function fatAreaHeaderRow(r, colspan) {
    var areaName = state.aree[r.area] ? state.aree[r.area].nome : r.area;
    return '<tr style="background:rgba(34,197,94,0.05)"><td colspan="' + colspan + '" style="padding:10px 12px;font-weight:700;color:var(--accent);font-size:13px;text-transform:uppercase;letter-spacing:1px">' + r.area + ' — ' + areaName + '</td></tr>';
}

function fatKpi(label, value, accent) {
    return '<div class="kpi-card' + (accent ? ' accent' : '') + '"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
}

// Righe per filiale dai rapporti del mese
function fatRighePerFiliale(rapporti) {
    var filialiData = {};
    rapporti.forEach(function(r) {
        if (!filialiData[r.filiale]) filialiData[r.filiale] = { filiale: r.filiale, nome: r.filialeNome, area: r.area, feriali: 0, festivi: 0, giorni: {}, driver: {} };
        var f = filialiData[r.filiale];
        if (r.festivo) f.festivi += r.n; else f.feriali += r.n;
        f.giorni[r.ymd] = true;
        if (r.driverEmail) f.driver[r.driverEmail] = true;
    });
    var righe = fatOrdinaSort(Object.values(filialiData));
    righe.forEach(function(r) {
        r.count = r.feriali + r.festivi;
        r.fatt = r.feriali * PREZZO_FLAT + r.festivi * PREZZO_FLAT_FESTIVO;
        r.nGiorni = Object.keys(r.giorni).length;
        r.nDriver = Object.keys(r.driver).length;
    });
    return righe;
}

function renderFatturazione() {
    var mese = state.meseCorrente;
    if (!mese) return;
    var rapporti = rapportiMese(mese);
    var righe = fatRighePerFiliale(rapporti);
    var tot = fatturatoAttesoRapporti(rapporti);

    document.getElementById('fatDesc').innerHTML = 'Consegne registrate dai driver nell\'app, valorizzate col listino in vigore da luglio 2026: <strong>€9,70 feriali</strong>, <strong>€12,61 domeniche e festivi</strong>, fattura unica a F.lli Arena. È il fatturato <strong>atteso</strong>: la fattura si emette dal file mensile Arena (card sotto) e qui si verifica che i conteggi tornino. Le consegne speciali &gt;€499 non passano dall\'app e arrivano solo dal file Arena.';
    document.getElementById('fatKpiGrid').innerHTML =
        fatKpi('Feriali (×€9,70)', formatNumber(tot.feriali)) +
        fatKpi('Festivi (×€12,61)', formatNumber(tot.festivi)) +
        fatKpi('Fatturato atteso', formatCurrency(tot.imponibile), true) +
        fatKpi('Rapporti driver', formatNumber(rapporti.length));

    document.getElementById('fatThead').innerHTML = '<tr>' +
        '<th>Filiale</th><th>Area</th>' +
        '<th style="text-align:right">Feriali</th>' +
        '<th style="text-align:right">Festivi</th>' +
        '<th style="text-align:right">Totale</th>' +
        '<th style="text-align:right">Fatturato atteso</th>' +
        '<th style="text-align:right">Giorni · driver</th>' +
    '</tr>';

    var lastArea = '', html = '';
    righe.forEach(function(r) {
        if (r.area !== lastArea) { html += fatAreaHeaderRow(r, 7); lastArea = r.area; }
        html += '<tr>' +
            '<td><strong>' + escapeHtml(r.filiale) + '</strong> ' + escapeHtml(r.nome) + '</td>' +
            '<td style="text-align:center">' + r.area + '</td>' +
            '<td style="text-align:right"><strong>' + r.feriali + '</strong></td>' +
            '<td style="text-align:right;color:' + (r.festivi > 0 ? 'var(--accent)' : 'var(--text-light)') + '">' + (r.festivi || '—') + '</td>' +
            '<td style="text-align:right">' + r.count + '</td>' +
            '<td style="text-align:right"><strong>' + formatCurrency(r.fatt) + '</strong></td>' +
            '<td style="text-align:right;color:var(--text-muted)">' + r.nGiorni + ' · ' + r.nDriver + '</td>' +
        '</tr>';
    });
    document.getElementById('tblFattBody').innerHTML = html || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">Nessun rapporto driver nel mese</td></tr>';

    document.getElementById('fatTfoot').innerHTML = '<tr class="totals-row">' +
        '<td colspan="2"><strong>TOTALE</strong> <span style="font-weight:400;color:var(--text-muted)">(' + righe.length + ' filiali)</span></td>' +
        '<td style="text-align:right"><strong>' + tot.feriali + '</strong></td>' +
        '<td style="text-align:right"><strong>' + tot.festivi + '</strong></td>' +
        '<td style="text-align:right"><strong>' + tot.consegne + '</strong></td>' +
        '<td style="text-align:right"><strong>' + formatCurrency(tot.imponibile) + '</strong></td>' +
        '<td></td>' +
    '</tr>';

    var iva = tot.imponibile * 0.22;
    document.getElementById('fatRiepilogo').innerHTML =
        '<div style="margin-top:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px">' +
            '<h4 style="margin-bottom:12px;color:var(--text)">Fattura attesa (escluse speciali &gt;€499)</h4>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text-muted)">Imponibile</span><span style="font-weight:600">' + formatCurrency(tot.imponibile) + '</span></div>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text-muted)">IVA 22%</span><span style="font-weight:600">' + formatCurrency(iva) + '</span></div>' +
            '<div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px"><span style="font-weight:700;color:var(--accent)">Totale atteso</span><span style="font-weight:800;color:var(--accent)">' + formatCurrency(tot.imponibile + iva) + '</span></div>' +
        '</div>';

    var card = document.getElementById('cardSpeciali499');
    if (card) card.style.display = 'none';

    // Card fattura elettronica (js/moduli/fatturazione-fic.js)
    if (typeof renderFatturazioneFic === 'function') renderFatturazioneFic();
}

// Export xlsx della pre-fattura (per confronto col file Arena)
function exportFatturazione() {
    var mese = state.meseCorrente;
    var rapporti = rapportiMese(mese);
    if (!rapporti.length) { toast('Nessun rapporto nel mese', 'warning'); return; }
    var righe = fatRighePerFiliale(rapporti);
    var rows = [
        ['PRE-FATTURA DA RAPPORTI APP DRIVER — ' + meseLabel(mese)],
        ['Listino da luglio 2026: €9,70 feriali / €12,61 domeniche e festivi — speciali >€499 non incluse (solo da file Arena)'],
        [],
        ['Prodotto', 'Quantità', 'Prezzo unitario', 'Importo (netto)', 'IVA']
    ];
    var totImponibile = 0;
    righe.forEach(function(r) {
        if (r.feriali > 0) { var nf = r.feriali * PREZZO_FLAT; rows.push(['FILIALE ' + r.filiale + ' ' + r.nome + ' — feriali', r.feriali, PREZZO_FLAT.toFixed(2).replace('.', ','), nf.toFixed(2), '22%']); totImponibile += nf; }
        if (r.festivi > 0) { var ns = r.festivi * PREZZO_FLAT_FESTIVO; rows.push(['FILIALE ' + r.filiale + ' ' + r.nome + ' — festivi', r.festivi, PREZZO_FLAT_FESTIVO.toFixed(2).replace('.', ','), ns.toFixed(2), '22%']); totImponibile += ns; }
    });
    var iva = totImponibile * 0.22;
    rows.push([]);
    rows.push(['Totale imponibile', '', '', totImponibile.toFixed(2), '']);
    rows.push(['IVA 22%', '', '', iva.toFixed(2), '']);
    rows.push(['TOTALE ATTESO', '', '', (totImponibile + iva).toFixed(2), '']);

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 44 }, { wch: 12 }, { wch: 15 }, { wch: 18 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Pre-fattura');

    // Dettaglio giornaliero per filiale: utile per contestare un conteggio Arena
    var det = [['Giorno', 'Filiale', 'Nome', 'Area', 'Festivo', 'Driver', 'Consegne']];
    rapporti.sort(function(a, b) { return a.ymd.localeCompare(b.ymd) || a.filiale.localeCompare(b.filiale); }).forEach(function(r) {
        det.push([r.ymd.split('-').reverse().join('/'), r.filiale, r.filialeNome, r.area, r.festivo ? 'sì' : '', r.driver, r.n]);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(det);
    ws2['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 6 }, { wch: 8 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Dettaglio giorni');
    XLSX.writeFile(wb, 'prefattura_' + mese + '.xlsx');
    toast('File scaricato', 'success');
}
