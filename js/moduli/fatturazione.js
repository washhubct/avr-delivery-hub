// DELIVERY HUB v2 — Fatturazione per Filiale (solo consegne AVR — allineato con dashboard)
//
// Da MESE_PREZZO_FLAT (luglio 2026): €9,70 flat per consegna, senza
// distinzioni di volume. Le consegne con importo merce > €499 sono
// escluse dal calcolo e mostrate in una sezione dedicata: il loro
// prezzo si concorda e si inserisce a mano in fattura.
// Per i mesi precedenti resta lo schema storico €6,90 (<250) / €10 (≥250).

var MESE_PREZZO_FLAT = '2026-07';
var SOGLIA_SPECIALE = 499;
// PREZZO_FLAT / PREZZO_FLAT_FESTIVO / isGiornoFestivo in utils.js

function isSchemaFlat(mese) {
    return mese >= MESE_PREZZO_FLAT;
}

function fatDatiMese() {
    var mese = state.meseCorrente;
    var cm = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });
    var avrSet = buildDriverAvrSet();
    var cmAvr = cm.filter(function(c) { return isConsegnaAvr(c, avrSet); });
    return { mese: mese, cmAvr: cmAvr };
}

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
    var gruppo = state.aree[r.area] ? state.aree[r.area].gruppo : '';
    return '<tr style="background:rgba(34,197,94,0.05)"><td colspan="' + colspan + '" style="padding:10px 12px;font-weight:700;color:var(--accent);font-size:13px;text-transform:uppercase;letter-spacing:1px">' + r.area + ' — ' + areaName + '<span style="font-weight:400;color:var(--text-muted);margin-left:8px;font-size:11px;letter-spacing:0">' + gruppo + '</span></td></tr>';
}

function fatKpi(label, value, accent) {
    return '<div class="kpi-card' + (accent ? ' accent' : '') + '"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>';
}

function fatRiepilogoHtml(totImponibile, notaExtra) {
    var iva = totImponibile * 0.22;
    return '<div style="margin-top:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px">' +
        '<h4 style="margin-bottom:12px;color:var(--text)">Riepilogo Fattura</h4>' +
        (notaExtra || '') +
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
            '<span style="font-weight:800;color:var(--accent)">' + formatCurrency(totImponibile + iva) + '</span>' +
        '</div>' +
    '</div>';
}

function renderFatturazione() {
    var d = fatDatiMese();
    if (!d.mese) return;
    if (isSchemaFlat(d.mese)) renderFatturazioneFlat(d);
    else renderFatturazioneStorica(d);
    // Card fattura elettronica (js/moduli/fatturazione-fic.js)
    if (typeof renderFatturazioneFic === 'function') renderFatturazioneFic();
}

