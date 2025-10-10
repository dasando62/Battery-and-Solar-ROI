// js/uiRender.js
// Version 1.1.4
// This module is responsible for all UI rendering that occurs AFTER a calculation
// or analysis is complete. This includes displaying financial results tables,
// rendering charts, and showing system sizing recommendations.

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
import { formatHoursToRanges } from './utils.js';

/**
 * Renders or updates the two distribution histogram charts in the sizing recommendation section.
 * This version includes a fix to destroy old chart instances before creating new ones,
 * preventing memory leaks and rendering glitches on recalculation.
 * @param {object} distributions - An object containing the data arrays for the charts.
 * @param {object} state - The global application state, used to store chart instances.
 */
export function drawDistributionCharts(distributions, state) {
    if (!distributions) return;

    const { peakPeriod: dailyPeakPeriodData, maxHourly: dailyMaxHourData } = distributions;

    // --- Chart 1: Peak Period Load Distribution ---
    const ctx1 = document.getElementById("peakPeriodHistogram")?.getContext("2d");
    if (ctx1) {
        // Destroy the previous chart instance if it exists to prevent conflicts.
        if (state.peakPeriodChart) {
            state.peakPeriodChart.destroy();
        }

        // --- Binning Logic: Group daily data into 10 columns for the histogram ---
        const maxPeakPeriod = Math.max(...dailyPeakPeriodData);
        const binSize1 = Math.ceil(maxPeakPeriod / 10) || 1; // Calculate bin width.
        const bins1 = Array.from({ length: 10 }, (_, i) => ({ 
            label: `${i * binSize1}-${(i + 1) * binSize1} kWh`, 
            count: 0 
        }));
        // Count how many days fall into each bin.
        dailyPeakPeriodData.forEach(v => { 
            const binIndex = Math.min(Math.floor(v / binSize1), 9); 
            if (bins1[binIndex]) bins1[binIndex].count++; 
        });

        // Create the new Chart.js instance.
        state.peakPeriodChart = new Chart(ctx1, { 
            type: 'bar', 
            data: { 
                labels: bins1.map(b => b.label), 
                datasets: [{ label: "Days", data: bins1.map(b => b.count), backgroundColor: "rgba(54,162,235,0.6)" }] 
            }, 
            options: { plugins: { title: { display: true, text: 'Daily Peak Period Load Distribution' } } } 
        }); 
    }

    // --- Chart 2: Maximum Hourly Load Distribution ---
    const ctx2 = document.getElementById("maxHourlyHistogram")?.getContext("2d");
    if (ctx2) { 
        if (state.maxHourlyChart) {
            state.maxHourlyChart.destroy();
        }

        // --- Binning Logic for the second chart ---
        const maxHourly = Math.max(...dailyMaxHourData);
        const binSize2 = (Math.ceil(maxHourly / 10 * 10) / 10) || 1; // Calculate bin width.
        const bins2 = Array.from({ length: 10 }, (_, i) => ({ 
            label: `${(i * binSize2).toFixed(1)}-${((i + 1) * binSize2).toFixed(1)} kW`, 
            count: 0 
        }));
        dailyMaxHourData.forEach(v => { 
            const binIndex = Math.min(Math.floor(v / binSize2), 9); 
            if (bins2[binIndex]) bins2[binIndex].count++; 
        });

        // Create the new Chart.js instance.
        state.maxHourlyChart = new Chart(ctx2, { 
            type: 'bar', 
            data: { 
                labels: bins2.map(b => b.label), 
                datasets: [{ label: "Days", data: bins2.map(b => b.count), backgroundColor: "rgba(255,159,64,0.6)" }] 
            }, 
            options: { plugins: { title: { display: true, text: 'Daily Maximum Hourly Load Distribution' } } } 
        }); 
    }
}

/**
 * A helper function that builds the HTML for a single raw data table. It dynamically
 * adjusts its columns based on whether the provider has a flat-rate import tariff
 * and/or a tiered export tariff.
 * @param {object} data - The raw seasonal data for a single simulation.
 * @param {boolean} [isFlatRate=false] - A flag indicating a flat-rate import tariff.
 * @param {boolean} [hasTieredExport=false] - A flag indicating a tiered export tariff.
 * @returns {string} The complete HTML string for the table.
 */
