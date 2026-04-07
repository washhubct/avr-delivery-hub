// DELIVERY HUB v2 — State Management

const state = {
    user: null,
    userRole: 'admin', // 'admin' or 'driver'
    driverProfile: null, // if logged in as driver
    currentModule: 'dashboard',
    meseCorrente: null,
    
    consegne: [],
    filiali: [],
    driverList: [],
    danniList: [],
    dataDeco: null,
    
    consegnePage: 1,
    consegnePerPage: 50,
    filialiMap: {},

    aree: {
        'CT': { nome: 'Catania', gruppo: 'Fratelli Arena' },
        'ME': { nome: 'Messina', gruppo: 'Fratelli Arena' },
        'EN': { nome: 'Enna', gruppo: 'Fratelli Arena' },
        'SR': { nome: 'Siracusa', gruppo: 'Fratelli Arena' },
        'PA': { nome: 'Palermo', gruppo: 'Palermo Retail' }
    },

    // Compenso driver
    costoPerConsegna: 3.50,

    // Prezziario Decò
    prezziOrdinarie: { base: 6.90, sopra250: 10.00 },
    prezziSpeciali: [
        { min: 400, max: 500, prezzo: 20.70 },
        { min: 501, max: 600, prezzo: 27.60 },
        { min: 601, max: 700, prezzo: 34.50 },
        { min: 701, max: 800, prezzo: 41.40 },
        { min: 801, max: 900, prezzo: 48.30 },
        { min: 901, max: 1000, prezzo: 55.20 },
        { min: 1100, max: 2000, prezzo: 100.00 },
        { min: 2100, max: 3000, prezzo: 200.00 },
        { min: 3100, max: 4000, prezzo: 250.00 },
        { min: 4100, max: 7000, prezzo: 300.00 }
    ],

    // Driver precaricati
    driverPreload: [
        { cognome: 'VISCONTI', nome: 'ALESSANDRO', citta: 'PA', contratto: 'CO.CO.CO' },
        { cognome: 'ARICÒ', nome: 'AGOSTINO', citta: 'PA', contratto: 'CO.CO.CO' },
        { cognome: 'GALEAZZO', nome: 'GIACOMO', citta: 'PA', contratto: 'CO.CO.CO' },
        { cognome: 'ROTOLO', nome: 'ALESSANDRO', citta: 'PA', contratto: 'CO.CO.CO' },
        { cognome: 'TUMMINIA', nome: 'MATTIA', citta: 'PA', contratto: 'CO.CO.CO' },
        { cognome: 'BUCCHERI', nome: 'ALESSANDRO', citta: 'PA', contratto: 'CO.CO.CO' },
        { cognome: 'SCHILLACI', nome: 'MANUEL', citta: 'PA', contratto: 'P.O.' },
        { cognome: 'CARDILE', nome: 'FRANCESCO', citta: 'ME', contratto: 'CO.CO.CO' },
        { cognome: 'IMMORMINO', nome: 'SALVATORE', citta: 'ME', contratto: 'CO.CO.CO' },
        { cognome: 'DI GIORGI', nome: 'ANGELO', citta: 'ME', contratto: 'CO.CO.CO' },
        { cognome: 'DI CANDIA', nome: 'MASSIMO', citta: 'ME', contratto: 'CO.CO.CO' },
        { cognome: 'AREZZIO', nome: 'ALESSANDRO', citta: 'ME', contratto: 'CO.CO.CO' },
        { cognome: 'GALLO', nome: 'IVANO', citta: 'ME', contratto: 'CO.CO.CO' },
        { cognome: 'STURIALE', nome: 'GIUSEPPE', citta: 'ME', contratto: 'CO.CO.CO' },
        { cognome: 'MESSINA', nome: 'LUCA', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'VINCI', nome: 'VITO', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'LA PORTA', nome: 'MARCO WALTER', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'BRUNO', nome: 'NICOLÒ', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'ZAPPALÀ', nome: 'MICAEL', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'SCABOTTI', nome: 'DANIELE', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'DAL PIN', nome: 'DARIO UMBERTO', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'MASSIMINO', nome: 'ANTONINO', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'SIYAMBALA GAMAGE', nome: 'SHRENUKA', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'PITTÀ', nome: 'SALVATORE', citta: 'CT', contratto: 'CO.CO.CO' },
        { cognome: 'BELLUARDO', nome: 'IGNAZIO', citta: 'SR', contratto: 'CO.CO.CO' },
        { cognome: 'ZOCCO', nome: 'GIORDANO', citta: 'SR', contratto: 'CO.CO.CO' },
        { cognome: 'CANNARELLA', nome: 'CARLO', citta: 'SR', contratto: 'CO.CO.CO' },
        { cognome: 'LI NOCE', nome: 'FRANCESCO', citta: 'SR', contratto: 'CO.CO.CO' },
        { cognome: 'DI PRIMA', nome: 'SIMONE', citta: 'EN', contratto: 'CO.CO.CO' }
    ]
};

const ADMIN_EMAILS = [
    'amministrazione@avrlogisticarl.com'
];
