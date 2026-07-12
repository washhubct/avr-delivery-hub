// DELIVERY HUB v2 — Driver App (driver-side views)
// Le viste driver leggono reportDriver (i propri report dall'app driver):
// la collection `consegne` non è leggibile dai driver per rules.

var myReportsCache = null;

function reportDay(d) {
    if (!d) return null;
    if (d.toDate) d = d.toDate();
    else if (d.seconds != null) d = new Date(d.seconds * 1000);
    else if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d)) return null;
    return d.toISOString().slice(0, 10);
}

async function loadMyReports() {
    if (myReportsCache) return myReportsCache;
    if (!state.user) return [];
    try {
        var snap = await db.collection('reportDriver')
            .where('driverEmail', '==', (state.user.email || '').toLowerCase())
            .limit(2000)
            .get();
        myReportsCache = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            return d;
        });
    } catch (e) {
        console.warn('loadMyReports:', e);
        myReportsCache = [];
    }
    return myReportsCache;
}

async function renderDriverConsegne() {
    var reports = await loadMyReports();
    var mese = state.meseCorrente;
    var mine = reports.filter(function(r) { return r.mese === mese; });

    var count = 0;
    var giorni = {};
    mine.forEach(function(r) {
        count += (r.numConsegne || 0);
        var day = reportDay(r.data);
        if (day && (r.numConsegne || 0) > 0) giorni[day] = true;
    });
    var nGiorni = Object.keys(giorni).length;

    document.getElementById('drvConsegneMese').textContent = formatNumber(count);
    document.getElementById('drvGiorniAttivi').textContent = nGiorni;
    document.getElementById('drvMedia').textContent = nGiorni > 0 ? Math.round(count / nGiorni) : '—';

    var sorted = mine.slice().sort(function(a, b) {
        return (reportDay(b.data) || '').localeCompare(reportDay(a.data) || '');
    });

    document.getElementById('tblDriverConsegne').innerHTML = sorted.map(function(r) {
        var day = reportDay(r.data);
        var label = day ? new Date(day + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
        var durata = r.durataMin > 0 ? Math.round(r.durataMin) + ' min' : '—';
        var media = r.durataMin > 0 && r.numConsegne > 0 ? Math.round(r.durataMin / r.numConsegne) + ' min' : '—';
        return '<tr>' +
            '<td>' + label + '</td>' +
            '<td>' + escapeHtml(r.filialeNome || ('Filiale ' + (r.filiale || '—'))) + '</td>' +
            '<td>' + escapeHtml(r.fascia || '—') + '</td>' +
            '<td><strong>' + (r.numConsegne || 0) + '</strong></td>' +
            '<td>' + durata + '</td>' +
            '<td>' + media + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nessun report questo mese</td></tr>';
}

async function renderDriverCompensi() {
    // Storico mensile consegne — i driver sono dipendenti a stipendio fisso:
    // solo conteggi, nessun importo.
    var reports = await loadMyReports();

    var mesi = {};
    reports.forEach(function(r) {
        var m = r.mese || (reportDay(r.data) || '').substring(0, 7);
        if (!m) return;
        if (!mesi[m]) mesi[m] = { count: 0, giorni: {} };
        mesi[m].count += (r.numConsegne || 0);
        var day = reportDay(r.data);
        if (day && (r.numConsegne || 0) > 0) mesi[m].giorni[day] = true;
    });

    var sorted = Object.entries(mesi).sort(function(a, b) { return b[0].localeCompare(a[0]); });

    document.getElementById('tblDriverCompensiBody').innerHTML = sorted.map(function(entry) {
        var m = entry[0], data = entry[1];
        var g = Object.keys(data.giorni).length;
        return '<tr>' +
            '<td><strong>' + meseLabel(m) + '</strong></td>' +
            '<td>' + data.count + '</td>' +
            '<td>' + g + '</td>' +
            '<td>' + (g > 0 ? Math.round(data.count / g) : '—') + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Nessun dato</td></tr>';
}

function getMyDriverName() {
    if (state.driverProfile) {
        return (state.driverProfile.cognome || '').toUpperCase().trim();
    }
    // Fallback: try matching by email
    if (state.user) {
        const drv = state.driverList.find(d => d.email === state.user.email);
        if (drv) return (drv.cognome || '').toUpperCase().trim();
    }
    return null;
}
