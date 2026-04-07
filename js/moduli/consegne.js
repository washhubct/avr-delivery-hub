// DELIVERY HUB — Consegne Module

function renderConsegne() {
    const mese = state.meseCorrente;
    const filtered = getFilteredConsegne();
    
    // Update filiale dropdown from current data
    updateFilialeFilter();
    
    // Pagination
    const total = filtered.length;
    const totalPages = Math.ceil(total / state.consegnePerPage);
    const page = Math.min(state.consegnePage, totalPages || 1);
    const start = (page - 1) * state.consegnePerPage;
    const pageData = filtered.slice(start, start + state.consegnePerPage);

    const tbody = document.getElementById('tblConsegneBody');
    tbody.innerHTML = pageData.map(c => {
        const tipoClass = classificaConsegna(c.importo) === 'speciale' ? 'badge-warn' : 
                          isConsegnaMaggiore(c.importo) ? 'badge-info' : 'badge-ok';
        const tipoLabel = classificaConsegna(c.importo) === 'speciale' ? 'Speciale' :
                          isConsegnaMaggiore(c.importo) ? '≥€250' : 'Ordinaria';
        
        return `<tr>
            <td>${formatDate(c.data)}</td>
            <td>${c.filiale || '—'}</td>
            <td>${c.cliente || '—'}</td>
            <td>${c.citta || '—'}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${formatCurrency(c.importo)}</td>
            <td>${c.fascia || '—'}</td>
            <td>${c.driver || '—'}</td>
            <td><span class="badge ${tipoClass}">${tipoLabel}</span></td>
        </tr>`;
    }).join('');

    // Pagination controls
    renderPagination(page, totalPages, total);
}

function getFilteredConsegne() {
    const mese = state.meseCorrente;
    const search = (document.getElementById('searchConsegne')?.value || '').toLowerCase();
    const filterArea = document.getElementById('filterArea')?.value || '';
    const filterFiliale = document.getElementById('filterFiliale')?.value || '';

    var result = state.consegne.filter(c => {
        // Month filter
        const m = meseFromDate(c.data);
        if (m !== mese) return false;

        // Area filter
        if (filterArea) {
            const area = c.area || areaFromProvincia(c.provincia);
            if (area !== filterArea) return false;
        }

        // Filiale filter
        if (filterFiliale && c.filiale !== filterFiliale) return false;

        // Search filter
        if (search) {
            const haystack = [c.cliente, c.driver, c.filiale, c.citta, c.provincia].join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }

        return true;
    });

    // Ordina per data crescente (dal 1° al 30/31 del mese)
    result.sort(function(a, b) {
        var dateA = a.data instanceof Date ? a.data : new Date(a.data);
        var dateB = b.data instanceof Date ? b.data : new Date(b.data);
        return dateA - dateB;
    });

    return result;
}

function updateFilialeFilter() {
    const mese = state.meseCorrente;
    const filialiInMese = new Set();
    state.consegne.forEach(c => {
        if (meseFromDate(c.data) === mese && c.filiale) {
            filialiInMese.add(c.filiale);
        }
    });

    const sel = document.getElementById('filterFiliale');
    const current = sel?.value || '';
    if (sel) {
        sel.innerHTML = '<option value="">Tutte le filiali</option>';
        [...filialiInMese].sort().forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            if (f === current) opt.selected = true;
            sel.appendChild(opt);
        });
    }
}

const filterConsegne = debounce(() => {
    state.consegnePage = 1;
    renderConsegne();
}, 250);

function renderPagination(page, totalPages, total) {
    const container = document.getElementById('paginationConsegne');
    if (totalPages <= 1) {
        container.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${total} consegne</span>`;
        return;
    }

    let html = `<span style="font-size:12px;color:var(--text-muted);margin-right:8px">${total} consegne</span>`;
    html += `<button ${page <= 1 ? 'disabled' : ''} onclick="goToPage(${page-1})">‹</button>`;
    
    for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 7 && i > 3 && i < totalPages - 1 && Math.abs(i - page) > 1) {
            if (i === 4 || i === totalPages - 2) html += `<button disabled>…</button>`;
            continue;
        }
        html += `<button class="${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }
    
    html += `<button ${page >= totalPages ? 'disabled' : ''} onclick="goToPage(${page+1})">›</button>`;
    container.innerHTML = html;
}

function goToPage(p) {
    state.consegnePage = p;
    renderConsegne();
    document.getElementById('screen-consegne').scrollTop = 0;
}
