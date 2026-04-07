// DELIVERY HUB v2 — Ritorni Admin Module

async function renderRitorni() {
    var mese = state.meseCorrente;
    var searchTerm = document.getElementById('searchRitorni') ? document.getElementById('searchRitorni').value.toUpperCase().trim() : '';
    var filterStato = document.getElementById('filterRitorniStato') ? document.getElementById('filterRitorniStato').value : '';
    var tbody = document.getElementById('tblRitorni');

    var rows = [];
    var totRitorni = 0, totFattura = 0, totCostoDriver = 0;

    (state.ritorniMese || []).forEach(function(d) {
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
            var statoBadge = d.stato === 'accettato' ? 'badge-ok' : d.stato === 'rifiutato' ? 'badge-err' : 'badge-warn';
            var statoLabel = d.stato === 'accettato' ? 'Accettato' : d.stato === 'rifiutato' ? 'Rifiutato' : 'In attesa';

            var azioni = '';
            if (d.stato !== 'accettato' && d.stato !== 'rifiutato') {
                azioni = '<button class="btn btn-sm" style="color:var(--success)" onclick="gestisciRitorno(\'' + d.id + '\',\'accettato\')">✓</button> ' +
                         '<button class="btn btn-sm btn-danger" onclick="gestisciRitorno(\'' + d.id + '\',\'rifiutato\')">✕</button>';
            } else if (d.stato === 'rifiutato') {
                azioni = '<button class="btn btn-sm" style="color:var(--success)" onclick="gestisciRitorno(\'' + d.id + '\',\'accettato\')">✓</button>';
            }

            return '<tr>' +
                '<td>' + dataStr + '</td>' +
                '<td><strong>' + (d.driver || '—') + '</strong></td>' +
                '<td>' + (d.filialeNome || d.filiale || '—') + '</td>' +
                '<td>' + (d.motivoLabel || d.motivo || '—') + '</td>' +
                '<td><strong>' + num + '</strong></td>' +
                '<td>' + (d.cliente || '—') + '</td>' +
                '<td style="text-align:right">' + formatCurrency(fattura) + '</td>' +
                '<td><span class="badge ' + statoBadge + '">' + statoLabel + '</span></td>' +
                '<td>' + azioni + '</td>' +
            '</tr>';
        }).join('');
}

async function gestisciRitorno(id, nuovoStato) {
    var label = nuovoStato === 'accettato' ? 'accettare' : 'rifiutare';
    if (!confirm('Vuoi ' + label + ' questo ritorno?')) return;
    try {
        await db.collection('ritorni').doc(id).update({
            stato: nuovoStato,
            gestito: true,
            gestitoDa: state.user.email,
            gestitoIl: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast('Ritorno ' + nuovoStato, 'success');
        await loadRitorniMese();
        renderRitorni();
    } catch (e) {
        toast('Errore: ' + e.message, 'error');
    }
}
