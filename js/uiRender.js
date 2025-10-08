// js/uiRender.js
// Version 1.1.1
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
 * A helper function to build the HTML for the raw data tables shown in the results section.
 * These tables summarize the year 1 performance, broken down by season.
 * @param {object} data - The raw seasonal data to display.
 * @returns {string} The complete HTML string for the table.
 */
function buildRawDataTable(data) {
    let tableHTML = `<table class="raw-data-table">
        <thead>
            <tr>
                <th>Period</th>
                <th>Days</th>
                <th>Peak (kWh)</th>
                <th>Shoulder (kWh)</th>
                <th>Off-Peak (kWh)</th>
                <th>Grid Charge (kWh)</th>
                <th>Export Tier 1 (kWh)</th>
                <th>Export Tier 2 (kWh)</th>
            </tr>
        </thead>
        <tbody>`;
    
    // Aggregate totals for the annual summary row.
    let totalDays = 0, totalPeakKWh = 0, totalShoulderKWh = 0, totalOffPeakKWh = 0;
    let totalGridChargeKWh = 0, totalTier1ExportKWh = 0, totalTier2ExportKWh = 0;

    // Create a row for each season.
    for (const seasonName in data) {
        const seasonData = data[seasonName];
        if (seasonData && seasonData.days > 0) {
            totalDays += seasonData.days || 0;
            totalPeakKWh += seasonData.peakKWh || 0;
            totalShoulderKWh += seasonData.shoulderKWh || 0;
            totalOffPeakKWh += seasonData.offPeakKWh || 0;
            totalGridChargeKWh += seasonData.gridChargeKWh || 0;
            totalTier1ExportKWh += seasonData.tier1ExportKWh || 0;
            totalTier2ExportKWh += seasonData.tier2ExportKWh || 0;

            tableHTML += `
                <tr>
                    <td>${seasonName}</td>
                    <td>${seasonData.days}</td>
                    <td>${(seasonData.peakKWh || 0).toFixed(2)}</td>
                    <td>${(seasonData.shoulderKWh || 0).toFixed(2)}</td>
                    <td>${(seasonData.offPeakKWh || 0).toFixed(2)}</td>
                    <td>${(seasonData.gridChargeKWh || 0).toFixed(2)}</td>
                    <td>${(seasonData.tier1ExportKWh || 0).toFixed(2)}</td>
                    <td>${(seasonData.tier2ExportKWh || 0).toFixed(2)}</td>
                </tr>`;
        }
    }

    // Add the final "Annual Total" row.
    tableHTML += `
        <tr class="total-row">
            <td><strong>Annual Total</strong></td>
            <td><strong>${totalDays}</strong></td>
            <td><strong>${totalPeakKWh.toFixed(2)}</strong></td>
            <td><strong>${totalShoulderKWh.toFixed(2)}</strong></td>
            <td><strong>${totalOffPeakKWh.toFixed(2)}</strong></td>
            <td><strong>${totalGridChargeKWh.toFixed(2)}</strong></td>
            <td><strong>${totalTier1ExportKWh.toFixed(2)}</strong></td>
            <td><strong>${totalTier2ExportKWh.toFixed(2)}</strong></td>
        </tr>`;

    tableHTML += `</tbody></table>`;
    return tableHTML;
}

/**
 * Renders the results of the system sizing calculation into the UI.
 * @param {object} sizingResults - The complete sizing results object from the analysis module.
 * @param {object} state - The global application state.
 */
export function renderSizingResults(sizingResults, state) {
    const recommendationContainer = document.getElementById('recommendationContainer');
    if (!recommendationContainer) return;

    const { heuristic, detailed, blackout } = sizingResults;
    let recommendationHTML = `<div class="recommendation-section">`;

    // Display the simple heuristic-based recommendation.
    if (heuristic) {
        recommendationHTML += `
            <h4>Heuristic Sizing (based on ${heuristic.coverageTarget}% annual coverage)</h4>
            <p>
                <strong>Recommended Solar: ${heuristic.solar.toFixed(1)} kW</strong><br>
                <strong>Recommended Battery: ${heuristic.battery.toFixed(1)} kWh</strong><br>
                <strong>Recommended Inverter: ${heuristic.inverter.toFixed(1)} kW</strong>
            </p>`;
    }

    // Display the more advanced, data-driven recommendation.
    if (detailed) {
        recommendationHTML += `<hr>
            <h4>Detailed Sizing (based on 90th percentile of daily load)</h4>
            <p>
                <strong>Recommended Battery Capacity: ${detailed.recommendedBatteryKWh} kWh</strong><br>
                <small><em>This would have fully covered peak period needs on ${detailed.batteryCoverageDays} of ${detailed.totalDays} days.</em></small>
            </p>
            <p>
                <strong>Recommended Inverter Power: ${detailed.recommendedInverterKW.toFixed(1)} kW</strong><br>
                <small><em>This would have met max power demand on ${detailed.inverterCoverageDays} of ${detailed.totalDays} days.</em></small>
            </p>`;
    }

    // Display the blackout protection sizing add-on, if calculated.
    if (blackout) {
        recommendationHTML += `<hr>
            <h4>Blackout Protection Sizing</h4>
            <p>
                A reserve of <strong>${blackout.requiredReserve.toFixed(2)} kWh</strong> is needed for your specified blackout scenario.
            </p>
            <p>
                <strong>Total Recommended Practical Size (Savings + Blackout):</strong><br>
                ${detailed.recommendedBatteryKWh} kWh + ${blackout.requiredReserve.toFixed(2)} kWh = ${blackout.totalCalculatedSize.toFixed(2)} kWh.
                The next largest standard size is <strong>${blackout.practicalSize} kWh</strong>.
            </p>`;
    }
    
    recommendationHTML += `</div>`;
    recommendationContainer.innerHTML = recommendationHTML;

    // Add the canvas elements for the histograms to the DOM.
    const newSystemEstimatesTable = document.getElementById("newSystemEstimatesTable");
    if (newSystemEstimatesTable) {
        newSystemEstimatesTable.innerHTML = `
            <details class="collapsible-histogram" open><summary>📊 Daily Peak Period Load Distribution</summary><canvas id="peakPeriodHistogram"></canvas></details>
            <details class="collapsible-histogram" open><summary>📊 Daily Maximum Hourly Load Distribution</summary><canvas id="maxHourlyHistogram"></canvas></details>`;
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
 * Renders the raw data tables for Year 1 performance (baseline vs. system).
 * @param {object} rawData - The raw simulation output data.
 * @param {object} config - The configuration object.
 */
function renderRawDataTables(rawData, config) {
    const container = document.getElementById('raw-data-tables-container');
    if (!container) return;

    let tablesHTML = '';

    // Render the baseline performance table.
    const baselineProviderDetails = config.providers.find(p => p.id === config.selectedProviders[0]);
    if (rawData.baseline?.year1 && baselineProviderDetails) {
        tablesHTML += `<h3>Baseline Performance (Year 1)</h3>`;
        tablesHTML += buildRawDataTable(rawData.baseline.year1);
    }
    
    // Render a performance table for each provider's simulation.
    Object.keys(rawData.system).forEach(providerId => {
        const providerDetails = config.providers.find(p => p.id === providerId);
        if (!providerDetails) return;

        const providerSystemData = rawData.system[providerId];
        if (providerSystemData?.year1) {
            tablesHTML += `<h3>${providerDetails.name} - System Performance (Year 1)</h3>`;
            tablesHTML += buildRawDataTable(providerSystemData.year1);
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