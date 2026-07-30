// DELIVERY HUB v2 — Anagrafica Driver (con ricerca + creazione accesso app)

function renderAnagraficaDriver() {
    const tbody = document.getElementById('tblAnagraficaDriver');
    if (state.driverList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Nessun driver. Clicca "Popola driver" per caricare la lista preconfigurata.</td></tr>';
        return;
    }

    var searchTerm = document.getElementById('searchAnagrafica') ? document.getElementById('searchAnagrafica').value.toUpperCase().trim() : '';

    var sorted = [...state.driverList].sort((a,b) => (a.citta||'').localeCompare(b.citta||'') || (a.cognome||'').localeCompare(b.cognome||''));

    if (searchTerm) {
        sorted = sorted.filter(function(d) {
            var full = ((d.cognome || '') + ' ' + (d.nome || '')).toUpperCase();
            return full.indexOf(searchTerm) >= 0;
        });
    }

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Nessun risultato per "' + searchTerm + '"</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(d => {
        const idSafe = escapeHtml(d.id);
        return `<tr>
        <td><strong>${escapeHtml(d.cognome)}</strong></td>
        <td>${escapeHtml(d.nome)}</td>
        <td><span class="badge badge-info">${escapeHtml(d.citta)}</span></td>
        <td>${escapeHtml(d.contratto) || '—'}</td>
        <td>${scadenzaBadge(d.scadenzaContratto)}</td>
        <td><span class="badge ${d.attivo !== false ? 'badge-ok' : 'badge-err'}">${d.attivo !== false ? 'Attivo' : 'Inattivo'}</span></td>
        <td>
            <button class="btn btn-sm" onclick="editDriver('${idSafe}')">✏️</button>
            <button class="btn btn-sm btn-danger" title="Disattiva/riattiva (blocca l'app; archiviazione automatica dopo 90gg)" onclick="toggleDriverAttivo('${idSafe}')">⏸️</button>
        </td>
    </tr>`;
    }).join('');
}

// Badge scadenza contratto: rosso se scaduto, giallo se entro 30 giorni
function scadenzaBadge(scad) {
    if (!scad) return '<span style="color:var(--text-light)">Indeterminato</span>';
    var d = new Date(scad + 'T12:00:00');
    if (isNaN(d)) return escapeHtml(scad);
    var label = d.toLocaleDateString('it-IT');
    var oggi = new Date();
    var giorni = Math.floor((d - oggi) / 86400000);
    if (giorni < 0) return '<span class="badge badge-err" title="Contratto scaduto">⚠️ ' + label + '</span>';
    if (giorni <= 30) return '<span class="badge badge-warn" title="Scade tra ' + giorni + ' giorni">' + label + '</span>';
    return label;
}

var CONTRATTI_TIPI = ['Full time', 'Part time'];

