// js/analysis.js
// Version 1.2.9
// This is the core of the ROI calculator. It contains the simulation engine,
// financial calculation functions (IRR, NPV), and system sizing algorithms.

/*
 * Home Battery & Solar ROI Analyser
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
import { generateHourlyConsumptionProfileFromDailyTOU, generateHourlySolarProfileFromDaily, generateEVChargingProfile  } from './profiles.js';
import { SEASONS, SPECIAL_CONDITIONS, DEFAULT_TOU_HOURS, TARIFF_RULE_TYPES } from './constants.js';


/**
 * Generates a typical hourly profile for a controlled load like a hot water system.
 * This is used for the manual input mode.
 * @param {number} dailyTotal - The total kWh used by the controlled load per day.
 * @returns {number[]} An array of 24 hourly load values.
 */
function generateHourlyControlledLoadProfile(dailyTotal) {
    if (dailyTotal <= 0) return Array(24).fill(0);
    // Assumes a 7-hour heating window from 11pm to 6am.
    const heatingHours = 7;
    const hourlyLoad = dailyTotal / heatingHours;
    const profile = Array(24).fill(0);
    for (let i = 0; i < 6; i++) profile[i] = hourlyLoad; // Midnight to 6am
    for (let i = 23; i < 24; i++) profile[i] = hourlyLoad; // 11pm to Midnight
    return profile;
}

/**
 * Finds the appropriate rate for the controlled load based on a fallback system.
 * 1. Looks for a 'controlled_load' type rule.
 * 2. If not found, looks for a rule with 'off-peak' in the name.
 * 3. If not found, looks for a 'flat' type rule.
 * 4. If still not found, returns 0.
 * @param {object} provider - The provider's tariff configuration.
 * @returns {{rate: number, fallbackUsed: string|null}} An object with the rate and the fallback method used.
 */
function getControlledLoadRate(provider) {
    if (!provider.importRules) {
        return { rate: 0, fallbackUsed: 'Zero' };
    }

    // 1. Ideal case: Find a specific 'controlled_load' rule.
    const controlledLoadRule = provider.importRules.find(r => r.type === TARIFF_RULE_TYPES.CONTROLLED_LOAD);
    if (controlledLoadRule) {
        return { rate: controlledLoadRule.rate, fallbackUsed: null };
    }

    // 2. Fallback: Find an 'off-peak' rule.
    const offPeakRule = provider.importRules.find(r => r.name.toLowerCase().includes('off-peak'));
    if (offPeakRule) {
        return { rate: offPeakRule.rate, fallbackUsed: 'Off-Peak' };
    }

    // 3. Fallback: Find a 'flat' rate rule.
    const flatRule = provider.importRules.find(r => r.type === TARIFF_RULE_TYPES.FLAT);
    if (flatRule) {
        return { rate: flatRule.rate, fallbackUsed: 'Flat' };
    }

    // 4. Last resort: Fallback to zero.
    return { rate: 0, fallbackUsed: 'Zero' };
}

/**
 * Calculates the degraded capacity/size of all system components for a given year.
 * @param {object} config - The main analysis configuration.
 * @param {number} year - The current year of the analysis.
 * @returns {object} An object containing the degraded values for battery and solar.
 */
function calculateDegradedComponents(config, year) {
    const existingSystemCurrentAge = config.existingSystemAge + year - 1;
    const newSystemCurrentAge = year - 1;

    const degradedExistingBattery = (config.replaceExistingSystem ? 0 : config.existingBattery) * Math.pow(1 - config.batteryDegradation, existingSystemCurrentAge);
    const degradedNewBattery = config.newBatteryKWH * Math.pow(1 - config.batteryDegradation, newSystemCurrentAge);
    const totalDegradedBatteryCapacity = degradedExistingBattery + degradedNewBattery;

    const degradedExistingSolarDaily = (config.replaceExistingSystem ? 0 : config.existingSolarKW * config.manualSolarProfile) * Math.pow(1 - config.solarDegradation, existingSystemCurrentAge);
    const degradedNewSolarDaily = config.newSolarKW * config.manualSolarProfile * Math.pow(1 - config.solarDegradation, newSystemCurrentAge);
    const totalDegradedSolarDaily = degradedExistingSolarDaily + degradedNewSolarDaily;

    return {
        batteryCapacity: totalDegradedBatteryCapacity,
        manualModeSolarGeneration: totalDegradedSolarDaily, // Used only in manual mode
    };
}

/**
 * Reconstructs the true hourly household consumption by adding self-consumed solar back to the grid import data.
 * @param {object} day - The electricity data object for a single day, containing grid consumption and feed-in.
 * @param {number[]} historicalSolar - The hourly solar generation from the original system for that day.
 * @returns {number[]} An array of 24 hourly values representing true household consumption.
 */
