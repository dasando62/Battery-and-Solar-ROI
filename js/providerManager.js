// js/providerManager.js
// Version 9.5

// --- LOCALSTORAGE KEYS ---
const PROVIDERS_KEY = 'roiAnalyzer_providers';
const DEFAULTS_LOADED_KEY = 'roiAnalyzer_defaults_loaded';

// --- DEFAULT PROVIDER DATA ---
// This is the starting set of providers for a new user.
const defaultProviders = {
    "Origin": {
        id: "Origin",
        name: "Origin Energy",
        importComponent: 'TIME_OF_USE_IMPORT',
        exportComponent: 'MULTI_TIER_FIT',
        exportType: 'tiered',
        dailyCharge: 1.1605,
        peakRate: 0.59653,
        shoulderRate: 0.29425,
        offPeakRate: 0.35233,
        peakHours: '7am-10am, 4pm-10pm',
        shoulderHours: '10am-4pm',
        offPeakHours: '10pm-7am',
        export1Rate: 0.10,
        export1Limit: 14,
        export2Rate: 0.02,
        gridChargeEnabled: false,
        gridChargeStart: 23,
        gridChargeEnd: 5
    },
    "GloBird": {
        id: "GloBird",
        name: "GloBird",
        importComponent: 'TIME_OF_USE_IMPORT',
        exportComponent: 'GLOBIRD_COMPLEX_FIT',
        exportType: 'timeOfUse',
        dailyCharge: 1.364,
        peakRate: 0.528,
        shoulderRate: 0.396,
        offPeakRate: 0.000,
        peakHours: '3pm-11pm',
        shoulderHours: '7am-11am, 10pm-12am',
        offPeakHours: '12am-7am, 11am-3pm',
        export4pm9pmRate: 0.030,
        export9pm10am2pm4pmRate: 0.003,
        export10am2pmRate: 0.000,
        superExportRate: 0.120,
        superExportLimit: 10,
        zeroHeroCredit: -1.00,
        gridChargeEnabled: false,
        gridChargeStart: 23,
        gridChargeEnd: 5
    },
    "Amber": {
        id: "Amber",
        name: "Amber",
        importComponent: 'FLAT_RATE_IMPORT',
        exportComponent: 'FLAT_RATE_FIT',
        exportType: 'flat',
        dailyCharge: 1.091,
        importRate: 0.355,
        exportRate: 0.007,
        monthlyFee: 25,
        gridChargeEnabled: false,
        gridChargeStart: 23,
        gridChargeEnd: 5
    },
    "AGL": {
        id: "AGL",
        name: "AGL Energy",
        importComponent: 'TIME_OF_USE_IMPORT',
        exportComponent: 'FLAT_RATE_FIT',
        exportType: 'flat',
        dailyCharge: 1.2,
        peakRate: 0.5,
        shoulderRate: 0.3,
        offPeakRate: 0.2,
        peakHours: '3pm-11pm',
        shoulderHours: '7am-11am, 10pm-12am',
        offPeakHours: '12am-7am, 11am-3pm',
        exportRate: 0.05,
        gridChargeEnabled: false,
        gridChargeStart: 23,
        gridChargeEnd: 5
    }
};

// --- CORE FUNCTIONS ---

/**
 * Retrieves all provider configurations from localStorage.
 * @returns {Object} An object containing all provider configurations.
 */
export function getProviders() {
    //console.log("--- getProviders() called ---");
    const providersJson = localStorage.getItem(PROVIDERS_KEY);
    //console.log("Data from localStorage:", providersJson);
    const providers = providersJson ? JSON.parse(providersJson) : {};
    //console.log("Returning providers object:", providers);
    //console.log("--------------------------");
    return providersJson ? JSON.parse(providersJson) : {};
}

/**
 * Saves a single provider configuration to localStorage.
 * @param {Object} providerData - The provider object to save.
 */
export function saveProvider(providerData) {
    if (!providerData.id) {
        // Create a unique ID for new providers
        providerData.id = `custom_${Date.now()}`;
    }
    const allProviders = getProviders();
    allProviders[providerData.id] = providerData;
    localStorage.setItem(PROVIDERS_KEY, JSON.stringify(allProviders));
}

/**
 * Deletes a provider from localStorage by its ID.
 * @param {string} providerId - The ID of the provider to delete.
 */
export function deleteProvider(providerId) {
    const allProviders = getProviders();
    delete allProviders[providerId];
    localStorage.setItem(PROVIDERS_KEY, JSON.stringify(allProviders));
}

/**
 * Checks if default providers have been loaded, and loads them if not.
 * This runs once per user to give them a starting point.
 */
export function initializeDefaultProviders() {
    const defaultsLoaded = localStorage.getItem(DEFAULTS_LOADED_KEY);
    if (!defaultsLoaded) {
        localStorage.setItem(PROVIDERS_KEY, JSON.stringify(defaultProviders));
        localStorage.setItem(DEFAULTS_LOADED_KEY, 'true');
        console.log("Default providers loaded into localStorage for the first time.");
    }
}