// DELIVERY HUB v2 — Navigation
const MODULE_TITLES = {
    dashboard: 'Dashboard',
    consegne: 'Consegne',
    'anagrafica-driver': 'Anagrafica Driver',
    compensi: 'Compensi Driver',
    produttivita: 'Produttività Driver',
    danni: 'Danni / Furgoni',
    ritorni: 'Ritorni',
    classifica: 'Classifica Driver',
    segnalazioni: 'Segnalazioni Driver',
    filiali: 'Filiali',
    utenti: 'Utenti',
    'punti-timbratura': 'Punti Timbratura',
    riconciliazione: 'Riconciliazione',
    fatturazione: 'Fatturazione',
    'report-finanziario': 'Report Finanziario',
    import: 'Importa dati',
    'log-accessi': 'Log Accessi',
    'driver-consegne': 'Le mie consegne',
    'driver-compensi': 'Storico mensile',
    'driver-bustepaga': 'Buste paga'
};
function navigateTo(module) {
    state.currentModule = module;
    document.querySelectorAll('.nav-item').forEach(n =>
        n.classList.toggle('active', n.dataset.module === module));
    document.querySelectorAll('.screen').forEach(s => {
        if (s.id !== 'loginScreen') s.style.display = 'none';
    });
    const screen = document.getElementById('screen-' + module);
    if (screen) screen.style.display = 'block';
    document.getElementById('pageTitle').textContent = MODULE_TITLES[module] || module;
    closeSidebar();
    refreshCurrentModule();
}
function refreshCurrentModule() {
    switch (state.currentModule) {
        case 'dashboard': renderDashboard(); break;
        case 'consegne': renderConsegne(); break;
        case 'anagrafica-driver': renderAnagraficaDriver(); break;
        case 'compensi': renderCompensi(); break;
        case 'produttivita': renderProduttivita(); break;
        case 'danni': renderDanni(); break;
        case 'ritorni': renderRitorni(); break;
        case 'classifica': renderClassifica(); break;
        case 'segnalazioni': renderSegnalazioniAdmin(); break;
        case 'filiali': renderFiliali(); break;
        case 'utenti':
            loadUtenti().then(renderUtenti);
            break;
        case 'punti-timbratura':
            loadPuntiTimbratura().then(renderPuntiTimbratura);
            break;
        case 'fatturazione': renderFatturazione(); break;
        case 'report-finanziario': renderReportFinanziario(); break;
        case 'log-accessi': renderLogAccessi(); break;
        case 'driver-consegne': renderDriverConsegne(); break;
        case 'driver-compensi': renderDriverCompensi(); break;
    }
}
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebarOverlay');
    if (sb.classList.contains('open')) { closeSidebar(); }
    else { sb.classList.add('open'); ov.classList.add('visible'); }
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('visible');
}
