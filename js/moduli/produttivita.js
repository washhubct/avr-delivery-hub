// DELIVERY HUB v2 — Produttività Driver (admin only)
// Monitoraggio giornaliero: consegne/giorno e tempo per singola consegna.
// Fonte: reportDriver (app driver) — campi oraInizio/oraFine/durataMin/tempoMedioMin.
// Nuova logica post-assunzione: i driver sono dipendenti a stipendio fisso,
// quindi non si calcolano più compensi a consegna ma si monitora la produttività.

var prodExpanded = {};

function prodToDay(d) {
    if (!d) return null;
    if (d.toDate) d = d.toDate();
    else if (d.seconds != null) d = new Date(d.seconds * 1000);
    else if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d)) return null;
    return d.toISOString().slice(0, 10);
}

// Oggi in TZ Europe/Rome (toISOString è UTC: slitterebbe tra 00:00 e le 02:00)
function prodOggiRoma() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function fmtMinuti(min) {
    if (min == null || isNaN(min)) return '—';
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ' min';
}

function prodAggrega() {
    var perDriver = {};

    function ensure(drv) {
        if (!perDriver[drv]) perDriver[drv] = { giorni: {}, consegne: 0, deco: 0, minuti: 0, consegneConTempo: 0 };
        return perDriver[drv];
    }
    function ensureDay(pd, day) {
        if (!pd.giorni[day]) pd.giorni[day] = { consegne: 0, deco: 0, minuti: 0, consegneConTempo: 0, fasce: 0 };
        return pd.giorni[day];
    }

    // Solo driver censiti in anagrafica: la colonna rider dei fogli Decò
    // contiene anche note libere ("FATTA 25/7", "?") che non sono driver.
    // Il nome mostrato è sempre il cognome anagrafica (unifica le varianti).
    function drvAnagrafica(nome) {
        var drv = normalizeDriverName(nome || '');
        if (!drv) return null;
        var anag = findDriverAnagrafica(drv);
        return anag ? (anag.cognome || drv).toUpperCase().trim() : null;
    }

    // ── Fonte 1: report dei driver dall'app (con orari giro) ──
    (state.reportDriver || []).forEach(function(r) {
        var drv = drvAnagrafica(r.driver);
        if (!drv) return;
        var day = prodToDay(r.data);
        if (!day) return;

        var pd = ensure(drv);
        var g = ensureDay(pd, day);

        var n = r.numConsegne || 0;
        pd.consegne += n;
        g.consegne += n;
        g.fasce++;
        if (r.durataMin > 0 && n > 0) {
            pd.minuti += r.durataMin;
            pd.consegneConTempo += n;
            g.minuti += r.durataMin;
            g.consegneConTempo += n;
        }
    });

    // ── Fonte 2: consegne dai fogli Decò (sync GAS) — per confronto ──
    var mese = state.meseCorrente;
    (state.consegne || []).forEach(function(c) {
        if (meseFromDate(c.data) !== mese) return;
        if (c.tipo === 'ritorno') return;
        var drv = drvAnagrafica(c.driver || c.rider);
        if (!drv) return;
        var day = prodToDay(c.data);
        if (!day) return;
        var pd = ensure(drv);
        pd.deco++;
        ensureDay(pd, day).deco++;
    });

    return perDriver;
}

