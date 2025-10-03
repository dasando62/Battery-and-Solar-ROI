// js/providerManager.js
//Version 1.0.6
const PROVIDERS_KEY = 'roiAnalyzer_providers';
const DEFAULTS_LOADED_KEY = 'roiAnalyzer_defaults_loaded';

// The default providers are now in an array to preserve order
const defaultProviders = [
    {
        id: "Origin",
        name: "Origin Energy",
		isExpanded: true,
        dailyCharge: 1.1605,
        rebate: 0,
        monthlyFee: 0,
        importRules: [
            { type: 'tou', name: 'Peak', rate: 0.59653, hours: '7am-10am, 4pm-10pm' },
            { type: 'tou', name: 'Shoulder', rate: 0.29425, hours: '10am-4pm' },
            { type: 'tou', name: 'Off-Peak', rate: 0.35233, hours: '10pm-7am' }
        ],
        exportRules: [
            { type: 'tiered', name: 'Tier 1', rate: 0.10, limit: 14 },
            { type: 'flat', name: 'Tier 2', rate: 0.02 }
        ], // <-- FIXED: Missing comma added
		specialConditions: [], 
        gridChargeEnabled: false,
        gridChargeStart: 1,
        gridChargeEnd: 5
    },
    {
        id: "GloBird",
        name: "GloBird",
		isExpanded: true,
        dailyCharge: 1.364,
        rebate: 1500, // <-- FIXED: Missing comma added
        zeroHeroCredit: -1.00,
        monthlyFee: 0,
        importRules: [
            { type: 'tou', name: 'Peak Import', rate: 0.528, hours: '3pm-11pm' },
            { type: 'tou', name: 'Shoulder Import', rate: 0.396, hours: '7am-11am, 10pm-12am' },
            { type: 'tou', name: 'Off-Peak Import', rate: 0.000, hours: '12am-7am, 11am-3pm' }
        ],
        exportRules: [
            { type: 'tiered', name: 'Super Export Bonus', rate: 0.120, limit: 10 },
            { type: 'tou', name: 'Peak Export', rate: 0.030, hours: '4pm-9pm' },
            { type: 'tou', name: 'Shoulder Export', rate: 0.003, hours: '9pm-10am, 2pm-4pm' },
            { type: 'tou', name: 'Solar Sponge', rate: 0.000, hours: '10am-2pm' }
        ],
		specialConditions: [
			{
				name: 'ZEROHERO Credit (Daylight Saving)',
				// Rule applies from October (10) to March (3)
				months: [10, 11, 12, 1, 2, 3], 
				condition: { 
					metric: 'import_in_window',      // Our new metric
					hours: '6pm-8pm',               // The DST window
					operator: 'less_than_or_equal_to',
					value: 0.06                     // The total threshold (0.03 kWh/hr * 2 hours)
				},
				action: { 
					type: 'flat_credit',
					value: 1.00 
				}
			},
			{
				name: 'ZEROHERO Credit (Standard Time)',
				// Rule applies from April (4) to September (9)
				months: [4, 5, 6, 7, 8, 9],
				condition: { 
					metric: 'import_in_window',
					hours: '5pm-7pm',               // The standard time window
					operator: 'less_than_or_equal_to',
					value: 0.06                     // The total threshold is the same
				},
				action: { 
					type: 'flat_credit',
					value: 1.00
				}
			}], 
        gridChargeEnabled: true,
        gridChargeStart: 11,
        gridChargeEnd: 15
    }, // <-- FIXED: Missing comma added
    {
        id: "Amber",
        name: "Amber",
		isExpanded: true,
        dailyCharge: 1.091,
        monthlyFee: 25,
        rebate: 1500,
        importRules: [
            { type: 'flat', name: 'Average Import', rate: 0.355 }
        ],
        exportRules: [
            { type: 'flat', name: 'Average Export', rate: 0.007 }
        ], // <-- FIXED: Missing comma added
		specialConditions: [], 
        gridChargeEnabled: false,
        gridChargeStart: 23,
        gridChargeEnd: 5
    },
    {
        id: "AGL",
        name: "AGL Energy",
		isExpanded: true,
        dailyCharge: 1.2,
        rebate: 0,
        monthlyFee: 0,
        importRules: [
            { type: 'tou', name: 'Peak', rate: 0.5, hours: '3pm-11pm' }, // <-- FIXED: Added quotes
            { type: 'tou', name: 'Shoulder', rate: 0.3, hours: '7am-11am, 11pm-12am' },
            { type: 'tou', name: 'Off-Peak', rate: 0.2, hours: '12am-7am, 11am-3pm' }
        ],
        exportRules: [
            { type: 'flat', name: 'Flat Rate', rate: 0.05 }
        ], // <-- FIXED: Missing comma added
		specialConditions: [], 
        gridChargeEnabled: false,
        gridChargeStart: 0,
        gridChargeEnd: 7
    },
];

export function getProviders() {
    const providersJson = localStorage.getItem(PROVIDERS_KEY);
    return providersJson ? JSON.parse(providersJson) : []; // Return an array
}

export function saveAllProviders(providersArray) {
    localStorage.setItem(PROVIDERS_KEY, JSON.stringify(providersArray));
}

export function saveProvider(providerData) {
    let allProviders = getProviders();
    const index = allProviders.findIndex(p => p.id === providerData.id);
    if (index > -1) {
        allProviders[index] = providerData; // Update existing
    } else {
        if (!providerData.id) providerData.id = `custom_${Date.now()}`;
        allProviders.push(providerData); // Add new
    }
    saveAllProviders(allProviders);
}

export function deleteProvider(providerId) {
    let allProviders = getProviders();
    allProviders = allProviders.filter(p => p.id !== providerId);
    saveAllProviders(allProviders);
}

export function initializeDefaultProviders() {
    const defaultsLoaded = localStorage.getItem(DEFAULTS_LOADED_KEY);
    if (!defaultsLoaded) {
        saveAllProviders(defaultProviders);
        localStorage.setItem(DEFAULTS_LOADED_KEY, 'true');
    }
}