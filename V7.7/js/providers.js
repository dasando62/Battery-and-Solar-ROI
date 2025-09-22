// js/providers.js
//Version 7.7
export const providers = {
    "Origin": {
        name: "Origin Energy",
        importComponent: 'TIME_OF_USE_IMPORT',
        exportComponent: 'MULTI_TIER_FIT',
        exportType: 'tiered'
    },
    "GloBird": {
        name: "GloBird",
        importComponent: 'TIME_OF_USE_IMPORT',
        exportComponent: 'GLOBIRD_COMPLEX_FIT',
        exportType: 'timeOfUse'
    },
    "Amber": {
        name: "Amber",
        importComponent: 'FLAT_RATE_IMPORT',
        exportComponent: 'FLAT_RATE_FIT',
        exportType: 'flat'
    },
    "AGL": {
        name: "AGL Energy",
        importComponent: 'TIME_OF_USE_IMPORT',
        exportComponent: 'FLAT_RATE_FIT',
        exportType: 'flat'
    }
};