// ══════════════════════════════════════════════
// SCHEMA NUOVO (da luglio 2026): €9,70 flat + speciali >€499 a mano
// ══════════════════════════════════════════════
function renderFatturazioneFlat(d) {
    var cmAvr = d.cmAvr;

    var speciali = [];
    var filialiData = {};
    cmAvr.forEach(function(c) {
        var importo = parseFloat(c.importo) || 0;
        if (importo > SOGLIA_SPECIALE) { speciali.push(c); return; }
        var fil = String(c.filiale || '?').replace(/\.0$/, '');
        if (!filialiData[fil]) {
            filialiData[fil] = { filiale: fil, area: c.area || c.provincia || '?', count: 0, feriali: 0, festivi: 0, specialiCount: 0 };
        }
        filialiData[fil].count++;
        if (isGiornoFestivo(c.data)) filialiData[fil].festivi++; else filialiData[fil].feriali++;
    });
    // Conteggio speciali per filiale (solo informativo in tabella)
    speciali.forEach(function(c) {
        var fil = String(c.filiale || '?').replace(/\.0$/, '');
        if (!filialiData[fil]) {
            filialiData[fil] = { filiale: fil, area: c.area || c.provincia || '?', count: 0, feriali: 0, festivi: 0, specialiCount: 0 };
        }
        filialiData[fil].specialiCount++;
    });

    var righe = fatOrdinaSort(Object.values(filialiData));

    var totConsegne = 0, totFeriali = 0, totFestivi = 0, totFatt = 0, totSpeciali = speciali.length;
    righe.forEach(function(r) {
        r.fatt = r.feriali * PREZZO_FLAT + r.festivi * PREZZO_FLAT_FESTIVO;
        totConsegne += r.count;
        totFeriali += r.feriali;
        totFestivi += r.festivi;
        totFatt += r.fatt;
    });

    document.getElementById('fatDesc').innerHTML = 'Schema in vigore da luglio 2026: <strong>€9,70 per consegna feriale</strong>, <strong>€12,61 domeniche e festivi</strong> (+30%), senza distinzioni di volume, con <strong>fattura unica a F.lli Arena</strong> (Palermo inclusa). Le consegne con importo merce &gt; €499 sono elencate a parte e vanno prezzate a mano.';
    document.getElementById('fatKpiGrid').innerHTML =
        fatKpi('Feriali (×€9,70)', formatNumber(totFeriali)) +
        fatKpi('Festivi (×€12,61)', formatNumber(totFestivi)) +
        fatKpi('Fatturato automatico', formatCurrency(totFatt), true) +
        fatKpi('Speciali > €499', formatNumber(totSpeciali));

    document.getElementById('fatThead').innerHTML = '<tr>' +
        '<th>Filiale</th><th>Area</th>' +
        '<th style="text-align:right">Feriali</th>' +
        '<th style="text-align:right">Festivi</th>' +
        '<th style="text-align:right">Fatturato</th>' +
        '<th style="text-align:right">Speciali &gt;€499</th>' +
    '</tr>';

    var lastArea = '';
    var html = '';
    righe.forEach(function(r) {
        if (r.area !== lastArea) { html += fatAreaHeaderRow(r, 6); lastArea = r.area; }
        html += '<tr>' +
            '<td><strong>FILIALE ' + r.filiale + '</strong></td>' +
            '<td style="text-align:center">' + r.area + '</td>' +
            '<td style="text-align:right"><strong>' + r.feriali + '</strong></td>' +
            '<td style="text-align:right;color:' + (r.festivi > 0 ? 'var(--accent)' : 'var(--text-light)') + '">' + (r.festivi || '—') + '</td>' +
            '<td style="text-align:right"><strong>' + formatCurrency(r.fatt) + '</strong></td>' +
            '<td style="text-align:right;color:' + (r.specialiCount > 0 ? 'var(--warning)' : 'var(--text-light)') + '">' + (r.specialiCount || '—') + '</td>' +
        '</tr>';
    });
    document.getElementById('tblFattBody').innerHTML = html || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nessuna consegna nel mese</td></tr>';

    document.getElementById('fatTfoot').innerHTML = '<tr class="totals-row">' +
        '<td colspan="2"><strong>TOTALE</strong> <span style="font-weight:400;color:var(--text-muted)">(' + totConsegne + ' consegne)</span></td>' +
        '<td style="text-align:right"><strong>' + totFeriali + '</strong></td>' +
        '<td style="text-align:right"><strong>' + totFestivi + '</strong></td>' +
        '<td style="text-align:right"><strong>' + formatCurrency(totFatt) + '</strong></td>' +
        '<td style="text-align:right"><strong>' + (totSpeciali || '—') + '</strong></td>' +
    '</tr>';

    var nota = totSpeciali > 0
        ? '<div style="padding:8px 12px;margin-bottom:8px;background:#fef3c7;border-radius:8px;font-size:12px;color:#78350f">⚠️ Escluse <strong>' + totSpeciali + '</strong> consegne speciali &gt;€499 (vedi sezione sotto): il loro prezzo va aggiunto a mano.</div>'
        : '';
    document.getElementById('fatRiepilogo').innerHTML = fatRiepilogoHtml(totFatt, nota);

    // Sezione dettaglio speciali
    var card = document.getElementById('cardSpeciali499');
    if (speciali.length === 0) {
        card.style.display = 'none';
    } else {
        card.style.display = 'block';
        speciali.sort(function(a, b) {
            var fa = String(a.filiale || '').localeCompare(String(b.filiale || ''));
            if (fa !== 0) return fa;
            return (parseFloat(b.importo) || 0) - (parseFloat(a.importo) || 0);
        });
        document.getElementById('tblSpeciali499').innerHTML = speciali.map(function(c) {
            return '<tr>' +
                '<td>' + formatDate(c.data) + '</td>' +
                '<td><strong>' + escapeHtml(String(c.filiale || '—')) + '</strong></td>' +
                '<td>' + escapeHtml(c.cliente || c.cognome || '—') + '</td>' +
                '<td>' + escapeHtml(c.citta || '—') + '</td>' +
                '<td style="text-align:right"><strong>' + formatCurrency(c.importo) + '</strong></td>' +
                '<td>' + escapeHtml((c.driver || c.rider || '—')) + '</td>' +
            '</tr>';
        }).join('');
    }
}

