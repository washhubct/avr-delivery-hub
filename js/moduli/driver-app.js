// DELIVERY HUB v2 — Driver App (driver-side views)

function renderDriverConsegne() {
    const mese = state.meseCorrente;
    const driverName = getMyDriverName();
    if (!driverName) {
        document.getElementById('tblDriverConsegne').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Profilo driver non trovato</td></tr>';
        return;
    }

    const myConsegne = state.consegne.filter(c => {
        if (meseFromDate(c.data) !== mese) return false;
        return normalizeDriverName(c.driver) === driverName;
    });

    const count = myConsegne.length;

    document.getElementById('drvConsegneMese').textContent = formatNumber(count);

    const giorni = new Set(myConsegne.map(c => {
        const d = c.data instanceof Date ? c.data : new Date(c.data);
        return d.toISOString().slice(0, 10);
    }));
    document.getElementById('drvGiorniAttivi').textContent = giorni.size;
    document.getElementById('drvMedia').textContent = giorni.size > 0 ? Math.round(count / giorni.size) : '—';

    const sorted = [...myConsegne].sort((a, b) => {
        const da = a.data instanceof Date ? a.data : new Date(a.data);
        const db2 = b.data instanceof Date ? b.data : new Date(b.data);
        return db2 - da;
    });

    document.getElementById('tblDriverConsegne').innerHTML = sorted.map(c => `<tr>
        <td>${formatDate(c.data)}</td>
        <td>${c.filiale || '—'}</td>
        <td>${c.cliente || '—'}</td>
        <td style="text-align:right">${formatCurrency(c.importo)}</td>
        <td><span class="badge ${c.consegnata ? 'badge-ok' : 'badge-warn'}">${c.consegnata ? 'Consegnata' : 'In corso'}</span></td>
    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nessuna consegna questo mese</td></tr>';
}

function renderDriverCompensi() {
    // Storico mensile consegne — i driver sono dipendenti a stipendio fisso,
    // quindi niente più calcolo € a consegna: solo conteggi.
    const driverName = getMyDriverName();
    if (!driverName) return;

    // Group consegne by month
    const mesiData = {};
    state.consegne.forEach(c => {
        if (normalizeDriverName(c.driver) !== driverName) return;
        const m = meseFromDate(c.data);
        if (!m) return;
        if (!mesiData[m]) mesiData[m] = { count: 0, giorni: new Set() };
        mesiData[m].count++;
        const d = c.data instanceof Date ? c.data : new Date(c.data);
        if (!isNaN(d)) mesiData[m].giorni.add(d.toISOString().slice(0, 10));
    });

    const sorted = Object.entries(mesiData).sort((a, b) => b[0].localeCompare(a[0]));

    document.getElementById('tblDriverCompensiBody').innerHTML = sorted.map(([m, data]) => {
        const g = data.giorni.size;
        return `<tr>
            <td><strong>${meseLabel(m)}</strong></td>
            <td>${data.count}</td>
            <td>${g}</td>
            <td>${g > 0 ? Math.round(data.count / g) : '—'}</td>
        </tr>`;
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
