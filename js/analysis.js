// js/analysis.js
// Version 1.1.1
// This is the core of the ROI calculator. It contains the simulation engine,
// financial calculation functions (IRR, NPV), and system sizing algorithms.

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

import { state } from './state.js';
import { getNumericInput, escalate, parseRangesToHours, getSeason } from './utils.js';
import { tariffComponents } from './tariffComponents.js';
import { generateHourlyConsumptionProfileFromDailyTOU, generateHourlySolarProfileFromDaily } from './profiles.js';

/**
 * Calculates the Internal Rate of Return (IRR) for a series of cash flows
 * using the Newton-Raphson method.
 * @param {number[]} cashFlows - An array of cash flows, where the first value is the initial investment (negative).
 * @param {number} [guess=0.1] - An initial guess for the IRR.
 * @returns {number|null} The calculated IRR as a decimal, or null if it fails to converge.
 */
function calculateIRR(cashFlows, guess = 0.1) {
    const maxIterations = 100;
    const tolerance = 1e-6; // How close to zero the NPV needs to be.

    let rate = guess;

    // Iterate to find the root of the NPV equation.
    for (let i = 0; i < maxIterations; i++) {
        let npv = 0;
        let derivative = 0;
        for (let t = 0; t < cashFlows.length; t++) {
            npv += cashFlows[t] / Math.pow(1 + rate, t);
            if (t > 0) {
                derivative -= t * cashFlows[t] / Math.pow(1 + rate, t + 1);
            }
        }
        const newRate = rate - npv / derivative; // Newton's method update rule.
        if (Math.abs(newRate - rate) < tolerance) {
            return newRate; // Converged.
        }
        rate = newRate;
    }
    return null; // Failed to converge.
}

/**
 * Calculates the average State of Charge (SOC) at 6 am across all seasons.
 * This is used for the provider debug table to show battery behavior.
 * @param {object} provider - The provider tariff configuration.
 * @param {object} batteryConfig - The battery configuration.
 * @param {object} simulationData - Seasonal average consumption data.
 * @returns {number} The average SOC at 6 am as a percentage.
 */
function calculateAverageSOCAt6am(provider, batteryConfig, simulationData) {
    if (!batteryConfig || batteryConfig.capacity === 0) {
        return 0; // No battery, no SOC.
    }
    
    let totalAnnualSocKWhDays = 0;
    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };

    // Simulate an average day for each season.
    for (const quarter in simulationData) {
        const qData = simulationData[quarter];
        if (!qData || typeof qData.avgPeak === 'undefined') continue;

        const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(qData.avgPeak, qData.avgShoulder, qData.avgOffPeak);
        
        // Run a simulation assuming no solar to see the "worst-case" morning SOC after overnight usage.
        const simResults = simulateDay(hourlyConsumption, Array(24).fill(0), provider, batteryConfig);
        
        if (daysPerQuarter[quarter]) {
            // Add the weighted result (SOC * days in quarter) to the annual total.
            totalAnnualSocKWhDays += (simResults.socAt6am || 0) * daysPerQuarter[quarter];
        }
    }
    
    // Calculate the weighted average SOC in kWh for the year.
    const avgSocKWh = totalAnnualSocKWhDays > 0 ? totalAnnualSocKWhDays / 365 : 0;
    // Convert the average kWh value to a percentage of the battery's capacity.
    const avgSocPercent = (avgSocKWh / batteryConfig.capacity) * 100;

    return avgSocPercent;
}

/**
 * Applies special, non-standard tariff conditions to a day's calculated cost.
 * E.g., "Get a $1 credit if your net grid usage is less than 5 kWh in winter months".
 * @param {number} dailyCost - The initial calculated cost for the day.
 * @param {object} dailyBreakdown - The breakdown of the day's energy usage.
 * @param {Array} conditions - The array of special condition rules for the provider.
 * @param {string} dateString - The date of the simulation ('YYYY-MM-DD').
 * @returns {number} The adjusted daily cost after applying conditions.
 */
function applySpecialConditions(dailyCost, dailyBreakdown, conditions, dateString) {
    let adjustedCost = dailyCost;
    if (!conditions || conditions.length === 0) {
        return adjustedCost;
    }

    const month = parseInt(dateString.split('-')[1], 10);

    // Evaluate each condition rule.
    for (const condition of conditions) {
        // If the rule has a 'months' property, check if it applies today.
        if (condition.months && condition.months.length > 0 && !condition.months.includes(month)) {
            continue; // Skip if rule is not for the current month.
        }
        
        // Get the value of the metric to be tested.
        let metricValue;
        switch (condition.condition.metric) {
            case 'peak_import':
                metricValue = dailyBreakdown.peakKWh;
                break;
            case 'net_grid_usage':
                const totalImport = dailyBreakdown.peakKWh + dailyBreakdown.shoulderKWh + dailyBreakdown.offPeakKWh;
                const totalExport = dailyBreakdown.tier1ExportKWh + dailyBreakdown.tier2ExportKWh;
                metricValue = totalImport - totalExport;
                break;
            case 'import_in_window':
                const ruleHours = parseRangesToHours(condition.condition.hours || '');
                metricValue = 0;
                for (const h of ruleHours) {
                    metricValue += dailyBreakdown.hourlyImports[h] || 0;
                }
                break;
        }

        // Check if the condition is met based on the operator.
        let conditionMet = false;
        switch (condition.condition.operator) {
            case 'less_than': conditionMet = metricValue < condition.condition.value; break;
            case 'less_than_or_equal_to': conditionMet = metricValue <= condition.condition.value; break;
            case 'greater_than': conditionMet = metricValue > condition.condition.value; break;
            case 'greater_than_or_equal_to': conditionMet = metricValue >= condition.condition.value; break;
        }

        // If the condition is met, apply the specified action (credit or charge).
        if (conditionMet) {
            switch (condition.action.type) {
                case 'flat_credit': adjustedCost -= condition.action.value; break;
                case 'flat_charge': adjustedCost += condition.action.value; break;
            }
        }
    }
    return adjustedCost;
}

