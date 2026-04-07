// DELIVERY HUB v2 — Ritorni Admin Module

async function renderRitorni() {
    var mese = state.meseCorrente;
    var searchTerm = document.getElementById('searchRitorni') ? document.getElementById('searchRitorni').value.toUpperCase().trim() : '';
    var filterStato = document.getElementById('filterRitorniStato') ? document.getElementById('filterRitorniStato').value : '';
    var tbody = document.getElementById('tblRitorni');

    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:40px">Caricamento...</td></tr>';

    try {
        var snap = await db.collection('ritorni').orderBy('timestamp', 'desc').limit(500).get();
        var rows = [];
        var totRitorni = 0, totFattura = 0, totCostoDriver = 0;

        snap.forEach(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            // Filtro mese
            if (d.mese !== mese) return;
            // Filtro ricerca
            if (searchTerm) {
                var haystack = ((d.driver || '') + ' ' + (d.filialeNome || '') + ' ' + (d.filiale || '') + ' ' + (d.cliente || '')).toUpperCase();
                if (haystack.indexOf(searchTerm) < 0) return;
            }
            // Filtro stato
            if (filterStato && d.stato !== filterStato) return;

            var num = d.numRitorni || 0;
            var fattura = num * 6.90;
            var costoDriver = d.costoDriver || (num * 3.50);
            totRitorni += num;
            totFattura += fattura;
            totCostoDriver += costoDriver;
            rows.push(d);
        });

        // KPI
        document.getElementById('rtTotRitorni').textContent = totRitorni;
        document.getElementById('rtTotFattura').textContent = formatCurrency(totFattura);
        document.getElementById('rtTotCostoDriver').textContent = formatCurrency(totCostoDriver);
        document.getElementById('rtTotMargine').textContent = formatCurrency(totFattura - totCostoDriver);

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:40px">Nessun ritorno registrato</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function(d) {
            var ts = d.data && d.data.toDate ? d.data.toDate() : (d.data instanceof Date ? d.data : new Date(d.data));
            var dataStr = ts.toLocaleDateString('it-IT', {day:'2-digit', month:'2-digit', year:'numeric'});
            var num = d.numRitorni || 0;
            var fattura = num * 6.90;
            var statoBadge = d.stato === 'fatturato' ? 'badge-ok' : 'badge-warn';
            var statoLabel = d.stato === 'fatturato' ? 'Fatturato' : 'Da fatturare';

            return '<tr>' +
                '<td>' + dataStr + '</td>' +
                '<td><strong>' + (d.driver || '—') + '</strong></td>' +
                '<td>' + (d.filialeNome || d.filiale || '—') + '</td>' +
                '<td>' + (d.motivoLabel || d.motivo || '—') + '</td>' +
                '<td><strong>' + num + '</strong></td>' +
                '<td>' + (d.cliente || '—') + '</td>' +
                '<td style="text-align:right">' + formatCurrency(fattura) + '</td>' +
                '<td><span class="badge ' + statoBadge + '">' + statoLabel + '</span></td>' +
                '<td>' +
                    (d.stato !== 'fatturato' ? '<button class="btn btn-sm" onclick="marcaRitornoFatturato(\'' + d.id + '\')">✓</button>' : '') +
                '</td>' +
            '</tr>';
        }).join('');

    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--danger)">Errore: ' + e.message + '</td></tr>';
    }
}

async function marcaRitornoFatturato(id) {
    if (!confirm('Segnare questo ritorno come fatturato?')) return;
    try {
        await db.collection('ritorni').doc(id).update({
            stato: 'fatturato',
            fatturatoDa: state.user.email,
            fatturatoIl: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast('Ritorno segnato come fatturato', 'success');
        renderRitorni();
    } catch (e) {
        toast('Errore: ' + e.message, 'error');
    }
}