function buildRawDataTable(data, isFlatRate = false, hasTieredExport = false) {
    let tableHTML = `<table class="raw-data-table"><thead><tr>`;
    
    // --- Dynamically Build Headers ---
    tableHTML += `<th>Period</th><th>Days</th>`;
    if (isFlatRate) {
        tableHTML += `<th>Grid Import (kWh)</th>`;
    } else {
        tableHTML += `<th>Peak (kWh)</th><th>Shoulder (kWh)</th><th>Off-Peak (kWh)</th>`;
    }
    tableHTML += `<th>Grid Charge (kWh)</th>`;
    if (hasTieredExport) {
        tableHTML += `<th>Export Tier 1 (kWh)</th><th>Export Tier 2 (kWh)</th>`;
    } else {
        tableHTML += `<th>Grid Export (kWh)</th>`;
    }
    tableHTML += `</tr></thead><tbody>`;
    
    // --- Dynamically Build Body Rows ---
    // Initialize totals for the summary row.
    let totals = { days: 0, peak: 0, shoulder: 0, offPeak: 0, gridCharge: 0, tier1: 0, tier2: 0 };
    
    for (const seasonName in data) {
        const seasonData = data[seasonName];
        if (seasonData && seasonData.days > 0) {
            // Aggregate totals for the annual summary.
            totals.days += seasonData.days || 0;
            totals.peak += seasonData.peakKWh || 0;
            totals.shoulder += seasonData.shoulderKWh || 0;
            totals.offPeak += seasonData.offPeakKWh || 0;
            totals.gridCharge += seasonData.gridChargeKWh || 0;
            totals.tier1 += seasonData.tier1ExportKWh || 0;
            totals.tier2 += seasonData.tier2ExportKWh || 0;
            
            // Build the table row for the season.
            tableHTML += `<tr><td>${seasonName}</td><td>${seasonData.days}</td>`;
            if (isFlatRate) {
                const totalImport = (seasonData.peakKWh || 0) + (seasonData.shoulderKWh || 0) + (seasonData.offPeakKWh || 0);
                tableHTML += `<td>${totalImport.toFixed(2)}</td>`;
            } else {
                tableHTML += `<td>${(seasonData.peakKWh || 0).toFixed(2)}</td><td>${(seasonData.shoulderKWh || 0).toFixed(2)}</td><td>${(seasonData.offPeakKWh || 0).toFixed(2)}</td>`;
            }
            tableHTML += `<td>${(seasonData.gridChargeKWh || 0).toFixed(2)}</td>`;
            if (hasTieredExport) {
                tableHTML += `<td>${(seasonData.tier1ExportKWh || 0).toFixed(2)}</td><td>${(seasonData.tier2ExportKWh || 0).toFixed(2)}</td>`;
            } else {
                const totalExport = (seasonData.tier1ExportKWh || 0) + (seasonData.tier2ExportKWh || 0);
                tableHTML += `<td>${totalExport.toFixed(2)}</td>`;
            }
            tableHTML += `</tr>`;
        }
    }

    // --- Dynamically Build Total Row ---
    tableHTML += `<tr class="total-row"><td><strong>Annual Total</strong></td><td><strong>${totals.days}</strong></td>`;
    if (isFlatRate) {
        const totalImport = totals.peak + totals.shoulder + totals.offPeak;
        tableHTML += `<td><strong>${totalImport.toFixed(2)}</strong></td>`;
    } else {
        tableHTML += `<td><strong>${totals.peak.toFixed(2)}</strong></td><td><strong>${totals.shoulder.toFixed(2)}</strong></td><td><strong>${totals.offPeak.toFixed(2)}</strong></td>`;
    }
    tableHTML += `<td><strong>${totals.gridCharge.toFixed(2)}</strong></td>`;
    if (hasTieredExport) {
        tableHTML += `<td><strong>${totals.tier1.toFixed(2)}</strong></td><td><strong>${totals.tier2.toFixed(2)}</strong></td>`;
    } else {
        const totalExport = totals.tier1 + totals.tier2;
        tableHTML += `<td><strong>${totalExport.toFixed(2)}</strong></td>`;
    }
    tableHTML += `</tr></tbody></table>`;

    return tableHTML;
}

/**
 * Renders the results of the system sizing calculation into the UI. It builds a
 * user-friendly HTML summary of the different sizing recommendations (Heuristic,
 * Detailed, and Blackout protection) and adds the canvas elements for the
 * distribution charts.
 * @param {object} sizingResults - The complete sizing results object from the analysis module.
 * @param {object} state - The global application state, used to access config and TOU hours.
 */