/**
 * Retrieves the Feed-in Tariff (FIT) degradation settings from the UI.
 * @returns {object} Configuration for FIT degradation.
 */
function getFitDegradationConfig() {
    return {
        startYear: getNumericInput("fitDegradationStartYear", 1),
        endYear: getNumericInput("fitDegradationEndYear", 10),
        minRate: getNumericInput("fitMinimumRate", 0.03)
    };
}

/**
 * Calculates the degraded Feed-in Tariff (FIT) rate for a given year.
 * The rate degrades linearly from the base rate to the minimum rate over a specified period.
 * @param {number} baseRate - The initial FIT rate.
 * @param {number} year - The analysis year (e.g., 1, 2, 3...).
 * @param {object} config - The FIT degradation configuration object.
 * @returns {number} The calculated FIT rate for that year.
 */
export function getDegradedFitRate(baseRate, year, config) {
    // Before the degradation period, return the base rate.
    if (year < config.degradationStartYear) {
        return baseRate;
    }
    // After the degradation period, return the minimum rate.
    if (year >= config.degradationEndYear || config.degradationEndYear <= config.degradationStartYear) {
        return config.minimumRate;
    }

    const totalYears = config.degradationEndYear - config.degradationStartYear;
    const currentYearIntoDegradation = year - config.degradationStartYear;
    
    // Calculate the percentage of the way through the degradation period.
    const percentage = currentYearIntoDegradation / totalYears;
    
    // The total amount the rate will drop over the period.
    const rateDifference = baseRate - config.minimumRate;

    // Linearly interpolate the rate for the current year.
    return baseRate - (rateDifference * percentage);
}

/**
 * Simulates energy flows for a single 24-hour period.
 * This is the core simulation function that models consumption, solar, and battery behavior.
 * @param {number[]} hourlyConsumption - Array of 24 consumption values (kWh).
 * @param {number[]} hourlySolar - Array of 24 solar generation values (kWh).
 * @param {object} provider - The provider tariff configuration.
 * @param {object|null} batteryConfig - The battery configuration. If null, a no-battery baseline is simulated.
 * @param {number} [initialSOC=0] - The initial state of charge of the battery in kWh.
 * @returns {object} An object containing the daily breakdown of energy flows and the final battery SOC.
 */