function renderProduttivita() {
    var perDriver = prodAggrega();
    var searchEl = document.getElementById('searchProduttivita');
    var searchTerm = searchEl ? searchEl.value.toUpperCase().trim() : '';
    var oggi = prodOggiRoma();

    var rows = Object.keys(perDriver).map(function(drv) {
        var pd = perDriver[drv];
        var giorni = Object.keys(pd.giorni).sort().reverse();
        var ana = findDriverAnagrafica(drv);
        return {
            drv: drv,
            citta: ana ? ana.citta : '—',
            nGiorni: giorni.length,
            consegne: pd.consegne,
            deco: pd.deco,
            diff: pd.consegne - pd.deco,
            mediaGiorno: giorni.length ? pd.consegne / giorni.length : 0,
            tempoMedio: pd.consegneConTempo > 0 ? pd.minuti / pd.consegneConTempo : null,
            copertura: pd.consegne > 0 ? Math.round(pd.consegneConTempo / pd.consegne * 100) : 0,
            oggi: pd.giorni[oggi] ? pd.giorni[oggi].consegne : 0,
            giorniDetail: giorni.map(function(d) { return Object.assign({ day: d }, pd.giorni[d]); })
        };
    });

    rows.sort(function(a, b) { return (b.consegne || b.deco) - (a.consegne || a.deco); });

    // KPI globali
    var totConsegne = 0, totDeco = 0, totMinuti = 0, totConTempo = 0, attiviOggi = 0;
    rows.forEach(function(r) {
        totConsegne += r.consegne;
        totDeco += r.deco;
        if (r.oggi > 0) attiviOggi++;
        r.giorniDetail.forEach(function(g) { totMinuti += g.minuti; totConTempo += g.consegneConTempo; });
    });
    document.getElementById('prodTotConsegne').textContent = formatNumber(totConsegne);
    document.getElementById('prodTotDeco').textContent = formatNumber(totDeco);
    var totDiff = totConsegne - totDeco;
    document.getElementById('prodTotDiff').innerHTML = totDiff === 0
        ? '<span style="color:var(--success, #16a34a)">allineate ✓</span>'
        : '<span style="color:var(--warning)">' + (totDiff > 0 ? '+' + totDiff : totDiff) + ' vs app driver</span>';
    document.getElementById('prodTempoMedio').textContent = totConTempo > 0 ? fmtMinuti(totMinuti / totConTempo) : '—';
    document.getElementById('prodAttiviOggi').textContent = attiviOggi;
    document.getElementById('prodCopertura').textContent = totConsegne > 0 ? Math.round(totConTempo / totConsegne * 100) + '%' : '—';

    if (searchTerm) {
        rows = rows.filter(function(r) { return r.drv.indexOf(searchTerm) >= 0; });
    }

    document.getElementById('tblProduttivita').innerHTML = rows.map(function(r) {
        var key = r.drv.replace(/[^A-Z0-9]/g, '_');
        var isOpen = !!prodExpanded[key];
        var tempoColor = r.tempoMedio == null ? 'var(--text-light)' : (r.tempoMedio > 30 ? 'var(--danger)' : (r.tempoMedio > 20 ? 'var(--warning)' : 'var(--success, #16a34a)'));
        var diffHtml = prodDiffHtml(r.diff, r.deco);
        var html = '<tr style="cursor:pointer" onclick="prodToggle(\'' + key + '\')">' +
            '<td>' + (isOpen ? '▼' : '▶') + ' <strong>' + escapeHtml(r.drv) + '</strong></td>' +
            '<td><span class="badge badge-info">' + escapeHtml(r.citta) + '</span></td>' +
            '<td>' + r.oggi + '</td>' +
            '<td>' + r.nGiorni + '</td>' +
            '<td><strong>' + r.consegne + '</strong></td>' +
            '<td>' + r.deco + '</td>' +
            '<td>' + diffHtml + '</td>' +
            '<td>' + r.mediaGiorno.toFixed(1) + '</td>' +
            '<td style="color:' + tempoColor + ';font-weight:700">' + fmtMinuti(r.tempoMedio) + '</td>' +
            '<td style="color:' + (r.copertura < 80 ? 'var(--warning)' : 'var(--text-muted)') + '">' + r.copertura + '%</td>' +
        '</tr>';
        if (isOpen) {
            html += '<tr><td colspan="10" style="padding:0;background:var(--bg, #f8fafc)">' +
                '<table class="data-table" style="margin:8px 16px;width:calc(100% - 32px)">' +
                '<thead><tr><th>Giorno</th><th>Fasce</th><th>App driver</th><th>File Decò</th><th>Diff.</th><th>Tempo in giro</th><th>Tempo medio/consegna</th></tr></thead><tbody>' +
                r.giorniDetail.map(function(g) {
                    var media = g.consegneConTempo > 0 ? g.minuti / g.consegneConTempo : null;
                    var dd = new Date(g.day + 'T12:00:00');
                    var label = dd.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
                    return '<tr>' +
                        '<td>' + label + (g.day === oggi ? ' <span class="badge badge-info">oggi</span>' : '') + '</td>' +
                        '<td>' + g.fasce + '</td>' +
                        '<td><strong>' + g.consegne + '</strong></td>' +
                        '<td>' + g.deco + '</td>' +
                        '<td>' + prodDiffHtml(g.consegne - g.deco, g.deco) + '</td>' +
                        '<td>' + (g.minuti > 0 ? fmtMinuti(g.minuti) : '—') + '</td>' +
                        '<td>' + fmtMinuti(media) + '</td>' +
                    '</tr>';
                }).join('') +
                '</tbody></table></td></tr>';
        }
        return html;
    }).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--text-muted)">Nessun report driver per questo mese</td></tr>';
}

