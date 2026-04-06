// DELIVERY HUB v2 — Danni / Furgoni

function renderDanni() {
    const tbody = document.getElementById('tblDanni');
    const sorted = [...state.danniList].sort((a, b) => {
        const da = a.data instanceof Date ? a.data : new Date(a.data);
        const db2 = b.data instanceof Date ? b.data : new Date(b.data);
        return db2 - da;
    });

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Nessun danno registrato</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(d => {
        const statoClass = d.stato === 'risolto' ? 'badge-ok' : d.stato === 'annullato' ? 'badge-err' : 'badge-warn';
        return `<tr>
            <td>${formatDate(d.data)}</td>
            <td><strong>${d.driver || '—'}</strong></td>
            <td>${d.targa || '—'}</td>
            <td>${d.descrizione || '—'}</td>
            <td style="color:var(--danger)">${formatCurrency(d.importo)}</td>
            <td><span class="badge ${statoClass}">${d.stato || 'aperto'}</span></td>
            <td>
                <button class="btn btn-sm" onclick="editDanno('${d.id}')">✏️</button>
                <button class="btn btn-sm" onclick="changeDannoStato('${d.id}')">🔄</button>
            </td>
        </tr>`;
    }).join('');
}

function openAddDanno() {
    const driverOpts = state.driverList
        .filter(d => d.attivo !== false)
        .sort((a,b) => (a.cognome||'').localeCompare(b.cognome||''))
        .map(d => `<option value="${d.cognome}">${d.cognome} ${d.nome} (${d.citta})</option>`)
        .join('');

    openModal('Registra danno', `
        <div class="form-group"><label>Data</label><input type="date" id="danData" class="input" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="form-group"><label>Driver responsabile</label>
            <select id="danDriver" class="input"><option value="">Seleziona...</option>${driverOpts}</select>
        </div>
        <div class="form-group"><label>Targa furgone</label><input type="text" id="danTarga" class="input" placeholder="es. GS756LX"></div>
        <div class="form-group"><label>Descrizione</label><textarea id="danDescrizione" class="input" rows="3" placeholder="Descrivi il danno..."></textarea></div>
        <div class="form-group"><label>Importo danno (€)</label><input type="number" id="danImporto" class="input" step="0.01" placeholder="0.00"></div>
        <button class="btn btn-primary" onclick="saveDanno()" style="width:100%;margin-top:8px">Registra danno</button>
    `);
}

async function saveDanno(editId) {
    const data = {
        data: document.getElementById('danData').value,
        driver: document.getElementById('danDriver').value,
        targa: document.getElementById('danTarga').value.trim().toUpperCase(),
        descrizione: document.getElementById('danDescrizione').value.trim(),
        importo: parseFloat(document.getElementById('danImporto').value) || 0,
        stato: 'aperto',
        mese: document.getElementById('danData').value.substring(0, 7),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!data.driver) { toast('Seleziona il driver', 'error'); return; }
    if (!data.importo) { toast('Inserisci l\'importo', 'error'); return; }

    try {
        if (editId) {
            await db.collection('danni').doc(editId).update(data);
        } else {
            await db.collection('danni').add(data);
        }
        toast('Danno registrato', 'success');
        closeModal();
        await loadDanni();
        renderDanni();
    } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

async function editDanno(id) {
    const d = state.danniList.find(x => x.id === id);
    if (!d) return;

    const driverOpts = state.driverList
        .filter(dr => dr.attivo !== false)
        .map(dr => `<option value="${dr.cognome}" ${d.driver === dr.cognome ? 'selected' : ''}>${dr.cognome} ${dr.nome}</option>`)
        .join('');

    const dataVal = d.data instanceof Date ? d.data.toISOString().slice(0,10) : (d.data || '').substring(0, 10);

    openModal('Modifica danno', `
        <div class="form-group"><label>Data</label><input type="date" id="danData" class="input" value="${dataVal}"></div>
        <div class="form-group"><label>Driver</label><select id="danDriver" class="input">${driverOpts}</select></div>
        <div class="form-group"><label>Targa</label><input type="text" id="danTarga" class="input" value="${d.targa || ''}"></div>
        <div class="form-group"><label>Descrizione</label><textarea id="danDescrizione" class="input" rows="3">${d.descrizione || ''}</textarea></div>
        <div class="form-group"><label>Importo (€)</label><input type="number" id="danImporto" class="input" value="${d.importo || 0}" step="0.01"></div>
        <button class="btn btn-primary" onclick="saveDanno('${id}')" style="width:100%;margin-top:8px">Aggiorna</button>
    `);
}

async function changeDannoStato(id) {
    const d = state.danniList.find(x => x.id === id);
    if (!d) return;
    const stati = ['aperto', 'risolto', 'annullato'];
    const currentIdx = stati.indexOf(d.stato || 'aperto');
    const newStato = stati[(currentIdx + 1) % stati.length];

    await db.collection('danni').doc(id).update({ stato: newStato });
    toast(`Stato cambiato a: ${newStato}`, 'success');
    await loadDanni();
    renderDanni();
}
