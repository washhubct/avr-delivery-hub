// DELIVERY HUB v2 — Presenze driver (griglia del mese per HR e responsabili)
//
// Fonte: presenzeDriver/{email}_{YYYY-MM-DD}, un doc per driver e giorno.
// I campi app (presenteApp, fonti, primoAccesso) li scrivono le CF
// presenzaDaTurno/presenzaDaRapporto quando il driver apre il turno o
// invia un rapporto; da qui si imposta solo causale + nota (ferie,
// malattia, presenza confermata a mano, annullo di una presenza app).
// Solo la presenza, niente ore. Chiusura mese in presenzeMesi/{mese}:
// dopo la chiusura i responsabili non modificano più, HR sì.
// Il file Arena del mese si confronta in locale (non viene caricato):
// evidenzia i giorni con consegne Arena ma senza presenza.

var PRES_CAUSALI = {
    presente:     { sigla: 'P',  label: 'Presente',     colore: '#10b981' },
    ferie:        { sigla: 'F',  label: 'Ferie',        colore: '#38bdf8' },
    malattia:     { sigla: 'M',  label: 'Malattia',     colore: '#a855f7' },
    permesso:     { sigla: 'PE', label: 'Permesso',     colore: '#6366f1' },
    riposo:       { sigla: 'R',  label: 'Riposo',       colore: '#64748b' },
    assente:      { sigla: 'AS', label: 'Assente',      colore: '#f43f5e' },
    non_lavorato: { sigla: '–',  label: 'Non lavorato (annulla la presenza app)', colore: '#94a3b8' }
};
var PRES_PROV = { CT: 'Catania', ME: 'Messina', PA: 'Palermo', SR: 'Siracusa', EN: 'Enna' };
var PRES_GG = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

var presState = { mese: '', docs: {}, righe: [], cognomiAnag: {}, arena: null, arenaNomi: null, chiuso: false };

function presMeseCorrente() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).format(new Date());
}
function presOggi() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function presGiorni(mese) {
    var p = mese.split('-').map(Number);
    var n = new Date(p[0], p[1], 0).getDate(), out = [];
    for (var i = 1; i <= n; i++) out.push(mese + '-' + String(i).padStart(2, '0'));
    return out;
}
function presGiornoSett(giorno) {
    return PRES_GG[new Date(giorno + 'T12:00:00').getDay()];
}
function presEsito(doc) {
    if (!doc) return null;
    if (doc.causale && PRES_CAUSALI[doc.causale]) return doc.causale;
    return doc.presenteApp ? 'presente' : null;
}
function presCanGestire() {
    return ['superadmin', 'amministratore', 'risorse_umane'].indexOf(state.userRole) >= 0;
}
function presCanModificare(citta) {
    if (presCanGestire()) return true;
    if (!isResponsabileZona() || presState.chiuso) return false;
    return (provinceVisibili() || []).indexOf(citta) >= 0;
}

