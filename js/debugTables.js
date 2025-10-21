// js/debugTables.js
// Version 1.2.9
// This module contains all functions related to rendering the "Debug Tables".
// These tables provide transparency into the calculator's inputs, intermediate calculations,
// and simulation results, aiding in validation and troubleshooting.

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

import { gatherConfigFromUI } from './config.js';
import { 
	getNumericInput, 
	displayError, 
	clearError,
	formatHoursToRanges,
	determineTouHours,
	getSimulationData,
	getSeason
} from './utils.js';
import { 
	generateHourlyConsumptionProfileFromDailyTOU, 
	generateHourlySolarProfileFromDaily,
	generateEVChargingProfile
} from './profiles.js';
import { simulateDay, calculateSizingRecommendations, calculateDetailedSizing } from './analysis.js';
import { state } from './state.js';
import { renderSizingResults, drawDistributionCharts } from './uiRender.js';
import { SEASONS } from './constants.js';

/**
 * Hides all debug and results containers to provide a clean slate
 * before showing a new one.
 */
export function hideAllDebugContainers() {
    document.querySelectorAll('[id$="DebugTableContainer"], #sizing-recommendation-section').forEach(el => el.style.display = "none");
}

/**
 * Calculates seasonal averages for battery behavior (grid charging, morning SOC)
 * by simulating an average day for each season. This function provides diagnostic data
 * for the "Providers Debug Table" and uses a simplified simulation approach compared
 * to the main analysis engine. It ensures the simulation uses the correct inverter power
 * and grid charge settings based on the user's configuration.
 * @param {object} provider - The provider configuration to use for the simulation.
 * @param {object} batteryConfigFromUI - DEPRECATED (kept for compatibility, but not used). The function now uses values from the main `config` object.
 * @param {object} config - The main application configuration object, containing all UI inputs and settings.
 * @param {object} state - The global application state, used here to access quarterly averages.
 * @returns {object} An object containing the calculated averages (avgGridCharge, avgSolarCharge, avgSocPercent) for each season ('Summer', 'Autumn', 'Winter', 'Spring').
 */
