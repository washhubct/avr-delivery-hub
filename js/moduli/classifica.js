// DELIVERY HUB — Classifica Driver (vista admin con nomi reali)
// Legge leaderboardFull/{mese} scritta dalla Cloud Function precalcolaLeaderboard.
// Dal 31/10/2026 le classifiche sono per provincia (CT, ME, PA, SR; Enna esclusa):
// ogni provincia ha un montepremi fisso (Catania 200, Messina 70, Palermo 60, Siracusa 40 €),
// ripartito 50/30/20 con 5+ driver o 60/40 con 3-4. Il volume di consegne lo decide
// Arena, non i driver: nessuna soglia legata alle consegne.
// Premiabile: zero danni, patente verificata. Il premio è un
// buono Q8 o Amazon a scelta del vincitore. Regole in functions/leaderboard-core.js.

var CLASSIFICA_PROVINCE = ['CT', 'ME', 'PA', 'SR'];
var CLASSIFICA_NOMI = { CT: 'Catania', ME: 'Messina', PA: 'Palermo', SR: 'Siracusa', EN: 'Enna' };
var CLASSIFICA_MOTIVI = { danni: 'danno nel mese', patente: 'patente non verificata', tetto: 'tetto 1.000 €/anno raggiunto' };
var classificaState = { prov: null, mese: null };

function classificaTabsVisibili(data) {
    var prov = provinceVisibili(); // null = tutte
    var tabs = CLASSIFICA_PROVINCE.filter(function(p) { return data.province && data.province[p] && (!prov || prov.indexOf(p) >= 0); });
    tabs.push('TUTTE');
    return tabs;
}

function classificaNome(d) { return ((d.nome || '') + ' ' + (d.cognome || d.driver)).trim(); }

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
            '<button class="btn btn-primary solo-ufficio" style="margin-top:12px" onclick="rebuildClassifica()">🔄 Forza rebuild ora</button>' +
            '</div>';
        return;
    }

    var data = doc.data();
    var lastUpdate = data.lastUpdate && data.lastUpdate.toDate ? data.lastUpdate.toDate() : null;
    var lastUpdateStr = lastUpdate ? lastUpdate.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

    var tabs = classificaTabsVisibili(data);
    if (classificaState.mese !== mese || tabs.indexOf(classificaState.prov) < 0) classificaState.prov = tabs[0];
    classificaState.mese = mese;
    var tab = classificaState.prov;

    var tabsHtml = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">' + tabs.map(function(p) {
        var c = p === 'TUTTE' ? null : data.province[p];
        var label = p === 'TUTTE' ? '🌍 Tutte' : CLASSIFICA_NOMI[p] + (c ? ' <span style="opacity:.7;font-weight:500">· ' + c.nDriver + ' driver · €' + c.montepremi + '</span>' : '');
        return '<button class="btn btn-sm' + (p === tab ? ' btn-primary' : '') + '" onclick="classificaState.prov=\'' + p + '\';renderClassifica()">' + label + '</button>';
    }).join('') + '</div>';

    var attivaDal = (data.regole && data.regole.attivaDal) || '2026-11';
    var avvisoVecchio = !data.province
        ? (mese < attivaDal
            ? '<div class="card" style="margin-bottom:16px;background:var(--info-bg)">ℹ️ Le classifiche per provincia con premi partono da ' + meseLabel(attivaDal) + ': per questo mese c\'è solo la classifica generale, senza premi.</div>'
            : '<div class="card" style="margin-bottom:16px;background:var(--warning-bg)">⚠️ Questo mese è stato calcolato prima delle classifiche per provincia: premi e montepremi compaiono dopo un ricalcolo. <button class="btn btn-sm solo-ufficio" onclick="rebuildClassifica()">🔄 Ricalcola ora</button></div>')
        : '';

    var regole = data.regole || { montepremiProvincia: { CT: 200, ME: 70, PA: 60, SR: 40 }, premio: 'Buono carburante Q8 o buono Amazon, a scelta del vincitore' };
    var scoringDesc = 'Scoring: 1 consegna = 1 pt · ⚡ Velocità (tempo medio &lt;20 min = +30, &lt;25 min = +15, con almeno 10 consegne con orari) · Zero danni = +50 pt · Danno = -30 pt';

    var body = tab === 'TUTTE'
        ? renderClassificaGenerale(data, mese, lastUpdateStr, scoringDesc)
        : renderClassificaProvincia(data.province[tab], data, mese, lastUpdateStr, scoringDesc, regole);

    el.innerHTML = tabsHtml + avvisoVecchio + body;
}

