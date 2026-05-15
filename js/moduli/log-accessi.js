// DELIVERY HUB v2 — Log Accessi (con supporto accessi driver app)

async function renderLogAccessi() {
    var tbody = document.getElementById('tblLogAccessi');
    var searchTerm = document.getElementById('searchLog') ? document.getElementById('searchLog').value.toUpperCase().trim() : '';
    var filterRuolo = document.getElementById('filterRuolo') ? document.getElementById('filterRuolo').value : '';
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:40px">Caricamento...</td></tr>';

    try {
        // Carica log da ENTRAMBE le collection: accessLog (dashboard) e driverAccessLog (app driver)
        var queries = [
            db.collection('accessLog').orderBy('timestamp', 'desc').limit(200).get()
        ];

        // Prova anche la collection dei log driver app
        queries.push(
            db.collection('driverAccessLog').orderBy('timestamp', 'desc').limit(200).get().catch(function() { return null; })
        );

        var results = await Promise.all(queries);
        var rows = [];

        // Log dashboard
        if (results[0] && !results[0].empty) {
            results[0].forEach(function(doc) {
                var d = doc.data();
                d._source = 'dashboard';
                rows.push(d);
            });
        }

        // Log app driver
        if (results[1] && !results[1].empty) {
            results[1].forEach(function(doc) {
                var d = doc.data();
                d._source = 'driver-app';
                if (!d.ruolo) d.ruolo = 'driver';
                if (!d.dispositivo) d.dispositivo = 'Mobile';
                rows.push(d);
            });
        }

        // Ordina tutti per timestamp desc
        rows.sort(function(a, b) {
            var ta = a.timestamp ? a.timestamp.toDate().getTime() : 0;
            var tb = b.timestamp ? b.timestamp.toDate().getTime() : 0;
            return tb - ta;
        });

        // Filtri
        if (searchTerm) {
            rows = rows.filter(function(r) {
                return (r.email || '').toUpperCase().indexOf(searchTerm) >= 0 ||
                       (r.nome || '').toUpperCase().indexOf(searchTerm) >= 0 ||
                       (r.cognome || '').toUpperCase().indexOf(searchTerm) >= 0;
            });
        }
        if (filterRuolo) {
            rows = rows.filter(function(r) { return r.ruolo === filterRuolo; });
        }

        updateLogStats(rows);

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:40px">Nessun risultato</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function(r) {
            var ts = r.timestamp ? r.timestamp.toDate() : null;
            var dataOra = ts ? ts.toLocaleDateString('it-IT', {day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + ts.toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'}) : r.data || '—';

            var ruoloBadge = 'badge-info';
            var ruoloLabel = r.ruolo || '—';
            if (r.ruolo === 'superadmin') { ruoloBadge = 'badge-warn'; ruoloLabel = 'Admin'; }
            else if (r.ruolo === 'staff') { ruoloBadge = 'badge-ok'; ruoloLabel = 'Staff'; }
            else if (r.ruolo === 'driver') { ruoloBadge = 'badge-info'; ruoloLabel = 'Driver'; }

            var deviceIcon = r.dispositivo === 'Mobile' ? '📱' : '💻';

            // Sorgente: dashboard o app driver
            var sourceLabel = r._source === 'driver-app'
                ? '<span class="badge" style="font-size:9px;padding:2px 6px;background:rgba(99,102,241,0.1);color:var(--primary)">APP</span>'
                : '<span class="badge" style="font-size:9px;padding:2px 6px">WEB</span>';

            return '<tr>' +
                '<td>' + dataOra + '</td>' +
                '<td><strong>' + (r.email || '—') + '</strong></td>' +
                '<td><span class="badge ' + ruoloBadge + '">' + ruoloLabel + '</span></td>' +
                '<td>' + deviceIcon + ' ' + (r.dispositivo || '—') + '</td>' +
                '<td>' + sourceLabel + '</td>' +
                '<td style="font-size:11px;color:var(--text-light)">' + (r.data || '—') + '</td>' +
            '</tr>';
        }).join('');
    } catch (e) {
        console.error('renderLogAccessi error:', e);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger)">Errore caricamento log — riprova</td></tr>';
    }
}

function updateLogStats(rows) {
    var oggi = new Date().toLocaleDateString('it-IT', {day:'2-digit',month:'2-digit',year:'numeric'});
    var accessiOggi = rows.filter(function(r) { return r.data === oggi; }).length;
    var driverUnici = new Set(rows.filter(function(r) { return r.ruolo === 'driver'; }).map(function(r) { return r.email; })).size;
    var totaleAccessi = rows.length;

    var driverLoggati = new Set(rows.filter(function(r) { return r.ruolo === 'driver'; }).map(function(r) { return r.email; }));
    var driverTotali = state.driverList ? state.driverList.filter(function(d) { return d.email; }).length : 0;
    var maiLoggati = driverTotali - driverLoggati.size;
    if (maiLoggati < 0) maiLoggati = 0;

    document.getElementById('logAccessiOggi').textContent = accessiOggi;
    document.getElementById('logDriverUnici').textContent = driverUnici;
    document.getElementById('logTotale').textContent = totaleAccessi;
    document.getElementById('logMaiLoggati').textContent = maiLoggati;
}