function calculateSeasonalAverages(provider, batteryConfigFromUI, config, state) {
    // Initialize the structure to hold results for each season.
    const seasonalData = {
        Summer: { avgGridCharge: 0, avgSolarCharge: 0, avgSocPercent: 0 },
        Autumn: { avgGridCharge: 0, avgSolarCharge: 0, avgSocPercent: 0 },
        Winter: { avgGridCharge: 0, avgSolarCharge: 0, avgSocPercent: 0 },
        Spring: { avgGridCharge: 0, avgSolarCharge: 0, avgSocPercent: 0 },
    };

    // Exit if the pre-calculated quarterly average data isn't available.
    if (!state.quarterlyAverages) return seasonalData;

    // --- Correctly calculate the DEGRADED battery capacity and TOTAL inverter power for Year 1 ---
    const degradedExistingBattery = (config.replaceExistingSystem ? 0 : config.existingBattery) * Math.pow(1 - config.batteryDegradation, config.existingSystemAge);
    const degradedNewBattery = config.newBatteryKWH * Math.pow(1 - config.batteryDegradation, 0); // Year 1 = age 0
    const totalDegradedBatteryCapacity = degradedExistingBattery + degradedNewBattery;

    let totalInverterPower;
    if (config.replaceExistingSystem) {
        totalInverterPower = config.newBatteryInverterKW;
    } else if (config.isAcCoupled) {
        totalInverterPower = config.newBatteryInverterKW + config.existingSolarInverterKW;
    } else {
        totalInverterPower = config.newBatteryInverterKW;
    }

    const batteryConfigForSim = {
        capacity: totalDegradedBatteryCapacity,
        inverterKW: totalInverterPower,
    };
    // --- End of corrected battery and inverter calculation ---


    // Calculate the daily EV charge needed if EV charging is enabled globally AND this provider has rules.
    let dailyEVChargeKWh = 0;
    if (config.evChargingEnabled && provider.evRules && provider.evRules.length > 0) {
        dailyEVChargeKWh = (config.evDailyKM / 100) * config.evEfficiency;
    }

    // Loop through each season defined in the quarterly averages data.
    for (const quarterKey in state.quarterlyAverages) {
        const seasonName = quarterKey.split('_')[1];
        const quarterData = state.quarterlyAverages[quarterKey];

        if (!quarterData || !seasonalData[seasonName]) continue;

        // Generate the base hourly household consumption profile using the CURRENT provider's import rules.
        const hourlyConsumptionBase = generateHourlyConsumptionProfileFromDailyTOU(
            quarterData.avgPeak,
            quarterData.avgShoulder,
            quarterData.avgOffPeak,
            provider.importRules
        );

        // Add EV load to the base consumption if applicable.
        // Create a copy of the base array to avoid modifying it directly.
        let hourlyConsumptionTotal = Array.from(hourlyConsumptionBase);
        if (config.evChargingEnabled) {
            const evProfile = generateEVChargingProfile(config.evDailyKM, config.evEfficiency, "10pm-6am");
            for (let h = 0; h < 24; h++) {
                hourlyConsumptionTotal[h] += evProfile[h];
            }
        }
        
        // Generate the average hourly solar profile for the new system (Year 1).
        const degradedExistingSolarDaily = (config.replaceExistingSystem ? 0 : config.existingSolarKW * config.manualSolarProfile) * Math.pow(1 - config.solarDegradation, config.existingSystemAge);
        const degradedNewSolarDaily = config.newSolarKW * config.manualSolarProfile * Math.pow(1 - config.solarDegradation, 0);
        const totalDegradedSolarDaily = degradedExistingSolarDaily + degradedNewSolarDaily;
        let hourlySolar = generateHourlySolarProfileFromDaily(totalDegradedSolarDaily, quarterKey);
        hourlySolar = hourlySolar.map(gen => Math.min(gen, batteryConfigForSim.inverterKW));


        // --- Pass correct grid charge and EV settings to simulateDay ---
        // Create a temporary config object for the simulation call.
        // This explicitly includes all necessary properties from the main config object
        // that the simulateDay function might need access to, ensuring correct behavior.
        const configForSim = {
            loanEnabled: config.loanEnabled,
            discountRateEnabled: config.discountRateEnabled,
            loanAmount: config.loanAmount,
            loanInterestRate: config.loanInterestRate,
            loanTerm: config.loanTerm,
            discountRate: config.discountRate,
            numYears: config.numYears,
            tariffEscalation: config.tariffEscalation,
            solarDegradation: config.solarDegradation,
            batteryDegradation: config.batteryDegradation,
            fitDegradationStartYear: config.fitDegradationStartYear,
            fitDegradationEndYear: config.fitDegradationEndYear,
            fitMinimumRate: config.fitMinimumRate,
            gridChargeThreshold: config.gridChargeThreshold, // Grid charge setting
            socChargeTrigger: config.socChargeTrigger,       // Grid charge setting
            evChargingEnabled: config.evChargingEnabled,
            evDailyKM: config.evDailyKM,
            evEfficiency: config.evEfficiency,
            minSOCForEV: config.minSOCForEV,                   // EV setting
            initialSystemCost: config.initialSystemCost,
            annualLoanRepayment: config.annualLoanRepayment
            // Add any other properties from the main 'config' object that simulateDay might implicitly rely on.
        };
        // --- End of passing correct settings ---

        // Run a two-pass simulation for better accuracy.
        const warmUpSOC = batteryConfigForSim.capacity * 0.5;
		
        const warmUpResults = simulateDay(hourlyConsumptionTotal, hourlySolar, provider, batteryConfigForSim, warmUpSOC, dailyEVChargeKWh, configForSim);

        const realisticInitialSOC = warmUpResults.finalSOC;
		
        const simResults = simulateDay(hourlyConsumptionTotal, hourlySolar, provider, batteryConfigForSim, realisticInitialSOC, dailyEVChargeKWh, configForSim);

		// Store results.
		seasonalData[seasonName].avgGridCharge = simResults.dailyBreakdown.gridChargeKWh;
		seasonalData[seasonName].avgSolarCharge = simResults.dailyBreakdown.solarChargeKWh;
		seasonalData[seasonName].avgSocPercent = batteryConfigForSim.capacity > 0 ? (simResults.socAt6am / batteryConfigForSim.capacity) * 100 : 0;
    }

    // Return the object containing the calculated averages for all seasons.
    return seasonalData;
}

