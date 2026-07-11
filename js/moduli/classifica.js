// DELIVERY HUB — Classifica Driver (vista admin con nomi reali)
// Legge leaderboardFull/{mese} scritta dalla Cloud Function precalcolaLeaderboard.
// Usata per decidere chi premiare a fine mese.
// Premi mensili in buoni pasto: 1° €100, 2° €70, 3° €40.

var PREMI_CLASSIFICA = { 1: 100, 2: 70, 3: 40 };

async function renderClassifica() {
    var mese = state.meseCorrente;
    var el = document.getElementById('classificaContent');
    if (!el) return;
    if (!mese) { el.innerHTML = '<p class="card-desc">Seleziona un mese.</p>'; return; }

    el.innerHTML = '<p class="card-desc">Caricamento classifica…</p>';

    var doc;
    try {
        doc = await db.collection('leaderboardFull').doc(mese).get();
    } catch (e) {
        console.error('Classifica load error:', e);
        el.innerHTML = '<p class="card-desc" style="color:var(--danger)">Errore nel caricamento: ' + (e.message || 'sconosciuto') + '</p>';
        return;
    }

    if (!doc.exists) {
        el.innerHTML =
            '<div class="card" style="text-align:center;padding:40px">' +
            '<div style="font-size:36px;margin-bottom:8px">🏆</div>' +
            '<p style="font-weight:600;color:var(--text)">Classifica non ancora disponibile per ' + meseLabel(mese) + '</p>' +
            '<p class="card-desc" style="margin-top:8px">La Cloud Function gira ogni ora. Se serve rebuild immediato, usa il bottone qui sotto.</p>' +
            '<button class="btn btn-primary" style="margin-top:12px" onclick="rebuildClassifica()">🔄 Forza rebuild ora</button>' +
            '</div>';
        return;
    }

    var data = doc.data();
    var drivers = data.drivers || [];
    var lastUpdate = data.lastUpdate && data.lastUpdate.toDate ? data.lastUpdate.toDate() : null;
    var lastUpdateStr = lastUpdate ? lastUpdate.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

    if (drivers.length === 0) {
        el.innerHTML =
            '<div class="card" style="text-align:center;padding:40px">' +
            '<div style="font-size:36px;margin-bottom:8px">📭</div>' +
            '<p style="font-weight:600;color:var(--text)">Nessun driver attivo nel mese</p>' +
            '<p class="card-desc">Ultimo aggiornamento: ' + lastUpdateStr + '</p>' +
            '</div>';
        return;
    }

    var totConsegne = drivers.reduce(function(s, d) { return s + (d.consegne || 0); }, 0);
    var totDanni = drivers.reduce(function(s, d) { return s + (d.danni || 0); }, 0);
    var driverPuliti = drivers.filter(function(d) { return d.bonusZeroDanni; }).length;

    var rowsHtml = drivers.map(function(d, i) {
        var pos = i + 1;
        var posBadge;
        if (pos === 1) posBadge = '<span style="font-size:18px">🥇</span>';
        else if (pos === 2) posBadge = '<span style="font-size:18px">🥈</span>';
        else if (pos === 3) posBadge = '<span style="font-size:18px">🥉</span>';
        else posBadge = '<span style="font-weight:700;color:var(--text-light)">' + pos + '</span>';

        var trendHtml = renderTrend(d.posPrec, pos);
        var bonusParts = [];
        if (d.bonusVelocita > 0) bonusParts.push('<span class="badge" style="background:var(--info-bg);color:var(--accent);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600">⚡ +' + d.bonusVelocita + '</span>');
        if (d.bonusZeroDanni) bonusParts.push('<span class="badge" style="background:var(--success-bg);color:var(--success);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600">🛡️ Zero danni</span>');
        var bonusHtml = bonusParts.length ? bonusParts.join(' ') : '<span style="color:var(--text-light)">—</span>';

        var tempoHtml = d.tempoMedioMin != null
            ? d.tempoMedioMin.toFixed(1).replace('.', ',') + ' min'
            : '<span style="color:var(--text-light)">—</span>';

        var premio = PREMI_CLASSIFICA[pos];
        var premioHtml = premio
            ? '<span class="badge" style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">🎁 €' + premio + ' buoni pasto</span>'
            : '<span style="color:var(--text-light)">—</span>';

        var nomeReale = (d.nome || '') + ' ' + (d.cognome || d.driver);
        nomeReale = nomeReale.trim();

        return (
            '<tr>' +
              '<td style="text-align:center;width:50px">' + posBadge + '</td>' +
              '<td><strong>' + escapeHtmlSafe(nomeReale) + '</strong>' +
                (d.email ? '<div style="font-size:11px;color:var(--text-light);margin-top:2px">' + escapeHtmlSafe(d.email) + '</div>' : '') +
              '</td>' +
              '<td style="color:var(--text-muted)">' + escapeHtmlSafe(d.citta || '—') + '</td>' +
              '<td style="text-align:right"><strong>' + (d.consegne || 0) + '</strong></td>' +
              '<td style="text-align:right">' + tempoHtml + '</td>' +
              '<td style="text-align:right;color:' + ((d.danni || 0) > 0 ? 'var(--danger)' : 'var(--text-light)') + '">' + (d.danni || 0) + '</td>' +
              '<td>' + bonusHtml + '</td>' +
              '<td style="text-align:right"><strong style="color:var(--accent);font-size:15px">' + (d.score || 0) + '</strong></td>' +
              '<td style="text-align:center">' + trendHtml + '</td>' +
              '<td>' + premioHtml + '</td>' +
            '</tr>'
        );
    }).join('');

    el.innerHTML =
        '<div class="card" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">' +
          '<div><div style="font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:1px">Driver attivi</div>' +
            '<div style="font-size:22px;font-weight:700;color:var(--text);margin-top:4px">' + drivers.length + '</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:1px">Consegne totali</div>' +
            '<div style="font-size:22px;font-weight:700;color:var(--text);margin-top:4px">' + totConsegne + '</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:1px">Driver senza danni</div>' +
            '<div style="font-size:22px;font-weight:700;color:var(--success);margin-top:4px">' + driverPuliti + ' / ' + drivers.length + '</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:1px">Danni totali</div>' +
            '<div style="font-size:22px;font-weight:700;color:' + (totDanni > 0 ? 'var(--danger)' : 'var(--text)') + ';margin-top:4px">' + totDanni + '</div></div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">🏆 Classifica ' + meseLabel(mese) + '</div>' +
          '<div class="card-desc">Aggiornata ' + lastUpdateStr + ' · Scoring: 1 consegna = 1 pt · ⚡ Velocità (tempo medio &lt;20 min = +30, &lt;25 min = +15, con almeno 10 consegne con orari) · Zero danni = +50 pt · Danno = -30 pt · Premi buoni pasto: 🥇 €100 · 🥈 €70 · 🥉 €40</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:12px">' +
            '<button class="btn btn-sm" onclick="rebuildClassifica()">🔄 Rebuild ora</button>' +
            '<button class="btn btn-sm" onclick="esportaClassificaCsv()">📥 Esporta CSV</button>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table class="data-table">' +
              '<thead><tr>' +
                '<th style="text-align:center">Pos.</th>' +
                '<th>Driver</th>' +
                '<th>Città</th>' +
                '<th style="text-align:right">Consegne</th>' +
                '<th style="text-align:right">Tempo medio</th>' +
                '<th style="text-align:right">Danni</th>' +
                '<th>Bonus</th>' +
                '<th style="text-align:right">Score</th>' +
                '<th style="text-align:center">Trend</th>' +
                '<th>Premio</th>' +
              '</tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
}

