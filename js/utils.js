// DELIVERY HUB — Utility Functions

function formatCurrency(n) {
    if (n == null || isNaN(n)) return '—';
    return '€' + Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('it-IT');
}

function formatDate(d) {
    if (!d) return '—';
    if (d.toDate) d = d.toDate(); // Firestore Timestamp
    if (typeof d === 'string') d = new Date(d);
    if (!(d instanceof Date) || isNaN(d)) return '—';
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function meseLabel(meseStr) {
    if (!meseStr) return '—';
    const [y, m] = meseStr.split('-');
    const mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                   'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    return `${mesi[parseInt(m) - 1]} ${y}`;
}

function meseFromDate(d) {
    if (d.toDate) d = d.toDate();
    if (typeof d === 'string') d = new Date(d);
    if (!(d instanceof Date) || isNaN(d)) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function getCurrentMese() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getMesiOptions() {
    // Generate last 24 months
    const mesi = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        mesi.push({ value: val, label: meseLabel(val) });
    }
    return mesi;
}

// Calcola il prezzo per una consegna basato sull'importo
function calcolaPrezzo(importo) {
    if (!importo || importo <= 0) return 0;
    
    // Consegna ordinaria: fino a €250
    if (importo <= 250) return state.prezziOrdinarie.base; // €6.90
    
    // Consegna ordinaria: €251-€399
    if (importo <= 399) return state.prezziOrdinarie.sopra250; // €10.00
    
    // Consegne speciali (€400+)
    // Nota: per €400-€500 ci sono sia €10 ordinarie sia €20.70 speciali
    // Usiamo il prezzo speciale come da prezziario
    for (const fascia of state.prezziSpeciali) {
        if (importo >= fascia.min && importo <= fascia.max) return fascia.prezzo;
    }
    
    // Sopra €7000 — usiamo ultimo prezzo
    if (importo > 7000) return 300.00;
    
    return state.prezziOrdinarie.base;
}

// Classifica consegna
function classificaConsegna(importo) {
    if (!importo || importo <= 0) return 'ordinaria';
    if (importo >= 400) return 'speciale';
    return 'ordinaria';
}

// Determina se una consegna è ≥€250
function isConsegnaMaggiore(importo) {
    return importo >= 250;
}

// Area dalla provincia
function areaFromProvincia(prov) {
    if (!prov) return '??';
    const p = prov.toUpperCase().trim();
    if (state.aree[p]) return p;
    // Fallback: prova a matchare per nome città
    const mapping = {
        'CATANIA': 'CT', 'MESSINA': 'ME', 'SIRACUSA': 'SR',
        'PALERMO': 'PA', 'ENNA': 'EN',
        'AUGUSTA': 'SR', 'PRIOLO': 'SR', 'NOTO': 'SR', 'AVOLA': 'SR',
        'LENTINI': 'SR', 'CARLENTINI': 'SR', 'FLORIDIA': 'SR'
    };
    return mapping[p] || p;
}

// Excel serial date to JS Date
function excelDateToJS(serial) {
    if (serial instanceof Date) return serial;
    if (typeof serial === 'string') return new Date(serial);
    if (typeof serial === 'number') {
        const epoch = new Date(1899, 11, 30);
        return new Date(epoch.getTime() + serial * 86400000);
    }
    return null;
}

// Distanza di Levenshtein — numero minimo di edit (insert/delete/sostituzione) tra due stringhe
function levenshtein(a, b) {
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var dp = [];
    for (var i = 0; i <= m; i++) {
        dp[i] = [i];
        for (var j = 1; j <= n; j++) {
            dp[i][j] = i === 0 ? j :
                a[i-1] === b[j-1] ? dp[i-1][j-1] :
                1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
    }
    return dp[m][n];
}

// Fuzzy match: trova il cognome AVR più simile (distanza ≤1 per nomi ≥5 char, ≤2 per ≥8 char)
// Confronta solo contro cognomi canonici di state.driverList. Ritorna il cognome AVR o null.
function fuzzyMatchDriver(rawName) {
    if (!rawName || rawName.length < 5) return null;
    var name = rawName.toUpperCase().trim().replace(/\s+/g, '');
    var threshold = name.length >= 8 ? 2 : 1;
    var list = (state.driverList && state.driverList.length > 0) ? state.driverList : [];
    var bestDist = Infinity;
    var bestCognome = null;
    list.forEach(function(d) {
        if (!d.cognome) return;
        var cog = d.cognome.toUpperCase().trim();
        var cogNS = cog.replace(/\s+/g, '');
        if (cog.length < 4) return;
        var dist = Math.min(levenshtein(name, cog), levenshtein(name, cogNS));
        if (dist < bestDist) { bestDist = dist; bestCognome = cog; }
    });
    return bestDist <= threshold ? bestCognome : null;
}

// Debounce
function debounce(fn, delay = 300) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// Toast notification
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 9999;
        padding: 12px 20px; border-radius: 8px; font-size: 14px;
        font-family: var(--font); box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        animation: fadeIn 0.3s ease; max-width: 360px;
    `;
    const colors = {
        info: { bg: '#e3f2fd', color: '#1565c0' },
        success: { bg: '#e8f5e9', color: '#2e7d32' },
        error: { bg: '#ffebee', color: '#c62828' },
        warning: { bg: '#fff3e0', color: '#ef6c00' }
    };
    const c = colors[type] || colors.info;
    el.style.background = c.bg;
    el.style.color = c.color;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
}

// Modal helpers
function openModal(title, bodyHTML) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHTML;
    document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}