/**
 * Renders the "Data Debug Table" which shows the raw hourly input data
 * used for the simulation, either from CSV or manual entry.
 * @param {object} state - The global application state.
 * @param {boolean} [shouldShow=true] - Whether to display the container after rendering.
 */
export function renderDebugDataTable(state, shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;
    const useManual = document.getElementById("manualInputToggle")?.checked;
    
    // Validate that required data is present.
    if (!useManual && (!state.electricityData || state.electricityData.length === 0)) {
        displayError("Please upload an electricity CSV file with data first.", "data-input-error");
        return;
    }
    
    const debugContainer = document.getElementById("dataDebugTableContainer");
    let tableHTML = "<h3>Debug Data</h3><table><thead><tr><th>Date</th><th>Hour</th><th>Consumption (kWh)</th><th>Feed In (kWh)</th><th>Solar (kWh)</th></tr></thead><tbody>";
    
    if (useManual) {
        // For manual mode, show the hourly profiles generated from the daily averages.
        const dailyPeak = (getNumericInput("summerDailyPeak") + getNumericInput("autumnDailyPeak") + getNumericInput("winterDailyPeak") + getNumericInput("springDailyPeak")) / 4;
        const dailyShoulder = (getNumericInput("summerDailyShoulder") + getNumericInput("autumnDailyShoulder") + getNumericInput("winterShoulder") + getNumericInput("springShoulder")) / 4;
        const dailyOffPeak = (getNumericInput("summerDailyOffPeak") + getNumericInput("autumnDailyOffPeak") + getNumericInput("winterOffPeak") + getNumericInput("springOffPeak")) / 4;
        const dailySolar = (getNumericInput("summerDailySolar") + getNumericInput("autumnDailySolar") + getNumericInput("winterDailySolar") + getNumericInput("springDailySolar")) / 4;

        const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(dailyPeak, dailyShoulder, dailyOffPeak);
        const hourlySolar = generateHourlySolarProfileFromDaily(dailySolar);

        for (let h = 0; h < 24; h++) {
            tableHTML += `<tr><td>Manual Average</td><td>${(h<10?'0':'')+h}:00</td><td>${(hourlyConsumption[h] || 0).toFixed(3)}</td><td>0.000</td><td>${(hourlySolar[h] || 0).toFixed(3)}</td></tr>`;
        }
    } else {
        // For CSV mode, show the first 100 rows of processed hourly data.
        const numEntries = Math.min(state.electricityData.length, 100);
        const solarDataMap = new Map((state.solarData || []).map(d => [d.date, d.hourly]));
        for (let d = 0; d < numEntries; d++) {
            const dayData = state.electricityData[d];
            const hourlySolar = solarDataMap.get(dayData.date) || Array(24).fill(0);
            for (let h = 0; h < 24; h++) {
                tableHTML += `<tr><td>${dayData.date}</td><td>${(h<10?'0':'')+h}:00</td><td>${(dayData.consumption[h] || 0).toFixed(3)}</td><td>${(dayData.feedIn[h] || 0).toFixed(3)}</td><td>${(hourlySolar[h] || 0).toFixed(3)}</td></tr>`;
            }
        }
    }

    tableHTML += "</tbody></table>";
    if (debugContainer) debugContainer.innerHTML = tableHTML;
    
    // Show the container if requested.
    if (shouldShow) {
        hideAllDebugContainers();
        if (debugContainer) debugContainer.style.display = "block";
    }
}

/**
 * Renders the "Existing System Debug Table" which shows the user's inputs
 * for their current system and a baseline energy analysis derived from the CSV data.
 * @param {object} state - The global application state.
 * @param {boolean} [shouldShow=true] - Whether to display the container after rendering.
 */
