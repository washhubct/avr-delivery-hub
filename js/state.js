// DELIVERY HUB — State Management

const state = {
    user: null,
    currentModule: 'dashboard',
    meseCorrente: null, // formato: '2026-02'
    
    // Data cache
    consegne: [],
    filiali: [],
    driverList: [],
    dataDeco: null,
    
    // Pagination
    consegnePage: 1,
    consegnePerPage: 50,
    
    // Filiali mapping: codice -> { nome, area, provincia, gruppo }
    filialiMap: {},
    
    // Aree mapping
    aree: {
        'CT': { nome: 'Catania', gruppo: 'Fratelli Arena' },
        'ME': { nome: 'Messina', gruppo: 'Fratelli Arena' },
        'EN': { nome: 'Enna', gruppo: 'Fratelli Arena' },
        'SR': { nome: 'Siracusa', gruppo: 'Fratelli Arena' },
        'PA': { nome: 'Palermo', gruppo: 'Palermo Retail' }
    },
    
    // Prezziario
    prezziOrdinarie: {
        base: 6.90,        // fino a €250
        sopra250: 10.00     // €251 - €399
    },
    
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
    ]
};

// Admin emails allowed
const ADMIN_EMAILS = [
    'info@parkinglungomare.it',
    'amministrazione@avrlogisticarl.com'
];
