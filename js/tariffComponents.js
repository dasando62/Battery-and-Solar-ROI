// js/tariffComponents.js
// Version 1.1.4
// This module contains the core "rules engines" for calculating daily electricity costs and credits.
// It provides a generic, data-driven way to handle various complex tariff structures,
// making the system extensible to new types of rules in the future.

/*
 * Home Battery & Solar ROI Analyzer
 * Copyright (c) 2025 [DaSando62]
 *
 * This software is licensed under the MIT License.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { escalate, parseRangesToHours } from './utils.js';

/**
 * A generic "rules engine" to calculate the total import cost for a day.
 * It processes a list of import rules in the order they are provided, which is
 * crucial for correctly calculating costs under tiered or combined tariff schemes.
 * @param {Array} importRules - An array of rule objects from the provider's configuration.
 * @param {object} dailyBreakdown - An object containing the day's hourly and total energy data.
 * @param {object} escalationConfig - Contains the tariff escalation rate and the current simulation year.
 * @returns {number} The total calculated import cost for the day.
 */
function calculateImportCost(importRules, dailyBreakdown, escalationConfig) {
    let totalCost = 0;
    // Create a mutable copy of the hourly import data. As costs are calculated,
    // the corresponding kWh in this array will be set to zero to prevent double-counting.
    const remainingHourlyImports = [...(dailyBreakdown.hourlyImports || [])];
    let remainingTotalImport = remainingHourlyImports.reduce((a, b) => a + b, 0);

    const { rate: escalationRate, year } = escalationConfig;

    // Process rules in the order they appear in the provider's array.
    for (const rule of importRules) {
        if (remainingTotalImport <= 0) break; // Stop if all imported energy has been costed.

        // Apply the annual tariff escalation to the rule's base rate.
        const escalatedRate = escalate(rule.rate || 0, escalationRate, year);

        switch (rule.type) {
            case 'tou': // Time of Use rule: Applies to specific hours of the day.
                const ruleHours = parseRangesToHours(rule.hours || '');
                for (const h of ruleHours) {
                    if (remainingHourlyImports[h] > 0) {
                        totalCost += remainingHourlyImports[h] * escalatedRate;
                        remainingTotalImport -= remainingHourlyImports[h];
                        remainingHourlyImports[h] = 0; // Mark this hour's import as processed.
                    }
                }
                break;

            case 'tiered': // Tiered rule: Applies to a block of the total daily import.
                const amountInTier = Math.min(remainingTotalImport, rule.limit || Infinity);
                totalCost += amountInTier * escalatedRate;
                remainingTotalImport -= amountInTier;
                // Note: This simplified model assumes tiers apply to the daily total regardless of time.
                // It doesn't deplete specific hours, which is accurate for most tiered billing.
                break;

            case 'flat': // Flat rate rule: Applies to all remaining unprocessed import.
                totalCost += remainingTotalImport * escalatedRate;
                remainingTotalImport = 0;
                break;
        }
    }
    return totalCost;
}

/**
 * A generic "rules engine" to calculate the total export credit for a day.
 * It processes rules in order, allowing for complex schemes like a bonus tier
 * for the first X kWh, followed by different Time of Use rates for the rest.
 * @param {Array} exportRules - An array of rule objects from the provider's configuration.
 * @param {object} dailyBreakdown - An object containing the day's energy data.
 * @param {number} year - The current simulation year (for degradation calculation).
 * @param {object} fitConfig - Configuration for Feed-In Tariff (FIT) degradation.
 * @param {Function} getDegradedFitRate - Helper function to calculate the FIT rate for the current year.
 * @returns {number} The total calculated export credit for the day.
 */
function calculateExportCredit(exportRules, dailyBreakdown, year, fitConfig, getDegradedFitRate) {
    let totalCredit = 0;
    // Create a mutable copy of hourly exports to track what has been processed.
    const remainingHourlyExports = [...(dailyBreakdown.hourlyExports || [])];
    let remainingTotalExport = remainingHourlyExports.reduce((a, b) => a + b, 0);

    for (const rule of exportRules) {
        if (remainingTotalExport <= 0) break;

        // Calculate the degraded FIT rate for the current year before applying it.
        const degradedRate = getDegradedFitRate(rule.rate || 0, year, fitConfig);

        switch (rule.type) {
            case 'tiered': // Tiered rule: Applies to a block of the total daily export.
                const amountInTier = Math.min(remainingTotalExport, rule.limit || Infinity);
                totalCredit += amountInTier * degradedRate;
                remainingTotalExport -= amountInTier;
                // Since the tier consumes a portion of the total export, we must proportionally
                // reduce all the hourly export values to reflect this consumption.
                const reductionFactor = (remainingTotalExport + amountInTier) > 0 ? remainingTotalExport / (remainingTotalExport + amountInTier) : 0;
                for (let h = 0; h < 24; h++) {
                    remainingHourlyExports[h] *= reductionFactor;
                }
                break;

            case 'tou': // Time of Use rule: Applies to specific hours.
                const ruleHours = parseRangesToHours(rule.hours || '');
                for (const h of ruleHours) {
                    if (remainingHourlyExports[h] > 0) {
                        totalCredit += remainingHourlyExports[h] * degradedRate;
                        remainingTotalExport -= remainingHourlyExports[h];
                        remainingHourlyExports[h] = 0; // Mark as processed.
                    }
                }
                break;

            case 'flat': // Flat rate rule: Applies to all remaining unprocessed export.
                totalCredit += remainingTotalExport * degradedRate;
                remainingTotalExport = 0;
                break;
        }
    }
    return totalCredit;
}

// --- EXPORTED COMPONENT LIBRARY ---
// This object exports the two main rules engines in a structured way,
// making them available to the main analysis module.
export const tariffComponents = {
    IMPORT_RULES: { calculate: calculateImportCost },
    EXPORT_RULES: { calculate: calculateExportCredit },
};