export function simulateDay(hourlyConsumption, hourlySolar, provider, batteryConfig, initialSOC = 0) {
    const results = {
        peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0,
        tier1ExportKWh: 0, tier2ExportKWh: 0,
        gridChargeKWh: 0,
        hourlyImports: Array(24).fill(0),
        hourlyExports: Array(24).fill(0)
    };
    let currentSOC = initialSOC;
    let gridChargeCost = 0;
    let socAt6am = 0; // For debug tracking.

    if (!batteryConfig) { // --- No-battery baseline simulation ---
        for (let h = 0; h < 24; h++) {
            const consumption = hourlyConsumption[h] || 0;
            const solar = hourlySolar[h] || 0;
            const net = consumption - solar; // Net energy needed from grid or exported.
            if (net > 0) {
                results.hourlyImports[h] = net;
            } else {
                results.hourlyExports[h] = -net;
            }
        }
    } else { // --- Battery simulation logic ---
        for (let h = 0; h < 24; h++) {
            if (h === 6) socAt6am = currentSOC; // Record SOC at 6am.
            const consumption = hourlyConsumption[h] || 0;
            const solar = hourlySolar[h] || 0;

            // 1. Direct self-consumption: Solar power used directly by the house.
            const selfConsumption = Math.min(consumption, solar);
            let net = consumption - selfConsumption; // Remaining consumption to be met.
            const excessSolar = solar - selfConsumption; // Solar power left over.

            // 2. Charge battery with excess solar.
            let chargeAmount = 0;
            if (excessSolar > 0 && currentSOC < batteryConfig.capacity) {
                chargeAmount = Math.min(excessSolar, batteryConfig.inverterKW, batteryConfig.capacity - currentSOC);
                currentSOC += chargeAmount;
            }
            // Any solar left after charging is exported to the grid.
            results.hourlyExports[h] = excessSolar - chargeAmount;

            // 3. Discharge battery to meet remaining consumption.
            if (net > 0 && currentSOC > 0) {
                const dischargeAmount = Math.min(net, batteryConfig.inverterKW, currentSOC);
                currentSOC -= dischargeAmount;
                net -= dischargeAmount;
            }

            // 4. Any remaining consumption is imported from the grid.
            results.hourlyImports[h] = net;
            
            // 5. Grid Charging Logic (during specified off-peak hours).
            if (provider.gridChargeEnabled && h >= provider.gridChargeStart && h < provider.gridChargeEnd) {
                const chargeThresholdSOC = batteryConfig.capacity * (batteryConfig.gridChargeThreshold / 100);
                const chargeTriggerSOC = batteryConfig.capacity * (batteryConfig.socChargeTrigger / 100);

                // Only charge if SOC is below the trigger level.
                if (currentSOC < chargeTriggerSOC) {
                    const chargeNeeded = chargeThresholdSOC - currentSOC;
                    if (chargeNeeded > 0) {
                        const gridChargeAmount = Math.min(chargeNeeded, batteryConfig.inverterKW, batteryConfig.capacity - currentSOC);
                        results.gridChargeKWh += gridChargeAmount;
                        currentSOC += gridChargeAmount;
                        // Grid charging counts as an import.
                        results.hourlyImports[h] += gridChargeAmount;
                        
                        // Calculate the cost of this grid charge based on the tariff for the current hour.
                        const touRule = (provider.importRules || []).find(r => r.type === 'tou' && parseRangesToHours(r.hours).includes(h));
                        const flatRule = (provider.importRules || []).find(r => r.type === 'flat');
                        const rateForHour = (touRule || flatRule)?.rate || 0;
                        gridChargeCost += gridChargeAmount * rateForHour;
                    }
                }
            }
        }
    }

    // --- Categorize hourly imports into TOU periods (Peak, Shoulder, Off-Peak) ---
    const peakRule = (provider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
    const shoulderRule = (provider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));
    const peakHours = parseRangesToHours(peakRule?.hours || '');
    const shoulderHours = parseRangesToHours(shoulderRule?.hours || '');

    for (let h = 0; h < 24; h++) {
        const gridImport = results.hourlyImports[h] || 0;
        if (peakHours.includes(h)) {
            results.peakKWh += gridImport;
        } else if (shoulderHours.includes(h)) {
            results.shoulderKWh += gridImport;
        } else {
            results.offPeakKWh += gridImport;
        }
    }

    // --- Categorize daily exports into tiered rates if applicable ---
    const dailyTotalExport = results.hourlyExports.reduce((a, b) => a + b, 0);
    const firstExportRule = (provider.exportRules || [])[0];
    if (provider.exportRules && firstExportRule && firstExportRule.type === 'tiered') {
        results.tier1ExportKWh = Math.min(dailyTotalExport, firstExportRule.limit || Infinity);
        results.tier2ExportKWh = dailyTotalExport - results.tier1ExportKWh;
    } else {
        results.tier1ExportKWh = dailyTotalExport;
    }

    return { dailyBreakdown: results, finalSOC: currentSOC, socAt6am: socAt6am, gridChargeCost: gridChargeCost };
}

/**
 * Calculates the total annualized electricity cost for the baseline (no new system) scenario.
 * @param {object} config - The main analysis configuration object.
 * @param {object} simulationData - Seasonal average data (for manual mode).
 * @param {Array} electricityData - The parsed electricity usage data (for CSV mode).
 * @param {object} rawData - An object to store raw simulation outputs for debugging.
 * @returns {number} The total estimated annual cost for the baseline.
 */
