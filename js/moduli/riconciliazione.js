// DELIVERY HUB v2 — Riconciliazione (Driver App vs Decò Sheets)

async function runRiconciliazione() {
    var mese = state.meseCorrente;
    if (!mese) { toast('Seleziona un mese', 'warning'); return; }

    var container = document.getElementById('riconResults');
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">Caricamento dati...</p>';

    // 1. Carica report driver per questo mese
    var reportSnap;
    var reportLoadError = false;
    try {
        reportSnap = await db.collection('reportDriver')
            .where('mese', '==', mese)
            .get();
    } catch(e) {
        reportSnap = { docs: [] };
        reportLoadError = true;
        console.error('Riconciliazione: errore caricamento reportDriver', e);
    }

    var reportDriver = {};
    reportSnap.docs.forEach(function(doc) {
        var r = doc.data();
        var drv = (r.driver || '').toUpperCase().trim();
        if (!drv) return;
        if (!reportDriver[drv]) reportDriver[drv] = {};
        var fil = String(r.filiale || '?');
        if (!reportDriver[drv][fil]) reportDriver[drv][fil] = 0;
        reportDriver[drv][fil] += (r.numConsegne || 0);
    });

    // 2. Dati Decò (dalle consegne GAS-synced)
    var consegneGAS = state.consegne.filter(function(c) {
        return meseFromDate(c.data) === mese && c.fonte === 'GAS';
    });

    var decoPerDriver = {};
    consegneGAS.forEach(function(c) {
        var drv = typeof normalizeDriverName === 'function'
            ? normalizeDriverName(c.driver || '')
            : (c.driver || '').toUpperCase().trim();
        if (!drv) return;
        if (!decoPerDriver[drv]) decoPerDriver[drv] = {};
        var fil = String(c.filiale || '?');
        if (!decoPerDriver[drv][fil]) decoPerDriver[drv][fil] = 0;
        decoPerDriver[drv][fil]++;
    });

    // 3. Merge tutti i driver
    var tuttiDriver = {};
    Object.keys(reportDriver).forEach(function(d) { tuttiDriver[d] = true; });
    Object.keys(decoPerDriver).forEach(function(d) { tuttiDriver[d] = true; });

    var driverList = Object.keys(tuttiDriver).sort();

    if (driverList.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">' +
            '<div style="font-size:40px;margin-bottom:8px">📭</div>' +
            '<p>Nessun dato per ' + meseLabel(mese) + '</p>' +
            '<p style="font-size:12px;margin-top:4px">I driver devono usare l\'app e il GAS deve sincronizzare i dati Decò</p></div>';
        return;
    }

    // 4. Calcola totali
    var totDriverApp = 0, totDeco = 0, totDiff = 0;
    var righe = [];

    driverList.forEach(function(drv) {
        var appData = reportDriver[drv] || {};
        var decoData = decoPerDriver[drv] || {};

        // Merge filiali
        var filiali = {};
        Object.keys(appData).forEach(function(f) { filiali[f] = true; });
        Object.keys(decoData).forEach(function(f) { filiali[f] = true; });

        var drvTotApp = 0, drvTotDeco = 0;
        var dettaglio = [];

        Object.keys(filiali).sort().forEach(function(fil) {
            var app = appData[fil] || 0;
            var deco = decoData[fil] || 0;
            var diff = app - deco;
            drvTotApp += app;
            drvTotDeco += deco;

            if (app > 0 || deco > 0) {
                dettaglio.push({ filiale: fil, app: app, deco: deco, diff: diff });
            }
        });

        var drvDiff = drvTotApp - drvTotDeco;
        totDriverApp += drvTotApp;
        totDeco += drvTotDeco;
        totDiff += drvDiff;

        righe.push({
            driver: drv,
            totApp: drvTotApp,
            totDeco: drvTotDeco,
            diff: drvDiff,
            dettaglio: dettaglio,
            stato: drvDiff === 0 ? 'ok' : (Math.abs(drvDiff) <= 2 ? 'warning' : 'error')
        });
    });

    // 5. Render
    var html = '';

    // KPI
    html += '<div class="kpi-grid" style="margin:16px 0">' +
        '<div class="kpi-card"><div class="kpi-label">Report driver (app)</div><div class="kpi-value">' + formatNumber(totDriverApp) + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">Dati Decò (sheets)</div><div class="kpi-value">' + formatNumber(totDeco) + '</div></div>' +
        '<div class="kpi-card ' + (totDiff === 0 ? 'accent' : '') + '"><div class="kpi-label">Differenza</div><div class="kpi-value" style="color:' + (totDiff === 0 ? 'var(--success)' : 'var(--danger)') + '">' + (totDiff > 0 ? '+' : '') + totDiff + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">Driver confrontati</div><div class="kpi-value">' + driverList.length + '</div></div>' +
    '</div>';

    // Legenda
    html += '<div style="display:flex;gap:12px;margin-bottom:16px;font-size:12px">' +
        '<span><span class="badge badge-ok">●</span> Coincide</span>' +
        '<span><span class="badge badge-warn">●</span> Lieve differenza (±2)</span>' +
        '<span><span class="badge badge-err">●</span> Discrepanza</span>' +
    '</div>';

    // Tabella
    html += '<div class="table-wrap"><table class="data-table">' +
        '<thead><tr><th>Driver</th><th style="text-align:right">App driver</th><th style="text-align:right">Decò sheets</th><th style="text-align:right">Differenza</th><th>Stato</th><th>Dettaglio</th></tr></thead><tbody>';

    righe.sort(function(a, b) {
        var order = { error: 0, warning: 1, ok: 2 };
        return (order[a.stato] || 2) - (order[b.stato] || 2);
    });

    righe.forEach(function(r) {
        var badgeClass = r.stato === 'ok' ? 'badge-ok' : r.stato === 'warning' ? 'badge-warn' : 'badge-err';
        var statoLabel = r.stato === 'ok' ? 'OK' : r.stato === 'warning' ? 'Verifica' : 'Discrepanza';
        var diffColor = r.diff === 0 ? 'var(--success)' : 'var(--danger)';
        var diffText = r.diff === 0 ? '0' : (r.diff > 0 ? '+' + r.diff : String(r.diff));

        var driverSafe = escapeHtml(r.driver);
        var meseSafe = escapeHtml(mese);
        html += '<tr>' +
            '<td><strong>' + driverSafe + '</strong></td>' +
            '<td style="text-align:right">' + r.totApp + '</td>' +
            '<td style="text-align:right">' + r.totDeco + '</td>' +
            '<td style="text-align:right;color:' + diffColor + ';font-weight:700">' + diffText + '</td>' +
            '<td><span class="badge ' + badgeClass + '">' + statoLabel + '</span></td>' +
            '<td><button class="btn btn-sm" onclick="mostraDettaglioRicon(\'' + driverSafe + '\', \'' + meseSafe + '\')">👁️</button></td>' +
        '</tr>';
    });

    html += '</tbody>' +
        '<tfoot><tr class="totals-row">' +
            '<td><strong>TOTALE</strong></td>' +
            '<td style="text-align:right"><strong>' + totDriverApp + '</strong></td>' +
            '<td style="text-align:right"><strong>' + totDeco + '</strong></td>' +
            '<td style="text-align:right;color:' + (totDiff === 0 ? 'var(--success)' : 'var(--danger)') + ';font-weight:700">' + (totDiff > 0 ? '+' : '') + totDiff + '</td>' +
            '<td colspan="2"></td>' +
        '</tr></tfoot></table></div>';

    // Info
    if (reportLoadError) {
        html = '<div style="background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:16px;margin-bottom:16px">' +
            '<strong style="color:#dc2626">⚠️ Errore caricamento dati app driver</strong>' +
            '<p style="color:var(--text-muted);font-size:13px;margin-top:4px">Impossibile leggere i report dell\'app driver. La colonna "App driver" mostra 0 per tutti — il confronto non è affidabile. Ricarica la pagina e riprova.</p></div>' + html;
    } else if (totDriverApp === 0) {
        html += '<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:16px;margin-top:16px">' +
            '<strong style="color:var(--warning)">Nessun report dai driver</strong>' +
            '<p style="color:var(--text-muted);font-size:13px;margin-top:4px">I driver non hanno ancora utilizzato l\'app per registrare le consegne di ' + meseLabel(mese) + '. La colonna "App driver" mostra 0 per tutti.</p></div>';
    }

    container.innerHTML = html;
}

