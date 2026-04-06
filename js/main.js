// DELIVERY HUB v2 — Main App with localStorage Cache

var CACHE_KEY = 'dhub_cache_';
var CACHE_TTL = 6 * 60 * 60 * 1000; // 6 ore in millisecondi

async function loadAllData() {
    try {
        // Controlla se il GAS ha fatto un sync recente
        var lastSync = await getLastSyncTimestamp();
        var cacheTime = localStorage.getItem(CACHE_KEY + 'time');
        var cacheValid = cacheTime && (Date.now() - parseInt(cacheTime)) < CACHE_TTL;
        var cacheNewer = cacheTime && lastSync && parseInt(cacheTime) > lastSync;

        if (cacheValid && cacheNewer) {
            // Cache valida e più recente dell'ultimo sync — carica dalla cache
            console.log('Caricamento da cache locale...');
            loadFromCache();
        } else {
            // Cache scaduta o sync più recente — carica da Firestore
            console.log('Caricamento da Firestore...');
            await loadFromFirestore();
            saveToCache();
        }
    } catch (e) {
        console.error('Load error:', e);
        // Fallback: prova dalla cache
        if (localStorage.getItem(CACHE_KEY + 'consegne')) {
            console.log('Errore Firestore, uso cache...');
            loadFromCache();
        } else {
            toast('Errore nel caricamento dati', 'error');
        }
    }
}

async function getLastSyncTimestamp() {
    try {
        var snap = await db.collection('syncLogs')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();
        if (!snap.empty) {
            var ts = snap.docs[0].data().timestamp;
            return new Date(ts).getTime();
        }
    } catch (e) {
        // Se non riesce a leggere i syncLogs, ignora
    }
    return 0;
}

async function loadFromFirestore() {
    await Promise.all([
        loadConsegne(),
        loadFiliali(),
        loadDriverAnagrafica(),
        loadDanni()
    ]);
}

function saveToCache() {
    try {
        localStorage.setItem(CACHE_KEY + 'consegne', JSON.stringify(state.consegne.map(function(c) {
            var copy = Object.assign({}, c);
            if (copy.data instanceof Date) copy.data = copy.data.toISOString();
            return copy;
        })));
        localStorage.setItem(CACHE_KEY + 'filiali', JSON.stringify(state.filiali));
        localStorage.setItem(CACHE_KEY + 'driver', JSON.stringify(state.driverList));
        localStorage.setItem(CACHE_KEY + 'danni', JSON.stringify(state.danniList.map(function(d) {
            var copy = Object.assign({}, d);
            if (copy.data instanceof Date) copy.data = copy.data.toISOString();
            return copy;
        })));
        localStorage.setItem(CACHE_KEY + 'time', String(Date.now()));
        console.log('Cache salvata (' + state.consegne.length + ' consegne, ' + state.filiali.length + ' filiali, ' + state.driverList.length + ' driver)');
    } catch (e) {
        console.warn('Cache save error:', e.message);
    }
}

function loadFromCache() {
    try {
        var consegne = JSON.parse(localStorage.getItem(CACHE_KEY + 'consegne') || '[]');
        state.consegne = consegne.map(function(c) {
            if (c.data && typeof c.data === 'string') c.data = new Date(c.data);
            return c;
        });

        state.filiali = JSON.parse(localStorage.getItem(CACHE_KEY + 'filiali') || '[]');
        state.filialiMap = {};
        state.filiali.forEach(function(f) { state.filialiMap[String(f.codice)] = f; });

        state.driverList = JSON.parse(localStorage.getItem(CACHE_KEY + 'driver') || '[]');

        var danni = JSON.parse(localStorage.getItem(CACHE_KEY + 'danni') || '[]');
        state.danniList = danni.map(function(d) {
            if (d.data && typeof d.data === 'string') d.data = new Date(d.data);
            return d;
        });

        console.log('Cache caricata: ' + state.consegne.length + ' consegne, ' + state.filiali.length + ' filiali, ' + state.driverList.length + ' driver, ' + state.danniList.length + ' danni');
    } catch (e) {
        console.warn('Cache read error:', e.message);
        state.consegne = [];
        state.filiali = [];
        state.driverList = [];
        state.danniList = [];
    }
}

// Forza refresh da Firestore (bottone manuale o chiamata)
async function forceRefresh() {
    toast('Aggiornamento dati...', 'info');
    await loadFromFirestore();
    saveToCache();
    refreshCurrentModule();
    toast('Dati aggiornati!', 'success');
}

// Svuota cache (utile per debug)
function clearCache() {
    localStorage.removeItem(CACHE_KEY + 'consegne');
    localStorage.removeItem(CACHE_KEY + 'filiali');
    localStorage.removeItem(CACHE_KEY + 'driver');
    localStorage.removeItem(CACHE_KEY + 'danni');
    localStorage.removeItem(CACHE_KEY + 'time');
    console.log('Cache svuotata');
}

// ── LOADERS ──

async function loadConsegne() {
    try {
        var snap = await db.collection('consegne').orderBy('data', 'desc').limit(10000).get();
        state.consegne = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log('Loaded ' + state.consegne.length + ' consegne');
    } catch (e) {
        console.warn('Consegne load:', e);
        state.consegne = [];
    }
}

async function loadFiliali() {
    try {
        var snap = await db.collection('filiali').get();
        state.filiali = snap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
        state.filialiMap = {};
        state.filiali.forEach(function(f) { state.filialiMap[String(f.codice)] = f; });
        console.log('Loaded ' + state.filiali.length + ' filiali');
    } catch (e) {
        console.warn('Filiali load:', e);
        state.filiali = [];
    }
}

async function loadDriverAnagrafica() {
    try {
        var snap = await db.collection('driverAnagrafica').get();
        state.driverList = snap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
        console.log('Loaded ' + state.driverList.length + ' driver');
    } catch (e) {
        console.warn('Driver load:', e);
        state.driverList = [];
    }
}

async function loadDanni() {
    try {
        var snap = await db.collection('danni').orderBy('data', 'desc').limit(500).get();
        state.danniList = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log('Loaded ' + state.danniList.length + ' danni');
    } catch (e) {
        console.warn('Danni load:', e);
        state.danniList = [];
    }
}

document.addEventListener('DOMContentLoaded', function() {
    initAuth();
});
