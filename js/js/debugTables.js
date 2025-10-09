// js/debugTables.js
// Version 1.1.2
// This module contains all functions related to rendering the "Debug Tables".
// These tables provide transparency into the calculator's inputs, intermediate calculations,
// and simulation results, aiding in validation and troubleshooting.

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

import { 
	getNumericInput, 
	displayError, 
	clearError 
} from './utils.js';
import { 
	generateHourlyConsumptionProfileFromDailyTOU, 
	generateHourlySolarProfileFromDaily 
} from './profiles.js';
import { simulateDay, calculateSizingRecommendations, calculateDetailedSizing } from './analysis.js';
import { state } from './state.js';
import { renderSizingResults, drawDistributionCharts } from './uiRender.js';

/**
 * Hides all debug and results containers to provide a clean slate
 * before showing a new one.
 */
export function hideAllDebugContainers() {
    document.querySelectorAll('[id$="DebugTableContainer"], #sizing-recommendation-section').forEach(el => el.style.display = "none");
}

/**
 * Calculates seasonal averages for battery behavior (grid charging, morning SOC)
 * by simulating the entire provided dataset.
 * @param {object} provider - The provider configuration to use for the simulation.
 * @param {object} batteryConfig - The battery configuration.
 * @param {object} state - The global application state containing electricity and solar data.
 * @returns {object} An object with calculated averages for each season.
 */