export function renderExistingSystemDebugTable(state, shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;
    
    const errorId = "existing-system-error";
    clearError(errorId);
    
    // This table is only available in CSV mode.
    if (document.getElementById("manualInputToggle")?.checked) {
        displayError("This debug table is not available in manual mode as it requires CSV data.", errorId);
        if (shouldShow) hideAllDebugContainers();
        return;
    }
    if (!state.electricityData || !state.solarData || state.electricityData.length === 0) {
        displayError("This debug table requires uploaded CSV data.", errorId);
        if (shouldShow) hideAllDebugContainers();
        return;
    }
    
    const debugContainer = document.getElementById("existingSystemDebugTableContainer");
    
    // Calculate baseline statistics from the raw data.
    let totalGridImports = 0, totalGridExports = 0, totalSolarGeneration = 0;
    let totalDays = 0;
    const solarDataMap = new Map(state.solarData.map(day => [day.date, day.hourly]));
    state.electricityData.forEach(day => {
        const dateKey = day.date;
        const hourlySolar = solarDataMap.get(dateKey);
        if (hourlySolar) { // Only process days with both usage and solar data.
            totalDays++;
            totalSolarGeneration += hourlySolar.reduce((a, b) => a + b, 0);
            totalGridImports += day.consumption.reduce((a, b) => a + b, 0);
            totalGridExports += day.feedIn.reduce((a, b) => a + b, 0);
        }
    });

    if (totalDays === 0) {
        displayError("No overlapping data found between the two CSV files. Please ensure the date ranges are aligned.");
        if (shouldShow) hideAllDebugContainers();
        return;
    }

    // Derive self-consumption and total consumption.
    const totalSelfConsumed = totalSolarGeneration - totalGridExports;
    const totalConsumption = totalSelfConsumed + totalGridImports;
    
    // Build the HTML table.
    let tableHTML = "<h3>Existing System & Baseline Data</h3><table><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>";
    tableHTML += `<tr><td colspan="2"><strong>Existing System Inputs</strong></td></tr>`;
    tableHTML += `<tr><td>Existing Solar Panel Size (kW)</td><td>${document.getElementById("existingSolarKW")?.value || ''}</td></tr>`;
    tableHTML += `<tr><td>Existing Solar Inverter Size (kWh)</td><td>${document.getElementById("existingSolarInverter")?.value || ''}</td></tr>`;
    tableHTML += `<tr><td>Existing Battery Size (kWh)</td><td>${document.getElementById("existingBattery")?.value || ''}</td></tr>`;
    tableHTML += `<tr><td>Existing Battery Inverter (kW)</td><td>${document.getElementById("existingBatteryInverter")?.value || ''}</td></tr>`;
    tableHTML += `<tr><td colspan="2"><strong>Baseline Data Analysis (from CSV)</strong></td></tr>`;
    tableHTML += `<tr><td>Total Days Analysed</td><td>${totalDays} days</td></tr>`;
    tableHTML += `<tr><td>Total Consumption (Grid Imports + Self-Consumed Solar)</td><td>${totalConsumption.toFixed(2)} kWh</td></tr>`;
    tableHTML += `<tr><td>Total Solar Generation</td><td>${totalSolarGeneration.toFixed(2)} kWh</td></tr>`;
    tableHTML += `<tr><td>Total Self-Consumed Solar (Generation - Exports)</td><td>${totalSelfConsumed.toFixed(2)} kWh</td></tr>`;
    tableHTML += `<tr><td>Total Imported from Grid (from Usage CSV)</td><td>${totalGridImports.toFixed(2)} kWh</td></tr>`;
    tableHTML += `<tr><td>Total Exported to Grid (from Usage CSV)</td><td>${totalGridExports.toFixed(2)} kWh</td></tr>`;
    tableHTML += "</tbody></table>";

    if (debugContainer) debugContainer.innerHTML = tableHTML;
    
    if (shouldShow) {
        hideAllDebugContainers();
        if (debugContainer) debugContainer.style.display = "block";
    }
}

/**
 * Renders the "Sizing Recommendation" section, which doubles as the debug view for the new system.
 * It shows heuristic and/or detailed sizing recommendations.
 * @param {object} state - The global application state.
 * @param {boolean} [shouldShow=true] - Whether to display the container after rendering.
 */