function calculateBaseline(config, simulationData, electricityData, rawData) {
    const baselineProvider = config.providers[0]; // Baseline always uses the first selected provider.
    const importCalculator = tariffComponents.IMPORT_RULES.calculate;
    const exportCalculator = tariffComponents.EXPORT_RULES.calculate;
    const fitConfig = {
        degradationStartYear: config.fitDegradationStartYear,
        degradationEndYear: config.fitDegradationEndYear,
        minimumRate: config.fitMinimumRate,
    };

    let annualizedBaseCost = 0;
    if (config.useManual) {
        // --- Manual Mode Baseline Calculation ---
        let totalCostForPeriod = 0;
        const daysInQuarter = 365 / 4;
        for (const q in simulationData) {
            const quarter = simulationData[q];
            const season = q.split('_')[1];
            // Generate hourly profiles from daily averages.
            const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(quarter.avgPeak, quarter.avgShoulder, quarter.avgOffPeak, baselineProvider.importRules);
            // Account for degradation of the existing solar system.
            const degradedExistingSolar = (config.existingSolarKW * config.manualSolarProfile) * Math.pow(1 - config.solarDegradation, config.existingSystemAge);
            const hourlySolar = generateHourlySolarProfileFromDaily(degradedExistingSolar, q);
            // Simulate an average day for the quarter.
            const simResults = simulateDay(hourlyConsumption, hourlySolar, baselineProvider, null, 0);
            const dailyBreakdown = simResults.dailyBreakdown;
            
            // Store raw data for debug table.
            const rawSeason = rawData.baseline.year1[season];
            if (rawSeason) {
                rawSeason.days += daysInQuarter;
                rawSeason.peakKWh += dailyBreakdown.peakKWh * daysInQuarter;
                rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh * daysInQuarter;
                rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh * daysInQuarter;
                rawSeason.tier1ExportKWh += dailyBreakdown.tier1ExportKWh * daysInQuarter;
                rawSeason.tier2ExportKWh += dailyBreakdown.tier2ExportKWh * daysInQuarter;
            }
            
            // Calculate daily cost and add to the total for the quarter.
            let dailyEnergyCost = importCalculator(baselineProvider.importRules, dailyBreakdown, { rate: 0, year: 1 });
            dailyEnergyCost -= exportCalculator(baselineProvider.exportRules, dailyBreakdown, 1, fitConfig, getDegradedFitRate);
            let totalDailyAdjustment = (baselineProvider.dailyCharge || 0) + dailyEnergyCost;
            totalCostForPeriod += totalDailyAdjustment * daysInQuarter;
        }
        annualizedBaseCost = totalCostForPeriod;
    } else if (electricityData) {
        // --- CSV Mode Baseline Calculation ---
        let totalCostForPeriod = 0;
        let daysProcessed = 0;
        const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
        const shoulderRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));
        const peakHours = parseRangesToHours(peakRule?.hours || '');
        const shoulderHours = parseRangesToHours(shoulderRule?.hours || '');
        
        // Process each day from the CSV data.
        electricityData.forEach(day => {
            daysProcessed++;
            // The baseline breakdown comes directly from the usage CSV.
            const dailyBreakdown = { peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, hourlyImports: day.consumption, hourlyExports: day.feedIn };
            for (let h = 0; h < 24; h++) {
                const gridImport = day.consumption[h] || 0;
                if (peakHours.includes(h)) { dailyBreakdown.peakKWh += gridImport; }
                else if (shoulderHours.includes(h)) { dailyBreakdown.shoulderKWh += gridImport; }
                else { dailyBreakdown.offPeakKWh += gridImport; }
            }
            // Store raw data for debug table.
            const season = getSeason(day.date);
            const rawSeason = rawData.baseline.year1[season];
            if (rawSeason) {
                rawSeason.days++;
                rawSeason.peakKWh += dailyBreakdown.peakKWh;
                rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh;
                rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh;
                const dailyTotalExport = dailyBreakdown.hourlyExports.reduce((a, b) => a + b, 0);
                const firstExportRule = (baselineProvider.exportRules || [])[0];
                if (firstExportRule && firstExportRule.type === 'tiered') {
                    const tier1Amount = Math.min(dailyTotalExport, firstExportRule.limit || Infinity);
                    rawSeason.tier1ExportKWh += tier1Amount;
                    rawSeason.tier2ExportKWh += dailyTotalExport - tier1Amount;
                } else {
                    rawSeason.tier1ExportKWh += dailyTotalExport;
                }
            }
            
            // Calculate the cost for the day and add to the total.
            let dailyEnergyCost = importCalculator(baselineProvider.importRules, dailyBreakdown, { rate: 0, year: 1 });
            dailyEnergyCost -= exportCalculator(baselineProvider.exportRules, dailyBreakdown, 1, fitConfig, getDegradedFitRate);
            let totalDailyAdjustment = (baselineProvider.dailyCharge || 0) + dailyEnergyCost;
            totalDailyAdjustment = applySpecialConditions(totalDailyAdjustment, dailyBreakdown, baselineProvider.specialConditions, day.date);
            totalCostForPeriod += totalDailyAdjustment;
        });
        // Annualize the cost based on the number of days processed.
        const annualizationFactor = daysProcessed > 0 ? 365 / daysProcessed : 0;
        annualizedBaseCost = totalCostForPeriod * annualizationFactor;
    }
    return annualizedBaseCost;
}

/**
 * Calculates the total annualized electricity cost for a single year with the new system.
 * @param {object} providerData - The tariff configuration for the specific provider being calculated.
 * @param {object} config - The main analysis configuration.
 * @param {number} year - The current year of the analysis (for degradation).
 * @param {object} simulationData - Seasonal average data (for manual mode).
 * @param {Array} electricityData - Parsed usage data (for CSV mode).
 * @param {object} rawData - Object to store raw simulation outputs.
 * @returns {number} The total estimated annual cost for the system in the given year.
 */