async function renderPresenze() {
    var meseEl = document.getElementById('presMese');
    if (meseEl && !meseEl.value) meseEl.value = presMeseCorrente();
    var mese = meseEl ? meseEl.value : presMeseCorrente();
    if (mese !== presState.mese) { presState.arena = null; presState.arenaNomi = null; }
    presState.mese = mese;

    var provSel = document.getElementById('presProv');
    var mie = provinceVisibili();
    if (provSel && !provSel.dataset.init) {
        var lista = mie || Object.keys(PRES_PROV);
        provSel.innerHTML = (mie && mie.length === 1 ? '' : '<option value="">' + (mie ? 'Le mie province' : 'Tutte le province') + '</option>') +
            lista.map(function(p) { return '<option value="' + p + '">' + (PRES_PROV[p] || p) + '</option>'; }).join('');
        provSel.dataset.init = '1';
    }
    var box = document.getElementById('presGriglia');
    if (!box) return;
    box.innerHTML = '<p class="card-desc">Caricamento…</p>';

    try {
        var province = mie || null;
        var qs = province
            ? province.map(function(p) { return db.collection('presenzeDriver').where('citta', '==', p).where('mese', '==', mese).get(); })
            : [db.collection('presenzeDriver').where('mese', '==', mese).get()];
        var res = await Promise.all([db.collection('driverAnagrafica').get(), db.collection('presenzeMesi').doc(mese).get()].concat(qs));
        var anagSnap = res[0], meseDoc = res[1];
        presState.chiuso = meseDoc.exists && meseDoc.data().chiuso === true;
        presState.docs = {};
        res.slice(2).forEach(function(s) { s.forEach(function(d) { var x = d.data(); presState.docs[x.email + '|' + x.data] = x; }); });

        // Righe: driver attivi + chiunque abbia giorni nel mese
        var perEmail = {};
        presState.cognomiAnag = {};
        anagSnap.forEach(function(d) {
            var a = d.data(), em = (a.email || '').toLowerCase();
            if (a.cognome) presState.cognomiAnag[normalizzaNome(a.cognome).replace(/[^A-Z]/g, '')] = true;
            if (!em) return;
            var citta = (a.citta || '').toUpperCase();
            if (province && province.indexOf(citta) < 0) return;
            perEmail[em] = { email: em, cognome: (a.cognome || '').toUpperCase(), nome: a.nome || '', citta: citta, attivo: a.attivo !== false };
        });
        Object.keys(presState.docs).forEach(function(k) {
            var x = presState.docs[k];
            if (!perEmail[x.email]) perEmail[x.email] = { email: x.email, cognome: x.driver || x.email, nome: '', citta: x.citta || '', attivo: false };
        });
        var conGiorni = {};
        Object.keys(presState.docs).forEach(function(k) { conGiorni[presState.docs[k].email] = true; });
        presState.righe = Object.keys(perEmail).map(function(e) { return perEmail[e]; })
            .filter(function(r) { return r.attivo || conGiorni[r.email]; })
            .sort(function(a, b) { return (a.citta || 'ZZ').localeCompare(b.citta || 'ZZ') || a.cognome.localeCompare(b.cognome); });
    } catch (e) {
        console.error('renderPresenze:', e);
        box.innerHTML = '<p class="card-desc" style="color:var(--danger)">Errore caricamento: ' + escapeHtml(e.message) + '</p>';
        return;
    }
    presDisegna();
}

