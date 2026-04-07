// DELIVERY HUB v2 — Log Accessi

async function renderLogAccessi() {
    var tbody = document.getElementById('tblLogAccessi');
    var searchTerm = document.getElementById('searchLog') ? document.getElementById('searchLog').value.toUpperCase().trim() : '';
    var filterRuolo = document.getElementById('filterRuolo') ? document.getElementById('filterRuolo').value : '';

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:40px">Caricamento...</td></tr>';

    try {
        var query = db.collection('accessLog').orderBy('timestamp', 'desc').limit(200);
        var snap = await query.get();

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:40px">Nessun accesso registrato</td></tr>';
            updateLogStats([]);
            return;
        }

        var rows = [];
        snap.forEach(function(doc) {
            var d = doc.data();
            rows.push(d);
        });

        // Filtri
        if (searchTerm) {
            rows = rows.filter(function(r) {
                return (r.email || '').toUpperCase().indexOf(searchTerm) >= 0;
            });
        }
        if (filterRuolo) {
            rows = rows.filter(function(r) { return r.ruolo === filterRuolo; });
        }

        updateLogStats(rows);

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:40px">Nessun risultato</td></tr>';
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

            return '<tr>' +
                '<td>' + dataOra + '</td>' +
                '<td><strong>' + (r.email || '—') + '</strong></td>' +
                '<td><span class="badge ' + ruoloBadge + '">' + ruoloLabel + '</span></td>' +
                '<td>' + deviceIcon + ' ' + (r.dispositivo || '—') + '</td>' +
                '<td style="font-size:11px;color:var(--text-light)">' + (r.data || '—') + '</td>' +
            '</tr>';
        }).join('');

    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger)">Errore: ' + e.message + '</td></tr>';
    }
}

function updateLogStats(rows) {
    var oggi = new Date().toLocaleDateString('it-IT', {day:'2-digit',month:'2-digit',year:'numeric'});

    var accessiOggi = rows.filter(function(r) { return r.data === oggi; }).length;
    var driverUnici = new Set(rows.filter(function(r) { return r.ruolo === 'driver'; }).map(function(r) { return r.email; })).size;
    var totaleAccessi = rows.length;

    // Driver che non hanno MAI fatto login
    var driverLoggati = new Set(rows.filter(function(r) { return r.ruolo === 'driver'; }).map(function(r) { return r.email; }));
    var driverTotali = state.driverList ? state.driverList.filter(function(d) { return d.email; }).length : 0;
    var maiLoggati = driverTotali - driverLoggati.size;
    if (maiLoggati < 0) maiLoggati = 0;

    document.getElementById('logAccessiOggi').textContent = accessiOggi;
    document.getElementById('logDriverUnici').textContent = driverUnici;
    document.getElementById('logTotale').textContent = totaleAccessi;
    document.getElementById('logMaiLoggati').textContent = maiLoggati;
}