function reconstructTrueConsumption(day, historicalSolar) {
    const trueHourlyConsumption = Array(24).fill(0);
    for (let h = 0; h < 24; h++) {
        const selfConsumed = Math.max(0, (historicalSolar[h] || 0) - (day.feedIn[h] || 0));
        trueHourlyConsumption[h] = (day.consumption[h] || 0) + selfConsumed;
    }
    return trueHourlyConsumption;
}

/**
 * Generates the total hourly solar profile for the proposed new/upgraded system for a given day.
 * It accounts for degradation of both old and new panels and applies inverter clipping.
 * @param {object} config - The main analysis configuration.
 * @param {object} day - The electricity data object for the day (used to get the date/season).
 * @param {number} year - The current analysis year.
 * @param {Map} solarDataMap - A Map containing the historical solar data.
 * @returns {number[]} An array of 24 hourly values for the total solar generation of the new system.
 */
function generateTotalSolarProfile(config, day, year, solarDataMap) {
    const existingHourlySolar_historical = solarDataMap.get(day.date);
    if (!existingHourlySolar_historical) return Array(24).fill(0);

    const newSystemCurrentAge = year - 1;

    // Degrade the historical generation from the existing panels
    let degradedExistingSolar = existingHourlySolar_historical.map(s => s * Math.pow(1 - config.solarDegradation, year - 1));
    if (config.existingSolarInverterKW > 0) {
        degradedExistingSolar = degradedExistingSolar.map(hourlyGeneration =>
            Math.min(hourlyGeneration, config.existingSolarInverterKW)
        );
    }

    // Generate and degrade the profile for the new panels
    const newSolarGenerationDaily = config.newSolarKW * config.manualSolarProfile;
    const degradedNewSolarDaily = newSolarGenerationDaily * Math.pow(1 - config.solarDegradation, newSystemCurrentAge);
    const newHourlySolar = generateHourlySolarProfileFromDaily(degradedNewSolarDaily, getSeason(day.date));

    const existingSolarForSim = config.replaceExistingSystem ? Array(24).fill(0) : degradedExistingSolar;
    let totalHourlySolar = existingSolarForSim.map((s, i) => s + newHourlySolar[i]);

    // Determine total inverter power for clipping
    let totalInverterPower;
    if (config.replaceExistingSystem) {
        totalInverterPower = config.newBatteryInverterKW;
    } else if (config.isAcCoupled) {
        totalInverterPower = config.newBatteryInverterKW + config.existingSolarInverterKW;
    } else {
        totalInverterPower = config.newBatteryInverterKW; // Use the corrected logic from the bug fix
    }

    // Clip the final combined generation to the total inverter limit
    totalHourlySolar = totalHourlySolar.map(hourlyGeneration => Math.min(hourlyGeneration, totalInverterPower));

    return totalHourlySolar;
}

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
    const daysPerQuarter = { 
        [SEASONS.SUMMER]: 90, 
        [SEASONS.AUTUMN]: 91, 
        [SEASONS.WINTER]: 92, 
        [SEASONS.SPRING]: 92 
    };

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
        // *** FIX: Add a defensive check to ensure the rule object has the necessary nested properties. ***
        // If a rule is malformed, skip it and continue to the next one.
        if (!condition.condition || !condition.action) {
            console.warn("Skipping malformed special condition:", condition);
            continue;
        }

        // If the rule has a 'months' property, check if it applies today.
        if (condition.months && condition.months.length > 0 && !condition.months.includes(month)) {
            continue; // Skip if rule is not for the current month.
        }
        
        // Get the value of the metric to be tested.
        let metricValue;
        switch (condition.condition.metric) {
            case SPECIAL_CONDITIONS.METRIC.PEAK_IMPORT:
                metricValue = dailyBreakdown.peakKWh;
                break;
            case SPECIAL_CONDITIONS.METRIC.NET_GRID_USAGE:
                const totalImport = dailyBreakdown.peakKWh + dailyBreakdown.shoulderKWh + dailyBreakdown.offPeakKWh;
                const totalExport = dailyBreakdown.tier1ExportKWh + dailyBreakdown.tier2ExportKWh;
                metricValue = totalImport - totalExport;
                break;
            case SPECIAL_CONDITIONS.METRIC.IMPORT_IN_WINDOW:
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
            case SPECIAL_CONDITIONS.OPERATOR.LESS_THAN: conditionMet = metricValue < condition.condition.value; break;
            case SPECIAL_CONDITIONS.OPERATOR.LESS_THAN_OR_EQUAL: conditionMet = metricValue <= condition.condition.value; break;
            case SPECIAL_CONDITIONS.OPERATOR.GREATER_THAN: conditionMet = metricValue > condition.condition.value; break;
            case SPECIAL_CONDITIONS.OPERATOR.GREATER_THAN_OR_EQUAL: conditionMet = metricValue >= condition.condition.value; break;
        }

        // If the condition is met, apply the specified action (credit or charge).
        if (conditionMet) {
            switch (condition.action.type) {
                case SPECIAL_CONDITIONS.ACTION.FLAT_CREDIT: adjustedCost -= condition.action.value; break;
                case SPECIAL_CONDITIONS.ACTION.FLAT_CHARGE: adjustedCost += condition.action.value; break;
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
 * Simulates energy flows for a single 24-hour period, now including a priority-based EV charging scheduler
 * and corrected inverter capacity sharing between solar and grid charging.
 * @param {number[]} hourlyConsumption - Array of 24 household consumption values (kWh).
 * @param {number[]} hourlySolar - Array of 24 solar generation values (kWh).
 * @param {object} provider - The provider tariff configuration.
 * @param {object|null} batteryConfig - The battery configuration. If null, a no-battery baseline is simulated.
 * @param {number} initialSOC - The initial state of charge of the battery in kWh.
 * @param {number} evChargeNeededKWh - The total energy the EV needs for the day.
 * @param {object} config - The main application configuration.
 * @returns {object} An object containing the daily breakdown of energy flows and the final battery SOC.
 */
export function simulateDay(hourlyConsumption, hourlySolar, provider, batteryConfig, initialSOC = 0, evChargeNeededKWh = 0, config = {}) {
    const results = {
        peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0,
        tier1ExportKWh: 0, tier2ExportKWh: 0,
        gridChargeKWh: 0, solarChargeKWh: 0, evChargedKWh: 0,
        hourlyImports: Array(24).fill(0), hourlyExports: Array(24).fill(0)
    };
    let currentSOC = initialSOC;
    let gridChargeCost = 0;
    let socAt6am = 0;

    if (!batteryConfig) {
        // --- PATH 1: NO BATTERY (BASELINE SIMULATION) ---
        for (let h = 0; h < 24; h++) {
            const consumption = hourlyConsumption[h] || 0;
            const solar = hourlySolar[h] || 0;
            const net = consumption - solar;
            if (net > 0) {
                results.hourlyImports[h] = net;
            } else {
                results.hourlyExports[h] = -net;
            }
        }
    } else {
        // --- PATH 2: WITH BATTERY (FULL SYSTEM SIMULATION) ---
        let remainingEVChargeKWh = evChargeNeededKWh;

        for (let h = 0; h < 24; h++) {
            if (h === 6) socAt6am = currentSOC;
            const consumption = hourlyConsumption[h] || 0;
            let solar = hourlySolar[h] || 0;
            const inverterLimit = batteryConfig.inverterKW;

            // --- PART A: HANDLE HOUSEHOLD LOAD ---
            const solarToConsumption = Math.min(consumption, solar);
            let remainingConsumption = consumption - solarToConsumption;
            let excessSolar = solar - solarToConsumption;
            
            let solarToBattery = 0;
            if (excessSolar > 0 && currentSOC < batteryConfig.capacity) {
                solarToBattery = Math.min(excessSolar, batteryConfig.capacity - currentSOC, inverterLimit);
                currentSOC += solarToBattery;
                excessSolar -= solarToBattery;
            }
            results.solarChargeKWh += solarToBattery;

            const inverterHeadroomForBattery = inverterLimit - solarToConsumption;
            const batteryDischargeLimit = Math.max(0, inverterHeadroomForBattery);
            const batteryToConsumption = Math.min(remainingConsumption, currentSOC, batteryDischargeLimit);
            
            currentSOC -= batteryToConsumption;
            remainingConsumption -= batteryToConsumption;
            results.hourlyImports[h] = remainingConsumption;
            
            // --- PART B: HANDLE EV CHARGING ---
            if (remainingEVChargeKWh > 0 && provider.evRules) {
                for (const rule of provider.evRules) {
                    const ruleHours = parseRangesToHours(rule.hours || '');
                    if (ruleHours.includes(h)) {
                        let chargeAmount = 0;
                        const powerFromInverter = solarToConsumption + batteryToConsumption;
                        const availableInverterPower = Math.max(0, inverterLimit - powerFromInverter);

                        switch (rule.source) {
                            case 'excess_solar':
                                chargeAmount = Math.min(remainingEVChargeKWh, excessSolar, availableInverterPower);
                                if (chargeAmount > 0) { excessSolar -= chargeAmount; }
                                break;
                            case 'grid':
                                chargeAmount = Math.min(remainingEVChargeKWh, availableInverterPower);
                                if (chargeAmount > 0) { results.hourlyImports[h] += chargeAmount; }
                                break;
                            case 'battery':
                                const minSocThreshold = batteryConfig.capacity * (config.minSOCForEV / 100);
                                if (currentSOC > minSocThreshold) {
                                    const availableBatteryDischarge = currentSOC - minSocThreshold;
                                    chargeAmount = Math.min(remainingEVChargeKWh, availableBatteryDischarge, availableInverterPower);
                                    if (chargeAmount > 0) { currentSOC -= chargeAmount; }
                                }
                                break;
                        }

                        if (chargeAmount > 0) {
                            remainingEVChargeKWh -= chargeAmount;
                            results.evChargedKWh += chargeAmount;
                            break; 
                        }
                    }
                }
            }

            // --- PART C: HANDLE FINAL GRID INTERACTIONS ---
            const inverterHeadroomForExport = inverterLimit - solarToConsumption;
            const maxSolarExport = Math.max(0, inverterHeadroomForExport);
            results.hourlyExports[h] = Math.min(excessSolar, maxSolarExport);
            
            // Grid Charging Logic for the BATTERY
            if (provider.gridChargeEnabled && h >= provider.gridChargeStart && h < provider.gridChargeEnd) {
                const chargeThresholdSOC = batteryConfig.capacity * (batteryConfig.gridChargeThreshold / 100);
                const chargeTriggerSOC = batteryConfig.capacity * (batteryConfig.socChargeTrigger / 100);
                if (currentSOC < chargeTriggerSOC) {
                    const chargeNeeded = chargeThresholdSOC - currentSOC;
                    if (chargeNeeded > 0) {
                        // --- THE FIX IS HERE ---
                        // 1. Calculate how much inverter capacity is left after solar has charged the battery.
                        const inverterHeadroomForGridCharge = Math.max(0, inverterLimit - solarToBattery);
                        
                        // 2. Use this remaining headroom to cap the grid charge amount.
                        const gridChargeAmount = Math.min(chargeNeeded, inverterHeadroomForGridCharge, batteryConfig.capacity - currentSOC);
                        
                        if (gridChargeAmount > 0) {
                            results.gridChargeKWh += gridChargeAmount;
                            currentSOC += gridChargeAmount;
                            results.hourlyImports[h] += gridChargeAmount;
                            const touRule = (provider.importRules || []).find(r => r.type === 'tou' && parseRangesToHours(r.hours).includes(h));
                            const flatRule = (provider.importRules || []).find(r => r.type === 'flat');
                            const rateForHour = (touRule || flatRule)?.rate || 0;
                            gridChargeCost += gridChargeAmount * rateForHour;
                        }
                    }
                }
            }
        } // End of main 'for' loop for battery simulation
    } // End of main if/else block

    // 3. Categorize TOU and Tiered usage (this part is common to both paths)
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
 * Calculates the total annualized electricity cost for a single year with the new system.
 * This version is corrected to handle a "full replacement" scenario in CSV mode
 * even when no historical solar CSV is provided.
 */
function calculateSystemYear(providerData, config, year, simulationData, electricityData, rawData, finalResults) {
    // 1. Initialize calculators and other variables
    const importCalculator = tariffComponents.IMPORT_RULES.calculate;
    const exportCalculator = tariffComponents.EXPORT_RULES.calculate;
    const fitConfig = {
        degradationStartYear: config.fitDegradationStartYear,
        degradationEndYear: config.fitDegradationEndYear,
        minimumRate: config.fitMinimumRate,
    };
    const baselineProvider = config.providers[0];
    let annualCost = 0;

    // 2. Calculate degraded component performance
    const degradedComponents = calculateDegradedComponents(config, year);
    
    // 3. Check for controlled load and get its rate
    const hasControlledLoadInData = config.useManual 
        ? Object.values(simulationData).some(q => q.avgControlledLoad > 0) 
        : electricityData.some(d => d.controlledLoad && d.controlledLoad.reduce((a, b) => a + b, 0) > 0);
    const controlledLoadRateInfo = getControlledLoadRate(providerData);

    // 4. Handle Manual Mode simulation
    if (config.useManual) {
        let totalCostForPeriod = 0;
        const daysInQuarter = 365 / 4;

        for (const q in simulationData) {
            const quarter = simulationData[q];
            const season = q.split('_')[1];

            const hourlyControlledLoad = generateHourlyControlledLoadProfile(quarter.avgControlledLoad);
            const batteryConfig = {
                capacity: degradedComponents.batteryCapacity,
                inverterKW: config.replaceExistingSystem ? config.newBatteryInverterKW : (config.isAcCoupled ? config.newBatteryInverterKW + config.existingSolarInverterKW : config.newBatteryInverterKW),
                gridChargeThreshold: config.gridChargeThreshold,
                socChargeTrigger: config.socChargeTrigger
            };
            let currentSOC = batteryConfig.capacity * 0.5;

            let trueHourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(quarter.avgPeak, quarter.avgShoulder, quarter.avgOffPeak, baselineProvider.importRules);
            
            let totalHourlySolar = generateHourlySolarProfileFromDaily(degradedComponents.manualModeSolarGeneration, q);
            totalHourlySolar = totalHourlySolar.map(hourlyGeneration => Math.min(hourlyGeneration, batteryConfig.inverterKW));

            let dailyControlledLoadCost = 0;

            if (config.moveControlledLoad) {
                for (let h = 0; h < 24; h++) {
                    trueHourlyConsumption[h] += hourlyControlledLoad[h];
                }
            } else {
                dailyControlledLoadCost = quarter.avgControlledLoad * escalate(controlledLoadRateInfo.rate, config.tariffEscalation, year);
            }

            let dailyEVChargeKWh = 0;
            if (config.evChargingEnabled && providerData.evRules && providerData.evRules.length > 0) {
                dailyEVChargeKWh = (config.evDailyKM / 100) * config.evEfficiency;
            }
            const simResults = simulateDay(trueHourlyConsumption, totalHourlySolar, providerData, batteryConfig, currentSOC, dailyEVChargeKWh, config);
            const dailyBreakdown = simResults.dailyBreakdown;

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
                    rawSeason.solarChargeKWh += dailyBreakdown.solarChargeKWh * daysInQuarter;
                    rawSeason.gridChargeCost += simResults.gridChargeCost * daysInQuarter;
                    rawSeason.evLoadKWh += dailyBreakdown.evChargedKWh * daysInQuarter;
                    if (!config.moveControlledLoad) {
                        rawSeason.controlledLoadKWh += quarter.avgControlledLoad * daysInQuarter;
                    }
                }
            }

            let dailyEnergyCost = simResults.gridChargeCost || 0;
            dailyEnergyCost += importCalculator(providerData.importRules, dailyBreakdown, { rate: config.tariffEscalation, year: year });
            dailyEnergyCost -= exportCalculator(providerData.exportRules, dailyBreakdown, year, fitConfig, getDegradedFitRate);
            
            let totalDailyAdjustment = (providerData.dailyCharge || 0) + dailyEnergyCost;
            totalCostForPeriod += (totalDailyAdjustment + dailyControlledLoadCost) * daysInQuarter;
        }
        annualCost = totalCostForPeriod;

    // 5. Handle CSV Mode simulation
    } else {
        let totalCostForPeriod = 0;
        let daysProcessed = 0;
        const solarDataMap = new Map(state.solarData.map(d => [d.date, d.hourly]));
        let currentSOC = degradedComponents.batteryCapacity * 0.5;

        electricityData.forEach(day => {
            // *** THE FIX IS HERE: 'trueHourlyConsumption' is declared only ONCE. ***
            let trueHourlyConsumption;
            const existingHourlySolar_historical = solarDataMap.get(day.date);

            // Determine how to calculate the true consumption based on the scenario.
            if (!config.replaceExistingSystem && existingHourlySolar_historical) {
                // If we're adding to an existing system, we MUST have historical solar data to reconstruct the true load.
                trueHourlyConsumption = reconstructTrueConsumption(day, existingHourlySolar_historical);
            } else if (config.replaceExistingSystem) {
                // If it's a full replacement, we assume the grid import WAS the total consumption,
                // as there was no old solar system to self-consume from. This allows the simulation to run
                // even if the user didn't provide a (now irrelevant) historical solar file.
                trueHourlyConsumption = day.consumption;
            } else {
                // Failsafe: if we are in an 'addition' scenario but have no historical solar data, we cannot proceed for this day.
                return; 
            }
            
            daysProcessed++;

            const batteryConfig = {
                capacity: degradedComponents.batteryCapacity,
                inverterKW: config.replaceExistingSystem ? config.newBatteryInverterKW : (config.isAcCoupled ? config.newBatteryInverterKW + config.existingSolarInverterKW : config.newBatteryInverterKW),
                gridChargeThreshold: config.gridChargeThreshold,
                socChargeTrigger: config.socChargeTrigger
            };
            
            const totalHourlySolar = generateTotalSolarProfile(config, day, year, solarDataMap);
            let dailyControlledLoadCost = 0;
            const dailyControlledLoadKWh = (day.controlledLoad || []).reduce((a, b) => a + b, 0);

            if (config.moveControlledLoad) {
                for (let h = 0; h < 24; h++) {
                    trueHourlyConsumption[h] += day.controlledLoad[h] || 0;
                }
            } else {
                dailyControlledLoadCost = dailyControlledLoadKWh * escalate(controlledLoadRateInfo.rate, config.tariffEscalation, year);
            }
            
            let dailyEVChargeKWh = 0;
            if (config.evChargingEnabled && providerData.evRules && providerData.evRules.length > 0) {
                dailyEVChargeKWh = (config.evDailyKM / 100) * config.evEfficiency;
            }
            const simResults = simulateDay(trueHourlyConsumption, totalHourlySolar, providerData, batteryConfig, currentSOC, dailyEVChargeKWh, config);
            currentSOC = simResults.finalSOC;
            const dailyBreakdown = simResults.dailyBreakdown;

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
                    rawSeason.solarChargeKWh += dailyBreakdown.solarChargeKWh;
                    rawSeason.gridChargeCost += simResults.gridChargeCost;
                    rawSeason.evLoadKWh += dailyBreakdown.evChargedKWh;
                    if (!config.moveControlledLoad) {
                       rawSeason.controlledLoadKWh += dailyControlledLoadKWh;
                    }
                }
            }

            let dailyEnergyCost = simResults.gridChargeCost || 0;
            dailyEnergyCost += importCalculator(providerData.importRules, dailyBreakdown, { rate: config.tariffEscalation, year: year });
            dailyEnergyCost -= exportCalculator(providerData.exportRules, dailyBreakdown, year, fitConfig, getDegradedFitRate);
            
            let totalDailyAdjustment = (providerData.dailyCharge || 0) + dailyEnergyCost;
            totalDailyAdjustment = applySpecialConditions(totalDailyAdjustment, dailyBreakdown, providerData.specialConditions, day.date);
            totalDailyAdjustment += dailyControlledLoadCost;
            totalCostForPeriod += totalDailyAdjustment;
        });

        const annualizationFactor = daysProcessed > 0 ? 365 / daysProcessed : 0;
        annualCost = totalCostForPeriod * annualizationFactor;
    }

    // 6. Add a warning if a fallback rate was used
    if (hasControlledLoadInData && !config.moveControlledLoad && controlledLoadRateInfo.fallbackUsed) {
        finalResults.warnings.push(`For Provider '${providerData.name}': No 'Controlled Load' tariff was found. The analysis used the '${controlledLoadRateInfo.fallbackUsed}' rate as a substitute.`);
    }

    return annualCost;
}
/**
 * Calculates the total annualized electricity cost for the baseline scenario.
 * The baseline represents the user's current situation, including any existing solar or battery systems.
 * This function handles both manual and CSV data modes and correctly simulates an existing battery if one is defined.
 * @param {object} config - The main analysis configuration object.
 * @param {object} simulationData - Seasonal average data (used only in manual mode).
 * @param {Array} electricityData - Parsed usage data from the CSV file.
 * @param {object} rawData - Object used to store raw simulation outputs for the debug tables.
 * @param {object} finalResults - The main results object, used here to store warnings.
 * @returns {number} The total estimated annual cost for the baseline scenario.
 */