function mostraDettaglioRicon(driver, mese) {
    // Ricarica i dati per questo driver
    var consegneGAS = state.consegne.filter(function(c) {
        return meseFromDate(c.data) === mese && c.fonte === 'GAS' &&
            (c.driver || '').toUpperCase().trim() === driver;
    });

    // Raggruppa per filiale e giorno
    var perFiliale = {};
    consegneGAS.forEach(function(c) {
        var fil = String(c.filiale || '?');
        if (!perFiliale[fil]) perFiliale[fil] = { count: 0, giorni: {} };
        perFiliale[fil].count++;
        var giorno = c.data instanceof Date ? c.data.toISOString().slice(0, 10) : (c.data || '').substring(0, 10);
        if (!perFiliale[fil].giorni[giorno]) perFiliale[fil].giorni[giorno] = 0;
        perFiliale[fil].giorni[giorno]++;
    });

    var html = '<div style="margin-bottom:12px;font-size:14px">Dettaglio consegne <strong>' + driver + '</strong> — ' + meseLabel(mese) + '</div>';

    // Per filiale
    var filiali = Object.keys(perFiliale).sort();
    if (filiali.length === 0) {
        html += '<p style="color:var(--text-muted)">Nessuna consegna Decò trovata per questo driver.</p>';
    } else {
        filiali.forEach(function(fil) {
            var data = perFiliale[fil];
            html += '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px">' +
                '<div style="display:flex;justify-content:space-between;margin-bottom:6px">' +
                    '<strong>Filiale ' + fil + '</strong>' +
                    '<span style="color:var(--accent);font-weight:700">' + data.count + ' consegne</span>' +
                '</div>';

            // Giorni
            var giorni = Object.keys(data.giorni).sort();
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
            giorni.forEach(function(g) {
                var parts = g.split('-');
                var label = parts[2] + '/' + parts[1];
                html += '<span style="font-size:11px;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:4px;padding:2px 6px">' + label + ': ' + data.giorni[g] + '</span>';
            });
            html += '</div></div>';
        });
    }

    openModal('Riconciliazione — ' + driver, html);
}