function classificaPosBadge(pos) {
    if (pos === 1) return '<span style="font-size:18px">🥇</span>';
    if (pos === 2) return '<span style="font-size:18px">🥈</span>';
    if (pos === 3) return '<span style="font-size:18px">🥉</span>';
    return '<span style="font-weight:700;color:var(--text-light)">' + pos + '</span>';
}

function classificaBonusHtml(d) {
    var parts = [];
    if (d.bonusVelocita > 0) parts.push('<span class="badge" style="background:var(--info-bg);color:var(--accent);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600">⚡ +' + d.bonusVelocita + '</span>');
    if (d.bonusZeroDanni) parts.push('<span class="badge" style="background:var(--success-bg);color:var(--success);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600">🛡️ Zero danni</span>');
    return parts.length ? parts.join(' ') : '<span style="color:var(--text-light)">—</span>';
}

function classificaTempoHtml(d) {
    return d.tempoMedioMin != null ? d.tempoMedioMin.toFixed(1).replace('.', ',') + ' min' : '<span style="color:var(--text-light)">—</span>';
}

function classificaStatCard(items) {
    return '<div class="card" style="display:grid;grid-template-columns:repeat(' + items.length + ',1fr);gap:16px;margin-bottom:20px">' + items.map(function(it) {
        return '<div><div style="font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:1px">' + it.label + '</div>' +
            '<div style="font-size:22px;font-weight:700;color:' + (it.color || 'var(--text)') + ';margin-top:4px">' + it.value + '</div>' +
            (it.sub ? '<div style="font-size:11px;color:var(--text-muted)">' + it.sub + '</div>' : '') + '</div>';
    }).join('') + '</div>';
}

