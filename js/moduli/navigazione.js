// DELIVERY HUB — Navigation Module

function navigateTo(module) {
    state.currentModule = module;

    // Update sidebar active state
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.module === module);
    });

    // Hide all screens except login
    document.querySelectorAll('.screen').forEach(s => {
        if (s.id !== 'loginScreen') s.style.display = 'none';
    });

    // Show target screen
    const screen = document.getElementById('screen-' + module);
    if (screen) {
        screen.style.display = 'block';
    }

    // Update page title
    const titles = {
        dashboard: 'Dashboard',
        consegne: 'Consegne',
        driver: 'Driver',
        filiali: 'Filiali',
        riconciliazione: 'Riconciliazione',
        fatturazione: 'Fatturazione',
        import: 'Importa dati'
    };
    document.getElementById('pageTitle').textContent = titles[module] || module;

    // Close mobile sidebar
    closeSidebar();

    // Refresh module data
    refreshCurrentModule();
}

function refreshCurrentModule() {
    switch (state.currentModule) {
        case 'dashboard': renderDashboard(); break;
        case 'consegne': renderConsegne(); break;
        case 'driver': renderDriver(); break;
        case 'filiali': renderFiliali(); break;
        case 'fatturazione': renderFatturazione(); break;
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isOpen = sidebar.classList.contains('open');
    
    if (isOpen) {
        closeSidebar();
    } else {
        sidebar.classList.add('open');
        overlay.classList.add('visible');
    }
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('visible');
}
