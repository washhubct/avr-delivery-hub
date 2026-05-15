// DELIVERY HUB v2 — Segnalazioni Admin Module

async function renderSegnalazioniAdmin() {
    var searchTerm = document.getElementById('searchSegnalazioni') ? document.getElementById('searchSegnalazioni').value.toUpperCase().trim() : '';
    var filterStato = document.getElementById('filterSegStato') ? document.getElementById('filterSegStato').value : '';
    var tbody = document.getElementById('tblSegnalazioni');

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Caricamento...</td></tr>';

    try {
        var snap = await db.collection('segnalazioni').orderBy('timestamp', 'desc').limit(200).get();
        var rows = [];
        var aperte = 0, risolte = 0;

        snap.forEach(function(doc) {
            var d = doc.data();
            d.id = doc.id;

            if (d.stato === 'aperta') aperte++;
            if (d.stato === 'risolta') risolte++;

            // Filtro ricerca
            if (searchTerm) {
                var haystack = ((d.driver || '') + ' ' + (d.driverNome || '') + ' ' + (d.filialeNome || '') + ' ' + (d.filiale || '') + ' ' + (d.tipoLabel || '')).toUpperCase();
                if (haystack.indexOf(searchTerm) < 0) return;
            }
            // Filtro stato
            if (filterStato && d.stato !== filterStato) return;

            rows.push(d);
        });

        // KPI
        document.getElementById('segAperte').textContent = aperte;
        document.getElementById('segRisolte').textContent = risolte;

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Nessuna segnalazione</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function(d) {
            var statoBadge = d.stato === 'risolta' ? 'badge-ok' : 'badge-warn';
            var statoLabel = d.stato === 'risolta' ? 'Risolta' : 'Aperta';
            var descShort = (d.descrizione || '').length > 60 ? d.descrizione.substring(0, 60) + '...' : (d.descrizione || '—');
            var fotoLink = d.foto ? ' <span title="Ha una foto allegata">📷</span>' : '';

            return '<tr>' +
                '<td>' + (d.data || '—') + '</td>' +
                '<td><strong>' + (d.driverNome || d.driver || '—') + '</strong></td>' +
                '<td><span class="badge badge-info">' + (d.tipoLabel || d.tipo || '—') + '</span></td>' +
                '<td>' + (d.filialeNome || d.filiale || '—') + '</td>' +
                '<td>' + descShort + fotoLink + '</td>' +
                '<td><span class="badge ' + statoBadge + '">' + statoLabel + '</span></td>' +
                '<td>' +
                    (d.stato !== 'risolta' ?
                        '<button class="btn btn-sm" onclick="risolviSegnalazione(\'' + d.id + '\')">✓ Risolvi</button>' :
                        '') +
                    ' <button class="btn btn-sm" onclick="dettaglioSegnalazione(\'' + d.id + '\')">👁️</button>' +
                '</td>' +
            '</tr>';
        }).join('');

    } catch (e) {
        console.error('renderSegnalazioniAdmin error:', e);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger)">Errore caricamento dati — riprova</td></tr>';
    }
}

async function risolviSegnalazione(id) {
    if (!state.user) { toast('Sessione scaduta — ricarica la pagina', 'error'); return; }
    if (!confirm('Segnare questa segnalazione come risolta?')) return;
    try {
        await db.collection('segnalazioni').doc(id).update({
            stato: 'risolta',
            risoltaDa: state.user.email,
            risoltaIl: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast('Segnalazione risolta', 'success');
        renderSegnalazioniAdmin();
    } catch (e) {
        toast('Errore: impossibile aggiornare la segnalazione', 'error');
        console.error('risolviSegnalazione error:', e);
    }
}

async function dettaglioSegnalazione(id) {
    try {
        var doc = await db.collection('segnalazioni').doc(id).get();
        if (!doc.exists) { toast('Segnalazione non trovata', 'error'); return; }
        var d = doc.data();

        var html = '<div style="margin-bottom:14px">' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">DRIVER</div>' +
            '<div style="font-size:15px;font-weight:700">' + (d.driverNome || d.driver) + '</div>' +
        '</div>' +
        '<div style="margin-bottom:14px">' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">TIPO</div>' +
            '<div>' + (d.tipoLabel || d.tipo) + '</div>' +
        '</div>' +
        '<div style="margin-bottom:14px">' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">FILIALE</div>' +
            '<div>' + (d.filialeNome || d.filiale || '—') + '</div>' +
        '</div>' +
        (d.cliente ? '<div style="margin-bottom:14px"><div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">CLIENTE</div><div>' + escapeHtml(d.cliente) + '</div></div>' : '') +
        (d.indirizzo ? '<div style="margin-bottom:14px"><div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">INDIRIZZO</div><div>' + escapeHtml(d.indirizzo) + '</div></div>' : '') +
        '<div style="margin-bottom:14px">' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">DESCRIZIONE</div>' +
            '<div style="line-height:1.6">' + escapeHtml(d.descrizione || '—') + '</div>' +
        '</div>' +
        '<div style="margin-bottom:14px">' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">DATA</div>' +
            '<div>' + escapeHtml(d.data || '—') + ' · Targa: ' + escapeHtml(d.targa || '—') + '</div>' +
        '</div>';

        if (d.foto) {
            html += '<div style="margin-bottom:14px">' +
                '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">FOTO</div>' +
                '<img src="' + d.foto + '" style="max-width:100%;border-radius:8px;border:1px solid var(--border)">' +
            '</div>';
        }

        if (d.stato !== 'risolta') {
            html += '<button class="btn btn-primary" onclick="risolviSegnalazione(\'' + id + '\');closeModal()" style="width:100%;margin-top:8px">✓ Segna come risolta</button>';
        }

        openModal('Dettaglio segnalazione', html);
    } catch (e) {
        console.error('dettaglioSegnalazione error:', e);
        toast('Errore caricamento segnalazione — riprova', 'error');
    }
}