function calculateSystemYear(providerData, config, year, simulationData, electricityData, rawData) {
    const importCalculator = tariffComponents.IMPORT_RULES.calculate;
    const exportCalculator = tariffComponents.EXPORT_RULES.calculate;
    const fitConfig = {
        degradationStartYear: config.fitDegradationStartYear,
        degradationEndYear: config.fitDegradationEndYear,
        minimumRate: config.fitMinimumRate,
    };
    const baselineProvider = config.providers[0]; // Needed for profile generation in manual mode.
    let annualCost = 0;

    if (config.useManual) {
        // --- Manual Mode System Calculation ---
        let totalCostForPeriod = 0;
        const daysInQuarter = 365 / 4;
        for (const q in simulationData) {
            const quarter = simulationData[q];
            const season = q.split('_')[1];

            // Calculate degradation for both new and existing components.
            const existingSystemCurrentAge = config.existingSystemAge + year - 1;
            const newSystemCurrentAge = year - 1;
            const degradedExistingSolarDaily = (config.replaceExistingSystem ? 0 : config.existingSolarKW * config.manualSolarProfile) * Math.pow(1 - config.solarDegradation, existingSystemCurrentAge);
            const degradedNewSolarDaily = config.newSolarKW * config.manualSolarProfile * Math.pow(1 - config.solarDegradation, newSystemCurrentAge);
            const totalDegradedSolarDaily = degradedExistingSolarDaily + degradedNewSolarDaily;
            const degradedExistingBattery = (config.replaceExistingSystem ? 0 : config.existingBattery) * Math.pow(1 - config.batteryDegradation, existingSystemCurrentAge);
            const degradedNewBattery = config.newBatteryKWH * Math.pow(1 - config.batteryDegradation, newSystemCurrentAge);
            const totalDegradedBatteryCapacity = degradedExistingBattery + degradedNewBattery;
            const batteryConfig = { capacity: totalDegradedBatteryCapacity, inverterKW: config.newBatteryInverterKW, gridChargeThreshold: config.gridChargeThreshold, socChargeTrigger: config.socChargeTrigger };
            
            let currentSOC = batteryConfig.capacity * 0.5; // Assume average starting SOC.
            const trueHourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(quarter.avgPeak, quarter.avgShoulder, quarter.avgOffPeak, baselineProvider.importRules);
            const totalHourlySolar = generateHourlySolarProfileFromDaily(totalDegradedSolarDaily, q);
            
            // Simulate the average day for the quarter.
            const simResults = simulateDay(trueHourlyConsumption, totalHourlySolar, providerData, batteryConfig, currentSOC);
            const dailyBreakdown = simResults.dailyBreakdown;
            
            // Store raw data for the first year.
            if (year === 1) {
                const rawSeason = rawData.system[providerData.id].year1[season];
                if (rawSeason) {
                    rawSeason.days += daysInQuarter;
                    rawSeason.peakKWh += dailyBreakdown.peakKWh * daysInQuarter;
                    rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh * daysInQuarter;
                    rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh * daysInQuarter;
                    rawSeason.tier1ExportKWh += dailyBreakdown.tier1ExportKWh * daysInQuarter;
                    rawSeason.tier2ExportKWh += dailyBreakdown.tier2ExportKWh * daysInQuarter;
                    rawSeason.gridChargeKWh += dailyBreakdown.gridChargeKWh * daysInQuarter;
                    rawSeason.gridChargeCost += simResults.gridChargeCost * daysInQuarter;
                }
            }
            
            // Calculate daily cost, accounting for tariff escalation and FIT degradation.
            let dailyEnergyCost = simResults.gridChargeCost || 0;
            dailyEnergyCost += importCalculator(providerData.importRules, dailyBreakdown, { rate: config.tariffEscalation, year: year });
            dailyEnergyCost -= exportCalculator(providerData.exportRules, dailyBreakdown, year, fitConfig, getDegradedFitRate);
            let totalDailyAdjustment = (providerData.dailyCharge || 0) + dailyEnergyCost;
            totalCostForPeriod += totalDailyAdjustment * daysInQuarter;
        }
        annualCost = totalCostForPeriod;
    } else { 
        // --- CSV Mode System Calculation ---
        let totalCostForPeriod = 0;
        let daysProcessed = 0;
        const solarDataMap = new Map(state.solarData.map(d => [d.date, d.hourly]));
        
        // Calculate system degradation for the current year.
        const existingSystemCurrentAge = config.existingSystemAge + year - 1;
        const newSystemCurrentAge = year - 1;
        const degradedExistingBattery = (config.replaceExistingSystem ? 0 : config.existingBattery) * Math.pow(1 - config.batteryDegradation, existingSystemCurrentAge);
        const degradedNewBattery = config.newBatteryKWH * Math.pow(1 - config.batteryDegradation, newSystemCurrentAge);
        const totalDegradedBatteryCapacity = degradedExistingBattery + degradedNewBattery;
        
        let currentSOC = totalDegradedBatteryCapacity * 0.5; // Start with average SOC.
        
        electricityData.forEach(day => {
            const existingHourlySolar_historical = solarDataMap.get(day.date);
            if (!existingHourlySolar_historical) return; // Skip days with no matching solar data.
            daysProcessed++;

            const batteryConfig = { capacity: totalDegradedBatteryCapacity, inverterKW: config.newBatteryInverterKW, gridChargeThreshold: config.gridChargeThreshold, socChargeTrigger: config.socChargeTrigger };
            
            // Apply degradation to historical solar data.
            const degradedExistingSolar = existingHourlySolar_historical.map(s => s * Math.pow(1 - config.solarDegradation, year - 1));
            // Generate a profile for the new solar panels and apply degradation.
            const newSolarGenerationDaily = config.newSolarKW * config.manualSolarProfile;
            const degradedNewSolarDaily = newSolarGenerationDaily * Math.pow(1 - config.solarDegradation, newSystemCurrentAge);
            const newHourlySolar = generateHourlySolarProfileFromDaily(degradedNewSolarDaily, getSeason(day.date));
            // Combine existing and new solar generation.
            const existingSolarForSim = config.replaceExistingSystem ? Array(24).fill(0) : degradedExistingSolar;
            const totalHourlySolar = existingSolarForSim.map((s, i) => s + newHourlySolar[i]);
            
            // Reconstruct the "true" household consumption before any existing solar was self-consumed.
            const trueHourlyConsumption = Array(24).fill(0);
            for (let h = 0; h < 24; h++) {
                const selfConsumed = Math.max(0, (existingHourlySolar_historical[h] || 0) - (day.feedIn[h] || 0));
                trueHourlyConsumption[h] = (day.consumption[h] || 0) + selfConsumed;
            }
            
            // Simulate the day with the new system.
            const simResults = simulateDay(trueHourlyConsumption, totalHourlySolar, providerData, batteryConfig, currentSOC);
            currentSOC = simResults.finalSOC; // Carry over SOC to the next day.
            const dailyBreakdown = simResults.dailyBreakdown;
            
            // Store raw data for year 1.
            if (year === 1) {
                const season = getSeason(day.date);
                const rawSeason = rawData.system[providerData.id].year1[season];
                if (rawSeason) {
                    rawSeason.days++;
                    rawSeason.peakKWh += dailyBreakdown.peakKWh;
                    rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh;
                    rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh;
                    rawSeason.tier1ExportKWh += dailyBreakdown.tier1ExportKWh;
                    rawSeason.tier2ExportKWh += dailyBreakdown.tier2ExportKWh;
                    rawSeason.gridChargeKWh += dailyBreakdown.gridChargeKWh;
                    rawSeason.gridChargeCost += simResults.gridChargeCost;
                }
            }
            
            // Calculate the cost for the day and add to total.
            let dailyEnergyCost = simResults.gridChargeCost || 0;
            dailyEnergyCost += importCalculator(providerData.importRules, dailyBreakdown, { rate: config.tariffEscalation, year: year });
            dailyEnergyCost -= exportCalculator(providerData.exportRules, dailyBreakdown, year, fitConfig, getDegradedFitRate);
            let totalDailyAdjustment = (providerData.dailyCharge || 0) + dailyEnergyCost;
            totalDailyAdjustment = applySpecialConditions(totalDailyAdjustment, dailyBreakdown, providerData.specialConditions, day.date);
            totalCostForPeriod += totalDailyAdjustment;
        });
        // Annualize the cost based on the number of days processed.
        const annualizationFactor = daysProcessed > 0 ? 365 / daysProcessed : 0;
        annualCost = totalCostForPeriod * annualizationFactor;
    }
    return annualCost;
}