// ── Classifica di una provincia: montepremi, podio, tabella ──
function renderClassificaProvincia(c, data, mese, lastUpdateStr, scoringDesc, regole) {
    var drivers = c.drivers || [];
    var inCorso = !!data.inCorso;

    var importi = c.importi || [];
    var premiStr = importi.length ? importi.map(function(x, i) { return ['🥇', '🥈', '🥉'][i] + ' €' + x; }).join(' · ') : 'nessun premio (servono almeno 3 driver)';

    var montepremiCard =
        '<div class="card" style="margin-bottom:20px;background:linear-gradient(135deg,var(--navy,#0f1d3d),#1e3a8a);color:#fff">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">' +
            '<div>' +
              '<div style="font-size:11px;opacity:.75;text-transform:uppercase;letter-spacing:1px">Montepremi ' + escapeHtmlSafe(c.nome) + ' · ' + meseLabel(mese) + '</div>' +
              '<div style="font-size:34px;font-weight:800;margin-top:2px">€' + c.montepremi + '</div>' +
              '<div style="font-size:12px;opacity:.85">montepremi fisso della provincia · ' + c.nDriver + ' driver · ' + c.consegne + ' consegne di squadra' + (inCorso ? ' (mese in corso)' : '') + '</div>' +
            '</div>' +
            '<div style="text-align:right">' +
              '<div style="font-size:11px;opacity:.75;text-transform:uppercase;letter-spacing:1px">Premi</div>' +
              '<div style="font-size:16px;font-weight:700;margin-top:4px">' + premiStr + '</div>' +
              '<div style="font-size:11px;opacity:.85;margin-top:4px">' + escapeHtmlSafe(regole.premio || '') + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

    // Podio: i premi già assegnati dalla CF (saltano chi non è premiabile)
    var premi = c.premi || [];
    var podioOrder = importi.length >= 3 ? [1, 0, 2] : [0, 1];
    var podioHtml = podioOrder.filter(function(i) { return i < importi.length; }).map(function(i) {
        var medal = ['🥇', '🥈', '🥉'][i];
        var isFirst = i === 0;
        var pr = premi[i];
        if (!pr) {
            return '<div style="flex:1;text-align:center;padding:16px 12px;border:1.5px dashed var(--border);border-radius:12px;opacity:.6">' +
                '<div style="font-size:26px">' + medal + '</div><div style="font-size:12px;color:var(--text-light);margin-top:6px">€' + importi[i] + ' · nessun driver premiabile</div></div>';
        }
        var d = drivers.find(function(x) { return x.driver === pr.driver; }) || { driver: pr.driver };
        return '<div style="flex:1;text-align:center;padding:' + (isFirst ? '22px 12px' : '16px 12px') + ';background:' + (isFirst ? '#fffbeb' : 'var(--white)') + ';border:1.5px solid ' + (isFirst ? '#fbbf24' : 'var(--border)') + ';border-radius:12px' + (isFirst ? ';box-shadow:0 4px 12px rgba(251,191,36,0.25)' : '') + '">' +
            '<div style="font-size:' + (isFirst ? '34px' : '26px') + '">' + medal + '</div>' +
            '<div style="font-weight:700;color:var(--text);margin-top:6px;font-size:' + (isFirst ? '15px' : '13px') + '">' + escapeHtmlSafe(classificaNome(d)) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">' + pr.posizione + '° · ' + (d.consegne || 0) + ' consegne · ' + (d.giorni || 0) + ' gg · ' + (d.score || 0) + ' pt</div>' +
            '<div style="margin-top:8px;display:inline-block;background:#fef3c7;color:#b45309;font-weight:800;padding:4px 12px;border-radius:8px;font-size:' + (isFirst ? '16px' : '14px') + '">🎁 €' + pr.importo + '</div>' +
            '<div style="font-size:10px;color:var(--text-light);margin-top:4px">buono Q8 o Amazon' + (pr.ridotto ? ' · ridotto per tetto annuo' : '') + '</div>' +
        '</div>';
    }).join('');

    var podioCard = importi.length
        ? '<div class="card" style="margin-bottom:20px">' +
            '<div class="card-title">🏆 Podio ' + escapeHtmlSafe(c.nome) + ' ' + meseLabel(mese) + (inCorso ? ' — provvisorio' : '') + '</div>' +
            '<div class="card-desc">Premiabile solo chi ha zero danni e patente verificata: il premio passa al successivo. Tetto fringe benefit 1.000 € l\'anno per driver: il premio che supera il residuo viene ridotto, chi ha raggiunto il tetto passa il premio al successivo (si contano i premi dal ' + meseLabel((regole.attivaDal || '2026-11')) + ').</div>' +
            '<div style="display:flex;gap:14px;align-items:flex-end;margin-top:14px">' + podioHtml + '</div>' +
          '</div>'
        : '';

    var totDanni = drivers.reduce(function(sum, d) { return sum + (d.danni || 0); }, 0);
    var premiabili = drivers.filter(function(d) { return d.premiabile; }).length;
    var statCard = classificaStatCard([
        { label: 'Driver in classifica', value: c.nDriver },
        { label: 'Consegne', value: c.consegne },
        { label: 'Premiabili', value: premiabili + ' / ' + drivers.length, color: 'var(--success)' },
        { label: 'Danni', value: totDanni, color: totDanni > 0 ? 'var(--danger)' : 'var(--text)' },
    ]);

    var rowsHtml = drivers.map(function(d) {
        var pos = d.posizione;
        var premioHtml;
        if (d.premio > 0) premioHtml = '<span class="badge" style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">🎁 €' + d.premio + '</span>' + (d.premioRidotto ? '<div style="font-size:10px;color:var(--warning,#b45309);margin-top:2px">ridotto: tetto 1.000 €/anno</div>' : '');
        else if (!d.premiabile) premioHtml = '<span style="font-size:11px;color:var(--danger)" title="Non premiabile">✗ ' + (d.motiviNonPremiabile || []).map(function(m) { return CLASSIFICA_MOTIVI[m] || m; }).join(', ') + '</span>';
        else premioHtml = '<span style="font-size:11px;color:var(--success)">✓ premiabile</span>';
        return (
            '<tr>' +
              '<td style="text-align:center;width:50px">' + classificaPosBadge(pos) + '</td>' +
              '<td><strong>' + escapeHtmlSafe(classificaNome(d)) + '</strong>' +
                (d.email ? '<div style="font-size:11px;color:var(--text-light);margin-top:2px">' + escapeHtmlSafe(d.email) + '</div>' : '') +
              '</td>' +
              '<td style="text-align:right;color:var(--text-light)">' + (d.giorni || 0) + '</td>' +
              '<td style="text-align:right"><strong>' + (d.consegne || 0) + '</strong></td>' +
              '<td style="text-align:right">' + classificaTempoHtml(d) + '</td>' +
              '<td style="text-align:right;color:' + ((d.danni || 0) > 0 ? 'var(--danger)' : 'var(--text-light)') + '">' + (d.danni || 0) + '</td>' +
              '<td style="text-align:center">' + (d.patenteOk ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--danger)" title="Patente non verificata">✗</span>') + '</td>' +
              '<td>' + classificaBonusHtml(d) + '</td>' +
              '<td style="text-align:right"><strong style="color:var(--accent);font-size:15px">' + (d.score || 0) + '</strong></td>' +
              '<td style="text-align:center">' + renderTrend(d.posPrec, pos) + '</td>' +
              '<td>' + premioHtml + '</td>' +
              '<td style="text-align:right;color:' + ((d.premiAnno || 0) >= 1000 ? 'var(--danger)' : 'var(--text-light)') + '">€' + (d.premiAnno || 0) + '</td>' +
            '</tr>'
        );
    }).join('') || '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:24px">Nessun driver di ' + escapeHtmlSafe(c.nome) + ' con consegne nel mese</td></tr>';

    return montepremiCard + podioCard + statCard +
        '<div class="card">' +
          '<div class="card-title">🏆 Classifica ' + escapeHtmlSafe(c.nome) + ' ' + meseLabel(mese) + '</div>' +
          '<div class="card-desc">Aggiornata ' + lastUpdateStr + ' · ' + scoringDesc + '</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:12px">' +
            '<button class="btn btn-sm solo-ufficio" onclick="rebuildClassifica()">🔄 Rebuild ora</button>' +
            '<button class="btn btn-sm" onclick="esportaClassificaCsv()">📥 Esporta CSV</button>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table class="data-table">' +
              '<thead><tr>' +
                '<th style="text-align:center">Pos.</th>' +
                '<th>Driver</th>' +
                '<th style="text-align:right">Giorni</th>' +
                '<th style="text-align:right">Consegne</th>' +
                '<th style="text-align:right">Tempo medio</th>' +
                '<th style="text-align:right">Danni</th>' +
                '<th style="text-align:center">Patente</th>' +
                '<th>Bonus</th>' +
                '<th style="text-align:right">Score</th>' +
                '<th style="text-align:center">Trend</th>' +
                '<th>Premio</th>' +
                '<th style="text-align:right" title="Premi già maturati nell\'anno (tetto fringe 1.000 €)">Anno</th>' +
              '</tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
}

