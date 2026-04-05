// DELIVERY HUB — Fatturazione Module

function renderFatturazione() {
    const mese = state.meseCorrente;
    const consegneMese = state.consegne.filter(c => meseFromDate(c.data) === mese);

    // Calcoli globali
    let totOrdinarie = 0, totSpeciali = 0;
    let fattOrdinarie = 0, fattSpeciali = 0;

    // Per area
    const areeOrdine = ['CT', 'EN', 'ME', 'SR', 'PA'];
    const areeData = {};
    areeOrdine.forEach(a => {
        areeData[a] = { maggiori: 0, minori: 0, speciali: 0, fattOrd: 0, fattSpec: 0 };
    });

    consegneMese.forEach(c => {
        const area = c.area || areaFromProvincia(c.provincia);
        if (!areeData[area]) areeData[area] = { maggiori: 0, minori: 0, speciali: 0, fattOrd: 0, fattSpec: 0 };

        const prezzo = calcolaPrezzo(c.importo);
        const tipo = classificaConsegna(c.importo);

        if (tipo === 'speciale') {
            totSpeciali++;
            fattSpeciali += prezzo;
            areeData[area].speciali++;
            areeData[area].fattSpec += prezzo;
            areeData[area].maggiori++;
        } else {
            totOrdinarie++;
            fattOrdinarie += prezzo;
            if (isConsegnaMaggiore(c.importo)) {
                areeData[area].maggiori++;
            } else {
                areeData[area].minori++;
            }
            areeData[area].fattOrd += prezzo;
        }
    });

    // KPI
    document.getElementById('fatOrdinarie').textContent = formatNumber(totOrdinarie);
    document.getElementById('fatFattOrdinarie').textContent = formatCurrency(fattOrdinarie);
    document.getElementById('fatSpeciali').textContent = formatNumber(totSpeciali);
    document.getElementById('fatFattSpeciali').textContent = formatCurrency(fattSpeciali);

    // Tabella per area
    const tbody = document.getElementById('tblFattBody');
    let html = '';
    let tMagg = 0, tMin = 0, tSpec = 0, tFOrd = 0, tFSpec = 0, tTot = 0;

    areeOrdine.forEach(area => {
        const d = areeData[area];
        const gruppo = state.aree[area]?.gruppo || '—';
        const totArea = d.fattOrd + d.fattSpec;

        tMagg += d.maggiori;
        tMin += d.minori;
        tSpec += d.speciali;
        tFOrd += d.fattOrd;
        tFSpec += d.fattSpec;
        tTot += totArea;

        html += `<tr>
            <td><strong>${area}</strong> — ${state.aree[area]?.nome || area}</td>
            <td>${gruppo}</td>
            <td>${d.maggiori}</td>
            <td>${d.minori}</td>
            <td>${d.speciali}</td>
            <td style="text-align:right">${formatCurrency(d.fattOrd)}</td>
            <td style="text-align:right">${formatCurrency(d.fattSpec)}</td>
            <td style="text-align:right"><strong>${formatCurrency(totArea)}</strong></td>
        </tr>`;
    });

    tbody.innerHTML = html;
    document.getElementById('fatTotMagg').textContent = tMagg;
    document.getElementById('fatTotMin').textContent = tMin;
    document.getElementById('fatTotSpec').textContent = tSpec;
    document.getElementById('fatTotFattOrd').textContent = formatCurrency(tFOrd);
    document.getElementById('fatTotFattSpec').textContent = formatCurrency(tFSpec);
    document.getElementById('fatTotTot').innerHTML = `<strong>${formatCurrency(tTot)}</strong>`;
}

function exportFatturazione() {
    const mese = state.meseCorrente;
    const consegneMese = state.consegne.filter(c => meseFromDate(c.data) === mese);

    if (consegneMese.length === 0) {
        toast('Nessun dato per questo mese', 'warning');
        return;
    }

    // Build export data similar to Decò format
    const areeOrdine = ['CT', 'EN', 'ME', 'SR', 'PA'];
    const rows = [
        ['RIEPILOGO FATTURAZIONE — ' + meseLabel(mese)],
        [],
        ['AREA', 'FILIALE', '≥€250', '<€250', 'CONSEGNE SPECIALI', 'FATT. ORDINARIE', 'FATT. SPECIALI', 'TOTALE']
    ];

    areeOrdine.forEach(area => {
        // Get filiali for this area
        const filialiArea = {};
        consegneMese.forEach(c => {
            const a = c.area || areaFromProvincia(c.provincia);
            if (a !== area) return;
            const fil = String(c.filiale || '???');
            if (!filialiArea[fil]) filialiArea[fil] = { magg: 0, min: 0, spec: 0, fattOrd: 0, fattSpec: 0 };
            
            const prezzo = calcolaPrezzo(c.importo);
            const tipo = classificaConsegna(c.importo);
            
            if (tipo === 'speciale') {
                filialiArea[fil].spec++;
                filialiArea[fil].fattSpec += prezzo;
                filialiArea[fil].magg++;
            } else if (isConsegnaMaggiore(c.importo)) {
                filialiArea[fil].magg++;
                filialiArea[fil].fattOrd += prezzo;
            } else {
                filialiArea[fil].min++;
                filialiArea[fil].fattOrd += prezzo;
            }
        });

        if (Object.keys(filialiArea).length === 0) return;

        rows.push([area + ' — ' + (state.aree[area]?.nome || '')]);

        Object.entries(filialiArea).sort((a,b) => a[0].localeCompare(b[0])).forEach(([fil, d]) => {
            rows.push([
                '', fil, d.magg, d.min, d.spec,
                d.fattOrd.toFixed(2), d.fattSpec.toFixed(2),
                (d.fattOrd + d.fattSpec).toFixed(2)
            ]);
        });
        rows.push([]);
    });

    // Generate xlsx
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Fatturazione');
    XLSX.writeFile(wb, `fatturazione_${mese}.xlsx`);
    toast('File scaricato: fatturazione_' + mese + '.xlsx', 'success');
}
