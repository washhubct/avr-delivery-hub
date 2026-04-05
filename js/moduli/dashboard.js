// DELIVERY HUB — Dashboard Module

function renderDashboard() {
    const mese = state.meseCorrente;
    if (!mese) return;

    const consegneMese = state.consegne.filter(c => {
        const m = meseFromDate(c.data);
        return m === mese;
    });

    // KPI: Consegne mese
    const totale = consegneMese.length;
    document.getElementById('kpiConsegneMese').textContent = formatNumber(totale);
    
    const maggiori = consegneMese.filter(c => isConsegnaMaggiore(c.importo)).length;
    const minori = totale - maggiori;
    document.getElementById('kpiConsegneDetail').textContent = 
        `${maggiori} ≥€250 · ${minori} <€250`;

    // KPI: Fatturato stimato
    let fattTotale = 0;
    let fattSpeciali = 0;
    let countSpeciali = 0;
    consegneMese.forEach(c => {
        const prezzo = calcolaPrezzo(c.importo);
        fattTotale += prezzo;
        if (classificaConsegna(c.importo) === 'speciale') {
            fattSpeciali += prezzo;
            countSpeciali++;
        }
    });
    document.getElementById('kpiFatturato').textContent = formatCurrency(fattTotale);
    document.getElementById('kpiFatturatoDetail').textContent = 
        `Imponibile (+ IVA 22%)`;

    // KPI: Consegne speciali
    document.getElementById('kpiSpeciali').textContent = formatNumber(countSpeciali);
    document.getElementById('kpiSpecialiDetail').textContent = 
        `Fatturato speciali: ${formatCurrency(fattSpeciali)}`;

    // KPI: Media giornaliera
    const giorniUnici = new Set(consegneMese.map(c => {
        const d = c.data instanceof Date ? c.data : (c.data?.toDate ? c.data.toDate() : new Date(c.data));
        return d.toISOString().slice(0, 10);
    }));
    const mediaGiornaliera = giorniUnici.size > 0 ? Math.round(totale / giorniUnici.size) : 0;
    document.getElementById('kpiMedia').textContent = formatNumber(mediaGiornaliera);
    document.getElementById('kpiMediaDetail').textContent = 
        `Su ${giorniUnici.size} giorni lavorativi`;

    // Tabella aree
    renderTabellaAree(consegneMese);

    // Top filiali
    renderTopFiliali(consegneMese);

    // Top driver
    renderTopDriver(consegneMese);
}

function renderTabellaAree(consegneMese) {
    const areeData = {};
    const areeOrdine = ['CT', 'ME', 'EN', 'SR', 'PA'];

    areeOrdine.forEach(area => {
        areeData[area] = { filiali: new Set(), maggiori: 0, minori: 0, fatturato: 0 };
    });

    consegneMese.forEach(c => {
        const area = c.area || areaFromProvincia(c.provincia);
        if (!areeData[area]) areeData[area] = { filiali: new Set(), maggiori: 0, minori: 0, fatturato: 0 };
        
        areeData[area].filiali.add(c.filiale);
        if (isConsegnaMaggiore(c.importo)) {
            areeData[area].maggiori++;
        } else {
            areeData[area].minori++;
        }
        areeData[area].fatturato += calcolaPrezzo(c.importo);
    });

    const tbody = document.getElementById('tblAree');
    let html = '';
    let totFiliali = 0, totMagg = 0, totMin = 0, totCons = 0, totFatt = 0;

    areeOrdine.forEach(area => {
        const d = areeData[area];
        const nFiliali = d.filiali.size;
        const totArea = d.maggiori + d.minori;
        const gruppo = state.aree[area]?.gruppo || '—';

        totFiliali += nFiliali;
        totMagg += d.maggiori;
        totMin += d.minori;
        totCons += totArea;
        totFatt += d.fatturato;

        html += `<tr>
            <td><strong>${area}</strong> — ${state.aree[area]?.nome || area}
                <br><span style="font-size:11px;color:var(--text-light)">${gruppo}</span></td>
            <td>${nFiliali}</td>
            <td>${formatNumber(d.maggiori)}</td>
            <td>${formatNumber(d.minori)}</td>
            <td><strong>${formatNumber(totArea)}</strong></td>
            <td>${formatCurrency(d.fatturato)}</td>
        </tr>`;
    });

    tbody.innerHTML = html;
    document.getElementById('totFiliali').textContent = totFiliali;
    document.getElementById('totMaggiori').textContent = formatNumber(totMagg);
    document.getElementById('totMinori').textContent = formatNumber(totMin);
    document.getElementById('totConsegne').innerHTML = `<strong>${formatNumber(totCons)}</strong>`;
    document.getElementById('totFatturato').textContent = formatCurrency(totFatt);
}

function renderTopFiliali(consegneMese) {
    const filialiData = {};
    consegneMese.forEach(c => {
        const key = c.filiale || '???';
        if (!filialiData[key]) filialiData[key] = { count: 0, fatturato: 0, area: c.area || c.provincia };
        filialiData[key].count++;
        filialiData[key].fatturato += calcolaPrezzo(c.importo);
    });

    const sorted = Object.entries(filialiData).sort((a, b) => b[1].count - a[1].count).slice(0, 10);

    document.getElementById('tblTopFiliali').innerHTML = sorted.map(([fil, d]) => `
        <tr>
            <td><strong>${fil}</strong></td>
            <td>${d.area}</td>
            <td>${d.count}</td>
            <td>${formatCurrency(d.fatturato)}</td>
        </tr>
    `).join('');
}

function renderTopDriver(consegneMese) {
    const driverData = {};
    consegneMese.forEach(c => {
        const drv = (c.driver || 'N/D').toUpperCase().trim();
        if (!drv || drv === 'N/D' || drv === 'RITIRO PDV') return;
        if (!driverData[drv]) driverData[drv] = { count: 0, filiali: new Set() };
        driverData[drv].count++;
        driverData[drv].filiali.add(c.filiale);
    });

    const sorted = Object.entries(driverData).sort((a, b) => b[1].count - a[1].count);

    document.getElementById('tblTopDriver').innerHTML = sorted.map(([drv, d]) => `
        <tr>
            <td><strong>${drv}</strong></td>
            <td>${d.count}</td>
            <td>${d.filiali.size}</td>
        </tr>
    `).join('');
}
