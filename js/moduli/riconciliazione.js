// DELIVERY HUB — Riconciliazione Module
// Confronta: Dati nostri (importati da Sheet filiali) vs Dati Decò (file riepilogo)

function runRiconciliazione() {
    const mese = state.meseCorrente;
    const consegneMese = state.consegne.filter(c => meseFromDate(c.data) === mese);

    if (consegneMese.length === 0) {
        document.getElementById('riconResults').innerHTML = `
            <div style="text-align:center;padding:40px;color:var(--text-muted)">
                <p style="font-size:36px;margin-bottom:8px">📭</p>
                <p>Nessuna consegna importata per <strong>${meseLabel(mese)}</strong>.</p>
                <p>Vai in <a href="#" onclick="navigateTo('import');return false" style="color:var(--accent)">Importa dati</a> per caricare i file delle filiali.</p>
            </div>`;
        return;
    }

    // Raggruppa per area → filiale
    const nostri = {};
    const areeOrdine = ['CT', 'EN', 'ME', 'SR', 'PA'];

    consegneMese.forEach(c => {
        const area = c.area || areaFromProvincia(c.provincia);
        const fil = String(c.filiale || '???');

        if (!nostri[area]) nostri[area] = {};
        if (!nostri[area][fil]) nostri[area][fil] = { maggiori: 0, minori: 0, speciali: 0, totale: 0 };

        nostri[area][fil].totale++;
        if (classificaConsegna(c.importo) === 'speciale') {
            nostri[area][fil].speciali++;
            nostri[area][fil].maggiori++; // speciali sono anche ≥250
        } else if (isConsegnaMaggiore(c.importo)) {
            nostri[area][fil].maggiori++;
        } else {
            nostri[area][fil].minori++;
        }
    });

    // Dati Decò (se importati)
    const deco = state.dataDeco;

    let html = `<div style="margin-bottom:16px;padding:12px;background:var(--info-bg);border-radius:var(--radius-sm);font-size:13px;color:var(--info)">
        📊 Riconciliazione per <strong>${meseLabel(mese)}</strong> — ${consegneMese.length} consegne nostre caricate.
        ${deco ? '✅ File Decò importato — confronto attivo.' : '⚠️ File Decò non importato. Caricalo in "Importa dati" per il confronto automatico.'}
    </div>`;

    areeOrdine.forEach(area => {
        if (!nostri[area] && !(deco && deco[area])) return;

        const nostroArea = nostri[area] || {};
        const decoArea = deco ? (deco[area] || {}) : null;

        // Area header
        const nomeArea = state.aree[area]?.nome || area;
        const gruppoArea = state.aree[area]?.gruppo || '';
        
        // Totali area nostri
        let totNostroMagg = 0, totNostroMin = 0, totNostroTot = 0;
        Object.values(nostroArea).forEach(v => {
            totNostroMagg += v.maggiori;
            totNostroMin += v.minori;
            totNostroTot += v.totale;
        });

        html += `<div class="ricon-area">
            <div class="ricon-area-header">
                <span>${area} — ${nomeArea} <span style="font-weight:400;color:var(--text-muted)">(${gruppoArea})</span></span>
                <span>${totNostroTot} consegne nostre</span>
            </div>
            <div class="ricon-area-body">
                <table class="data-table" style="font-size:12px">
                    <thead><tr>
                        <th>Filiale</th>
                        <th>Nostri ≥250</th>
                        <th>Nostri &lt;250</th>
                        <th>Nostri Tot</th>
                        ${decoArea ? '<th>Decò ≥250</th><th>Decò &lt;250</th><th>Decò Tot</th><th>Differenza</th>' : ''}
                    </tr></thead>
                    <tbody>`;

        // Merge filiali keys
        const allFiliali = new Set([
            ...Object.keys(nostroArea),
            ...(decoArea ? Object.keys(decoArea) : [])
        ]);

        [...allFiliali].sort().forEach(fil => {
            const n = nostroArea[fil] || { maggiori: 0, minori: 0, totale: 0 };
            const d = decoArea ? (decoArea[fil] || { maggiori: 0, minori: 0 }) : null;
            const decoTot = d ? (d.maggiori + d.minori) : 0;
            const diff = d ? (n.totale - decoTot) : null;

            html += `<tr>
                <td><strong>${fil}</strong></td>
                <td>${n.maggiori}</td>
                <td>${n.minori}</td>
                <td><strong>${n.totale}</strong></td>`;

            if (d !== null) {
                const diffClass = diff === 0 ? 'ricon-match' : 'ricon-mismatch';
                const diffStr = diff === 0 ? '✓ OK' : (diff > 0 ? `+${diff}` : `${diff}`);
                html += `
                    <td>${d.maggiori}</td>
                    <td>${d.minori}</td>
                    <td><strong>${decoTot}</strong></td>
                    <td class="${diffClass}">${diffStr}</td>`;
            }

            html += `</tr>`;
        });

        // Totale area
        if (decoArea) {
            let totDecoMagg = 0, totDecoMin = 0;
            Object.values(decoArea).forEach(v => {
                totDecoMagg += v.maggiori;
                totDecoMin += v.minori;
            });
            const totDecoTot = totDecoMagg + totDecoMin;
            const diffTot = totNostroTot - totDecoTot;
            const diffClass = diffTot === 0 ? 'ricon-match' : 'ricon-mismatch';

            html += `<tr class="totals-row">
                <td><strong>Totale ${area}</strong></td>
                <td>${totNostroMagg}</td>
                <td>${totNostroMin}</td>
                <td><strong>${totNostroTot}</strong></td>
                <td>${totDecoMagg}</td>
                <td>${totDecoMin}</td>
                <td><strong>${totDecoTot}</strong></td>
                <td class="${diffClass}"><strong>${diffTot === 0 ? '✓ OK' : (diffTot > 0 ? `+${diffTot}` : diffTot)}</strong></td>
            </tr>`;
        } else {
            html += `<tr class="totals-row">
                <td><strong>Totale ${area}</strong></td>
                <td>${totNostroMagg}</td>
                <td>${totNostroMin}</td>
                <td><strong>${totNostroTot}</strong></td>
            </tr>`;
        }

        html += `</tbody></table></div></div>`;
    });

    document.getElementById('riconResults').innerHTML = html;
}

function exportRiconciliazione() {
    toast('Export riconciliazione in arrivo nella prossima versione', 'info');
    // TODO: generate xlsx export using SheetJS
}
