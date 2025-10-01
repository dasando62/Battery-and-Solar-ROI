// js/tariffComponents.js
// Version 1.0.2

import { escalate } from './utils.js';

// --- IMPORT COST CALCULATION COMPONENTS ---

function calculateFlatRateImport(importData, dailyBreakdown, escalationConfig) {
    const { rate, year } = escalationConfig;
    const totalImport = dailyBreakdown.peakKWh + dailyBreakdown.shoulderKWh + dailyBreakdown.offPeakKWh;
    
    // Escalate the base rate before calculating the cost
    const escalatedRate = escalate(importData.rate || 0, rate, year);
    return totalImport * escalatedRate;
}

function calculateTimeOfUseImport(importData, dailyBreakdown, escalationConfig) {
    const { rate, year } = escalationConfig;
    let cost = 0;

    // Escalate each TOU rate before calculating the cost for that period
    cost += dailyBreakdown.peakKWh * escalate(importData.peak || 0, rate, year);
    cost += dailyBreakdown.shoulderKWh * escalate(importData.shoulder || 0, rate, year);
    cost += dailyBreakdown.offPeakKWh * escalate(importData.offPeak || 0, rate, year);
    
    return cost;
}

// --- FEED-IN TARIFF (FIT) CALCULATION COMPONENTS ---
// These remain unchanged as they use a specific degradation logic, not escalation.

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
    
    // Note: This assumes the hourly export rates for GloBird also degrade over time.
    for (let h = 0; h < 24; h++) {
        if (dailyBreakdown.hourlyExports[h] > 0) {
            const rateForHour = getRateForHour(h, exportData.touRates);
            credit += dailyBreakdown.hourlyExports[h] * getDegradedFitRate(rateForHour, year, fitConfig);
        }
    }
    return credit;
}


// --- EXPORTED COMPONENT LIBRARY ---

export const tariffComponents = {
    FLAT_RATE_IMPORT: { calculate: calculateFlatRateImport },
    TIME_OF_USE_IMPORT: { calculate: calculateTimeOfUseImport },
    FLAT_RATE_FIT: { calculate: calculateFlatRateFit },
    MULTI_TIER_FIT: { calculate: calculateMultiTierFit },
    GLOBIRD_COMPLEX_FIT: { calculate: calculateGloBirdComplexFit },
};