function contrattoOptions(current) {
    var tipi = CONTRATTI_TIPI.slice();
    // Mantieni visibile un eventuale valore legacy (CO.CO.CO, P.O., Dipendente…)
    if (current && tipi.indexOf(current) < 0) tipi.push(current);
    return tipi.map(function(c) {
        return '<option value="' + escapeHtml(c) + '"' + (c === current ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
    }).join('');
}

function openAddDriver() {
    openModal('Aggiungi driver', `
        <div class="form-group"><label>Cognome</label><input type="text" id="drCognome" class="input"></div>
        <div class="form-group"><label>Nome</label><input type="text" id="drNome" class="input"></div>
        <div class="form-group"><label>Città</label>
            <select id="drCitta" class="input">
                <option value="CT">Catania</option><option value="ME">Messina</option>
                <option value="EN">Enna</option><option value="SR">Siracusa</option><option value="PA">Palermo</option>
            </select>
        </div>
        <div class="form-group"><label>Contratto</label>
            <select id="drContratto" class="input">${contrattoOptions('Full time')}</select>
        </div>
        <div class="form-group"><label>Scadenza contratto <span style="color:var(--text-light);font-weight:400">(vuoto = indeterminato)</span></label><input type="date" id="drScadenza" class="input"></div>
        <div class="form-group"><label>Email (per accesso driver app)</label><input type="email" id="drEmail" class="input" placeholder="obbligatoria per accesso app"></div>
        <div class="form-group"><label>Alias sui fogli Decò <span style="color:var(--text-light);font-weight:400">(altri nomi con cui appare come rider, separati da virgola)</span></label><input type="text" id="drAlias" class="input" placeholder="es. FELIX"></div>
        <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-primary" onclick="saveDriverAndCreateAccess()" style="flex:1">Salva + Crea accesso app</button>
        </div>
        <button class="btn" onclick="saveDriver()" style="width:100%;margin-top:6px">Salva senza accesso app</button>
    `);
}

async function saveDriver(editId) {
    const data = {
        cognome: document.getElementById('drCognome').value.trim().toUpperCase(),
        nome: document.getElementById('drNome').value.trim(),
        citta: document.getElementById('drCitta').value,
        contratto: document.getElementById('drContratto').value,
        scadenzaContratto: document.getElementById('drScadenza')?.value || null,
        email: document.getElementById('drEmail')?.value.trim().toLowerCase() || null,
        alias: (document.getElementById('drAlias')?.value || '').split(',').map(a => a.trim().toUpperCase()).filter(Boolean),
        attivo: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!data.cognome) { toast('Inserisci il cognome', 'error'); return; }
    const btn = document.querySelector('[onclick="saveDriver()"], [onclick="saveDriver(\'' + (editId || '') + '\')"]');
    if (btn) btn.disabled = true;
    try {
        if (editId) {
            await db.collection('driverAnagrafica').doc(editId).update(data);
        } else {
            await db.collection('driverAnagrafica').add(data);
        }
        toast('Driver salvato', 'success');
        closeModal();
        await loadDriverAnagrafica();
        renderAnagraficaDriver();
    } catch (e) {
        toast('Errore: impossibile salvare il driver — riprova', 'error');
        console.error('saveDriver error:', e);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function saveDriverAndCreateAccess() {
    var email = document.getElementById('drEmail')?.value.trim().toLowerCase();
    if (!email) { toast('Inserisci l\'email per creare l\'accesso app', 'error'); return; }
    var btn = document.querySelector('[onclick="saveDriverAndCreateAccess()"]');
    if (btn) btn.disabled = true;
    try {
        await saveDriver();
        await creaAccessoDriver(email);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Chiama la CF brandizzata inviaCredenzialiDriver: trova-o-crea utente Auth
// e manda mail di reset via Resend (template AVR, dominio avrlogisticarl.com).
// Sostituisce auth.sendPasswordResetEmail() che mandava da firebaseapp.com.
async function inviaAccessoBrandizzato(email) {
    const user = auth.currentUser;
    if (!user) throw new Error('Sessione admin scaduta — rifai login');
    const idToken = await user.getIdToken();
    const resp = await fetch('https://europe-west1-avr-logistic-dashboard.cloudfunctions.net/inviaCredenzialiDriver', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + idToken,
        },
        body: JSON.stringify({ email }),
    });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.error || ('HTTP ' + resp.status));
    return body; // { success, created, sent, uid }
}

async function creaAccessoDriver(email) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast('Email non valida', 'error');
        return;
    }
    try {
        const r = await inviaAccessoBrandizzato(email);
        const msg = r.created
            ? 'Accesso creato e email di reset inviata a ' + email
            : 'Utente già esistente — email di reset reinviata a ' + email;
        toast(msg, 'success');
    } catch (e) {
        console.error('creaAccessoDriver:', e);
        toast('Errore: ' + e.message, 'error');
    }
}

