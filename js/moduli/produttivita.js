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

function fmtMinuti(min) {
    if (min == null || isNaN(min)) return '—';
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ' min';
}

function prodAggrega() {
    var perDriver = {};
    (state.reportDriver || []).forEach(function(r) {
        var drv = normalizeDriverName(r.driver || '');
        if (!drv) return;
        var day = prodToDay(r.data);
        if (!day) return;

        if (!perDriver[drv]) perDriver[drv] = { giorni: {}, consegne: 0, minuti: 0, consegneConTempo: 0 };
        var pd = perDriver[drv];
        if (!pd.giorni[day]) pd.giorni[day] = { consegne: 0, minuti: 0, consegneConTempo: 0, fasce: 0 };
        var g = pd.giorni[day];

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
    return perDriver;
}

function renderProduttivita() {
    var perDriver = prodAggrega();
    var searchEl = document.getElementById('searchProduttivita');
    var searchTerm = searchEl ? searchEl.value.toUpperCase().trim() : '';
    var oggi = new Date().toISOString().slice(0, 10);

    var rows = Object.keys(perDriver).map(function(drv) {
        var pd = perDriver[drv];
        var giorni = Object.keys(pd.giorni).sort().reverse();
        var ana = findDriverAnagrafica(drv);
        return {
            drv: drv,
            citta: ana ? ana.citta : '—',
            nGiorni: giorni.length,
            consegne: pd.consegne,
            mediaGiorno: giorni.length ? pd.consegne / giorni.length : 0,
            tempoMedio: pd.consegneConTempo > 0 ? pd.minuti / pd.consegneConTempo : null,
            copertura: pd.consegne > 0 ? Math.round(pd.consegneConTempo / pd.consegne * 100) : 0,
            oggi: pd.giorni[oggi] ? pd.giorni[oggi].consegne : 0,
            giorniDetail: giorni.map(function(d) { return Object.assign({ day: d }, pd.giorni[d]); })
        };
    });

    rows.sort(function(a, b) { return b.consegne - a.consegne; });

    // KPI globali
    var totConsegne = 0, totMinuti = 0, totConTempo = 0, attiviOggi = 0;
    rows.forEach(function(r) {
        totConsegne += r.consegne;
        if (r.oggi > 0) attiviOggi++;
        r.giorniDetail.forEach(function(g) { totMinuti += g.minuti; totConTempo += g.consegneConTempo; });
    });
    document.getElementById('prodTotConsegne').textContent = formatNumber(totConsegne);
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
        var html = '<tr style="cursor:pointer" onclick="prodToggle(\'' + key + '\')">' +
            '<td>' + (isOpen ? '▼' : '▶') + ' <strong>' + r.drv + '</strong></td>' +
            '<td><span class="badge badge-info">' + r.citta + '</span></td>' +
            '<td>' + r.oggi + '</td>' +
            '<td>' + r.nGiorni + '</td>' +
            '<td>' + r.consegne + '</td>' +
            '<td>' + r.mediaGiorno.toFixed(1) + '</td>' +
            '<td style="color:' + tempoColor + ';font-weight:700">' + fmtMinuti(r.tempoMedio) + '</td>' +
            '<td style="color:' + (r.copertura < 80 ? 'var(--warning)' : 'var(--text-muted)') + '">' + r.copertura + '%</td>' +
        '</tr>';
        if (isOpen) {
            html += '<tr><td colspan="8" style="padding:0;background:var(--bg, #f8fafc)">' +
                '<table class="data-table" style="margin:8px 16px;width:calc(100% - 32px)">' +
                '<thead><tr><th>Giorno</th><th>Fasce</th><th>Consegne</th><th>Tempo in giro</th><th>Tempo medio/consegna</th></tr></thead><tbody>' +
                r.giorniDetail.map(function(g) {
                    var media = g.consegneConTempo > 0 ? g.minuti / g.consegneConTempo : null;
                    var dd = new Date(g.day + 'T12:00:00');
                    var label = dd.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
                    return '<tr>' +
                        '<td>' + label + (g.day === new Date().toISOString().slice(0,10) ? ' <span class="badge badge-info">oggi</span>' : '') + '</td>' +
                        '<td>' + g.fasce + '</td>' +
                        '<td><strong>' + g.consegne + '</strong></td>' +
                        '<td>' + (g.minuti > 0 ? fmtMinuti(g.minuti) : '—') + '</td>' +
                        '<td>' + fmtMinuti(media) + '</td>' +
                    '</tr>';
                }).join('') +
                '</tbody></table></td></tr>';
        }
        return html;
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Nessun report driver per questo mese</td></tr>';
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
        ['Driver', 'Giorni attivi', 'Consegne totali', 'Media consegne/giorno', 'Tempo medio per consegna (min)', 'Copertura orari %']
    ];
    var giornaliero = [
        ['DETTAGLIO GIORNALIERO — ' + meseLabel(mese)],
        [],
        ['Driver', 'Giorno', 'Fasce', 'Consegne', 'Minuti in giro', 'Tempo medio per consegna (min)']
    ];

    drivers.sort().forEach(function(drv) {
        var pd = perDriver[drv];
        var giorni = Object.keys(pd.giorni).sort();
        var tempoMedio = pd.consegneConTempo > 0 ? (pd.minuti / pd.consegneConTempo) : null;
        riepilogo.push([
            drv, giorni.length, pd.consegne,
            giorni.length ? +(pd.consegne / giorni.length).toFixed(1) : 0,
            tempoMedio != null ? +tempoMedio.toFixed(1) : '',
            pd.consegne > 0 ? Math.round(pd.consegneConTempo / pd.consegne * 100) : 0
        ]);
        giorni.forEach(function(day) {
            var g = pd.giorni[day];
            var m = g.consegneConTempo > 0 ? +(g.minuti / g.consegneConTempo).toFixed(1) : '';
            giornaliero.push([drv, day, g.fasce, g.consegne, g.minuti || '', m]);
        });
    });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riepilogo), 'Riepilogo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(giornaliero), 'Giornaliero');
    XLSX.writeFile(wb, 'produttivita_' + mese + '.xlsx');
    toast('File scaricato', 'success');
}