// ══════════════════════════════════════════════
// SCHEMA STORICO (fino a giugno 2026): €6,90 <250 / €10 ≥250
// ══════════════════════════════════════════════
function renderFatturazioneStorica(d) {
    var cmAvr = d.cmAvr;
    document.getElementById('cardSpeciali499').style.display = 'none';

    var filialiData = {};
    cmAvr.forEach(function(c) {
        var fil = String(c.filiale || '?').replace(/\.0$/, '');
        if (!filialiData[fil]) {
            filialiData[fil] = { filiale: fil, area: c.area || c.provincia || '?', sotto250: 0, sopra250: 0 };
        }
        var importo = parseFloat(c.importo) || 0;
        if (importo >= 250.00) filialiData[fil].sopra250++;
        else filialiData[fil].sotto250++;
    });

    var righe = fatOrdinaSort(Object.values(filialiData));

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

    document.getElementById('fatDesc').innerHTML = 'Schema storico (fino a giugno 2026): consegne &lt;€250 a €6,90 e ≥€250,01 a €10,00.';
    document.getElementById('fatKpiGrid').innerHTML =
        fatKpi('Consegne <€250 (×€6,90)', formatNumber(totSotto)) +
        fatKpi('Fatturato <€250', formatCurrency(totFattSotto), true) +
        fatKpi('Consegne ≥€250,01 (×€10)', formatNumber(totSopra)) +
        fatKpi('Fatturato ≥€250,01', formatCurrency(totFattSopra), true);

    document.getElementById('fatThead').innerHTML = '<tr>' +
        '<th>Filiale</th><th>Area</th>' +
        '<th style="text-align:right">&lt;€250</th><th style="text-align:right">Fatt. (×€6,90)</th>' +
        '<th style="text-align:right">≥€250,01</th><th style="text-align:right">Fatt. (×€10)</th>' +
        '<th style="text-align:right">Tot. consegne</th><th style="text-align:right">Tot. fatturato</th>' +
    '</tr>';

    var lastArea = '';
    var html = '';
    righe.forEach(function(r) {
        if (r.area !== lastArea) { html += fatAreaHeaderRow(r, 8); lastArea = r.area; }
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
    document.getElementById('tblFattBody').innerHTML = html || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Nessuna consegna nel mese</td></tr>';

    var totImponibile = totFattSotto + totFattSopra;
    document.getElementById('fatTfoot').innerHTML = '<tr class="totals-row">' +
        '<td colspan="2"><strong>TOTALE</strong></td>' +
        '<td style="text-align:right">' + totSotto + '</td>' +
        '<td style="text-align:right">' + formatCurrency(totFattSotto) + '</td>' +
        '<td style="text-align:right">' + totSopra + '</td>' +
        '<td style="text-align:right">' + formatCurrency(totFattSopra) + '</td>' +
        '<td style="text-align:right"><strong>' + (totSotto + totSopra) + '</strong></td>' +
        '<td style="text-align:right"><strong>' + formatCurrency(totImponibile) + '</strong></td>' +
    '</tr>';

    document.getElementById('fatRiepilogo').innerHTML = fatRiepilogoHtml(totImponibile, '');
}

// ══════════════════════════════════════════════
// EXPORT XLSX
// ══════════════════════════════════════════════
function exportFatturazione() {
    var d = fatDatiMese();
    if (d.cmAvr.length === 0) { toast('Nessun dato', 'warning'); return; }
    if (isSchemaFlat(d.mese)) exportFatturazioneFlat(d);
    else exportFatturazioneStorica(d);
}

function exportFatturazioneFlat(d) {
    var mese = d.mese;
    var speciali = [];
    var filialiData = {};
    d.cmAvr.forEach(function(c) {
        var importo = parseFloat(c.importo) || 0;
        if (importo > SOGLIA_SPECIALE) { speciali.push(c); return; }
        var fil = String(c.filiale || '?').replace(/\.0$/, '');
        if (!filialiData[fil]) filialiData[fil] = { filiale: fil, area: c.area || '?', count: 0, feriali: 0, festivi: 0 };
        filialiData[fil].count++;
        if (isGiornoFestivo(c.data)) filialiData[fil].festivi++; else filialiData[fil].feriali++;
    });
    var righe = fatOrdinaSort(Object.values(filialiData));

    var rows = [
        ['FATTURAZIONE — ' + meseLabel(mese)],
        ['Schema da luglio 2026: €9,70 feriali / €12,61 domeniche e festivi — speciali >€499 su foglio separato'],
        [],
        ['Prodotto', 'Quantità', 'Prezzo unitario', 'Importo (netto)', 'IVA']
    ];
    var totImponibile = 0;
    righe.forEach(function(r) {
        if (r.count === 0) return;
        if (r.feriali > 0) {
            var nettoFer = r.feriali * PREZZO_FLAT;
            rows.push(['FILIALE ' + r.filiale + ' — feriali', r.feriali, PREZZO_FLAT.toFixed(2).replace('.', ','), nettoFer.toFixed(2), '22%']);
            totImponibile += nettoFer;
        }
        if (r.festivi > 0) {
            var nettoFes = r.festivi * PREZZO_FLAT_FESTIVO;
            rows.push(['FILIALE ' + r.filiale + ' — festivi', r.festivi, PREZZO_FLAT_FESTIVO.toFixed(2).replace('.', ','), nettoFes.toFixed(2), '22%']);
            totImponibile += nettoFes;
        }
    });
    var iva = totImponibile * 0.22;
    rows.push([]);
    rows.push(['Totale imponibile (escluse speciali)', '', '', totImponibile.toFixed(2), '']);
    rows.push(['IVA 22%', '', '', iva.toFixed(2), '']);
    rows.push(['TOTALE DA PAGARE (escluse speciali)', '', '', (totImponibile + iva).toFixed(2), '']);
    if (speciali.length > 0) {
        rows.push([]);
        rows.push(['⚠ ' + speciali.length + ' consegne speciali >€499 nel foglio "Speciali" — prezzo da inserire a mano']);
    }

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 15 }, { wch: 18 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Fattura');

    if (speciali.length > 0) {
        var spRows = [
            ['CONSEGNE SPECIALI > €499 — ' + meseLabel(mese)],
            ['Prezzo da concordare e inserire a mano'],
            [],
            ['Data', 'Filiale', 'Cliente', 'Città', 'Importo merce', 'Driver', 'PREZZO CONSEGNA (da compilare)']
        ];
        speciali.forEach(function(c) {
            var dataStr = c.data instanceof Date ? c.data.toLocaleDateString('it-IT') : String(c.data || '');
            spRows.push([dataStr, c.filiale || '', c.cliente || c.cognome || '', c.citta || '', (parseFloat(c.importo) || 0).toFixed(2), (c.driver || c.rider || ''), '']);
        });
        var ws2 = XLSX.utils.aoa_to_sheet(spRows);
        ws2['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 26 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Speciali');
    }

    XLSX.writeFile(wb, 'fattura_' + mese + '.xlsx');
    toast('File fattura scaricato', 'success');
}

function exportFatturazioneStorica(d) {
    var mese = d.mese;
    var filialiData = {};
    d.cmAvr.forEach(function(c) {
        var fil = String(c.filiale || '?').replace(/\.0$/, '');
        if (!filialiData[fil]) filialiData[fil] = { filiale: fil, area: c.area || '?', sotto250: 0, sopra250: 0 };
        var importo = parseFloat(c.importo) || 0;
        if (importo >= 250.00) filialiData[fil].sopra250++;
        else filialiData[fil].sotto250++;
    });
    var righe = fatOrdinaSort(Object.values(filialiData));

    var rows = [
        ['FATTURAZIONE — ' + meseLabel(mese)],
        ['Formato fattura Fratelli Arena / Palermo Retail (schema storico)'],
        [],
        ['Prodotto', 'Quantità', 'Prezzo unitario', 'Importo (netto)', 'IVA']
    ];
    var totImponibile = 0;
    righe.forEach(function(r) {
        if (r.sotto250 > 0) {
            var netto1 = r.sotto250 * 6.90;
            rows.push(['FILIALE ' + r.filiale, r.sotto250, '6,90', netto1.toFixed(2), '22%']);
            totImponibile += netto1;
        }
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
    ws['!cols'] = [{ wch: 35 }, { wch: 12 }, { wch: 15 }, { wch: 18 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Fattura');
    XLSX.writeFile(wb, 'fattura_' + mese + '.xlsx');
    toast('File fattura scaricato', 'success');
}