/**
 * The main entry point for running the entire financial analysis over the specified number of years.
 * @param {object} config - The complete analysis configuration.
 * @param {object} simulationData - Seasonal average data (for manual mode).
 * @param {Array} electricityData - Parsed usage data (for CSV mode).
 * @returns {object} An object containing the final financial results, raw data, and the config used.
 */
export function runSimulation(config, simulationData, electricityData) {
    const finalResults = { baselineCosts: [] };
    const rawData = { baseline: { year1: {} }, system: {} };

    // Initialize results and raw data structures for each selected provider.
    config.selectedProviders.forEach(pId => {
        const provider = config.providers.find(p => p.id === pId);
        if (!provider) return;
        finalResults[provider.id] = { annualCosts: [], cumulativeSavingsPerYear: [], roiYear: null, npv: 0 };
        rawData.system[provider.id] = { year1: {} };
        for (const q of ['Summer', 'Autumn', 'Winter', 'Spring']) {
            rawData.baseline.year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, gridChargeCost: 0 };
            rawData.system[provider.id].year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, gridChargeCost: 0 };
        }
    });

    // Calculate the initial annualized baseline cost (Year 1).
    const annualizedBaseCost = calculateBaseline(config, simulationData, electricityData, rawData);

    // --- Loop through each year of the analysis period ---
    for (let y = 1; y <= config.numYears; y++) {
        // Escalate the baseline cost for the current year.
        finalResults.baselineCosts[y] = escalate(annualizedBaseCost, config.tariffEscalation, y);

        // Calculate the system cost for each selected provider for the current year.
        config.selectedProviders.forEach(p => {
            const providerData = config.providers.find(prov => prov.id === p);
            if (!providerData) return;

            // Calculate the total cost with the system for this year.
            const annualCost = calculateSystemYear(providerData, config, y, simulationData, electricityData, rawData);

            // Add any fixed monthly fees (also escalated).
            const finalAnnualCost = annualCost + escalate((providerData.monthlyFee || 0) * 12, config.tariffEscalation, y);
            finalResults[p].annualCosts.push(finalAnnualCost);

            // Calculate savings for the year.
            const annualSavings = finalResults.baselineCosts[y] - finalAnnualCost;
            const prevSavings = y > 1 ? finalResults[p].cumulativeSavingsPerYear[y - 2] : 0;
            // Subtract loan repayments from savings for the duration of the loan.
            const cumulativeSavings = prevSavings + annualSavings - (y <= config.loanTerm ? config.annualLoanRepayment : 0);
            
            // Check for ROI (payback) year.
            if (cumulativeSavings > (config.initialSystemCost - (providerData.rebate || 0)) && !finalResults[p].roiYear) {
                finalResults[p].roiYear = y;
            }
            finalResults[p].cumulativeSavingsPerYear.push(cumulativeSavings);
            
            // If enabled, add the discounted annual savings to the Net Present Value (NPV).
            if (config.discountRateEnabled) {
                finalResults[p].npv += annualSavings / Math.pow(1 + config.discountRate, y);
            }
        });
    }
    
    // --- Post-simulation: Calculate IRR for each provider ---
	config.selectedProviders.forEach(p => {
        const providerData = config.providers.find(prov => prov.id === p);
        if (!providerData) return;

        // Create the cash flow array: [-investment, savings_yr1, savings_yr2, ...].
        const initialInvestment = config.initialSystemCost - (providerData.rebate || 0);
        const annualSavings = [];
        for (let y = 1; y <= config.numYears; y++) {
            const systemCostForYear = finalResults[p].annualCosts[y - 1];
            const baselineCostForYear = finalResults.baselineCosts[y];
            annualSavings.push(baselineCostForYear - systemCostForYear);
        }

        const cashFlows = [-initialInvestment, ...annualSavings];

        // Only calculate IRR if there are positive savings to make a return possible.
        if (annualSavings.some(s => s > 0)) {
            const irr = calculateIRR(cashFlows);
            finalResults[p].irr = irr !== null ? irr * 100 : null; // Store as a percentage.
        } else {
            finalResults[p].irr = null; // Not possible to calculate IRR.
        }
    });

    return { financials: finalResults, rawData: rawData, config: config };
}