export function renderSizingResults(sizingResults, state) {
    // Get the container where the recommendations will be displayed.
    const recommendationContainer = document.getElementById('recommendationContainer');
    if (!recommendationContainer) return;

    // Destructure the results object for easier access.
    const { heuristic, detailed, blackout } = sizingResults;
    // Get the analysis configuration to access user inputs (e.g., for blackout text).
    const config = state.analysisConfig;
    let recommendationHTML = `<div class="recommendation-section">`;

    // --- Block 1: Build the Heuristic Sizing Recommendation ---
    if (heuristic) {
        recommendationHTML += `
            <h4>Heuristic Sizing</h4>
            
            <p style="font-size:0.9em; font-style:italic; margin-top:-5px;">This is a general recommendation based on the <strong>Energy Self-Sufficiency</strong> target you set. It aims to size a system that would generate that percentage of your total annual energy consumption.</p>

            <p>
                <strong>Recommended Solar: ${heuristic.solar.toFixed(1)} kW</strong><br>
                <strong>Recommended Battery: ${heuristic.battery.toFixed(1)} kWh</strong><br>
                <strong>Recommended Inverter: ${heuristic.inverter.toFixed(1)} kW</strong>
            </p>`;
    }

    // --- Block 2: Build the Detailed Sizing Recommendation ---
    if (detailed) {
        // Get the peak hours used for the analysis from the global state and format them for display.
        const peakHoursString = formatHoursToRanges(state.touHoursForAnalysis?.peak || []);
        recommendationHTML += `<hr>
            <h4>Detailed Sizing</h4>

            <p style="font-size:0.9em; font-style:italic; margin-top:-5px;">This is an advanced recommendation that analyzes your day-to-day historical usage. It sizes the battery and inverter to handle your typical <strong>high-usage days</strong>, not just your overall average.</p>

            <p>
                <strong>Recommended Battery Capacity: ${detailed.recommendedBatteryKWh} kWh</strong><br>
                <small><em>This recommendation is based on your total consumption during the Peak Period (currently <strong>${peakHoursString}</strong>) and would have covered your needs on ${detailed.batteryCoverageDays} of ${detailed.totalDays} analyzed days.</em></small>
            </p>
            <p>
                <strong>Recommended Inverter Power: ${detailed.recommendedInverterKW.toFixed(1)} kW</strong><br>
                <small><em>This would have met max power demand on ${detailed.inverterCoverageDays} of ${detailed.totalDays} days.</em></small>
            </p>`;
    }

    // --- Block 3: Build the Blackout Protection Sizing ---
    if (blackout && config) {
        // Get the user's specific blackout settings to make the text dynamic.
        const duration = config.blackoutDuration;
        const coverage = config.blackoutCoverage * 100;
        recommendationHTML += `<hr>
            <h4>Blackout Protection Sizing</h4>
            <p>
                A reserve of <strong>${blackout.requiredReserve.toFixed(2)} kWh</strong> is needed to cover you for a <strong>${duration}-hour</strong> blackout, catering for <strong>${coverage}%</strong> of your maximum historical consumption during such a period.
            </p>
            
            <p>
                <strong>Total Recommended Practical Size (Savings + Blackout):</strong><br>
                ${detailed.recommendedBatteryKWh} kWh + ${blackout.requiredReserve.toFixed(2)} kWh = ${blackout.totalCalculatedSize.toFixed(2)} kWh.
                The next largest standard size is <strong>${blackout.practicalSize} kWh</strong>.
            </p>`;
    }
    
    // Close the main container div.
    recommendationHTML += `</div>`;
    // Inject the complete HTML string into the recommendation container on the page.
    recommendationContainer.innerHTML = recommendationHTML;

    // Finally, add the canvas elements to the DOM, preparing them for the charts to be drawn.
    const newSystemEstimatesTable = document.getElementById("newSystemEstimatesTable");
    if (newSystemEstimatesTable) {
        newSystemEstimatesTable.innerHTML = `
            <details class="collapsible-histogram" open><summary>📊 Daily Peak Period Load Distribution</summary>
				<p style="font-size: 0.9em; font-style: italic; margin: 5px 10px; color: #555;">
				This chart shows how frequently you have high-demand evenings. It groups the days from your historical data based on the total amount of electricity <b>(in kWh)</b> you consumed during the 'peak' hours (as defined by your first selected provider's tariff, or 3pm-11pm if the tariff does not specify a peak period). This visualization is the primary data used to recommend your ideal <b>battery capacity (kWh)</b>, ensuring it's large enough to store the energy you need for your typical peak periods.
                </p>
			<canvas id="peakPeriodHistogram"></canvas></details>
            <details class="collapsible-histogram" open><summary>📊 Daily Maximum Hourly Load Distribution</summary>
				<p style="font-size: 0.9em; font-style: italic; margin: 5px 10px; color: #555;">
				This chart shows the peak power you demand from your system. For each day in your history, it finds the single hour where you drew the most power <b>(in kW)</b> from the grid or battery after your solar panels were used first. This reveals your typical peak power needs and is used to recommend the appropriate <b>inverter size (kW)</b>, ensuring it's powerful enough to handle your highest-demand moments.
                </p>
			<canvas id="maxHourlyHistogram"></canvas></details>`;
    }
}

