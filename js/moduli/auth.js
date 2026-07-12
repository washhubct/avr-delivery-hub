// DELIVERY HUB v2 — Auth Module with roles + auto-logout a mezzanotte + log accessi

var SUPER_ADMIN_EMAILS = [
    'amministrazione@avrlogisticarl.com'
];

// Fallback hardcoded — attivo finché non completiamo la migrazione a
// collection `utenti/`. Rimuovere quando i doc utenti/{email} sono a regime.
var STAFF_EMAILS = [
    'michela@avrlogisticarl.com',
    'alessandra@avrlogisticarl.com'
];

// Sync legacy — non usare per nuova logica. Mantieni per compatibilità
// con codice che non è ancora stato migrato al ruolo esteso.
function getUserRole(email) {
    var e = (email || '').toLowerCase();
    if (SUPER_ADMIN_EMAILS.indexOf(e) >= 0) return 'superadmin';
    if (STAFF_EMAILS.indexOf(e) >= 0) return 'staff';
    return 'driver';
}

// Estende getUserRole leggendo la collection `utenti/{emailLower}`.
// Ruoli possibili: 'superadmin' | 'amministratore' | 'risorse_umane'
//                | 'responsabile' | 'staff' (legacy) | 'driver'
// Popola anche state.userProfile con { mansione, province, nome } se presente.
async function resolveUserRole(email) {
    var e = (email || '').toLowerCase();
    if (SUPER_ADMIN_EMAILS.indexOf(e) >= 0) {
        state.userProfile = { mansione: 'superadmin', province: [], nome: 'Amministratore' };
        return 'superadmin';
    }
    try {
        var doc = await db.collection('utenti').doc(e).get();
        if (doc.exists) {
            var d = doc.data();
            if (d.attivo === false) {
                // Utente disattivato: forza signOut immediato
                console.warn('Utente disattivato:', e);
                await auth.signOut();
                throw new Error('Account disattivato');
            }
            state.userProfile = {
                mansione: d.mansione,
                province: Array.isArray(d.province) ? d.province : [],
                nome: d.nome || e.split('@')[0]
            };
            return d.mansione; // amministratore | risorse_umane | responsabile
        }
    } catch (err) {
        // Se è signOut voluto sopra, ripropaga
        if (err && err.message === 'Account disattivato') throw err;
        console.warn('resolveUserRole utenti lookup:', err.message);
    }
    // Fallback hardcoded staff (Michela, Alessandra) finché non migrati
    if (STAFF_EMAILS.indexOf(e) >= 0) {
        state.userProfile = { mansione: 'staff', province: [], nome: e.split('@')[0] };
        return 'staff';
    }
    state.userProfile = null;
    return 'driver';
}

// True se il ruolo può gestire la sezione Utenti (solo superadmin + amministratore).
function canManageUsers(role) {
    return role === 'superadmin' || role === 'amministratore';
}

// True se il ruolo può configurare/leggere le timbrature (superadmin + amministratore + risorse_umane).
function canManageTimbrature(role) {
    return role === 'superadmin' || role === 'amministratore' || role === 'risorse_umane';
}

// True se il ruolo ha accesso admin/staff completo alla dashboard (senza P&L).
function isAdminOrStaffRole(role) {
    return role === 'superadmin'
        || role === 'amministratore'
        || role === 'risorse_umane'
        || role === 'responsabile'
        || role === 'staff';
}

// Registra accesso in Firestore
async function logAccesso(user, role) {
    try {
        var ua = navigator.userAgent || '';
        var isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
        await db.collection('accessLog').add({
            email: user.email,
            uid: user.uid,
            ruolo: role,
            dispositivo: isMobile ? 'Mobile' : 'Desktop',
            browser: ua.length > 120 ? ua.substring(0, 120) : ua,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            data: new Date().toLocaleDateString('it-IT', {day:'2-digit', month:'2-digit', year:'numeric'})
        });
    } catch (e) {
        console.warn('Errore log accesso:', e.message);
    }
}

function doLogin() {
    var email = document.getElementById('loginEmail').value.trim();
    var pw = document.getElementById('loginPassword').value;
    var errEl = document.getElementById('loginError');
    errEl.textContent = '';
    if (!email || !pw) { errEl.textContent = 'Inserisci email e password'; return; }
    document.getElementById('btnLogin').disabled = true;
    document.getElementById('btnLogin').textContent = 'Accesso...';

    auth.signInWithEmailAndPassword(email, pw)
        .catch(function(err) {
            var msg = 'Errore di accesso';
            if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Credenziali non valide';
            if (err.code === 'auth/too-many-requests') msg = 'Troppi tentativi, riprova tra poco';
            errEl.textContent = msg;
        })
        .finally(function() {
            document.getElementById('btnLogin').disabled = false;
            document.getElementById('btnLogin').textContent = 'Accedi';
        });
}