function presDisegna() {
    var mese = presState.mese, giorni = presGiorni(mese), oggi = presOggi();
    var fProv = (document.getElementById('presProv') || {}).value || '';
    var fNome = ((document.getElementById('presCerca') || {}).value || '').toUpperCase().trim();
    var righe = presState.righe.filter(function(r) {
        if (fProv && r.citta !== fProv) return false;
        if (fNome && (r.cognome + ' ' + r.nome).toUpperCase().indexOf(fNome) < 0) return false;
        return true;
    });

    // Stato mese + azioni
    var stato = document.getElementById('presStatoMese');
    if (stato) {
        stato.innerHTML = presState.chiuso
            ? '<span class="badge" style="background:rgba(244,63,94,0.12);color:var(--danger)">🔒 Mese chiuso</span>'
            : '<span class="badge" style="background:var(--success-bg);color:var(--success)">Mese aperto</span>';
    }
    var btnChiudi = document.getElementById('presBtnChiudi');
    if (btnChiudi) {
        btnChiudi.style.display = presCanGestire() ? '' : 'none';
        btnChiudi.textContent = presState.chiuso ? '🔓 Riapri mese' : '🔒 Chiudi mese';
    }

    // Banner "oggi": chi non ha ancora aperto il turno (solo mese corrente)
    var oggiBox = document.getElementById('presOggiBox');
    if (oggiBox) {
        if (mese !== presMeseCorrente()) { oggiBox.style.display = 'none'; }
        else {
            var attivi = righe.filter(function(r) { return r.attivo; });
            var presenti = 0, giustificati = 0, mancano = [];
            attivi.forEach(function(r) {
                var es = presEsito(presState.docs[r.email + '|' + oggi]);
                if (es === 'presente') presenti++;
                else if (es) giustificati++;
                else mancano.push(r.cognome);
            });
            oggiBox.style.display = 'block';
            oggiBox.innerHTML = '<strong>Oggi ' + presenti + ' su ' + attivi.length + ' hanno aperto il turno</strong>' +
                (giustificati ? ' · ' + giustificati + ' con causale' : '') +
                (mancano.length ? '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Non ancora: ' + escapeHtml(mancano.join(', ')) + '</div>' : '');
        }
    }

    // Griglia
    var h = '<div class="table-wrap"><table class="data-table pres-table"><thead><tr><th class="pres-nome">Driver</th><th>Prov.</th>';
    giorni.forEach(function(g) {
        var wd = presGiornoSett(g);
        h += '<th class="pres-g' + (wd === 'dom' ? ' pres-dom' : '') + (g === oggi ? ' pres-oggi' : '') + '">' + Number(g.slice(8)) + '<br><span>' + wd + '</span></th>';
    });
    h += '<th title="Giorni presente">P</th><th title="Ferie">F</th><th title="Malattia">M</th><th title="Permessi">PE</th><th title="Assenze">AS</th>' +
        (presState.arena ? '<th title="Giorni con consegne Arena ma senza presenza">Arena?</th>' : '') + '</tr></thead><tbody>';
    var totGiorno = {};
    righe.forEach(function(r) {
        var cont = { presente: 0, ferie: 0, malattia: 0, permesso: 0, assente: 0 }, arenaSenza = 0;
        h += '<tr><td class="pres-nome">' + escapeHtml(r.cognome + ' ' + r.nome) + (r.attivo ? '' : ' <span style="color:var(--text-muted);font-size:11px">(disatt.)</span>') + '</td><td>' + escapeHtml(r.citta) + '</td>';
        giorni.forEach(function(g) {
            var doc = presState.docs[r.email + '|' + g], es = presEsito(doc);
            var arenaN = presState.arena ? (presState.arena[r.email + '|' + g] || 0) : 0;
            var cls = 'pres-c' + (presGiornoSett(g) === 'dom' ? ' pres-dom' : '');
            var stile = '', txt = '', tip = PRES_CAUSALI[es] ? PRES_CAUSALI[es].label : '';
            if (es) {
                var c = PRES_CAUSALI[es];
                txt = c.sigla;
                stile = 'background:' + c.colore + '26;color:' + c.colore + ';';
                if (es in cont) cont[es]++;
                if (es === 'presente') totGiorno[g] = (totGiorno[g] || 0) + 1;
                if (doc && doc.causale) { cls += ' pres-man'; tip += ' (impostato da ' + (doc.modificatoDa || '?') + ')'; }
                if (arenaN && es !== 'presente') { cls += ' pres-warn'; tip += ' — ma Arena registra ' + arenaN + ' consegne'; }
            } else if (arenaN) {
                txt = 'A?'; cls += ' pres-arena'; arenaSenza++;
                tip = 'Arena registra ' + arenaN + ' consegne ma in app non c\'è presenza';
            }
            if (doc && doc.presenteApp) tip += (tip ? ' · ' : '') + 'app: ' + (doc.fonti ? doc.fonti.turno + ' turni, ' + doc.fonti.rapporto + ' rapporti' : '') + (doc.primoAccesso ? ', primo accesso ' + doc.primoAccesso : '');
            var click = presCanModificare(r.citta) ? ' onclick="presApriGiorno(\'' + r.email + '\',\'' + g + '\')"' : '';
            h += '<td class="' + cls + '" style="' + stile + '" title="' + escapeHtml(tip) + '"' + click + '>' + txt + '</td>';
        });
        h += '<td><strong>' + cont.presente + '</strong></td><td>' + (cont.ferie || '') + '</td><td>' + (cont.malattia || '') + '</td><td>' + (cont.permesso || '') + '</td><td>' + (cont.assente || '') + '</td>' +
            (presState.arena ? '<td style="color:var(--warning)">' + (arenaSenza || '') + '</td>' : '') + '</tr>';
    });
    h += '<tr class="pres-tot"><td class="pres-nome">Presenti</td><td></td>';
    giorni.forEach(function(g) { h += '<td>' + (totGiorno[g] || '') + '</td>'; });
    h += '<td colspan="' + (presState.arena ? 6 : 5) + '"></td></tr></tbody></table></div>';
    if (!righe.length) h = '<p class="card-desc">Nessun driver per i filtri scelti.</p>';
    document.getElementById('presGriglia').innerHTML = h;

    var nota = document.getElementById('presArenaNota');
    if (nota) {
        nota.style.display = presState.arena ? 'block' : 'none';
        if (presState.arena) nota.innerHTML = 'Confronto con il file Arena attivo: <strong>A?</strong> = consegne Arena senza presenza (da confermare), bordo rosso = causale di assenza ma Arena registra consegne.' +
            (presState.arenaNomi && presState.arenaNomi.length ? '<br>Nomi Arena non riconosciuti in anagrafica: ' + escapeHtml(presState.arenaNomi.join(', ')) : '');
    }
}

