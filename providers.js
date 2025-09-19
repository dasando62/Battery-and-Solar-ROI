// js/providers.js
// Version 7.7
// This file contains the data and configuration for all electricity providers.

export const providers = {
    "Origin": {
        name: "Origin Energy",
        dailyCharge: 1.1605,
        rebate: 0,
        monthlyFee: 0,
        importComponent: 'TIME_OF_USE_IMPORT',
        exportComponent: 'MULTI_TIER_FIT',
        exportType: 'tiered'
    },
    "GloBird": {
        name: "GloBird",
        dailyCharge: 1.36400,
        rebate: 1500,
        monthlyFee: 0,
        importComponent: 'TIME_OF_USE_IMPORT',
        exportComponent: 'GLOBIRD_COMPLEX_FIT',
        exportType: 'timeOfUse'
    },
    "Amber": {
        name: "Amber",
        dailyCharge: 1.091,
        rebate: 0,
        monthlyFee: 25,
        importComponent: 'FLAT_RATE_IMPORT',
        exportComponent: 'FLAT_RATE_FIT',
        exportType: 'flat'
    },
    "AGL": {
        name: "AGL Energy",
        dailyCharge: 1.2,
        rebate: 0,
        monthlyFee: 0,
        importComponent: 'TIME_OF_USE_IMPORT',
        exportComponent: 'FLAT_RATE_FIT',
        exportType: 'flat'
    }
};