// Differenza app driver vs file Decò: 0 = allineati, + = il driver ha
// segnato più consegne dei fogli, − = ne ha segnate meno
function prodDiffHtml(diff, deco) {
    if (diff === 0) return '<span style="color:var(--success, #16a34a)">✓</span>';
    var color = Math.abs(diff) > Math.max(2, deco * 0.1) ? 'var(--danger)' : 'var(--warning)';
    return '<span style="color:' + color + ';font-weight:700">' + (diff > 0 ? '+' + diff : diff) + '</span>';
}

function prodToggle(key) {
    prodExpanded[key] = !prodExpanded[key];
    renderProduttivita();
}

function exportProduttivita() {
    var perDriver = prodAggrega();
    var drivers = Object.keys(perDriver);
    if (!drivers.length) { toast('Nessun dato', 'warning'); return; }
    var mese = state.meseCorrente;

    var riepilogo = [
        ['PRODUTTIVITÀ DRIVER — ' + meseLabel(mese)],
        [],
        ['Driver', 'Giorni attivi', 'Consegne app driver', 'Consegne file Decò', 'Differenza', 'Media consegne/giorno', 'Tempo medio per consegna (min)', 'Copertura orari %']
    ];
    var giornaliero = [
        ['DETTAGLIO GIORNALIERO — ' + meseLabel(mese)],
        [],
        ['Driver', 'Giorno', 'Fasce', 'Consegne app', 'Consegne Decò', 'Differenza', 'Minuti in giro', 'Tempo medio per consegna (min)']
    ];

    drivers.sort().forEach(function(drv) {
        var pd = perDriver[drv];
        var giorni = Object.keys(pd.giorni).sort();
        var tempoMedio = pd.consegneConTempo > 0 ? (pd.minuti / pd.consegneConTempo) : null;
        riepilogo.push([
            drv, giorni.length, pd.consegne, pd.deco, pd.consegne - pd.deco,
            giorni.length ? +(pd.consegne / giorni.length).toFixed(1) : 0,
            tempoMedio != null ? +tempoMedio.toFixed(1) : '',
            pd.consegne > 0 ? Math.round(pd.consegneConTempo / pd.consegne * 100) : 0
        ]);
        giorni.forEach(function(day) {
            var g = pd.giorni[day];
            var m = g.consegneConTempo > 0 ? +(g.minuti / g.consegneConTempo).toFixed(1) : '';
            giornaliero.push([drv, day, g.fasce, g.consegne, g.deco, g.consegne - g.deco, g.minuti || '', m]);
        });
    });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riepilogo), 'Riepilogo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(giornaliero), 'Giornaliero');
    XLSX.writeFile(wb, 'produttivita_' + mese + '.xlsx');
    toast('File scaricato', 'success');
}
