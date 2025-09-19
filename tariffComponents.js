// js/tariffComponents.js
//Version 7.7
// This file contains the library of calculation "recipes" for different tariff rules.

function calculateFlatRateImport(importData, dailyBreakdown, escalationFactor) {
    const totalImport = dailyBreakdown.peakKWh + dailyBreakdown.shoulderKWh + dailyBreakdown.offPeakKWh;
    return totalImport * (importData.rate || 0) * escalationFactor;
}
function calculateTimeOfUseImport(importData, dailyBreakdown, escalationFactor) {
    let cost = 0;
    cost += dailyBreakdown.peakKWh * (importData.peak || 0);
    cost += dailyBreakdown.shoulderKWh * (importData.shoulder || 0);
    cost += dailyBreakdown.offPeakKWh * (importData.offPeak || 0);
    return cost * escalationFactor;
}
function calculateFlatRateFit(exportData, dailyBreakdown, year, fitConfig, getDegradedFitRate) {
    const totalExport = dailyBreakdown.tier1ExportKWh + dailyBreakdown.tier2ExportKWh;
    const degradedRate = getDegradedFitRate(exportData.rate, year, fitConfig);
    return totalExport * degradedRate;
}
function calculateMultiTierFit(exportData, dailyBreakdown, year, fitConfig, getDegradedFitRate) {
    let credit = 0;
    const tier1Rule = exportData.tiers[0];
    const tier2Rule = exportData.tiers[1];
    credit += dailyBreakdown.tier1ExportKWh * getDegradedFitRate(tier1Rule.rate, year, fitConfig);
    credit += dailyBreakdown.tier2ExportKWh * getDegradedFitRate(tier2Rule.rate, year, fitConfig);
    return credit;
}

function calculateGloBirdComplexFit(exportData, dailyBreakdown, year, fitConfig, getDegradedFitRate, getRateForHour) {
    let credit = 0;
    const totalExport = dailyBreakdown.hourlyExports.reduce((a, b) => a + b, 0);
    const bonusAmount = Math.min(totalExport, exportData.bonusLimit);
    credit += bonusAmount * getDegradedFitRate(exportData.bonusRate, year, fitConfig);
    for (let h = 0; h < 24; h++) {
        if (dailyBreakdown.hourlyExports[h] > 0) {
            const rateForHour = getRateForHour(h, exportData.touRates);
            // THE FIX IS HERE: Changed 'y' to 'year' to match the function's parameter
            credit += dailyBreakdown.hourlyExports[h] * getDegradedFitRate(rateForHour, year, fitConfig);
        }
    }
    return credit;
}

export const tariffComponents = {
    FLAT_RATE_IMPORT: { calculate: calculateFlatRateImport },
    TIME_OF_USE_IMPORT: { calculate: calculateTimeOfUseImport },
    FLAT_RATE_FIT: { calculate: calculateFlatRateFit },
    MULTI_TIER_FIT: { calculate: calculateMultiTierFit },
    GLOBIRD_COMPLEX_FIT: { calculate: calculateGloBirdComplexFit },
};