async function editDriver(id) {
    const d = state.driverList.find(x => x.id === id);
    if (!d) return;
    openModal('Modifica driver', `
        <div class="form-group"><label>Cognome</label><input type="text" id="drCognome" class="input" value="${d.cognome}"></div>
        <div class="form-group"><label>Nome</label><input type="text" id="drNome" class="input" value="${d.nome}"></div>
        <div class="form-group"><label>Città</label>
            <select id="drCitta" class="input">
                ${['CT','ME','EN','SR','PA'].map(a => `<option value="${a}" ${d.citta===a?'selected':''}>${state.aree[a]?.nome||a}</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>Contratto</label>
            <select id="drContratto" class="input">${contrattoOptions(d.contratto)}</select>
        </div>
        <div class="form-group"><label>Scadenza contratto <span style="color:var(--text-light);font-weight:400">(vuoto = indeterminato)</span></label><input type="date" id="drScadenza" class="input" value="${d.scadenzaContratto || ''}"></div>
        <div class="form-group"><label>Email</label><input type="email" id="drEmail" class="input" value="${d.email||''}"></div>
        <div class="form-group"><label>Alias sui fogli Decò <span style="color:var(--text-light);font-weight:400">(separati da virgola)</span></label><input type="text" id="drAlias" class="input" value="${Array.isArray(d.alias)?d.alias.join(', '):''}"></div>
        <button class="btn btn-primary" onclick="saveDriver('${id}')" style="width:100%;margin-top:8px">Aggiorna</button>
        ${d.email ? `<button class="btn" onclick="reinviaResetPassword('${d.email}')" style="width:100%;margin-top:6px">📧 Reinvia password di accesso</button>` : `<button class="btn" onclick="creaAccessoDriver(document.getElementById('drEmail').value.trim().toLowerCase())" style="width:100%;margin-top:6px">🔑 Crea accesso app</button>`}
    `);
}

async function reinviaResetPassword(email) {
    // Stesso flow di creaAccessoDriver: la CF è idempotente — se l'utente Auth
    // non esiste lo crea, altrimenti manda solo il link. In entrambi i casi
    // mail brandizzata via Resend.
    try {
        const r = await inviaAccessoBrandizzato(email);
        const msg = r.created
            ? 'Accesso creato (mancava in Auth) ed email inviata a ' + email
            : 'Email di reset inviata a ' + email;
        toast(msg, 'success');
    } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

async function toggleDriverAttivo(id) {
    const d = state.driverList.find(x => x.id === id);
    if (!d) return;
    const newState = d.attivo === false ? true : false;
    const label = newState ? 'attivare' : 'disattivare';
    const avviso = newState
        ? `Vuoi attivare il driver ${d.cognome} ${d.nome || ''}?`
        : `Vuoi disattivare il driver ${d.cognome} ${d.nome || ''}?\n\n` +
          `• L'accesso all'app viene bloccato subito\n` +
          `• Le sue consegne restano attribuite a Last Mile\n` +
          `• Dopo 90 giorni l'anagrafica viene archiviata automaticamente`;
    if (!confirm(avviso)) return;
    try {
        await db.collection('driverAnagrafica').doc(id).update({
            attivo: newState,
            disattivatoIl: newState ? firebase.firestore.FieldValue.delete() : firebase.firestore.FieldValue.serverTimestamp()
        });
        toast(`Driver ${newState ? 'attivato' : 'disattivato — accesso app bloccato'}`, 'success');
        await loadDriverAnagrafica();
        renderAnagraficaDriver();
    } catch (e) {
        toast('Errore: impossibile aggiornare lo stato del driver', 'error');
        console.error('toggleDriverAttivo error:', e);
    }
}

async function eliminaDriver(id) {
    var d = state.driverList.find(function(x) { return x.id === id; });
    var nome = d ? ((d.cognome || '') + ' ' + (d.nome || '')).trim() : id;
    if (!confirm('Sei sicuro di voler eliminare ' + nome + ' dall\'anagrafica?\n\nQuesta azione è irreversibile.')) return;
    if (!confirm('Conferma eliminazione di ' + nome + '?')) return;
    try {
        await db.collection('driverAnagrafica').doc(id).delete();
        toast('Driver ' + nome + ' eliminato', 'success');
        await loadDriverAnagrafica();
        renderAnagraficaDriver();
    } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

async function popolaDriver() {
    if (state.driverList.length > 0) {
        if (!confirm('Ci sono già driver in anagrafica. Vuoi aggiungere quelli mancanti?')) return;
    }
    const existing = state.driverList.map(d => `${d.cognome}_${d.nome}`);
    let added = 0;
    for (const d of state.driverPreload) {
        const key = `${d.cognome}_${d.nome}`;
        if (existing.includes(key)) continue;
        await db.collection('driverAnagrafica').add({
            ...d,
            attivo: true,
            email: null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        added++;
    }
    toast(`${added} driver aggiunti`, 'success');
    await loadDriverAnagrafica();
    renderAnagraficaDriver();
}