/**
 * Provides a simple, heuristic-based sizing recommendation based on annual energy needs.
 * @param {number} coverageTarget - The desired percentage of annual consumption to be met by solar.
 * @param {object} simulationData - Seasonal average consumption data.
 * @returns {object} An object with recommended solar, battery, and inverter sizes.
 */
export function calculateSizingRecommendations(coverageTarget, simulationData) {
    if (!simulationData || Object.keys(simulationData).length === 0) {
        return { solar: 0, battery: 0, inverter: 0, coverageTarget: coverageTarget };
    }
    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };
    let totalKWh = 0, totalEveningKWh = 0, totalDays = 0;
    
    // Calculate total annual consumption and "evening" consumption from seasonal averages.
    for (const quarter in simulationData) {
        if(simulationData[quarter]){
            const q = simulationData[quarter];
            const daysInQ = daysPerQuarter[quarter];
            if (daysInQ) {
                totalKWh += (q.avgPeak + q.avgShoulder + q.avgOffPeak) * daysInQ;
                // Heuristic: "Evening" is all peak usage plus half of off-peak (overnight) usage.
                totalEveningKWh += (q.avgPeak + (q.avgOffPeak * 0.5)) * daysInQ;
                totalDays += daysInQ;
            }
        }
    }
    
    // Determine the average daily solar generation per kW of panels.
    // Use data from existing system if available, otherwise use a default.
    let avgDailyGenerationPerKW = 4.0; 
    const existingKW = getNumericInput('existingSolarKW');
    if (state.solarData && state.solarData.length > 0 && existingKW > 0) {
        const totalGeneration = state.solarData.reduce((acc, day) => acc + day.hourly.reduce((a, b) => a + b, 0), 0);
        const avgDailyGeneration = totalGeneration / state.solarData.length;
        avgDailyGenerationPerKW = avgDailyGeneration / existingKW;
    }
    
    const avgDailyConsumption = totalDays > 0 ? totalKWh / totalDays : 0;
    const totalAnnualKWh = avgDailyConsumption * 365;
    const avgDailyEveningConsumption = totalDays > 0 ? totalEveningKWh / totalDays : 0;
    
    // Calculate required solar size to meet the coverage target.
    const targetAnnualGeneration = totalAnnualKWh * (coverageTarget / 100);
    let recommendedSolarKW = (avgDailyGenerationPerKW > 0) ? targetAnnualGeneration / (avgDailyGenerationPerKW * 365) : 0;
    recommendedSolarKW = Math.round(recommendedSolarKW * 2) / 2; // Round to nearest 0.5 kW.
    
    // Recommend battery size based on average evening consumption, fitting to common sizes.
    const scalingFactor = coverageTarget / 90; // Scale recommendation based on user aggressiveness.
    const targetEveningConsumption = avgDailyEveningConsumption * scalingFactor;
    let recommendedBatteryKWh;
    if (targetEveningConsumption <= 5) recommendedBatteryKWh = 5;
    else if (targetEveningConsumption <= 10) recommendedBatteryKWh = 10;
    else if (targetEveningConsumption <= 13.5) recommendedBatteryKWh = 13.5;
    else recommendedBatteryKWh = Math.round(targetEveningConsumption);
    
    // Recommend inverter size based on solar panel size.
    let recommendedInverterKW;
    if (recommendedSolarKW <= 6.6) recommendedInverterKW = 5;
    else if (recommendedSolarKW <= 10) recommendedInverterKW = 8;
    else recommendedInverterKW = 10;
    
    return { solar: recommendedSolarKW, battery: recommendedBatteryKWh, inverter: recommendedInverterKW, coverageTarget: coverageTarget };
}

/**
 * Provides a detailed, data-driven sizing recommendation based on percentile analysis of CSV data.
 * @param {Array} correctedElectricityData - The true household consumption data.
 * @param {Array} solarData - The parsed solar generation data.
 * @param {object} config - The main analysis configuration.
 * @param {object} simulationData - Seasonal average data for the heuristic fallback.
 * @returns {object|null} A detailed sizing result object, or null if data is insufficient.
 */