// ── Modifica di un giorno ──
function presApriGiorno(email, giorno) {
    var r = presState.righe.find(function(x) { return x.email === email; }) || {};
    var doc = presState.docs[email + '|' + giorno];
    var es = presEsito(doc);
    var info = [];
    if (doc && doc.presenteApp) info.push('In app: ' + (doc.fonti ? doc.fonti.turno + ' aperture turno, ' + doc.fonti.rapporto + ' rapporti' : 'presente') + (doc.primoAccesso ? ' · primo accesso ' + doc.primoAccesso : ''));
    else info.push('Nessuna attività in app quel giorno.');
    var arenaN = presState.arena ? (presState.arena[email + '|' + giorno] || 0) : 0;
    if (arenaN) info.push('Arena: ' + arenaN + ' consegne registrate.');
    if (doc && doc.causale) info.push('Causale impostata da ' + (doc.modificatoDa || '?'));
    var dataIt = giorno.slice(8) + '/' + giorno.slice(5, 7) + '/' + giorno.slice(0, 4);
    var html = '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">' + info.map(escapeHtml).join('<br>') + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
        Object.keys(PRES_CAUSALI).map(function(k) {
            var c = PRES_CAUSALI[k], sel = doc && doc.causale === k;
            return '<button class="btn' + (sel ? ' btn-primary' : '') + '" onclick="presSalvaGiorno(\'' + email + '\',\'' + giorno + '\',\'' + k + '\')"><strong style="color:' + c.colore + '">' + c.sigla + '</strong> ' + c.label + '</button>';
        }).join('') + '</div>' +
        '<textarea id="presNota" class="input" rows="2" style="width:100%" placeholder="Nota (facoltativa, es. numero protocollo certificato)">' + escapeHtml((doc && doc.nota) || '') + '</textarea>' +
        (doc && doc.causale ? '<button class="btn" style="margin-top:10px" onclick="presSalvaGiorno(\'' + email + '\',\'' + giorno + '\',null)">↩︎ Togli causale' + (doc.presenteApp ? ' (torna la presenza app)' : '') + '</button>' : '') +
        '<p style="font-size:12px;color:var(--text-muted);margin-top:10px">Stato attuale: <strong>' + (es ? PRES_CAUSALI[es].label : 'nessuna presenza') + '</strong></p>';
    openModal(r.cognome + ' ' + (r.nome || '') + ' — ' + dataIt, html);
}

async function presSalvaGiorno(email, giorno, causale) {
    var r = presState.righe.find(function(x) { return x.email === email; }) || {};
    var doc = presState.docs[email + '|' + giorno];
    var notaEl = document.getElementById('presNota');
    var nota = notaEl ? notaEl.value.trim().slice(0, 300) : '';
    var me = (auth.currentUser && auth.currentUser.email || '').toLowerCase();
    var ref = db.collection('presenzeDriver').doc(email + '_' + giorno);
    var campi = { causale: causale, nota: causale ? nota : '', modificatoDa: me, modificatoIl: firebase.firestore.FieldValue.serverTimestamp() };
    try {
        if (doc) await ref.update(campi);
        else {
            if (!causale) { closeModal(); return; }
            await ref.set(Object.assign({ email: email, data: giorno, mese: giorno.slice(0, 7), driver: r.cognome || '', driverNome: ((r.cognome || '') + ' ' + (r.nome || '')).trim(), citta: r.citta || '' }, campi));
        }
        presState.docs[email + '|' + giorno] = Object.assign({}, doc || { email: email, data: giorno, citta: r.citta }, { causale: causale, nota: campi.nota, modificatoDa: me });
        closeModal();
        presDisegna();
        toast(causale ? 'Salvato: ' + PRES_CAUSALI[causale].label : 'Causale tolta', 'success');
    } catch (e) {
        console.error('presSalvaGiorno:', e);
        toast('Errore: ' + (e.code === 'permission-denied' ? 'non hai i permessi (mese chiuso o provincia non tua)' : e.message), 'error');
    }
}