function calculateBaseline(config, simulationData, electricityData, rawData, finalResults) {
    // 1. Initialize calculators, provider configuration, and cost variable
    const baselineProvider = config.providers[0]; // The baseline always uses the first provider in the list.
    const importCalculator = tariffComponents.IMPORT_RULES.calculate;
    const exportCalculator = tariffComponents.EXPORT_RULES.calculate;
    const fitConfig = {
        degradationStartYear: config.fitDegradationStartYear,
        degradationEndYear: config.fitDegradationEndYear,
        minimumRate: config.fitMinimumRate,
    };
    let annualizedBaseCost = 0;
    // Declare here so it's available to the entire function's scope.
    let controlledLoadRateInfo;

    // 2. Configure the EXISTING battery if one is present
    let existingBatteryConfig = null;
    if (config.existingBattery > 0) {
        const degradedExistingBattery = config.existingBattery * Math.pow(1 - config.batteryDegradation, config.existingSystemAge);
        existingBatteryConfig = {
            capacity: degradedExistingBattery,
            inverterKW: config.isHybridInverter ? config.existingSolarInverterKW : config.existingBatteryInverter,
            gridChargeThreshold: config.gridChargeThreshold,
            socChargeTrigger: config.socChargeTrigger
        };
    }

    // 3. Check if any controlled load data exists to determine if warnings are needed later
    const hasControlledLoadInData = config.useManual
        ? Object.values(simulationData).some(q => q.avgControlledLoad > 0)
        : electricityData.some(d => d.controlledLoad && d.controlledLoad.reduce((a, b) => a + b, 0) > 0);

    // 4. Handle Manual Mode simulation
    if (config.useManual) {
        let totalCostForPeriod = 0;
        const daysInQuarter = 365 / 4;
        controlledLoadRateInfo = getControlledLoadRate(baselineProvider); // Assign value

        for (const q in simulationData) {
            const quarter = simulationData[q];
            const season = q.split('_')[1];

            const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(quarter.avgPeak, quarter.avgShoulder, quarter.avgOffPeak, baselineProvider.importRules);
            const degradedExistingSolar = (config.existingSolarKW * config.manualSolarProfile) * Math.pow(1 - config.solarDegradation, config.existingSystemAge);
            const hourlySolar = generateHourlySolarProfileFromDaily(degradedExistingSolar, q);

            const simResults = simulateDay(hourlyConsumption, hourlySolar, baselineProvider, existingBatteryConfig, 0);
            const dailyBreakdown = simResults.dailyBreakdown;

            if (rawData.baseline.year1[season]) {
                const rawSeason = rawData.baseline.year1[season];
                rawSeason.days += daysInQuarter;
                rawSeason.peakKWh += dailyBreakdown.peakKWh * daysInQuarter;
                rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh * daysInQuarter;
                rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh * daysInQuarter;
                rawSeason.tier1ExportKWh += dailyBreakdown.tier1ExportKWh * daysInQuarter;
                rawSeason.tier2ExportKWh += dailyBreakdown.tier2ExportKWh * daysInQuarter;
                rawSeason.controlledLoadKWh += quarter.avgControlledLoad * daysInQuarter;
                rawSeason.solarChargeKWh += dailyBreakdown.solarChargeKWh * daysInQuarter;
                rawSeason.gridChargeKWh += dailyBreakdown.gridChargeKWh * daysInQuarter;
            }

            let dailyEnergyCost = importCalculator(baselineProvider.importRules, dailyBreakdown, { rate: 0, year: 1 });
            dailyEnergyCost -= exportCalculator(baselineProvider.exportRules, dailyBreakdown, 1, fitConfig, getDegradedFitRate);

            const dailyControlledLoadCost = quarter.avgControlledLoad * escalate(controlledLoadRateInfo.rate, config.tariffEscalation, 1);
            let totalDailyAdjustment = (baselineProvider.dailyCharge || 0) + dailyEnergyCost + dailyControlledLoadCost;
            totalCostForPeriod += totalDailyAdjustment * daysInQuarter;
        }
        annualizedBaseCost = totalCostForPeriod;

    // 5. Handle CSV Mode simulation
    } else if (electricityData) {
        let totalCostForPeriod = 0;
        let daysProcessed = 0;
        controlledLoadRateInfo = getControlledLoadRate(baselineProvider); // Assign value
        const solarDataMap = new Map(state.solarData.map(d => [d.date, d.hourly]));
        let currentSOC = existingBatteryConfig ? existingBatteryConfig.capacity * 0.5 : 0;

        electricityData.forEach(day => {
            const existingHourlySolar_historical = solarDataMap.get(day.date);
            if (!existingHourlySolar_historical) return;
            daysProcessed++;

            const trueHourlyConsumption = reconstructTrueConsumption(day, existingHourlySolar_historical);
            const degradedHourlySolar = existingHourlySolar_historical.map(s => s * Math.pow(1 - config.solarDegradation, config.existingSystemAge));

            const simResults = simulateDay(trueHourlyConsumption, degradedHourlySolar, baselineProvider, existingBatteryConfig, currentSOC);
            currentSOC = simResults.finalSOC;
            const dailyBreakdown = simResults.dailyBreakdown;

            const season = getSeason(day.date);
            const rawSeason = rawData.baseline.year1[season];
            if (rawSeason) {
                rawSeason.days++;
                rawSeason.peakKWh += dailyBreakdown.peakKWh;
                rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh;
                rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh;
                rawSeason.tier1ExportKWh += dailyBreakdown.tier1ExportKWh;
                rawSeason.tier2ExportKWh += dailyBreakdown.tier2ExportKWh;
                rawSeason.solarChargeKWh += dailyBreakdown.solarChargeKWh;
                rawSeason.gridChargeKWh += dailyBreakdown.gridChargeKWh;
                const dailyControlledLoadKWh = (day.controlledLoad || []).reduce((a, b) => a + b, 0);
                rawSeason.controlledLoadKWh += dailyControlledLoadKWh;
            }

            let dailyEnergyCost = importCalculator(baselineProvider.importRules, dailyBreakdown, { rate: 0, year: 1 });
            dailyEnergyCost -= exportCalculator(baselineProvider.exportRules, dailyBreakdown, 1, fitConfig, getDegradedFitRate);

            const dailyControlledLoadKWh = (day.controlledLoad || []).reduce((a, b) => a + b, 0);
            const dailyControlledLoadCost = dailyControlledLoadKWh * controlledLoadRateInfo.rate;

            let totalDailyAdjustment = (baselineProvider.dailyCharge || 0) + dailyEnergyCost + dailyControlledLoadCost;
            totalDailyAdjustment = applySpecialConditions(totalDailyAdjustment, dailyBreakdown, baselineProvider.specialConditions, day.date);
            totalCostForPeriod += totalDailyAdjustment;
        });

        const annualizationFactor = daysProcessed > 0 ? 365 / daysProcessed : 0;
        annualizedBaseCost = totalCostForPeriod * annualizationFactor;
    }

    // 6. Add a warning if a fallback rate was used.
    if (hasControlledLoadInData && controlledLoadRateInfo && controlledLoadRateInfo.fallbackUsed) {
        finalResults.warnings.push(`For Baseline Provider '${baselineProvider.name}': No 'Controlled Load' tariff was found. The analysis used the '${controlledLoadRateInfo.fallbackUsed}' rate as a substitute.`);
    }

    return annualizedBaseCost;
}