// ── Classifica generale (tutte le province, senza premi): confronto d'insieme ──
function renderClassificaGenerale(data, mese, lastUpdateStr, scoringDesc) {
    var drivers = data.drivers || [];
    var prov = provinceVisibili();
    drivers = drivers.map(function(d, i) { return Object.assign({ posizioneGenerale: i + 1 }, d); });
    if (prov) drivers = drivers.filter(function(d) { return prov.indexOf(String(d.citta || '').toUpperCase()) >= 0; });

    if (drivers.length === 0) {
        return '<div class="card" style="text-align:center;padding:40px"><div style="font-size:36px;margin-bottom:8px">📭</div>' +
            '<p style="font-weight:600;color:var(--text)">Nessun driver attivo nel mese</p><p class="card-desc">Ultimo aggiornamento: ' + lastUpdateStr + '</p></div>';
    }

    var totConsegne = drivers.reduce(function(s, d) { return s + (d.consegne || 0); }, 0);
    var totDanni = drivers.reduce(function(s, d) { return s + (d.danni || 0); }, 0);
    var driverPuliti = drivers.filter(function(d) { return d.bonusZeroDanni; }).length;
    var montepremiTot = 0;
    CLASSIFICA_PROVINCE.forEach(function(p) { if (data.province && data.province[p] && data.province[p].importi && data.province[p].importi.length) montepremiTot += data.province[p].montepremi; });

    var statCard = classificaStatCard([
        { label: 'Driver attivi', value: drivers.length },
        { label: 'Consegne totali', value: totConsegne },
        { label: 'Driver senza danni', value: driverPuliti + ' / ' + drivers.length, color: 'var(--success)' },
        { label: 'Danni totali', value: totDanni, color: totDanni > 0 ? 'var(--danger)' : 'var(--text)' },
        { label: 'Montepremi del mese', value: '€' + montepremiTot, sub: 'somma delle province con premi' },
    ]);

    var rowsHtml = drivers.map(function(d) {
        var pos = d.posizioneGenerale;
        var citta = String(d.citta || '').toUpperCase();
        return (
            '<tr>' +
              '<td style="text-align:center;width:50px">' + classificaPosBadge(pos) + '</td>' +
              '<td><strong>' + escapeHtmlSafe(classificaNome(d)) + '</strong>' +
                (d.email ? '<div style="font-size:11px;color:var(--text-light);margin-top:2px">' + escapeHtmlSafe(d.email) + '</div>' : '') +
              '</td>' +
              '<td style="color:var(--text-muted)">' + escapeHtmlSafe(CLASSIFICA_NOMI[citta] || citta || '—') + (CLASSIFICA_PROVINCE.indexOf(citta) < 0 ? ' <span style="font-size:10px;color:var(--text-light)">(senza premi)</span>' : '') + '</td>' +
              '<td style="text-align:right">' + (d.giorni || 0) + '</td>' +
              '<td style="text-align:right"><strong>' + (d.consegne || 0) + '</strong></td>' +
              '<td style="text-align:right">' + classificaTempoHtml(d) + '</td>' +
              '<td style="text-align:right;color:' + ((d.danni || 0) > 0 ? 'var(--danger)' : 'var(--text-light)') + '">' + (d.danni || 0) + '</td>' +
              '<td>' + classificaBonusHtml(d) + '</td>' +
              '<td style="text-align:right"><strong style="color:var(--accent);font-size:15px">' + (d.score || 0) + '</strong></td>' +
              '<td style="text-align:center">' + renderTrend(d.posPrec, pos) + '</td>' +
            '</tr>'
        );
    }).join('');

    return statCard +
        '<div class="card">' +
          '<div class="card-title">🌍 Classifica generale ' + meseLabel(mese) + '</div>' +
          '<div class="card-desc">Solo confronto: i premi si assegnano nelle classifiche per provincia (Catania, Messina, Palermo, Siracusa). Aggiornata ' + lastUpdateStr + ' · ' + scoringDesc + '</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:12px">' +
            '<button class="btn btn-sm solo-ufficio" onclick="rebuildClassifica()">🔄 Rebuild ora</button>' +
            '<button class="btn btn-sm" onclick="esportaClassificaCsv()">📥 Esporta CSV</button>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table class="data-table">' +
              '<thead><tr>' +
                '<th style="text-align:center">Pos.</th>' +
                '<th>Driver</th>' +
                '<th>Provincia</th>' +
                '<th style="text-align:right">Giorni</th>' +
                '<th style="text-align:right">Consegne</th>' +
                '<th style="text-align:right">Tempo medio</th>' +
                '<th style="text-align:right">Danni</th>' +
                '<th>Bonus</th>' +
                '<th style="text-align:right">Score</th>' +
                '<th style="text-align:center">Trend</th>' +
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

// CSV della scheda corrente: una provincia (con premi) o la generale
async function esportaClassificaCsv() {
    var mese = state.meseCorrente;
    try {
        var doc = await db.collection('leaderboardFull').doc(mese).get();
        if (!doc.exists) { toast('Classifica non disponibile', 'error'); return; }
        var data = doc.data();
        var tab = classificaState.prov || 'TUTTE';
        var perProv = tab !== 'TUTTE' && data.province && data.province[tab];
        var drivers = perProv ? (data.province[tab].drivers || []) : (data.drivers || []);
        var rows = [['Posizione', 'Cognome', 'Nome', 'Email', 'Provincia', 'Giorni lavorati', 'Consegne', 'Tempo medio (min)', 'Bonus velocita', 'Danni', 'Zero danni', 'Patente verificata', 'Score', 'Posizione mese precedente', 'Premiabile', 'Motivo non premiabile', 'Premio (EUR)', 'Premio ridotto per tetto', 'Premi anno precedenti (EUR)']];
        drivers.forEach(function(d, i) {
            rows.push([
                d.posizione || (i + 1),
                d.cognome || d.driver || '',
                d.nome || '',
                d.email || '',
                d.citta || '',
                d.giorni || 0,
                d.consegne || 0,
                d.tempoMedioMin != null ? d.tempoMedioMin : '',
                d.bonusVelocita || 0,
                d.danni || 0,
                d.bonusZeroDanni ? 'SI' : 'NO',
                d.patenteOk ? 'SI' : 'NO',
                d.score || 0,
                d.posPrec || '',
                perProv ? (d.premiabile ? 'SI' : 'NO') : '',
                perProv ? (d.motiviNonPremiabile || []).map(function(m) { return CLASSIFICA_MOTIVI[m] || m; }).join(', ') : '',
                perProv ? (d.premio || '') : '',
                perProv ? (d.premioRidotto ? 'SI' : 'NO') : '',
                perProv ? (d.premiAnno || 0) : '',
            ]);
        });
        if (perProv) {
            var c = data.province[tab];
            rows.push([]);
            rows.push(['Montepremi ' + c.nome, c.montepremi, 'Consegne', c.consegne, 'Premio', (data.regole && data.regole.premio) || '']);
        }
        var csv = rows.map(function(r) {
            return r.map(function(cell) {
                var s = String(cell);
                if (/[",;\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
                return s;
            }).join(';');
        }).join('\n');
        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'classifica_' + mese + (perProv ? '_' + tab : '') + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('esportaClassificaCsv:', e);
        toast('Errore export: ' + e.message, 'error');
    }
}