export function calculateDetailedSizing(correctedElectricityData, solarData, config, simulationData) {
    if (!correctedElectricityData) return null;

    // Determine the peak hours from the baseline provider's tariff.
    const baselineProvider = config.providers.find(p => p.id === config.selectedProviders[0]);
    let peakHours = [];
    if (baselineProvider) {
        const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
        peakHours = parseRangesToHours(peakRule?.hours || '');
    }

    const totalSolarKW = config.replaceExistingSystem ? config.newSolarKW : config.existingSolarKW + config.newSolarKW;
    const solarProfileSourceKw = config.existingSolarKW > 0 ? config.existingSolarKW : 1;
    const solarDataMap = config.noExistingSolar ? new Map() : new Map((solarData || []).map(day => [day.date, day.hourly]));
    
    // These arrays will store the key metrics for each day of the year.
    const dailyPeakPeriodData = []; // Total kWh needed from battery during peak hours.
    const dailyMaxHourData = [];    // Max kWh needed from battery in a single hour.
    let totalDays = 0;

    // Analyze each day in the dataset.
    correctedElectricityData.forEach(day => {
        totalDays++;
        let dailyPeakPeriodKWh = 0;
        let dailyMaxHourKWh = 0;
        
        // Generate the total hourly solar profile for the proposed system.
        let hourlySolar;
        if (config.noExistingSolar) {
            const totalDailySolar = totalSolarKW * config.manualSolarProfile;
            const season = getSeason(day.date);
            hourlySolar = generateHourlySolarProfileFromDaily(totalDailySolar, season);
        } else {
            const hourlySolarRaw = solarDataMap.get(day.date) || Array(24).fill(0);
            hourlySolar = hourlySolarRaw.map(h => (h / solarProfileSourceKw) * totalSolarKW);
        }

        // For each hour, calculate consumption not met by solar.
        for (let h = 0; h < 24; h++) {
            const consumption = day.consumption[h] || 0;
            const solar = hourlySolar[h] || 0;
            const selfConsumption = Math.min(consumption, solar);
            const remainingConsumption = consumption - selfConsumption;
            dailyMaxHourKWh = Math.max(dailyMaxHourKWh, remainingConsumption);
            
            if (peakHours.includes(h)) {
                dailyPeakPeriodKWh += consumption;
            }
        }
        dailyPeakPeriodData.push(dailyPeakPeriodKWh);
        dailyMaxHourData.push(dailyMaxHourKWh);
    });

    if (totalDays === 0) return null;

    // Helper to find the value at a specific percentile in a dataset.
    const getPercentile = (data, percentile) => {
        const sortedData = [...data].sort((a, b) => a - b);
        const index = Math.ceil(percentile * sortedData.length) - 1;
        return sortedData[Math.max(0, index)];
    };

    // Recommend sizes based on the 90th percentile day (a "high usage" day).
    // This aims to cover needs on most days without oversizing for extreme outliers.
    const recommendedBatteryKWh = getPercentile(dailyPeakPeriodData, 0.90);
    const recommendedInverterKW = getPercentile(dailyMaxHourData, 0.90);
    
    // Round recommendations to practical sizes.
    const finalBatteryRec = Math.ceil(recommendedBatteryKWh);
    const finalInverterRec = (Math.ceil(recommendedInverterKW * 2) / 2); // Round to nearest 0.5 kW.
    
    // Calculate how many days the recommended system would have fully covered.
    const batteryCoverageDays = dailyPeakPeriodData.filter(d => d <= finalBatteryRec).length;
    const inverterCoverageDays = dailyMaxHourData.filter(d => d <= finalInverterRec).length;
    
    // Get the heuristic recommendation as a comparison.
    const heuristicRecs = calculateSizingRecommendations(config.recommendationCoverageTarget, simulationData);

    // --- Blackout Sizing Calculation ---
    let blackoutResults = null;
    if (config.blackoutSizingEnabled && config.blackoutDuration > 0 && config.blackoutCoverage > 0) {
        // Find the highest consumption period of the specified duration in the entire dataset.
        const allHours = correctedElectricityData.flatMap(d => d.consumption);
        let maxConsumptionInWindow = 0;
        for (let i = 0; i <= allHours.length - config.blackoutDuration; i++) {
            const windowSum = allHours.slice(i, i + config.blackoutDuration).reduce((a, b) => a + b, 0);
            if (windowSum > maxConsumptionInWindow) maxConsumptionInWindow = windowSum;
        }
        // Calculate the required battery reserve to cover this period.
        const requiredReserve = maxConsumptionInWindow * config.blackoutCoverage;
        // The total battery size needed is the daily use size plus the blackout reserve.
        const totalCalculatedSize = finalBatteryRec + requiredReserve;
        // Find the next largest standard battery size.
        const standardSizes = [5, 10, 13.5, 16, 20, 24, 32, 40, 48];
        const practicalSize = standardSizes.find(size => size >= totalCalculatedSize) || Math.ceil(totalCalculatedSize);
        blackoutResults = { requiredReserve, totalCalculatedSize, practicalSize };
    }

    return {
        heuristic: heuristicRecs,
        detailed: {
            recommendedBatteryKWh: finalBatteryRec,
            recommendedInverterKW: finalInverterRec,
            batteryCoverageDays: batteryCoverageDays,
            inverterCoverageDays: inverterCoverageDays,
            totalDays: totalDays,
        },
        distributions: { // Data for drawing the histogram charts.
            peakPeriod: dailyPeakPeriodData,
            maxHourly: dailyMaxHourData,
        },
        blackout: blackoutResults
    };
}