function doLogout() { auth.signOut(); }

function initAuth() {
    auth.onAuthStateChanged(async function(user) {
        state.user = user;
        if (user) {
            document.body.classList.remove('is-login');
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('sidebar').style.display = 'flex';

            var role;
            try {
                role = await resolveUserRole(user.email);
            } catch (err) {
                // Utente disattivato → signOut già eseguito
                return;
            }
            state.userRole = role;

            // Log accesso
            await logAccesso(user, role);

            if (isAdminOrStaffRole(role)) {
                document.getElementById('navAdmin').style.display = 'block';
                document.getElementById('navDriver').style.display = 'none';

                // Voci "solo superadmin" (P&L, Log Accessi, Dashboard KPI top)
                var adminOnlyItems = document.querySelectorAll('.nav-superadmin');
                adminOnlyItems.forEach(function(el) {
                    el.style.display = (role === 'superadmin' || role === 'amministratore') ? 'block' : 'none';
                });

                // Voce "Utenti" — solo superadmin + amministratore
                var manageUsersItems = document.querySelectorAll('.nav-can-manage-users');
                manageUsersItems.forEach(function(el) {
                    el.style.display = canManageUsers(role) ? 'block' : 'none';
                });

                // Voci di gestione timbrature — superadmin + amministratore + risorse_umane
                var timbratureItems = document.querySelectorAll('.nav-timbrature-admin');
                timbratureItems.forEach(function(el) {
                    el.style.display = canManageTimbrature(role) ? 'block' : 'none';
                });

                // Label sidebar
                var profile = state.userProfile || {};
                var displayName = profile.nome || user.email.split('@')[0];
                displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
                var roleLabel = {
                    superadmin: 'Amministratore',
                    amministratore: 'Amministratore',
                    risorse_umane: 'Risorse Umane',
                    responsabile: 'Responsabile' + (profile.province && profile.province.length ? ' — ' + profile.province.join(', ') : ''),
                    staff: 'Staff'
                }[role] || role;
                document.getElementById('userName').textContent = displayName;
                document.getElementById('userRole').textContent = role === 'superadmin' ? user.email : roleLabel;
            } else {
                document.getElementById('navAdmin').style.display = 'none';
                document.getElementById('navDriver').style.display = 'block';
                var driverDoc = await db.collection('driverAnagrafica').where('email', '==', user.email).get();
                if (!driverDoc.empty) {
                    state.driverProfile = { id: driverDoc.docs[0].id, ...driverDoc.docs[0].data() };
                    document.getElementById('userName').textContent = state.driverProfile.cognome + ' ' + state.driverProfile.nome;
                    document.getElementById('userRole').textContent = 'Driver — ' + (state.aree[state.driverProfile.citta] ? state.aree[state.driverProfile.citta].nome : state.driverProfile.citta);
                } else {
                    document.getElementById('userName').textContent = user.email;
                    document.getElementById('userRole').textContent = 'Driver';
                }
            }

            initMeseSelector();
            await loadAllData();

            if (role === 'superadmin' || role === 'amministratore') {
                navigateTo('dashboard');
            } else if (isAdminOrStaffRole(role)) {
                navigateTo('consegne');
            } else {
                navigateTo('driver-consegne');
            }

            // Auto-logout a mezzanotte
            var now = new Date();
            var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
            var msToMidnight = midnight - now;
            setTimeout(function() { auth.signOut(); location.reload(); }, msToMidnight);

        } else {
            document.body.classList.add('is-login');
            document.getElementById('loginScreen').style.display = 'flex';
            document.getElementById('sidebar').style.display = 'none';
            document.querySelectorAll('.screen').forEach(function(s) {
                if (s.id !== 'loginScreen') s.style.display = 'none';
            });
        }
    });

    document.getElementById('loginPassword').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doLogin();
    });
}

function initMeseSelector() {
    var sel = document.getElementById('meseSelector');
    sel.innerHTML = '';
    var mesi = getMesiOptions();
    var now = new Date();
    var def = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    mesi.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.value; opt.textContent = m.label;
        if (m.value === def) opt.selected = true;
        sel.appendChild(opt);
    });
    state.meseCorrente = sel.value;
}

// onMeseChange è definita in js/main.js (carica anche reportDriver e ritorni).
