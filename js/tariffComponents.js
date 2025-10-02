// js/tariffComponents.js
// Version 1.0.4

import { escalate, parseRangesToHours } from './utils.js';

/**
 * A generic "rules engine" to calculate the total import cost for a day.
 * It processes rules in the order they are provided, allowing for prioritization.
 * @param {Array} importRules - An array of rule objects from the provider.
 * @param {Object} dailyBreakdown - An object containing the day's energy data.
 * @param {Object} escalationConfig - Contains the escalation rate and current year.
 * @returns {number} The total calculated import cost for the day.
 */
function calculateImportCost(importRules, dailyBreakdown, escalationConfig) {
    let totalCost = 0;
    // Create a mutable copy of the hourly import data to track what's been processed.
    const remainingHourlyImports = [...(dailyBreakdown.hourlyImports || [])];
    let remainingTotalImport = remainingHourlyImports.reduce((a, b) => a + b, 0);

    const { rate: escalationRate, year } = escalationConfig;

    // Process rules in the order they appear in the array.
    for (const rule of importRules) {
        if (remainingTotalImport <= 0) break; // Stop if all imports have been processed.

        const escalatedRate = escalate(rule.rate || 0, escalationRate, year);

        switch (rule.type) {
            case 'tou': // Time of Use rule
                const ruleHours = parseRangesToHours(rule.hours || '');
                for (const h of ruleHours) {
                    if (remainingHourlyImports[h] > 0) {
                        totalCost += remainingHourlyImports[h] * escalatedRate;
                        remainingTotalImport -= remainingHourlyImports[h];
                        remainingHourlyImports[h] = 0; // Mark this hour as processed.
                    }
                }
                break;

            case 'tiered': // Tiered rule (processes a portion of the total daily import)
                const amountInTier = Math.min(remainingTotalImport, rule.limit || Infinity);
                totalCost += amountInTier * escalatedRate;
                remainingTotalImport -= amountInTier;
                // Note: This simplified tiered model doesn't deplete specific hours,
                // assuming tiers apply to the daily total regardless of time.
                break;

            case 'flat': // Flat rate rule (processes all remaining import)
                totalCost += remainingTotalImport * escalatedRate;
                remainingTotalImport = 0;
                break;
        }
    }
    return totalCost;
}

/**
 * A generic "rules engine" to calculate the total export credit for a day.
 * It processes rules in order, allowing for complex schemes like bonus tiers followed by TOU rates.
 * @param {Array} exportRules - An array of rule objects from the provider.
 * @param {Object} dailyBreakdown - An object containing the day's energy data.
 * @param {number} year - The current simulation year.
 * @param {Object} fitConfig - Configuration for Feed-In Tariff degradation.
 * @param {Function} getDegradedFitRate - Helper function to get the degraded rate.
 * @returns {number} The total calculated export credit for the day.
 */
function calculateExportCredit(exportRules, dailyBreakdown, year, fitConfig, getDegradedFitRate) {
    let totalCredit = 0;
    const remainingHourlyExports = [...(dailyBreakdown.hourlyExports || [])];
    let remainingTotalExport = remainingHourlyExports.reduce((a, b) => a + b, 0);

    for (const rule of exportRules) {
        if (remainingTotalExport <= 0) break;

        const degradedRate = getDegradedFitRate(rule.rate || 0, year, fitConfig);

        switch (rule.type) {
            case 'tiered':
                const amountInTier = Math.min(remainingTotalExport, rule.limit || Infinity);
                totalCredit += amountInTier * degradedRate;
                remainingTotalExport -= amountInTier;
                // This assumes the highest-priority kWh are used by the tier first.
                // We need to proportionally reduce the hourly exports.
                const reductionFactor = (remainingTotalExport + amountInTier) > 0 ? remainingTotalExport / (remainingTotalExport + amountInTier) : 0;
                for (let h = 0; h < 24; h++) {
                    remainingHourlyExports[h] *= reductionFactor;
                }
                break;

            case 'tou':
                const ruleHours = parseRangesToHours(rule.hours || '');
                for (const h of ruleHours) {
                    if (remainingHourlyExports[h] > 0) {
                        totalCredit += remainingHourlyExports[h] * degradedRate;
                        remainingTotalExport -= remainingHourlyExports[h];
                        remainingHourlyExports[h] = 0;
                    }
                }
                break;

            case 'flat':
                totalCredit += remainingTotalExport * degradedRate;
                remainingTotalExport = 0;
                break;
        }
    }
    return totalCredit;
}

// --- EXPORTED COMPONENT LIBRARY ---
// The library is now much simpler, exporting the two main engine functions.
export const tariffComponents = {
    IMPORT_RULES: { calculate: calculateImportCost },
    EXPORT_RULES: { calculate: calculateExportCredit },
};