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
    const compenso = count * (state.driverProfile?.costoConsegna || state.costoPerConsegna);

    document.getElementById('drvConsegneMese').textContent = formatNumber(count);
    document.getElementById('drvCompensoMese').textContent = formatCurrency(compenso);

    const giorni = new Set(myConsegne.map(c => {
        const d = c.data instanceof Date ? c.data : new Date(c.data);
        return d.toISOString().slice(0, 10);
    }));
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
    const driverName = getMyDriverName();
    if (!driverName) return;

    const costo = state.driverProfile?.costoConsegna || state.costoPerConsegna;

    // Group consegne by month
    const mesiData = {};
    state.consegne.forEach(c => {
        if (normalizeDriverName(c.driver) !== driverName) return;
        const m = meseFromDate(c.data);
        if (!m) return;
        if (!mesiData[m]) mesiData[m] = 0;
        mesiData[m]++;
    });

    // Get danni by month
    const danniByMese = {};
    state.danniList.forEach(d => {
        if (normalizeDriverName(d.driver) !== driverName) return;
        if (d.stato === 'annullato') return;
        const m = d.mese || (d.data ? d.data.substring(0, 7) : null);
        if (!m) return;
        if (!danniByMese[m]) danniByMese[m] = 0;
        danniByMese[m] += d.importo || 0;
    });

    const sorted = Object.entries(mesiData).sort((a, b) => b[0].localeCompare(a[0]));

    document.getElementById('tblDriverCompensiBody').innerHTML = sorted.map(([m, count]) => {
        const lordo = count * costo;
        const danni = danniByMese[m] || 0;
        const netto = lordo - danni;
        return `<tr>
            <td><strong>${meseLabel(m)}</strong></td>
            <td>${count}</td>
            <td>${formatCurrency(lordo)}</td>
            <td style="color:${danni > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${danni > 0 ? '-' + formatCurrency(danni) : '—'}</td>
            <td><strong>${formatCurrency(netto)}</strong></td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nessun dato</td></tr>';
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
