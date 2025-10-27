// js/debugTables.js
// Version 1.3.4
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
	getSeason,
	getUpgradedSystemInverterKW
} from './utils.js';
import { 
	generateHourlyConsumptionProfileFromDailyTOU, 
	generateHourlySolarProfileFromDaily,
	generateEVChargingProfile
} from './profiles.js';
import { simulateDay, calculateSizingRecommendations, calculateDetailedSizing, 	generateHourlyControlledLoadProfile } from './analysis.js';
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
function calculateSeasonalAverages(provider, config, averagesData, isManualMode) {
    const seasonalResults = {
        Summer: { avgGridCharge: 0, avgSolarCharge: 0, avgSocPercent: 0 },
        Autumn: { avgGridCharge: 0, avgSolarCharge: 0, avgSocPercent: 0 },
        Winter: { avgGridCharge: 0, avgSolarCharge: 0, avgSocPercent: 0 },
        Spring: { avgGridCharge: 0, avgSolarCharge: 0, avgSocPercent: 0 },
    };

    if (!averagesData) return seasonalResults;

    // --- Calculate DEGRADED battery capacity and TOTAL inverter power for Year 1 ---
    // (This part remains the same)
    const degradedExistingBattery = (config.replaceExistingSystem ? 0 : config.existingBattery) * Math.pow(1 - config.batteryDegradation, config.existingSystemAge);
    const degradedNewBattery = config.newBatteryKWH * Math.pow(1 - config.batteryDegradation, 0);
    const totalDegradedBatteryCapacity = degradedExistingBattery + degradedNewBattery;
    const totalInverterPower = getUpgradedSystemInverterKW(config);

    const batteryConfigForSim = {
        capacity: totalDegradedBatteryCapacity,
        inverterKW: totalInverterPower,
        // Add grid charge settings directly from config for simulateDay
        gridChargeThreshold: config.gridChargeThreshold,
        socChargeTrigger: config.socChargeTrigger
    };

    // --- Daily EV Charge ---
    let dailyEVChargeKWh = 0;
    if (config.evChargingEnabled && provider.evRules && provider.evRules.length > 0) {
        dailyEVChargeKWh = (config.evDailyKM / 100) * config.evEfficiency;
    }

    // --- Baseline provider rules for consumption profile ---
    const baselineProvider = config.providers.find(p => p.id === config.selectedProviders[0]);
    const baselineImportRules = baselineProvider ? baselineProvider.importRules : [];

    // Loop through each season (using standard names now)
    for (const seasonName of ['Summer', 'Autumn', 'Winter', 'Spring']) {
        // Construct the quarter key (e.g., 'Q1_Summer') dynamically
        const quarterKey = Object.keys(averagesData).find(key => key.includes(seasonName));
        const quarterData = averagesData[quarterKey];

        if (!quarterData) continue;

        let trueHourlyConsumption;
        let totalHourlySolar_upgraded;

        if (isManualMode) {
            // --- Manual Mode: Reconstruct profiles from daily averages ---
            const { avgPeakImport, avgShoulderImport, avgOffPeakImport, avgSolar, avgExport, avgControlledLoad, days } = quarterData;

            // Apply initial degradation to existing solar average
            const avgSolarGeneration_existing = avgSolar * Math.pow(1 - config.solarDegradation, config.existingSystemAge);
            const avgSelfConsumed_existing = Math.max(0, avgSolarGeneration_existing - avgExport);

            // Generate hourly profiles
            const hourlyImport = generateHourlyConsumptionProfileFromDailyTOU(avgPeakImport, avgShoulderImport, avgOffPeakImport, baselineImportRules);
            const hourlySelfConsumed = generateHourlySolarProfileFromDaily(avgSelfConsumed_existing, quarterKey); // Use quarterKey for season
            trueHourlyConsumption = hourlyImport.map((imp, h) => imp + (hourlySelfConsumed[h] || 0));

            // Generate hourly solar for NEW/UPGRADED system (Year 1)
            const degradedExistingSolarDaily = (config.replaceExistingSystem ? 0 : avgSolar) * Math.pow(1 - config.solarDegradation, config.existingSystemAge); // Use avgSolar, apply age degradation
            const degradedNewSolarDaily = (config.newSolarKW * 4.0) * Math.pow(1 - config.solarDegradation, 0); // Use default yield, no degradation (Year 1)
            const totalDegradedSolarDaily_upgraded = degradedExistingSolarDaily + degradedNewSolarDaily;
            totalHourlySolar_upgraded = generateHourlySolarProfileFromDaily(totalDegradedSolarDaily_upgraded, quarterKey); // Use quarterKey for season
            totalHourlySolar_upgraded = totalHourlySolar_upgraded.map(gen => Math.min(gen, totalInverterPower)); // Apply clipping

            // Handle controlled load for manual mode simulation
            const hourlyControlledLoad = generateHourlyControlledLoadProfile(avgControlledLoad);
            if (config.moveControlledLoad) {
                for (let h = 0; h < 24; h++) {
                    trueHourlyConsumption[h] += hourlyControlledLoad[h];
                }
            }
            // Note: If !moveControlledLoad, the separate cost is handled outside simulateDay usually,
            // but for this isolated sim, we don't need to add its cost, just its load profile if moved.

        } else {
            // --- CSV Mode: Use existing logic with avgPeak, avgShoulder, avgOffPeak ---
            const { avgPeak, avgShoulder, avgOffPeak, avgSolar } = quarterData; // These are true consumption averages

            trueHourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(avgPeak, avgShoulder, avgOffPeak, baselineImportRules); // Generate profile from true consumption averages

            // Generate hourly solar for NEW/UPGRADED system (Year 1)
            const degradedExistingSolarDaily_csv = (config.replaceExistingSystem ? 0 : config.existingSolarKW * 4.0) * Math.pow(1 - config.solarDegradation, config.existingSystemAge); // Use default yield
            const degradedNewSolarDaily_csv = (config.newSolarKW * 4.0) * Math.pow(1 - config.solarDegradation, 0); // Use default yield
            const totalDegradedSolarDaily_upgraded_csv = degradedExistingSolarDaily_csv + degradedNewSolarDaily_csv;
            totalHourlySolar_upgraded = generateHourlySolarProfileFromDaily(totalDegradedSolarDaily_upgraded_csv, quarterKey); // Use quarterKey for season
            totalHourlySolar_upgraded = totalHourlySolar_upgraded.map(gen => Math.min(gen, totalInverterPower)); // Apply clipping

            // Note: Controlled load and EV load are assumed to be part of the avgPeak/Shoulder/OffPeak averages derived from CSV.
        }

        // Add EV load (common to both modes, added AFTER profile generation)
        if (config.evChargingEnabled) {
            const evProfile = generateEVChargingProfile(config.evDailyKM, config.evEfficiency, "10pm-6am"); // Default window for avg sim
            for (let h = 0; h < 24; h++) {
                trueHourlyConsumption[h] += evProfile[h];
            }
        }


        // --- Pass correct grid charge and EV settings to simulateDay ---
        const configForSim = { /* ... populate necessary config fields ... */ minSOCForEV: config.minSOCForEV };

        // --- Run Simulation ---
        const warmUpSOC = batteryConfigForSim.capacity * 0.5;
        const warmUpResults = simulateDay(trueHourlyConsumption, totalHourlySolar_upgraded, provider, batteryConfigForSim, warmUpSOC, dailyEVChargeKWh, configForSim);
        const realisticInitialSOC = warmUpResults.finalSOC;
        const simResults = simulateDay(trueHourlyConsumption, totalHourlySolar_upgraded, provider, batteryConfigForSim, realisticInitialSOC, dailyEVChargeKWh, configForSim);

        // Store results using standard season name
        seasonalResults[seasonName].avgGridCharge = simResults.dailyBreakdown.gridChargeKWh;
        seasonalResults[seasonName].avgSolarCharge = simResults.dailyBreakdown.solarChargeKWh;
        seasonalResults[seasonName].avgSocPercent = batteryConfigForSim.capacity > 0 ? (simResults.socAt6am / batteryConfigForSim.capacity) * 100 : 0;
    }

    return seasonalResults;
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
    const debugContainer = document.getElementById("existingSystemDebugTableContainer");
    clearError(errorId); // Clear previous errors

    const config = gatherConfigFromUI(); // Get current config, including manualData
    const useManual = config.useManual;

    let tableHTML = "<h3>Existing System & Baseline Data</h3>";
    let calculatedValuesHTML = "";
    let dataLabelSuffix = ""; // Suffix for labels (e.g., "(Estimated from Manual Totals)")

    if (useManual) {
        // --- Manual Mode Calculations ---
        dataLabelSuffix = " (Estimated from Manual Totals)";
        let totalDays = 0;
        let totalImport = 0;
        let totalSolar = 0;
        let totalExport = 0;
        let validData = false;

        if (config.manualData) {
            for (const q in config.manualData) {
                const quarter = config.manualData[q];
                const daysInQ = quarter.days || 0;
                if (daysInQ > 0) {
                    validData = true; // Mark that we have at least some data
                    totalDays += daysInQ;
				// Correctly sum imports based on the isFlatRate flag
                if (quarter.isFlatRate) {
                    totalImport += (quarter.totalFlatImport || 0);
                } else {
                    totalImport += (quarter.totalPeakImport || 0) + (quarter.totalShoulderImport || 0) + (quarter.totalOffPeakImport || 0);
                }
                    totalSolar += quarter.totalSolar || 0;
                    totalExport += quarter.totalExport || 0;
                }
            }
        }

        if (!validData || totalDays === 0) {
            displayError("Please enter valid totals and days for at least one season in Manual Mode to populate this table.", errorId);
            if (shouldShow) hideAllDebugContainers();
            return; // Stop if no valid manual data entered
        }

        // Apply initial degradation to total solar for calculations below
        const initialDegradedTotalSolar = totalSolar * Math.pow(1 - config.solarDegradation, config.existingSystemAge);

        const totalSelfConsumed = Math.max(0, initialDegradedTotalSolar - totalExport);
        const totalConsumption = totalImport + totalSelfConsumed;
        const annualizationFactor = 365 / totalDays; // Factor to scale period totals to a full year

        // Build the HTML for the calculated values section
        calculatedValuesHTML = `
            <tr><td colspan="2"><strong>Baseline Data Analysis${dataLabelSuffix}</strong></td></tr>
            <tr><td>Total Days in Period (from inputs)</td><td>${totalDays.toFixed(0)} days</td></tr>
            <tr><td>Annualized Total Consumption (Grid Imports + Self-Consumed Solar)</td><td>${(totalConsumption * annualizationFactor).toFixed(2)} kWh</td></tr>
            <tr><td>Annualized Total Solar Generation (Initial Degradation Applied)</td><td>${(initialDegradedTotalSolar * annualizationFactor).toFixed(2)} kWh</td></tr>
            <tr><td>Annualized Total Self-Consumed Solar (Generation - Exports)</td><td>${(totalSelfConsumed * annualizationFactor).toFixed(2)} kWh</td></tr>
            <tr><td>Annualized Total Imported from Grid</td><td>${(totalImport * annualizationFactor).toFixed(2)} kWh</td></tr>
            <tr><td>Annualized Total Exported to Grid</td><td>${(totalExport * annualizationFactor).toFixed(2)} kWh</td></tr>
        `;

    } else {
        // --- CSV Mode Calculations ---
        dataLabelSuffix = " (from CSV)";
        if (!state.electricityData || state.electricityData.length === 0 || !state.solarData || state.solarData.length === 0) {
            displayError("CSV mode requires both electricity and solar CSV files with overlapping dates.", errorId);
            if (shouldShow) hideAllDebugContainers();
            return;
        }

        let totalGridImports_csv = 0, totalGridExports_csv = 0, totalSolarGeneration_csv = 0;
        let totalDays_csv = 0;
        const solarDataMap = new Map(state.solarData.map(day => [day.date, day.hourly]));

        state.electricityData.forEach(day => {
            const dateKey = day.date;
            const hourlySolar = solarDataMap.get(dateKey);
            if (hourlySolar) { // Only process days with both usage and solar data.
                totalDays_csv++;
                totalSolarGeneration_csv += hourlySolar.reduce((a, b) => a + b, 0);
                totalGridImports_csv += day.consumption.reduce((a, b) => a + b, 0);
                totalGridExports_csv += day.feedIn.reduce((a, b) => a + b, 0);
            }
        });

        if (totalDays_csv === 0) {
            displayError("No overlapping data found between the two CSV files. Please ensure the date ranges are aligned.", errorId);
            if (shouldShow) hideAllDebugContainers();
            return;
        }

        const totalSelfConsumed_csv = totalSolarGeneration_csv - totalGridExports_csv;
        const totalConsumption_csv = totalSelfConsumed_csv + totalGridImports_csv;
        const annualizationFactor_csv = 365 / totalDays_csv;

        calculatedValuesHTML = `
            <tr><td colspan="2"><strong>Baseline Data Analysis${dataLabelSuffix}</strong></td></tr>
            <tr><td>Total Overlapping Days Analysed</td><td>${totalDays_csv} days</td></tr>
            <tr><td>Annualized Total Consumption (Grid Imports + Self-Consumed Solar)</td><td>${(totalConsumption_csv * annualizationFactor_csv).toFixed(2)} kWh</td></tr>
            <tr><td>Annualized Total Solar Generation</td><td>${(totalSolarGeneration_csv * annualizationFactor_csv).toFixed(2)} kWh</td></tr>
            <tr><td>Annualized Total Self-Consumed Solar (Generation - Exports)</td><td>${(totalSelfConsumed_csv * annualizationFactor_csv).toFixed(2)} kWh</td></tr>
            <tr><td>Annualized Total Imported from Grid (from Usage CSV)</td><td>${(totalGridImports_csv * annualizationFactor_csv).toFixed(2)} kWh</td></tr>
            <tr><td>Annualized Total Exported to Grid (from Usage CSV)</td><td>${(totalGridExports_csv * annualizationFactor_csv).toFixed(2)} kWh</td></tr>
        `;
    }

    // --- Build the final table HTML ---
    tableHTML += `
        <table>
            <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
            <tbody>
                <tr><td colspan="2"><strong>Existing System Inputs</strong></td></tr>
                <tr><td>Existing Solar Panel Size (kW)</td><td>${config.existingSolarKW}</td></tr>
                <tr><td>Existing Solar Inverter Size (kW)</td><td>${config.existingSolarInverterKW}</td></tr>
                <tr><td>Is Hybrid Inverter</td><td>${config.isHybridInverter ? 'Yes' : 'No'}</td></tr>
                <tr><td>Existing Battery Size (kWh)</td><td>${config.existingBattery}</td></tr>
                <tr><td>Existing Battery Inverter (kW)</td><td>${config.existingBatteryInverter}</td></tr>
                <tr><td>Existing System Age (Years)</td><td>${config.existingSystemAge}</td></tr>
                ${calculatedValuesHTML} 
            </tbody>
        </table>`;

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
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;

    const debugContainer = document.getElementById("providersDebugTableContainer");
    let tableHTML = "<h3>Provider & Tariff Inputs</h3>";
    const errorId = "provider-selection-error";
    clearError(errorId); // Clear previous errors first

    const config = gatherConfigFromUI();
    const useManual = config.useManual;

    if (!useManual && (!state.electricityData || state.electricityData.length === 0)) {
        displayError("CSV mode requires uploaded data to calculate seasonal averages.", errorId);
        if (shouldShow) hideAllDebugContainers();
        return;
    }
    if (config.selectedProviders.length === 0) {
        displayError("Please select at least one provider.", errorId);
        if (shouldShow) hideAllDebugContainers();
        return;
    }

    let seasonalDailyAverages = {}; // To store calculated daily averages

    // --- Part 1: Render the Household Consumption Averages Table ---
    if (useManual) {
        // --- Manual Mode: Calculate and display daily averages derived from user totals ---
        tableHTML += `<table data-report-section="household-avg"><thead><tr><th colspan="2" class="provider-header-cell"><strong>Calculated Household Daily Averages (from Manual Totals)</strong></th></tr></thead><tbody>`;
        let validDataFound = false;
        for (const q in config.manualData) {
            const quarter = config.manualData[q];
            const seasonName = q.split('_')[1];
            const daysInQ = quarter.days || (config.manualTotalDays / 4);

            if (daysInQ > 0) {
                validDataFound = true;
                const avgPeakImport = quarter.totalPeakImport / daysInQ;
                const avgShoulderImport = quarter.totalShoulderImport / daysInQ;
                const avgOffPeakImport = quarter.totalOffPeakImport / daysInQ;
                const avgSolar = quarter.totalSolar / daysInQ;
                const avgExport = quarter.totalExport / daysInQ;
                const avgControlledLoad = quarter.totalControlledLoad / daysInQ;

                // Store for later use in calculateSeasonalAverages
                seasonalDailyAverages[q] = { avgPeakImport, avgShoulderImport, avgOffPeakImport, avgSolar, avgExport, avgControlledLoad, days: daysInQ };

                // Display these derived averages
                tableHTML += `<tr><td>${seasonName} Avg Peak Import</td><td>${avgPeakImport.toFixed(2)} kWh</td></tr>`;
                tableHTML += `<tr><td>${seasonName} Avg Shoulder Import</td><td>${avgShoulderImport.toFixed(2)} kWh</td></tr>`;
                tableHTML += `<tr><td>${seasonName} Avg Off-Peak Import</td><td>${avgOffPeakImport.toFixed(2)} kWh</td></tr>`;
                tableHTML += `<tr><td>${seasonName} Avg Solar Generation</td><td>${avgSolar.toFixed(2)} kWh</td></tr>`;
                tableHTML += `<tr><td>${seasonName} Avg Export</td><td>${avgExport.toFixed(2)} kWh</td></tr>`;
                tableHTML += `<tr><td>${seasonName} Avg Controlled Load</td><td>${avgControlledLoad.toFixed(2)} kWh</td></tr>`;
            }
        }
        tableHTML += `</tbody></table>`;
        if (!validDataFound) {
             displayError("Please enter valid totals and days for at least one season in Manual Mode.", errorId);
             if (shouldShow) hideAllDebugContainers();
             return;
        }

    } else {
        // --- CSV Mode: Use existing logic with state.quarterlyAverages ---
        const touHours = determineTouHours(config);
        state.touHoursForAnalysis = touHours;
        if (!state.quarterlyAverages) { // Ensure averages are calculated if not already
             getSimulationData(touHours, state.electricityData);
        }

        if (state.quarterlyAverages) {
            const peakStr = formatHoursToRanges(touHours.peak);
            const shoulderStr = formatHoursToRanges(touHours.shoulder);
            const allHours = new Set(Array.from({ length: 24 }, (_, i) => i));
            touHours.peak.forEach(h => allHours.delete(h));
            touHours.shoulder.forEach(h => allHours.delete(h));
            const offPeakHours = Array.from(allHours);
            const offPeakStr = formatHoursToRanges(offPeakHours);

             tableHTML += `
                <p class="pdf-export-note" data-report-note="provider-note" style="font-size: 0.9em; font-style: italic; border: 1px solid #f0ad4e; padding: 10px; border-radius: 5px; background-color: #fcf8e3;">
                <strong>Important Note:</strong> The daily averages in this table are calculated from <strong>isolated daily simulations</strong> and are for diagnostic purposes... [rest of note] ...
                </p>
                <p style="font-size: 0.85em; font-style: italic; color: #666; margin-top: 2px;">
                    Note: The periods below are based on the tariff rules of the first provider... [rest of note] ...
                </p>
            `;
            tableHTML += `<table data-report-section="household-avg"><thead><tr><th colspan="2" class="provider-header-cell"><strong>Total Household Consumption Quarterly Averages (Daily - CSV)</strong></th></tr></thead><tbody>`;
            for (const quarterKey in state.quarterlyAverages) {
                const q = state.quarterlyAverages[quarterKey];
                const seasonName = quarterKey.split('_')[1];
                tableHTML += `<tr><td>${seasonName} Avg Peak <span class="hour-display">(${peakStr})</span></td><td>${(q.avgPeak).toFixed(2)} kWh</td></tr>`;
                tableHTML += `<tr><td>${seasonName} Avg Shoulder <span class="hour-display">(${shoulderStr})</span></td><td>${(q.avgShoulder).toFixed(2)} kWh</td></tr>`;
                tableHTML += `<tr><td>${seasonName} Avg Off-Peak <span class="hour-display">(${offPeakStr})</span></td><td>${(q.avgOffPeak).toFixed(2)} kWh</td></tr>`;
                tableHTML += `<tr><td>${seasonName} Avg Solar</td><td>${(q.avgSolar).toFixed(2)} kWh</td></tr>`;
            }
            tableHTML += `</tbody></table>`;
        } else {
             displayError("Could not calculate quarterly averages from CSV data.", errorId);
             if (shouldShow) hideAllDebugContainers();
             return;
        }
    }

    // --- Part 2: Render the Provider-Specific Simulation Averages ---
    config.selectedProviders.forEach(pKey => {
        const providerConfig = config.providers.find(p => p.id === pKey);
        if (!providerConfig) return;

        // Add a wrapper div for PDF export grouping
        tableHTML += `<div data-report-section="provider-avg">`;
        tableHTML += `<h4 style="margin-top:20px;">${providerConfig.name}</h4>`;

        // Run the simulation using appropriate data source
        const simulationAverages = calculateSeasonalAverages(
            providerConfig,
            config,
            useManual ? seasonalDailyAverages : state.quarterlyAverages, // Pass the correct data
            useManual // Pass mode flag
        );

        tableHTML += `<table><thead><tr><th>Season</th><th>Avg Daily Solar Charge (kWh)</th><th>Avg Daily Grid Charge (kWh)</th><th>Avg SOC at 6am (%)</th></tr></thead><tbody>`;
        for (const seasonName in simulationAverages) { // Use standard season names
            const data = simulationAverages[seasonName];
            // Ensure data exists before trying to access properties
            if (data) {
                tableHTML += `<tr><td>${seasonName}</td><td>${(data.avgSolarCharge || 0).toFixed(2)}</td><td>${(data.avgGridCharge || 0).toFixed(2)}</td><td>${(data.avgSocPercent || 0).toFixed(1)}%</td></tr>`;
            } else {
                tableHTML += `<tr><td>${seasonName}</td><td>N/A</td><td>N/A</td><td>N/A</td></tr>`; // Handle missing season data
            }
        }
        tableHTML += `</tbody></table>`;
        tableHTML += `</div>`; // Close wrapper div
    });

    if (debugContainer) debugContainer.innerHTML = tableHTML;

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