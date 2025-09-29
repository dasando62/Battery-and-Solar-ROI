// js/providerManager.js
//Version 9.6
const PROVIDERS_KEY = 'roiAnalyzer_providers';
const DEFAULTS_LOADED_KEY = 'roiAnalyzer_defaults_loaded';

const defaultProviders = {
    "Origin": {
        id: "Origin", name: "Origin Energy", importComponent: 'TIME_OF_USE_IMPORT', exportComponent: 'MULTI_TIER_FIT', exportType: 'tiered',
        dailyCharge: 1.1605, peakRate: 0.59653, shoulderRate: 0.29425, offPeakRate: 0.35233,
        peakHours: '7am-10am, 4pm-10pm', shoulderHours: '10am-4pm', offPeakHours: '10pm-7am',
        export1Rate: 0.10, export1Limit: 14, export2Rate: 0.02,
        gridChargeEnabled: false, gridChargeStart: 23, gridChargeEnd: 5
    },
    "GloBird": {
        id: "GloBird", name: "GloBird", importComponent: 'TIME_OF_USE_IMPORT', exportComponent: 'GLOBIRD_COMPLEX_FIT', exportType: 'timeOfUse',
        dailyCharge: 1.364, peakRate: 0.528, shoulderRate: 0.396, offPeakRate: 0.000,
        peakHours: '3pm-11pm', shoulderHours: '7am-11am, 10pm-12am', offPeakHours: '12am-7am, 11am-3pm',
        export4pm9pmRate: 0.030, export9pm10am2pm4pmRate: 0.003, export10am2pmRate: 0.000,
        superExportRate: 0.120, superExportLimit: 10, zeroHeroCredit: -1.00,
        gridChargeEnabled: false, gridChargeStart: 23, gridChargeEnd: 5
    },
    "Amber": {
        id: "Amber", name: "Amber", importComponent: 'FLAT_RATE_IMPORT', exportComponent: 'FLAT_RATE_FIT', exportType: 'flat',
        dailyCharge: 1.091, importRate: 0.355, exportRate: 0.007, monthlyFee: 25,
        gridChargeEnabled: false, gridChargeStart: 23, gridChargeEnd: 5
    },
    "AGL": {
        id: "AGL", name: "AGL Energy", importComponent: 'TIME_OF_USE_IMPORT', exportComponent: 'FLAT_RATE_FIT', exportType: 'flat',
        dailyCharge: 1.2, peakRate: 0.5, shoulderRate: 0.3, offPeakRate: 0.2,
        peakHours: '3pm-11pm', shoulderHours: '7am-11am, 10pm-12am', offPeakHours: '12am-7am, 11am-3pm',
        exportRate: 0.05,
        gridChargeEnabled: false, gridChargeStart: 23, gridChargeEnd: 5
    }
};

export function getProviders() {
    const providersJson = localStorage.getItem(PROVIDERS_KEY);
    return providersJson ? JSON.parse(providersJson) : {};
}

export function saveProvider(providerData) {
    if (!providerData.id) {
        providerData.id = `custom_${Date.now()}`;
    }
    const allProviders = getProviders();
    allProviders[providerData.id] = providerData;
    localStorage.setItem(PROVIDERS_KEY, JSON.stringify(allProviders));
}

export function deleteProvider(providerId) {
    const allProviders = getProviders();
    delete allProviders[providerId];
    localStorage.setItem(PROVIDERS_KEY, JSON.stringify(allProviders));
}

export function initializeDefaultProviders() {
    const defaultsLoaded = localStorage.getItem(DEFAULTS_LOADED_KEY);
    if (!defaultsLoaded) {
        localStorage.setItem(PROVIDERS_KEY, JSON.stringify(defaultProviders));
        localStorage.setItem(DEFAULTS_LOADED_KEY, 'true');
    }
}