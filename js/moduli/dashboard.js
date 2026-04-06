// DELIVERY HUB v2 — Dashboard with margins

function renderDashboard() {
    const mese = state.meseCorrente;
    if (!mese) return;
    const cm = state.consegne.filter(c => meseFromDate(c.data) === mese);

    const totale = cm.length;
    const maggiori = cm.filter(c => isConsegnaMaggiore(c.importo)).length;
    let fattTotale = 0, countSpeciali = 0;
    cm.forEach(c => {
        fattTotale += calcolaPrezzo(c.importo);
        if (classificaConsegna(c.importo) === 'speciale') countSpeciali++;
    });
    const costoDriver = totale * state.costoPerConsegna;
    const margine = fattTotale - costoDriver;
    const marginePct = fattTotale > 0 ? Math.round((margine / fattTotale) * 100) : 0;

    document.getElementById('kpiConsegneMese').textContent = formatNumber(totale);
    document.getElementById('kpiConsegneDetail').textContent = `${maggiori} ≥€250 · ${totale - maggiori} <€250 · ${countSpeciali} speciali`;
    document.getElementById('kpiFatturato').textContent = formatCurrency(fattTotale);
    document.getElementById('kpiFatturatoDetail').textContent = 'Imponibile (+ IVA 22%)';
    document.getElementById('kpiCostoDriver').textContent = formatCurrency(costoDriver);
    document.getElementById('kpiCostoDriverDetail').textContent = `${totale} × €${state.costoPerConsegna.toFixed(2)}`;
    document.getElementById('kpiMargine').textContent = formatCurrency(margine);
    document.getElementById('kpiMargineDetail').textContent = `${marginePct}% margine lordo`;

    // Tabella aree
    const areeOrdine = ['CT', 'EN', 'ME', 'SR', 'PA'];
    const areeData = {};
    areeOrdine.forEach(a => { areeData[a] = { filiali: new Set(), magg: 0, min: 0, fatt: 0 }; });
    cm.forEach(c => {
        const a = c.area || areaFromProvincia(c.provincia);
        if (!areeData[a]) areeData[a] = { filiali: new Set(), magg: 0, min: 0, fatt: 0 };
        areeData[a].filiali.add(c.filiale);
        isConsegnaMaggiore(c.importo) ? areeData[a].magg++ : areeData[a].min++;
        areeData[a].fatt += calcolaPrezzo(c.importo);
    });

    let html = '', tFil = 0, tMagg = 0, tMin = 0, tCons = 0, tFatt = 0, tCosto = 0, tMarg = 0;
    areeOrdine.forEach(a => {
        const d = areeData[a]; const tot = d.magg + d.min;
        const costo = tot * state.costoPerConsegna; const marg = d.fatt - costo;
        tFil += d.filiali.size; tMagg += d.magg; tMin += d.min; tCons += tot; tFatt += d.fatt; tCosto += costo; tMarg += marg;
        html += `<tr>
            <td><strong>${a}</strong> — ${state.aree[a]?.nome||a}<br><span style="font-size:11px;color:var(--text-light)">${state.aree[a]?.gruppo||''}</span></td>
            <td>${d.filiali.size}</td><td>${d.magg}</td><td>${d.min}</td><td><strong>${tot}</strong></td>
            <td>${formatCurrency(d.fatt)}</td><td>${formatCurrency(costo)}</td>
            <td style="color:${marg>=0?'var(--success)':'var(--danger)'}">${formatCurrency(marg)}</td></tr>`;
    });
    document.getElementById('tblAree').innerHTML = html;
    document.getElementById('totFiliali').textContent = tFil;
    document.getElementById('totMaggiori').textContent = tMagg;
    document.getElementById('totMinori').textContent = tMin;
    document.getElementById('totConsegne').innerHTML = `<strong>${tCons}</strong>`;
    document.getElementById('totFatturato').textContent = formatCurrency(tFatt);
    document.getElementById('totCostoDriver').textContent = formatCurrency(tCosto);
    document.getElementById('totMargine').innerHTML = `<strong style="color:${tMarg>=0?'var(--success)':'var(--danger)'}">${formatCurrency(tMarg)}</strong>`;

    // Top filiali
    const fData = {};
    cm.forEach(c => {
        const k = c.filiale || '?';
        if (!fData[k]) fData[k] = { count: 0, fatt: 0, area: c.area || c.provincia };
        fData[k].count++; fData[k].fatt += calcolaPrezzo(c.importo);
    });
    document.getElementById('tblTopFiliali').innerHTML = Object.entries(fData)
        .sort((a,b) => b[1].count - a[1].count).slice(0, 10)
        .map(([f, d]) => `<tr><td><strong>${f}</strong></td><td>${d.area}</td><td>${d.count}</td><td>${formatCurrency(d.fatt)}</td></tr>`).join('');

    // Top driver
    const drData = {};
    cm.forEach(c => {
        const drv = (c.driver || '').toUpperCase().trim();
        if (!drv || drv === 'RITIRO PDV') return;
        if (!drData[drv]) drData[drv] = { count: 0, filiali: new Set() };
        drData[drv].count++; drData[drv].filiali.add(c.filiale);
    });
    document.getElementById('tblTopDriver').innerHTML = Object.entries(drData)
        .sort((a,b) => b[1].count - a[1].count)
        .map(([d, v]) => `<tr><td><strong>${d}</strong></td><td>${v.count}</td><td>${formatCurrency(v.count * state.costoPerConsegna)}</td><td>${v.filiali.size}</td></tr>`).join('');
}