function renderTrend(posPrec, posCorrente) {
    if (posPrec == null) {
        return '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:var(--info-bg);color:var(--accent)">NEW</span>';
    }
    var delta = posPrec - posCorrente;
    if (delta > 0) return '<span style="color:var(--success);font-weight:700">↑ ' + delta + '</span>';
    if (delta < 0) return '<span style="color:var(--danger);font-weight:700">↓ ' + Math.abs(delta) + '</span>';
    return '<span style="color:var(--text-light)">=</span>';
}

function escapeHtmlSafe(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function rebuildClassifica() {
    var btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = 'Rebuild in corso…'; }
    try {
        var user = firebase.auth().currentUser;
        if (!user) { toast('Sessione scaduta', 'error'); return; }
        var idToken = await user.getIdToken();
        var resp = await fetch('https://europe-west1-avr-logistic-dashboard.cloudfunctions.net/rebuildLeaderboard', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + idToken,
            },
            body: JSON.stringify({ mese: state.meseCorrente }),
        });
        var body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Errore rebuild');
        toast('Classifica aggiornata', 'success');
        await renderClassifica();
    } catch (e) {
        console.error('rebuildClassifica:', e);
        toast('Errore: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Rebuild ora'; }
    }
}

async function esportaClassificaCsv() {
    var mese = state.meseCorrente;
    try {
        var doc = await db.collection('leaderboardFull').doc(mese).get();
        if (!doc.exists) { toast('Classifica non disponibile', 'error'); return; }
        var drivers = doc.data().drivers || [];
        var rows = [['Posizione', 'Cognome', 'Nome', 'Email', 'Citta', 'Consegne', 'Tempo medio (min)', 'Bonus velocita', 'Danni', 'Zero danni', 'Score', 'Posizione mese precedente', 'Premio buoni pasto (EUR)']];
        drivers.forEach(function(d, i) {
            rows.push([
                i + 1,
                d.cognome || d.driver || '',
                d.nome || '',
                d.email || '',
                d.citta || '',
                d.consegne || 0,
                d.tempoMedioMin != null ? d.tempoMedioMin : '',
                d.bonusVelocita || 0,
                d.danni || 0,
                d.bonusZeroDanni ? 'SI' : 'NO',
                d.score || 0,
                d.posPrec || '',
                PREMI_CLASSIFICA[i + 1] || '',
            ]);
        });
        var csv = rows.map(function(r) {
            return r.map(function(c) {
                var s = String(c);
                if (/[",;\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
                return s;
            }).join(';');
        }).join('\n');
        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'classifica_' + mese + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('esportaClassificaCsv:', e);
        toast('Errore export: ' + e.message, 'error');
    }
}
