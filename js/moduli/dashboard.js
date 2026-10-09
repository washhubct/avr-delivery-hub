// DELIVERY HUB v2 — Dashboard
// Fonte: rapporti giornalieri dell'app driver (reportDriver) via rapportiMese().
// I fogli Google Decò non vengono più letti dal 09/10/2026.

var AREA_NAMES = { CT: 'Catania', ME: 'Messina', SR: 'Siracusa', PA: 'Palermo', EN: 'Enna' };

// Nome leggibile del driver dal rapporto: anagrafica per email, altrimenti il cognome scritto nel rapporto
function nomeDriverRapporto(r) {
    var ana = (state.driverList || []).find(function(d) { return (d.email || '').toLowerCase() === r.driverEmail; });
    if (ana) return (ana.cognome + ' ' + (ana.nome || '')).trim();
    return r.driver || '—';
}

function renderDashboard() {
    var mese = state.meseCorrente;
    var rapporti = rapportiMese(mese);
    var tot = fatturatoAttesoRapporti(rapporti);

    // ═══ KPI ═══
    document.getElementById('kpiConsegneMese').textContent = formatNumber(tot.consegne);
    document.getElementById('kpiConsegneDetail').textContent = tot.feriali + ' feriali · ' + tot.festivi + ' festivi · ' + rapporti.length + ' rapporti';
    document.getElementById('kpiFatturato').textContent = formatCurrency(tot.imponibile);
    document.getElementById('kpiFatturatoDetail').textContent = tot.feriali + '×€9,70 + ' + tot.festivi + '×€12,61 (speciali >€499 escluse)';

    var giorni = {};
    rapporti.forEach(function(r) { giorni[r.ymd] = (giorni[r.ymd] || 0) + r.n; });
    var nGiorni = Object.keys(giorni).length;
    document.getElementById('kpiMediaGiorno').textContent = nGiorni > 0 ? Math.round(tot.consegne / nGiorni) : '—';
    document.getElementById('kpiMediaGiornoDetail').textContent = nGiorni + ' giorni con consegne nel mese';

    var driverSet = {};
    rapporti.forEach(function(r) { if (r.driverEmail) driverSet[r.driverEmail] = true; });
    var nDriver = Object.keys(driverSet).length;
    document.getElementById('kpiDriverAttivi').textContent = nDriver;
    document.getElementById('kpiDriverAttiviDetail').textContent = nDriver > 0 ? '~' + Math.round(tot.consegne / nDriver) + ' consegne/driver nel mese' : '';

    // ═══ Consegne per area ═══
    var aree = {};
    rapporti.forEach(function(r) {
        if (!aree[r.area]) aree[r.area] = { filiali: {}, feriali: 0, festivi: 0 };
        aree[r.area].filiali[r.filiale] = true;
        if (r.festivo) aree[r.area].festivi += r.n; else aree[r.area].feriali += r.n;
    });
    var rowsHtml = '', tFil = 0, tFer = 0, tFes = 0, tFatt = 0;
    Object.keys(aree).sort().forEach(function(area) {
        var a = aree[area];
        var nFil = Object.keys(a.filiali).length;
        var fatt = a.feriali * PREZZO_FLAT + a.festivi * PREZZO_FLAT_FESTIVO;
        tFil += nFil; tFer += a.feriali; tFes += a.festivi; tFatt += fatt;
        rowsHtml += '<tr>' +
            '<td><strong>' + area + '</strong> — ' + (AREA_NAMES[area] || area) + '</td>' +
            '<td>' + nFil + '</td>' +
            '<td>' + a.feriali + '</td>' +
            '<td>' + a.festivi + '</td>' +
            '<td><strong>' + (a.feriali + a.festivi) + '</strong></td>' +
            '<td>' + formatCurrency(fatt) + '</td>' +
        '</tr>';
    });
    document.getElementById('tblAree').innerHTML = rowsHtml || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">Nessun rapporto driver nel mese</td></tr>';
    document.getElementById('totFiliali').textContent = tFil;
    document.getElementById('totMaggiori').textContent = tFer;
    document.getElementById('totMinori').textContent = tFes;
    document.getElementById('totConsegne').innerHTML = '<strong>' + (tFer + tFes) + '</strong>';
    document.getElementById('totFatturato').textContent = formatCurrency(tFatt);

    // ═══ Top 10 filiali ═══
    var byFiliale = {};
    rapporti.forEach(function(r) {
        if (!byFiliale[r.filiale]) byFiliale[r.filiale] = { nome: r.filialeNome, area: r.area, count: 0, fatt: 0 };
        byFiliale[r.filiale].count += r.n;
        byFiliale[r.filiale].fatt += r.n * (r.festivo ? PREZZO_FLAT_FESTIVO : PREZZO_FLAT);
    });
    var topFil = Object.entries(byFiliale).sort(function(a, b) { return b[1].count - a[1].count; }).slice(0, 10);
    document.getElementById('tblTopFiliali').innerHTML = topFil.map(function(e) {
        return '<tr><td>' + escapeHtml(e[0] + ' ' + e[1].nome) + '</td><td><span class="badge">' + e[1].area + '</span></td><td>' + e[1].count + '</td><td>' + formatCurrency(e[1].fatt) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">—</td></tr>';

    // ═══ Performance driver ═══
    var byDriver = {};
    rapporti.forEach(function(r) {
        var k = r.driverEmail || r.driver;
        if (!k) return;
        if (!byDriver[k]) byDriver[k] = { nome: nomeDriverRapporto(r), count: 0, giorni: {}, filiali: {} };
        byDriver[k].count += r.n;
        byDriver[k].giorni[r.ymd] = true;
        byDriver[k].filiali[r.filiale] = true;
    });
    var topDrv = Object.values(byDriver).sort(function(a, b) { return b.count - a.count; }).slice(0, 10);
    document.getElementById('tblTopDriver').innerHTML = topDrv.map(function(d) {
        var gg = Object.keys(d.giorni).length;
        return '<tr><td>' + escapeHtml(d.nome) + '</td><td>' + d.count + '</td><td>' + (gg ? (d.count / gg).toFixed(1) : '—') + '</td><td>' + Object.keys(d.filiali).length + '</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">—</td></tr>';
}