export function renderNewSystemDebugTable(state, shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;
	clearError();
    
    const debugContainer = document.getElementById("sizing-recommendation-section");
    const recommendationContainer = document.getElementById("recommendationContainer");
    if (!recommendationContainer || !debugContainer) return;

    const useManual = document.getElementById("manualInputToggle")?.checked;
    const config = state.analysisConfig;
    if (!config) return;

    if (useManual) {
        // In manual mode, only the simpler heuristic sizing is available.
        const simulationData = {
            [SEASONS.SUMMER]: { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
            [SEASONS.AUTUMN]: { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
            [SEASONS.WINTER]: { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
            [SEASONS.SPRING]: { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
        };
        const heuristicRecs = calculateSizingRecommendations(config.recommendationCoverageTarget, simulationData);
        let recommendationHTML = `<div class="recommendation-section">`;
        if (heuristicRecs) {
            recommendationHTML += `<h4>Heuristic Sizing (based on ${heuristicRecs.coverageTarget}% annual coverage)</h4><p><strong>Recommended Solar: ${heuristicRecs.solar.toFixed(1)} kW</strong><br><strong>Recommended Battery: ${heuristicRecs.battery.toFixed(1)} kWh</strong><br><strong>Recommended Inverter: ${heuristicRecs.inverter.toFixed(1)} kW</strong></p>`;
        }
        recommendationHTML += `</div>`;
        recommendationContainer.innerHTML = recommendationHTML;
        const newSystemEstimatesTable = document.getElementById("newSystemEstimatesTable");
        if (newSystemEstimatesTable) {
            newSystemEstimatesTable.innerHTML = '<p><em>Detailed sizing charts require CSV data.</em></p>';
        }

    } else { 
        // In CSV mode, run the detailed, data-driven sizing analysis.
        if (!state.electricityData || !state.solarData || state.electricityData.length === 0) {
            displayError("Please upload both electricity and solar CSV files to use this debug tool.");
            return;
        }
        const sizingResults = calculateDetailedSizing(state.electricityData, state.solarData, config, state.quarterlyAverages);
        if (sizingResults) {
            // --- FIX: To ensure charts render with correct dimensions, the container must be in the DOM layout.
            // We make it part of the layout but keep it invisible to prevent a flicker effect.
            const originalDisplay = debugContainer.style.display;
            const originalVisibility = debugContainer.style.visibility;
            debugContainer.style.visibility = 'hidden';
            debugContainer.style.display = 'block';

            // Render the text content and then draw the charts into the now-correctly-sized canvas elements.
            renderSizingResults(sizingResults, state);
            drawDistributionCharts(sizingResults.distributions, state);

            // Restore the original styles.
            debugContainer.style.display = originalDisplay;
            debugContainer.style.visibility = originalVisibility;
        } else {
            displayError("Sizing calculation failed for debug table.", "sizing-error-message");
        }
    }
    
    if (shouldShow) {
        hideAllDebugContainers();
        debugContainer.style.display = "block";
    }
}

/**
 * Renders the "Providers Debug Table" which shows two key pieces of information:
 * 1. The household's total quarterly consumption averages, broken down by the tariff periods
 * (Peak, Shoulder, Off-Peak) determined by the analysis.
 * 2. The simulated battery performance (average grid charging and morning SOC) for each
 * selected provider, based on their specific tariffs and grid charging rules.
 * @param {object} state - The global application state.
 * @param {boolean} [shouldShow=true] - Whether to display the container after rendering.
 */
export function renderProvidersDebugTable(state, shouldShow = true) {
    // Abort if the user hasn't enabled the debug tools.
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;
    
    const debugContainer = document.getElementById("providersDebugTableContainer");
    let tableHTML = "<h3>Provider & Tariff Inputs</h3>";

    // This table's calculations are only meaningful in CSV mode.
    const useManual = document.getElementById("manualInputToggle")?.checked;
    if (!useManual && (!state.electricityData || state.electricityData.length === 0)) {
        displayError("This debug table requires uploaded CSV data to calculate seasonal averages.", "provider-selection-error");
        return;
    }
    clearError("provider-selection-error");
    
    // Gather the current UI settings directly, instead of waiting for the main analysis.
    const config = gatherConfigFromUI();
    if (config.selectedProviders.length === 0) {
        displayError("Please select at least one provider.", "provider-selection-error");
        return;
    }

    // Determine the TOU hours and calculate quarterly averages on the fly.
    const touHours = determineTouHours(config);
    state.touHoursForAnalysis = touHours; // Save for consistent display
    if (!useManual) {
        state.quarterlyAverages = null; // Clear cache to recalculate
        getSimulationData(touHours, state.electricityData);
    }

    // --- Part 1: Render the Household Consumption Quarterly Averages Table ---
	if (state.quarterlyAverages) {
        // Retrieve the Time-of-Use hours that were determined during the main analysis.
        const touHours = state.touHoursForAnalysis || { peak: [], shoulder: [] };
        
        // Calculate the off-peak hours by finding all hours not in peak or shoulder.
        const allHours = new Set(Array.from({ length: 24 }, (_, i) => i));
        touHours.peak.forEach(h => allHours.delete(h));
        touHours.shoulder.forEach(h => allHours.delete(h));
        const offPeakHours = Array.from(allHours);

        // Format the hour arrays into human-readable strings (e.g., "3pm-11pm").
        const peakStr = formatHoursToRanges(touHours.peak);
        const shoulderStr = formatHoursToRanges(touHours.shoulder);
        const offPeakStr = formatHoursToRanges(offPeakHours);

        // Add a note explaining where the tariff periods come from.
        tableHTML += `
        <p class="pdf-export-note" style="font-size: 0.9em; font-style: italic; border: 1px solid #f0ad4e; padding: 10px; border-radius: 5px; background-color: #fcf8e3;">
        <strong>Important Note:</strong> The daily averages in this table are calculated from <strong>isolated daily simulations</strong> and are for diagnostic purposes. They may differ from the final "System Performance" results, which use a more realistic, <strong>continuous simulation</strong> where the battery's state of charge carries over from one day to the next.
        </p>
		`;
		tableHTML += `
            <p style="font-size: 0.85em; font-style: italic; color: #666; margin-top: 2px;">
                Note: The periods below are based on the tariff rules of the first provider. If no TOU rules are found, defaults are used.
            </p>
        `;

        // Build the table header.
		tableHTML += `<table><thead><tr><th colspan="2" class="provider-header-cell"><strong>Total Household Consumption Quarterly Averages (Daily)</strong></th></tr></thead><tbody>`;
		
        // Create a row for each period in each quarter, displaying the calculated hours.
        for (const quarter in state.quarterlyAverages) {
			const q = state.quarterlyAverages[quarter];
			tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Peak <span class="hour-display">(${peakStr})</span></td><td>${(q.avgPeak).toFixed(2)} kWh</td></tr>`;
			tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Shoulder <span class="hour-display">(${shoulderStr})</span></td><td>${(q.avgShoulder).toFixed(2)} kWh</td></tr>`;
			tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Off-Peak <span class="hour-display">(${offPeakStr})</span></td><td>${(q.avgOffPeak).toFixed(2)} kWh</td></tr>`;
			tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Solar</td><td>${(q.avgSolar).toFixed(2)} kWh</td></tr>`;
		}
		tableHTML += `</tbody></table>`;
	}

    // --- Part 2: Render the Provider-Specific Simulation Averages ---
    config.selectedProviders.forEach(pKey => {
        const providerConfig = config.providers.find(p => p.id === pKey);
        if (!providerConfig) return;
        tableHTML += `<h4 style="margin-top:20px;">${providerConfig.name}</h4>`;

        if (!useManual) {
            // Assemble the full battery configuration for the simulation.
            const batteryConfig = {
                capacity: (config.replaceExistingSystem ? 0 : config.existingBattery) + config.newBatteryKWH,
                inverterKW: (config.replaceExistingSystem ? 0 : config.existingBatteryInverter) + config.newBatteryInverterKW,
                gridChargeThreshold: config.gridChargeThreshold,
                socChargeTrigger: config.socChargeTrigger
            };
            // Run a separate simulation to get diagnostic averages for this provider.
            const seasonalAverages = calculateSeasonalAverages(providerConfig, batteryConfig, config, state);
            
            // Build the results table for this provider.
            tableHTML += `<table><thead><tr><th>Season</th><th>Avg Daily Solar Charge (kWh)</th><th>Avg Daily Grid Charge (kWh)</th><th>Avg SOC at 6am (%)</th></tr></thead><tbody>`;
            for (const season in seasonalAverages) {
                const data = seasonalAverages[season];
                tableHTML += `<tr><td>${season}</td><td>${data.avgSolarCharge.toFixed(2)}</td><td>${data.avgGridCharge.toFixed(2)}</td><td>${data.avgSocPercent.toFixed(1)}%</td></tr>`;
            }
            tableHTML += `</tbody></table>`;
        } else {
            tableHTML += `<p><em>Seasonal averages are only available in CSV mode.</em></p>`;
        }
    });

    // Finally, inject the generated HTML into the page.
    if (debugContainer) debugContainer.innerHTML = tableHTML;
    
    // If this function was called by a button click, show the container.
    if (shouldShow) {
        hideAllDebugContainers();
        if (debugContainer) debugContainer.style.display = "block";
    }
}

/**
 * Renders the "Analysis Period Debug Table" which shows the year-by-year
 * degradation of solar and battery components over the lifespan of the analysis.
 * @param {boolean} [shouldShow=true] - Whether to display the container after rendering.
 */
export function renderAnalysisPeriodDebugTable(shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;

    const debugContainer = document.getElementById("analysisPeriodDebugTableContainer");
    
    // Gather all relevant inputs from the UI.
    const numYears = getNumericInput("numYears", 15);
    const solarDegradation = getNumericInput("solarDegradation", 0.5) / 100;
    const batteryDegradation = getNumericInput("batteryDegradation", 2) / 100;
    const existingSystemAge = getNumericInput("existingSystemAge", 0);
    const replaceExisting = document.getElementById("replaceExistingSystem")?.checked;
    const newSolarKW = getNumericInput("newSolarKW");
    const existingSolarKW = replaceExisting ? 0 : getNumericInput("existingSolarKW");
    const newBatteryKWH = getNumericInput("newBattery");
    const existingBatteryKWH = replaceExisting ? 0 : getNumericInput("existingBattery");
    const totalInverterKW = getNumericInput("newBatteryInverter") + (replaceExisting ? 0 : getNumericInput("existingBatteryInverter"));
    
    // Build summary table of inputs.
    let tableHTML = "<h3>Analysis Period Inputs</h3><table><tbody>";
    tableHTML += `<tr><td>Analysis Years (System Lifespan)</td><td>${numYears}</td></tr>`;
    tableHTML += `<tr><td>Solar Degradation (% per year)</td><td>${(solarDegradation * 100).toFixed(1)}</td></tr>`;
    tableHTML += `<tr><td>Battery Degradation (% per year)</td><td>${(batteryDegradation * 100).toFixed(1)}</td></tr>`;
    tableHTML += `<tr><td>Existing System Age (Years)</td><td>${existingSystemAge}</td></tr>`;
    tableHTML += "</tbody></table>";
    
    // Build year-by-year degradation schedule table.
    tableHTML += "<h3 style='margin-top: 20px;'>Component Performance Schedule</h3>";
    tableHTML += `<table><thead><tr><th>Year</th><th>Total Solar kW</th><th>Total Battery kWh</th><th>Inverter kW</th></tr></thead><tbody>`;
    
    for (let year = 1; year <= numYears; year++) {
        // Calculate the age of each component in the current year.
        const currentExistingAge = existingSystemAge + year - 1;
        const currentNewAge = year - 1;
        // Apply the degradation formula to each component.
        const degradedExistingSolar = existingSolarKW * Math.pow(1 - solarDegradation, currentExistingAge);
        const degradedNewSolar = newSolarKW * Math.pow(1 - solarDegradation, currentNewAge);
        const totalDegradedSolar = degradedExistingSolar + degradedNewSolar;
        const degradedExistingBattery = existingBatteryKWH * Math.pow(1 - batteryDegradation, currentExistingAge);
        const degradedNewBattery = newBatteryKWH * Math.pow(1 - batteryDegradation, currentNewAge);
        const totalDegradedBattery = degradedExistingBattery + degradedNewBattery;
        tableHTML += `<tr><td>${year}</td><td>${totalDegradedSolar.toFixed(2)} kW</td><td>${totalDegradedBattery.toFixed(2)} kWh</td><td>${totalInverterKW.toFixed(2)} kW</td></tr>`;
    }
    
    tableHTML += "</tbody></table>";
    tableHTML += `<p style="font-size: 0.9em; font-style: italic; margin-top: 10px;"><strong>Note:</strong> Inverter degradation is not currently modeled in the simulation.</p>`;

    if (debugContainer) debugContainer.innerHTML = tableHTML;
    
    if (shouldShow) {
        hideAllDebugContainers();
        if (debugContainer) debugContainer.style.display = "block";
    }
}

/**
 * Renders the "Loan Debug Table" showing a simplified year-by-year
 * amortization schedule for the user-defined loan.
 * @param {boolean} [shouldShow=true] - Whether to display the container after rendering.
 */
export function renderLoanDebugTable(shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;

    const debugContainer = document.getElementById("loanDebugTableContainer");
    const P = getNumericInput("loanAmount"); // Principal
    const annualRate = getNumericInput("loanInterestRate");
    const termYears = getNumericInput("loanTerm");

    if (P === 0 || annualRate === 0 || termYears === 0) {
        if(debugContainer) debugContainer.innerHTML = "<p>Please enter valid loan details (Amount, Rate, and Term > 0).</p>";
    } else {
        const i = (annualRate / 100) / 12; // Monthly interest rate
        const n = termYears * 12; // Total number of payments
        // Calculate monthly and annual payments.
        const monthlyPayment = P * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
        const annualPayment = monthlyPayment * 12;
        // Build the amortization table.
        let tableHTML = "<h3>Loan Amortization Schedule</h3><table><thead><tr><th>Year</th><th>Annual Repayment</th><th>Cumulative Repayments</th><th>Remaining Balance</th></tr></thead><tbody>";
        for (let y = 1; y <= termYears; y++) {
            let cumulativeRepayments = annualPayment * y;
            // Standard formula for remaining balance.
            let yearEndBalance = P * (Math.pow(1 + i, n) - Math.pow(1 + i, y * 12)) / (Math.pow(1 + i, n) - 1);
            tableHTML += `<tr><td>${y}</td><td>$${annualPayment.toFixed(2)}</td><td>$${cumulativeRepayments.toFixed(2)}</td><td>$${Math.max(0, yearEndBalance).toFixed(2)}</td></tr>`;
        }
        tableHTML += "</tbody></table>";
        if(debugContainer) debugContainer.innerHTML = tableHTML;
    }
    
    if (shouldShow) {
        hideAllDebugContainers();
        if (debugContainer) debugContainer.style.display = "block";
    }
}

/**
 * Renders the "Opportunity Cost Debug Table" which shows the future value
 * of the initial system cost if it were invested elsewhere at the specified discount rate.
 * @param {boolean} [shouldShow=true] - Whether to display the container after rendering.
 */
export function renderOpportunityCostDebugTable(shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;

    const debugContainer = document.getElementById("opportunityCostDebugTableContainer");
    const costSolar = getNumericInput("costSolar");
    const costBattery = getNumericInput("costBattery");
    const systemCost = costSolar + costBattery;
    const discountRate = getNumericInput("discountRate") / 100;
    const numYears = getNumericInput("numYears", 15);

    // Build table showing year-by-year compounded growth of the initial capital.
    let tableHTML = `<h3>Opportunity Cost: Future Value of Initial Capital ($${systemCost.toFixed(2)})</h3><table><thead><tr><th>Year</th><th>Invested Capital Value</th></tr></thead><tbody>`;
    for (let y = 1; y <= numYears; y++) {
        // Future Value formula: FV = PV * (1 + r)^n
        const futureValue = systemCost * Math.pow(1 + discountRate, y);
        tableHTML += `<tr><td>${y}</td><td>$${futureValue.toFixed(2)}</td></tr>`;
    }
    tableHTML += "</tbody></table>";
    if(debugContainer) debugContainer.innerHTML = tableHTML;

    if (shouldShow) {
        hideAllDebugContainers();
        if (debugContainer) debugContainer.style.display = "block";
    }
}