/**
 * Renders the high-level financial summary box (Payback, NPV, IRR).
 * @param {object} financials - The financial results object.
 * @param {object} config - The configuration object used for the analysis.
 */
function renderFinancialSummary(financials, config) {
    let summaryHTML = "<h3>Return on Investment Summary</h3>";
    config.selectedProviders.forEach(pKey => {
        const providerDetails = config.providers.find(p => p.id === pKey);
		if (!providerDetails) return;
        const result = financials[pKey];
        if (!result) return;
        
        // Calculate final NPV, accounting for the initial investment.
        const systemCostForProvider = config.initialSystemCost - (providerDetails.rebate || 0);
        const finalNPV = result.npv - systemCostForProvider;

        summaryHTML += `<p><strong>${providerDetails.name}</strong></p>
            <ul>
                <li>Payback Period: Year ${result.roiYear ? result.roiYear : `> ${config.numYears}`}</li>
                ${config.discountRateEnabled ? `<li>Net Present Value (NPV): <strong>$${finalNPV.toFixed(2)}</strong></li>` : ''}
                ${result.irr !== null ? `<li>Internal Rate of Return (IRR): <strong>${result.irr.toFixed(2)}%</strong></li>` : ''}
            </ul>`;
    });
    document.getElementById("roiSummary").innerHTML = summaryHTML;
}

/**
 * Renders the detailed year-by-year financial breakdown table.
 * @param {object} financials - The financial results object.
 * @param {Array} baselineCosts - The calculated annual baseline costs.
 * @param {object} config - The configuration object.
 */
function renderFinancialTable(financials, baselineCosts, config) {
    // Get the name of the first provider to label the baseline column.
    const baselineProviderDetails = config.providers.find(p => p.id === config.selectedProviders[0]);
    const baselineProviderName = baselineProviderDetails ? baselineProviderDetails.name : "Baseline";

    // Build table headers.
    let tableHTML = `<h3>Financial Breakdown by Year</h3><table><thead><tr><th>Year</th><th>Baseline Cost (${baselineProviderName})</th>`;
    config.selectedProviders.forEach(pKey => {
        const providerDetails = config.providers.find(p => p.id === pKey);
        if (providerDetails) {
            tableHTML += `<th>${providerDetails.name} Cost w/ System</th><th>${providerDetails.name} Cumulative Net Cash Flow</th>`;
        }
    });
    tableHTML += `</tr></thead><tbody>`;

    // Build table body, one row for each year of the analysis.
    for (let y = 0; y < config.numYears; y++) {
        tableHTML += `<tr><td>${y + 1}</td><td>$${(baselineCosts[y + 1] || 0).toFixed(2)}</td>`;
        
        config.selectedProviders.forEach(pKey => {
            const result = financials[pKey];
            const annualCost = result?.annualCosts[y] || 0;
            const cumulativeSaving = result?.cumulativeSavingsPerYear[y] || 0;
            tableHTML += `<td>$${annualCost.toFixed(2)}</td><td>$${cumulativeSaving.toFixed(2)}</td>`;
        });
        tableHTML += "</tr>";
    }
    tableHTML += "</tbody></table>";
    document.getElementById("results").innerHTML = tableHTML;
}

/**
 * Renders the main cumulative savings line chart using Chart.js.
 * @param {object} financials - The financial results object.
 * @param {object} config - The configuration object.
 */
