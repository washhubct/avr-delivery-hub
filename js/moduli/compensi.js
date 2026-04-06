// DELIVERY HUB v2 — Compensi Driver

function renderCompensi() {
    const mese = state.meseCorrente;
    const cm = state.consegne.filter(c => meseFromDate(c.data) === mese);

    // Count per driver
    const driverData = {};
    cm.forEach(c => {
        const drv = normalizeDriverName(c.driver);
        if (!drv) return;
        if (!driverData[drv]) driverData[drv] = { count: 0, citta: '' };
        driverData[drv].count++;
    });

    // Match with anagrafica for city and cost
    const rows = [];
    let totConsegne = 0, totLordo = 0, totDanni = 0, totNetto = 0;

    // Get danni for this month
    const danniMese = state.danniList.filter(d => {
        const m = meseFromDate(d.data);
        return m === mese && d.stato !== 'annullato';
    });

    // Build driver rows
    const processedDrivers = new Set();

    // First: drivers from consegne data
    Object.entries(driverData).forEach(([drv, data]) => {
        const anagrafica = findDriverAnagrafica(drv);
        const costo = anagrafica?.costoConsegna || state.costoPerConsegna;
        const citta = anagrafica?.citta || '—';
        const lordo = data.count * costo;

        // Danni for this driver
        const danniDriver = danniMese.filter(d => normalizeDriverName(d.driver) === drv)
            .reduce((sum, d) => sum + (d.importo || 0), 0);

        const netto = lordo - danniDriver;
        totConsegne += data.count;
        totLordo += lordo;
        totDanni += danniDriver;
        totNetto += netto;

        rows.push({ drv, citta, count: data.count, lordo, danni: danniDriver, netto });
        processedDrivers.add(drv);
    });

    rows.sort((a, b) => b.count - a.count);

    // KPI
    document.getElementById('compTotale').textContent = formatCurrency(totLordo);
    document.getElementById('compDanni').textContent = formatCurrency(totDanni);
    document.getElementById('compNetto').textContent = formatCurrency(totNetto);

    // Table
    document.getElementById('tblCompensi').innerHTML = rows.map(r => `<tr>
        <td><strong>${r.drv}</strong></td>
        <td><span class="badge badge-info">${r.citta}</span></td>
        <td>${r.count}</td>
        <td>${formatCurrency(r.lordo)}</td>
        <td style="color:${r.danni > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${r.danni > 0 ? '-' + formatCurrency(r.danni) : '—'}</td>
        <td><strong>${formatCurrency(r.netto)}</strong></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nessun dato per questo mese</td></tr>';

    document.getElementById('compTotConsegne').textContent = totConsegne;
    document.getElementById('compTotLordo').textContent = formatCurrency(totLordo);
    document.getElementById('compTotDanniTab').textContent = totDanni > 0 ? '-' + formatCurrency(totDanni) : '—';
    document.getElementById('compTotNettoTab').innerHTML = `<strong>${formatCurrency(totNetto)}</strong>`;
}

function normalizeDriverName(name) {
    if (!name) return null;
    const n = name.toUpperCase().trim();
    if (n === 'RITIRO PDV' || n === 'N/D' || n === '') return null;
    return n;
}

function findDriverAnagrafica(driverName) {
    if (!driverName) return null;
    const name = driverName.toUpperCase().trim();
    return state.driverList.find(d => {
        const full = `${d.cognome} ${d.nome}`.toUpperCase();
        const cognome = (d.cognome || '').toUpperCase();
        return name === full || name === cognome || name.includes(cognome) || cognome.includes(name);
    });
}

function exportCompensi() {
    const mese = state.meseCorrente;
    const cm = state.consegne.filter(c => meseFromDate(c.data) === mese);
    if (cm.length === 0) { toast('Nessun dato', 'warning'); return; }

    const rows = [
        ['COMPENSI DRIVER — ' + meseLabel(mese)],
        [],
        ['Driver', 'Città', 'Consegne', 'Lordo (€3,50×n)', 'Danni', 'Netto']
    ];

    const driverData = {};
    cm.forEach(c => {
        const drv = normalizeDriverName(c.driver);
        if (!drv) return;
        if (!driverData[drv]) driverData[drv] = 0;
        driverData[drv]++;
    });

    const danniMese = state.danniList.filter(d => meseFromDate(d.data) === mese && d.stato !== 'annullato');

    Object.entries(driverData).sort((a,b) => b[1] - a[1]).forEach(([drv, count]) => {
        const ana = findDriverAnagrafica(drv);
        const lordo = count * (ana?.costoConsegna || state.costoPerConsegna);
        const danni = danniMese.filter(d => normalizeDriverName(d.driver) === drv).reduce((s,d) => s + (d.importo||0), 0);
        rows.push([drv, ana?.citta || '—', count, lordo.toFixed(2), danni.toFixed(2), (lordo - danni).toFixed(2)]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Compensi');
    XLSX.writeFile(wb, `compensi_${mese}.xlsx`);
    toast('File scaricato', 'success');
}
