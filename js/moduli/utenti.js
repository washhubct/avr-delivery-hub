// DELIVERY HUB v2 — Utenti (admin/HR/responsabili)
// Collection: utenti/{emailLower}
//   { email, nome, mansione: "amministratore"|"risorse_umane"|"responsabile",
//     province: string[] (solo responsabile), attivo: bool, creatoIl, aggiornatoIl }
//
// Solo superadmin (amministrazione@) può scrivere qui — le altre rules leggono
// utenti/{email}.mansione per decidere gli accessi. Così nessuno può alzarsi
// il ruolo autonomamente.

var UTENTI_ROLES = {
    amministratore: { label: 'Amministratore', badge: 'ok' },
    risorse_umane:  { label: 'Risorse Umane',  badge: 'info' },
    responsabile:   { label: 'Responsabile',   badge: 'warn' }
};

var UTENTI_PROVINCE = ['CT', 'SR', 'ME', 'PA', 'EN'];

async function loadUtenti() {
    try {
        var snap = await db.collection('utenti').get();
        state.utentiList = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            return d;
        });
    } catch (e) {
        console.warn('loadUtenti error:', e.message);
        state.utentiList = [];
    }
}

function renderUtenti() {
    var tbody = document.getElementById('tblUtentiBody');
    if (!tbody) return;
    var list = state.utentiList || [];
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:40px">Nessun utente registrato. Clicca "Aggiungi utente" per iniziare.</td></tr>';
        return;
    }
    var mansioneOrder = { amministratore: 0, risorse_umane: 1, responsabile: 2 };
    var sorted = list.slice().sort(function(a, b) {
        var oa = mansioneOrder[a.mansione] != null ? mansioneOrder[a.mansione] : 99;
        var ob = mansioneOrder[b.mansione] != null ? mansioneOrder[b.mansione] : 99;
        if (oa !== ob) return oa - ob;
        return (a.nome || '').localeCompare(b.nome || '');
    });
    tbody.innerHTML = sorted.map(function(u) {
        var m = UTENTI_ROLES[u.mansione] || { label: u.mansione || '—', badge: 'info' };
        var prov = Array.isArray(u.province) && u.province.length
            ? u.province.map(function(p) { return '<span class="badge badge-info" style="margin-right:4px">' + escapeHtml(p) + '</span>'; }).join('')
            : (u.mansione === 'responsabile' ? '<span class="badge badge-warn">nessuna</span>' : '—');
        var stato = u.attivo === false
            ? '<span class="badge badge-err">Disattivato</span>'
            : '<span class="badge badge-ok">Attivo</span>';
        var emailSafe = escapeHtml(u.id);
        return '<tr>' +
            '<td><strong>' + escapeHtml(u.nome || '—') + '</strong></td>' +
            '<td style="font-family:var(--font-mono);font-size:12px">' + escapeHtml(u.email || u.id) + '</td>' +
            '<td><span class="badge badge-' + m.badge + '">' + m.label + '</span></td>' +
            '<td>' + prov + '</td>' +
            '<td>' + stato + '</td>' +
            '<td style="white-space:nowrap">' +
                '<button class="btn btn-sm" onclick="editUtente(\'' + emailSafe + '\')" title="Modifica">✏️</button> ' +
                '<button class="btn btn-sm" onclick="toggleAttivoUtente(\'' + emailSafe + '\')" title="' + (u.attivo === false ? 'Riattiva' : 'Disattiva') + '">' + (u.attivo === false ? '✅' : '⏸️') + '</button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

function utenteFormHTML(u) {
    u = u || {};
    var isEdit = !!u.id;
    var mansione = u.mansione || '';
    var province = Array.isArray(u.province) ? u.province : [];
    return (
        '<div class="form-group"><label>Nome completo</label>' +
            '<input type="text" id="uNome" class="input" placeholder="es. Michela Rossi" value="' + escapeHtml(u.nome || '') + '"></div>' +
        '<div class="form-group"><label>Email</label>' +
            '<input type="email" id="uEmail" class="input" placeholder="nome@avrlogisticarl.com" value="' + escapeHtml(u.email || '') + '"' +
            (isEdit ? ' readonly style="opacity:0.6"' : '') + '></div>' +
        '<div class="form-group"><label>Mansione</label>' +
            '<select id="uMansione" class="input" onchange="onUtenteMansioneChange()">' +
                '<option value="">— seleziona —</option>' +
                Object.keys(UTENTI_ROLES).map(function(k) {
                    return '<option value="' + k + '"' + (mansione === k ? ' selected' : '') + '>' + UTENTI_ROLES[k].label + '</option>';
                }).join('') +
            '</select></div>' +
        '<div class="form-group" id="uProvinceWrap" style="' + (mansione === 'responsabile' ? '' : 'display:none') + '">' +
            '<label>Province gestite <span style="color:var(--text-muted);font-weight:400">(solo Responsabile)</span></label>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
                UTENTI_PROVINCE.map(function(p) {
                    var checked = province.indexOf(p) >= 0 ? 'checked' : '';
                    return (
                        '<label style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:var(--bg-elev)">' +
                            '<input type="checkbox" class="u-provincia" value="' + p + '" ' + checked + '> ' +
                            '<span style="font-weight:600">' + p + '</span>' +
                        '</label>'
                    );
                }).join('') +
            '</div></div>' +
        '<button class="btn btn-primary" onclick="saveUtente(' + (isEdit ? '\'' + escapeHtml(u.id) + '\'' : '') + ')" style="width:100%;margin-top:8px">' +
            (isEdit ? 'Aggiorna utente' : 'Aggiungi utente') +
        '</button>'
    );
}

function openAddUtente() {
    openModal('Aggiungi utente', utenteFormHTML());
}

function editUtente(id) {
    var u = (state.utentiList || []).find(function(x) { return x.id === id; });
    if (!u) { toast('Utente non trovato', 'error'); return; }
    openModal('Modifica utente ' + (u.nome || u.email), utenteFormHTML(u));
}

function onUtenteMansioneChange() {
    var sel = document.getElementById('uMansione');
    var wrap = document.getElementById('uProvinceWrap');
    if (!sel || !wrap) return;
    wrap.style.display = sel.value === 'responsabile' ? 'block' : 'none';
}

async function saveUtente(editId) {
    var nome = (document.getElementById('uNome').value || '').trim();
    var emailRaw = (document.getElementById('uEmail').value || '').trim();
    var mansione = document.getElementById('uMansione').value;
    var email = emailRaw.toLowerCase();

    if (!nome) { toast('Nome obbligatorio', 'error'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Email non valida', 'error'); return; }
    if (!mansione || !UTENTI_ROLES[mansione]) { toast('Seleziona una mansione', 'error'); return; }

    var province = [];
    if (mansione === 'responsabile') {
        document.querySelectorAll('.u-provincia:checked').forEach(function(cb) { province.push(cb.value); });
        if (province.length === 0) { toast('Un Responsabile deve avere almeno una provincia', 'error'); return; }
    }

    // Blocca sovrascrittura del superadmin hardcoded
    if (email === 'amministrazione@avrlogisticarl.com') {
        toast('Questo account è il Superadmin di sistema — non modificabile qui', 'error');
        return;
    }

    var btn = document.querySelector('.modal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio...'; }

    var payload = {
        email: email,
        nome: nome,
        mansione: mansione,
        province: province,
        attivo: true,
        aggiornatoIl: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!editId) payload.creatoIl = firebase.firestore.FieldValue.serverTimestamp();

    try {
        await db.collection('utenti').doc(email).set(payload, { merge: true });
        toast(editId ? 'Utente aggiornato' : 'Utente aggiunto', 'success');
        closeModal();
        await loadUtenti();
        renderUtenti();
    } catch (e) {
        console.error('saveUtente:', e);
        toast('Errore: ' + (e.message || 'salvataggio fallito'), 'error');
    } finally {
        if (btn) { btn.disabled = false; }
    }
}

async function toggleAttivoUtente(id) {
    var u = (state.utentiList || []).find(function(x) { return x.id === id; });
    if (!u) return;
    var nuovoStato = !(u.attivo === false) ? false : true; // toggle
    var azione = nuovoStato ? 'riattivare' : 'disattivare';
    if (!confirm('Vuoi ' + azione + ' l\'utente ' + (u.nome || u.email) + '?')) return;
    try {
        await db.collection('utenti').doc(id).update({
            attivo: nuovoStato,
            aggiornatoIl: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast('Utente ' + (nuovoStato ? 'riattivato' : 'disattivato'), 'success');
        await loadUtenti();
        renderUtenti();
    } catch (e) {
        toast('Errore: ' + (e.message || 'aggiornamento fallito'), 'error');
    }
}