function exportRiconciliazione() {
    var mese = state.meseCorrente;
    toast('Export riconciliazione per ' + meseLabel(mese) + '...', 'info');

    // Simile alla logica di runRiconciliazione ma esporta in xlsx
    var consegneGAS = state.consegne.filter(function(c) {
        return meseFromDate(c.data) === mese && c.fonte === 'GAS';
    });

    var decoPerDriver = {};
    consegneGAS.forEach(function(c) {
        var drv = (c.driver || 'N/D').toUpperCase().trim();
        if (!decoPerDriver[drv]) decoPerDriver[drv] = {};
        var fil = String(c.filiale || '?');
        if (!decoPerDriver[drv][fil]) decoPerDriver[drv][fil] = 0;
        decoPerDriver[drv][fil]++;
    });

    var rows = [
        ['RICONCILIAZIONE — ' + meseLabel(mese)],
        ['Driver vs Decò Google Sheets'],
        [],
        ['Driver', 'Filiale', 'Consegne Decò', 'Note']
    ];

    Object.keys(decoPerDriver).sort().forEach(function(drv) {
        var filiali = decoPerDriver[drv];
        var first = true;
        Object.keys(filiali).sort().forEach(function(fil) {
            rows.push([first ? drv : '', fil, filiali[fil], '']);
            first = false;
        });
    });

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 15 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Riconciliazione');
    XLSX.writeFile(wb, 'riconciliazione_' + mese + '.xlsx');
    toast('File scaricato', 'success');
}