/**
 * The main entry point for running the entire financial analysis over the specified number of years.
 * @param {object} config - The complete analysis configuration.
 * @param {object} simulationData - Seasonal average data (for manual mode).
 * @param {Array} electricityData - Parsed usage data (for CSV mode).
 * @returns {object} An object containing the final financial results, raw data, and the config used.
 */
export function runSimulation(config, simulationData, electricityData) {
    const finalResults = { baselineCosts: [], warnings: [] };
    const rawData = { baseline: { year1: {} }, system: {} };

    // Initialize results and raw data structures for each selected provider.
    config.selectedProviders.forEach(pId => {
        const provider = config.providers.find(p => p.id === pId);
        if (!provider) return;
        finalResults[provider.id] = { annualCosts: [], cumulativeSavingsPerYear: [], roiYear: null, npv: 0 };
        rawData.system[provider.id] = { year1: {} };
        for (const q of ['Summer', 'Autumn', 'Winter', 'Spring']) {
            rawData.baseline.year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, solarChargeKWh: 0, gridChargeCost: 0, controlledLoadKWh: 0, evLoadKWh: 0 };
            rawData.system[provider.id].year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, solarChargeKWh: 0, gridChargeCost: 0, controlledLoadKWh: 0, evLoadKWh: 0 };
        }
    });

    // Calculate the initial annualized baseline cost (Year 1).
    const annualizedBaseCost = calculateBaseline(config, simulationData, electricityData, rawData, finalResults);
  
    // --- Loop through each year of the analysis period ---
    for (let y = 1; y <= config.numYears; y++) {
        // Escalate the baseline cost for the current year.
        finalResults.baselineCosts[y] = escalate(annualizedBaseCost, config.tariffEscalation, y);

        // Calculate the system cost for each selected provider for the current year.
        config.selectedProviders.forEach(p => {
            const providerData = config.providers.find(prov => prov.id === p);
            if (!providerData) return;

            // Calculate the total cost with the system for this year.
            const annualCost = calculateSystemYear(providerData, config, y, simulationData, electricityData, rawData, finalResults);
  
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
    const daysPerQuarter = { 
        [SEASONS.SUMMER]: 90, 
        [SEASONS.AUTUMN]: 91, 
        [SEASONS.WINTER]: 92, 
        [SEASONS.SPRING]: 92 
    }
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
    let peakHours;
    if (baselineProvider) {
        const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
        peakHours = parseRangesToHours(peakRule?.hours || '');
    }
	
	// If, after checking the provider, no peak hours were found, apply a sensible default.
    if (!peakHours || peakHours.length === 0) {
        console.log("No 'Peak' rule found in the baseline provider. Applying default peak hours (3pm-11pm) for sizing analysis.");
        peakHours = parseRangesToHours('3pm-11pm');
    }

    const totalSolarKW = config.replaceExistingSystem ? config.newSolarKW : config.existingSolarKW + config.newSolarKW;
    const solarProfileSourceKw = config.existingSolarKW > 0 ? config.existingSolarKW : 1;
    const solarDataMap = config.noExistingSolar ? new Map() : new Map((solarData || []).map(day => [day.date, day.hourly]));
    
    // These arrays will store the key metrics for each day of the year.
    const dailyPeakPeriodData = []; // Total kWh needed from battery during peak hours.
    const dailyMaxHourData = [];    // Max kWh needed from battery in a single hour.
    let totalDays = 0;

    // Analyse each day in the dataset.
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