// ── Chiusura mese (HR / amministratore) ──
async function presToggleChiusura() {
    var chiudi = !presState.chiuso;
    if (!confirm(chiudi
        ? 'Chiudere le presenze di ' + presState.mese + '?\n\nI responsabili non potranno più modificarle; HR e amministratori sì.'
        : 'Riaprire le presenze di ' + presState.mese + '?')) return;
    try {
        await db.collection('presenzeMesi').doc(presState.mese).set({
            chiuso: chiudi,
            aggiornatoDa: (auth.currentUser && auth.currentUser.email || '').toLowerCase(),
            aggiornatoIl: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        presState.chiuso = chiudi;
        presDisegna();
        toast(chiudi ? 'Mese chiuso' : 'Mese riaperto', 'success');
    } catch (e) {
        toast('Errore: ' + e.message, 'error');
    }
}

// ── Export per HR / consulente ──
function presEsporta() {
    var giorni = presGiorni(presState.mese);
    var fProv = (document.getElementById('presProv') || {}).value || '';
    var righe = presState.righe.filter(function(r) { return !fProv || r.citta === fProv; });
    var intest = ['Cognome', 'Nome', 'Città'].concat(giorni.map(function(g) { return Number(g.slice(8)) + ' ' + presGiornoSett(g); }))
        .concat(['Presenze', 'Ferie', 'Malattia', 'Permessi', 'Riposi', 'Assenze', 'Note']);
    var rows = [intest];
    righe.forEach(function(r) {
        var cont = { presente: 0, ferie: 0, malattia: 0, permesso: 0, riposo: 0, assente: 0 }, note = [];
        var celle = giorni.map(function(g) {
            var doc = presState.docs[r.email + '|' + g], es = presEsito(doc);
            if (es in cont) cont[es]++;
            if (doc && doc.nota) note.push(Number(g.slice(8)) + ': ' + doc.nota);
            return es && es !== 'non_lavorato' ? PRES_CAUSALI[es].sigla : '';
        });
        rows.push([r.cognome, r.nome, PRES_PROV[r.citta] || r.citta].concat(celle)
            .concat([cont.presente, cont.ferie, cont.malattia, cont.permesso, cont.riposo, cont.assente, note.join('; ')]));
    });
    var leg = [['Sigla', 'Significato'], ['P', 'Presente (turno aperto o rapporto inviato nell\'app driver, oppure confermato dal responsabile)'],
        ['F', 'Ferie'], ['M', 'Malattia'], ['PE', 'Permesso'], ['R', 'Riposo'], ['AS', 'Assente'], ['', 'Nessuna presenza registrata'],
        [], ['Mese', presState.mese + (presState.chiuso ? ' (chiuso)' : ' (aperto, ancora modificabile)')], ['Esportato il', new Date().toLocaleString('it-IT')]];
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 10 }].concat(giorni.map(function() { return { wch: 4 }; })).concat([{ wch: 9 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 7 }, { wch: 8 }, { wch: 50 }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Presenze ' + presState.mese);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(leg), 'Legenda');
    XLSX.writeFile(wb, 'presenze_driver_' + presState.mese + (fProv ? '_' + fProv : '') + '.xlsx');
}

// ── Confronto con il file Arena del mese (letto in locale, non caricato) ──
function presCaricaArena(files) {
    var f = files && files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
        try {
            var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array', cellDates: true });
            presAnalizzaArena(wb);
        } catch (e) {
            toast('File non leggibile: ' + e.message, 'error');
        }
    };
    reader.readAsArrayBuffer(f);
}

function presAnalizzaArena(wb) {
    var norm = function(s) { return normalizzaNome(s).replace(/[^A-Z]/g, ''); };
    var perCognome = {};
    presState.righe.forEach(function(r) { (perCognome[norm(r.cognome)] = perCognome[norm(r.cognome)] || []).push(r.email); });
    var giornoDi = function(v) {
        if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
        if (typeof v === 'number') { var d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
        return '';
    };
    var arena = {}, ignoti = {}, righeLette = 0;
    wb.SheetNames.forEach(function(nome) {
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: null });
        if (!rows.length) return;
        var keys = Object.keys(rows[0]);
        var kRider = keys.find(function(k) { return /^(driver|rider)$/i.test(k.trim()); });
        var kData = keys.find(function(k) { return /^(dataconsegna|data)$/i.test(k.trim()); });
        var kOk = keys.find(function(k) { return /^consegnata/i.test(k.trim()); });
        if (!kRider || !kData) return;
        rows.forEach(function(r) {
            if (kOk && String(r[kOk] || '').toUpperCase() !== 'SI') return;
            var g = giornoDi(r[kData]);
            if (g.slice(0, 7) !== presState.mese) return;
            righeLette++;
            // Righe in coppia ("ORLANDO & ARICO'", "SCHILLACI / ARICO"): presenza per entrambi
            String(r[kRider] || '').split(/&|\//).forEach(function(p) {
                var c = norm(p);
                if (!c || c === 'LASTMILE') return;
                var em = perCognome[c];
                if (em && em.length === 1) arena[em[0] + '|' + g] = (arena[em[0] + '|' + g] || 0) + 1;
                // Driver di altre province (vista responsabile) non sono "ignoti"
                else if (!presState.cognomiAnag[c]) ignoti[p.trim().toUpperCase()] = true;
            });
        });
    });
    if (!righeLette) { toast('Nessuna consegna di ' + presState.mese + ' trovata nel file', 'error'); return; }
    presState.arena = arena;
    presState.arenaNomi = Object.keys(ignoti).sort();
    presDisegna();
    toast('File Arena confrontato: ' + righeLette + ' consegne lette', 'success');
}
