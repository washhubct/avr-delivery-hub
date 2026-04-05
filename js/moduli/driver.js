// DELIVERY HUB — Driver Module

function renderDriver() {
    const mese = state.meseCorrente;
    const consegneMese = state.consegne.filter(c => meseFromDate(c.data) === mese);

    const driverData = {};
    consegneMese.forEach(c => {
        const drv = (c.driver || '').toUpperCase().trim();
        if (!drv || drv === 'RITIRO PDV') return;

        if (!driverData[drv]) {
            driverData[drv] = {
                count: 0,
                maggiori: 0,
                minori: 0,
                volume: 0,
                filiali: new Set()
            };
        }

        driverData[drv].count++;
        if (isConsegnaMaggiore(c.importo)) {
            driverData[drv].maggiori++;
        } else {
            driverData[drv].minori++;
        }
        driverData[drv].volume += (c.importo || 0);
        if (c.filiale) driverData[drv].filiali.add(c.filiale);
    });

    const sorted = Object.entries(driverData).sort((a, b) => b[1].count - a[1].count);

    document.getElementById('tblDriverBody').innerHTML = sorted.map(([drv, d]) => `
        <tr>
            <td><strong>${drv}</strong></td>
            <td>${formatNumber(d.count)}</td>
            <td>${formatNumber(d.maggiori)}</td>
            <td>${formatNumber(d.minori)}</td>
            <td>${formatCurrency(d.volume)}</td>
            <td>${d.filiali.size}</td>
        </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nessun dato per questo mese</td></tr>';
}