function renderCharts(financials, config) {
    // Destroy the old chart instance to prevent issues.
    if (state.savingsChart) {
        state.savingsChart.destroy();
    }
    const ctx = document.getElementById("savingsChart")?.getContext("2d");
    if (!ctx) return;

    // Create a dataset for each provider's cumulative savings.
    const datasets = config.selectedProviders.map(pKey => {
        const providerDetails = config.providers.find(p => p.id === pKey);
        if (!providerDetails) return null;

        return {
            label: `${providerDetails.name} Cumulative Savings`,
            data: financials[pKey]?.cumulativeSavingsPerYear || [],
            borderColor: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'), // Random color
            fill: false,
            yAxisID: 'y'
        };
    }).filter(Boolean);

    // Create a dashed line dataset for each provider representing their initial capital cost.
    const costDatasets = config.selectedProviders.map(pKey => {
        const providerDetails = config.providers.find(p => p.id === pKey);
        if (!providerDetails) return null;

        const systemCostForProvider = config.initialSystemCost - (providerDetails.rebate || 0);
        return {
            label: `${providerDetails.name} Capital Outlay`,
            data: Array(config.numYears).fill(systemCostForProvider),
            borderColor: datasets.find(ds => ds.label.startsWith(providerDetails.name))?.borderColor || '#ccc',
            borderDash: [5, 5], // Make it a dashed line
            fill: false,
            pointRadius: 0,
            yAxisID: 'y'
        };
    }).filter(Boolean);

    // Create the new Chart.js instance and store it in the global state.
    state.savingsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({ length: config.numYears }, (_, i) => `Year ${i + 1}`),
            datasets: [...datasets, ...costDatasets]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

/**
 * Renders the raw data tables for Year 1 performance, creating a separate table
 * for the baseline and for each selected provider's simulation. It intelligently
 * determines if a provider has a flat-rate import or a tiered export tariff and
 * instructs the table-building function to render the appropriate layout.
 * @param {object} rawData - The raw simulation output data from the analysis.
 * @param {object} config - The configuration object used for the analysis.
 */
function renderRawDataTables(rawData, config) {
    const container = document.getElementById('raw-data-tables-container');
    if (!container) return;

    let tablesHTML = '';

    // Check the baseline provider's tariff type for both import and export.
    const baselineProviderDetails = config.providers.find(p => p.id === config.selectedProviders[0]);
    if (rawData.baseline?.year1 && baselineProviderDetails) {
        // Check if there are NO 'tou' import rules.
        const isBaselineFlatRate = !(baselineProviderDetails.importRules || []).some(r => r.type === 'tou');
        // Check if there ARE 'tiered' export rules.
        const baselineHasTieredExport = (baselineProviderDetails.exportRules || []).some(r => r.type === 'tiered');
        
        tablesHTML += `<h3>Baseline Performance (Year 1)</h3>`;
        // Pass both flags to the table builder.
        tablesHTML += buildRawDataTable(rawData.baseline.year1, isBaselineFlatRate, baselineHasTieredExport);
    }
    
    // Repeat the checks for each simulated provider.
    Object.keys(rawData.system).forEach(providerId => {
        const providerDetails = config.providers.find(p => p.id === providerId);
        if (!providerDetails) return;

        const providerSystemData = rawData.system[providerId];
        if (providerSystemData?.year1) {
            const isProviderFlatRate = !(providerDetails.importRules || []).some(r => r.type === 'tou');
            const providerHasTieredExport = (providerDetails.exportRules || []).some(r => r.type === 'tiered');
            
            tablesHTML += `<h3>${providerDetails.name} - System Performance (Year 1)</h3>`;
            // Pass both flags to the table builder.
            tablesHTML += buildRawDataTable(providerSystemData.year1, isProviderFlatRate, providerHasTieredExport);
        }
    });

    container.innerHTML = tablesHTML;
}


/**
 * The main entry point for rendering all results after an analysis is complete.
 * It orchestrates calls to all other rendering functions in this module.
 * @param {object} resultsObject - The complete results object from the simulation.
 */
export function renderResults(resultsObject) {
    const { financials, rawData, config } = resultsObject;
    if (!financials || !config) {
        console.error("Render Results called with invalid data.", resultsObject);
        return;
    }
    // Call each rendering function in sequence.
    renderFinancialSummary(financials, config);
    renderFinancialTable(financials, financials.baselineCosts, config);
    renderCharts(financials, config);
	renderRawDataTables(rawData, config);

    // Make the export and debug buttons visible now that there are results.
    const exportControls = document.getElementById("export-controls");
    if (exportControls) exportControls.style.display = 'flex';

    const debugElem = document.getElementById('showRawDataDebug');
    if (debugElem) debugElem.style.display = 'inline-block';
}