function calculateSeasonalAverages(provider, batteryConfig, state) {
    // Initialize data structure to hold results.
    const seasonalData = {
        Summer: { totalGridCharge: 0, totalSocAt6am: 0, days: 0 },
        Autumn: { totalGridCharge: 0, totalSocAt6am: 0, days: 0 },
        Winter: { totalGridCharge: 0, totalSocAt6am: 0, days: 0 },
        Spring: { totalGridCharge: 0, totalSocAt6am: 0, days: 0 },
    };

    if (!state.electricityData || state.electricityData.length === 0) {
        return seasonalData; // Return empty structure if no data.
    }

    // Simulate day-by-day, carrying over the battery's state of charge.
    let currentSOC = batteryConfig.capacity * 0.5;
    const solarDataMap = new Map((state.solarData || []).map(d => [d.date, d.hourly]));

    state.electricityData.forEach(day => {
        const month = parseInt(day.date.split('-')[1], 10);
        let season;
        if ([12, 1, 2].includes(month)) season = 'Summer';
        else if ([3, 4, 5].includes(month)) season = 'Autumn';
        else if ([6, 7, 8].includes(month)) season = 'Winter';
        else season = 'Spring';

        const hourlySolar = solarDataMap.get(day.date) || Array(24).fill(0);
        
        // Reconstruct true household consumption (grid import + self-consumed solar).
        const trueHourlyConsumption = Array(24).fill(0);
        for (let h = 0; h < 24; h++) {
            const selfConsumed = Math.max(0, (hourlySolar[h] || 0) - (day.feedIn[h] || 0));
            trueHourlyConsumption[h] = (day.consumption[h] || 0) + selfConsumed;
        }

        // Run the simulation for the day.
        const simResults = simulateDay(trueHourlyConsumption, hourlySolar, provider, batteryConfig, currentSOC);
        currentSOC = simResults.finalSOC; // Update SOC for the next day.

        // Aggregate results for the correct season.
        if (seasonalData[season]) {
            seasonalData[season].totalGridCharge += simResults.dailyBreakdown.gridChargeKWh;
            seasonalData[season].totalSocAt6am += simResults.socAt6am;
            seasonalData[season].days++;
        }
    });

    // Calculate the final averages for each season.
    for (const season in seasonalData) {
        const data = seasonalData[season];
        data.avgGridCharge = data.days > 0 ? data.totalGridCharge / data.days : 0;
        const avgSocKWh = data.days > 0 ? data.totalSocAt6am / data.days : 0;
        data.avgSocPercent = batteryConfig.capacity > 0 ? (avgSocKWh / batteryConfig.capacity) * 100 : 0;
    }

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
    tableHTML += `<tr><td>Total Days Analyzed</td><td>${totalDays} days</td></tr>`;
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
            'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
            'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
            'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
            'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
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
 * Renders the "Providers Debug Table" which shows household consumption averages
 * and simulated battery performance (grid charging, SOC) for each selected provider.
 * @param {object} state - The global application state.
 * @param {boolean} [shouldShow=true] - Whether to display the container after rendering.
 */
export function renderProvidersDebugTable(state, shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;
    
    const debugContainer = document.getElementById("providersDebugTableContainer");
    let tableHTML = "<h3>Provider & Tariff Inputs</h3>";
	    tableHTML += `
      <p class="pdf-export-note" style="font-size: 0.9em; font-style: italic; border: 1px solid #f0ad4e; padding: 10px; border-radius: 5px; background-color: #fcf8e3;">
        <strong>Important Note:</strong> The daily averages in this table are calculated from <strong>isolated daily simulations</strong> and are for diagnostic purposes. They may differ from the final "System Performance" results, which use a more realistic, <strong>continuous simulation</strong> where the battery's state of charge carries over from one day to the next.
      </p>
    `;
    // This table's calculations require CSV data.
    const useManual = document.getElementById("manualInputToggle")?.checked;
    if (!useManual && (!state.electricityData || state.electricityData.length === 0)) {
        displayError("This debug table requires uploaded CSV data to calculate seasonal averages.", "provider-selection-error");
        return;
    }
    clearError("provider-selection-error");
    
    const config = state.analysisConfig;
    if (!config) return;

    // First, display the quarterly consumption averages for the household.
	if (state.quarterlyAverages) {
		tableHTML += `<table><thead><tr><th colspan="2" class="provider-header-cell"><strong>Total Household Consumption Quarterly Averages (Daily)</strong></th></tr></thead><tbody>`;
		for (const quarter in state.quarterlyAverages) {
			const q = state.quarterlyAverages[quarter];
			tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Peak</td><td>${(q.avgPeak).toFixed(2)} kWh</td></tr>`;
			tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Shoulder</td><td>${(q.avgShoulder).toFixed(2)} kWh</td></tr>`;
			tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Off-Peak</td><td>${(q.avgOffPeak).toFixed(2)} kWh</td></tr>`;
			tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Solar</td><td>${(q.avgSolar).toFixed(2)} kWh</td></tr>`;
		}
		tableHTML += `</tbody></table>`;
	}

    // Then, for each provider, show how the battery is expected to behave under their tariff.
    config.selectedProviders.forEach(pKey => {
        const providerConfig = config.providers.find(p => p.id === pKey);
        if (!providerConfig) return;
        tableHTML += `<h4 style="margin-top:20px;">${providerConfig.name}</h4>`;
        if (!useManual) {
            // Configure the full battery system for the simulation.
            const batteryConfig = {
                capacity: (config.replaceExistingSystem ? 0 : config.existingBattery) + config.newBatteryKWH,
                inverterKW: (config.replaceExistingSystem ? 0 : config.existingBatteryInverter) + config.newBatteryInverterKW,
                gridChargeThreshold: config.gridChargeThreshold,
                socChargeTrigger: config.socChargeTrigger
            };
            // Run the simulation to get seasonal battery stats.
            const seasonalAverages = calculateSeasonalAverages(providerConfig, batteryConfig, state);
            tableHTML += `<table><thead><tr><th>Season</th><th>Avg Daily Grid Charge (kWh)</th><th>Avg SOC at 6am (%)</th></tr></thead><tbody>`;
            for (const season in seasonalAverages) {
                const data = seasonalAverages[season];
                tableHTML += `<tr><td>${season}</td><td>${data.avgGridCharge.toFixed(2)}</td><td>${data.avgSocPercent.toFixed(1)}%</td></tr>`;
            }
            tableHTML += `</tbody></table>`;
        } else {
            tableHTML += `<p><em>Seasonal averages are only available in CSV mode.</em></p>`;
        }
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