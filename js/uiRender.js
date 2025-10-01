// js/uiRender.js
//Version 1.0.2
import { state } from './state.js';
import { createBreakdownTableHTML } from './debugTables.js';
import { getNumericInput } from './utils.js';
import { getDegradedFitRate } from './analysis.js';

// Replace the existing buildRawDataTable function in uiRender.js with this one
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
    
    // 1. Initialize variables to hold the totals
    let totalDays = 0, totalPeakKWh = 0, totalShoulderKWh = 0, totalOffPeakKWh = 0;
    let totalGridChargeKWh = 0, totalTier1ExportKWh = 0, totalTier2ExportKWh = 0;

    // Loop through each season (Summer, Autumn, etc.) in the data
    for (const seasonName in data) {
        const seasonData = data[seasonName];
        if (seasonData && seasonData.days > 0) {
            // 2. Add the current season's data to the running totals
            totalDays += seasonData.days || 0;
            totalPeakKWh += seasonData.peakKWh || 0;
            totalShoulderKWh += seasonData.shoulderKWh || 0;
            totalOffPeakKWh += seasonData.offPeakKWh || 0;
            totalGridChargeKWh += seasonData.gridChargeKWh || 0;
            totalTier1ExportKWh += seasonData.tier1ExportKWh || 0;
            totalTier2ExportKWh += seasonData.tier2ExportKWh || 0;

            // Render the individual season row (this is unchanged)
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

    // 3. Add the final "Annual Total" row to the table HTML
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

export function renderSizingResults(sizingData, state) {
    const recommendationContainer = document.getElementById('recommendationContainer');
    const estimatesContainer = document.getElementById('newSystemEstimatesTable');
    const recommendationSection = document.getElementById('sizing-recommendation-section');
    
    // --- 1. Build the Complete HTML for the Recommendations ---
    let recommendationHTML = `
        <div class="recommendation-section">
            <h4>Heuristic Sizing (based on ${sizingData.heuristic.coverageTarget}% annual coverage)</h4>
            <p>
                <strong>Recommended Solar: ${sizingData.heuristic.solar.toFixed(1)} kW</strong><br>
                <strong>Recommended Battery: ${sizingData.heuristic.battery.toFixed(1)} kWh</strong><br>
                <strong>Recommended Inverter: ${sizingData.heuristic.inverter.toFixed(1)} kW</strong>
            </p>
            <hr>
            <h4>Detailed Sizing (based on 90th percentile of daily load)</h4>
            <p>
                <strong>Recommended Battery Capacity: ${sizingData.detailed.recommendedBatteryKWh} kWh</strong><br>
                <small><em>This would have fully covered peak period needs on ${sizingData.detailed.batteryCoverageDays} of ${sizingData.detailed.totalDays} days.</em></small>
            </p>
            <p>
                <strong>Recommended Inverter Power: ${sizingData.detailed.recommendedInverterKW} kW</strong><br>
                <small><em>This would have met max power demand on ${sizingData.detailed.inverterCoverageDays} of ${sizingData.detailed.totalDays} days.</em></small>
            </p>
    `;

    // Conditionally add the blackout section if the data exists
    if (sizingData.blackout) {
        recommendationHTML += `
            <hr>
            <h4>Blackout Protection Sizing</h4>
            <p>
                For a <strong>${sizingData.blackout.duration}-hour</strong> blackout covering <strong>${sizingData.blackout.coverage * 100}%</strong> of usage, a reserve of <strong>${sizingData.blackout.requiredReserve.toFixed(2)} kWh</strong> is needed.
            </p>
            <p>
                <strong>Total Recommended Practical Size (Savings + Blackout):</strong><br>
                ${sizingData.detailed.recommendedBatteryKWh} kWh + ${sizingData.blackout.requiredReserve.toFixed(2)} kWh = ${sizingData.blackout.totalCalculatedSize.toFixed(2)} kWh.
                The next largest standard size is <strong>${sizingData.blackout.practicalSize} kWh</strong>.
            </p>
        `;
    }

    recommendationHTML += `</div>`;
    recommendationContainer.innerHTML = recommendationHTML;

    // --- 2. Add the HTML for the Chart Canvases ---
    estimatesContainer.innerHTML = `
        <details class="collapsible-histogram" open>
            <summary>📊 Daily Peak Period Load Distribution</summary>
            <canvas id="peakPeriodHistogram"></canvas>
        </details>
        <details class="collapsible-histogram" open>
            <summary>📊 Daily Maximum Hourly Load Distribution</summary>
            <canvas id="maxHourlyHistogram" style="margin-top: 30px;"></canvas>
        </details>
    `;

// --- 3. Render the Chart.js Histograms ---
	setTimeout(() => {
    if (state.peakPeriodChart) state.peakPeriodChart.destroy();
    const ctx1 = document.getElementById("peakPeriodHistogram")?.getContext("2d");
    if (ctx1) {
        state.peakPeriodChart = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: sizingData.histogramData.peakPeriod.map(b => b.label),
                datasets: [{
                    label: "Number of Days",
                    data: sizingData.histogramData.peakPeriod.map(b => b.count),
                    backgroundColor: "rgba(54, 162, 235, 0.6)"
                }]
            },
            options: { plugins: { title: { display: true, text: 'Peak Period Demand Histogram' } } }
        });
    }

    if (state.maxHourlyChart) state.maxHourlyChart.destroy();
    const ctx2 = document.getElementById("maxHourlyHistogram")?.getContext("2d");
    if (ctx2) {
        state.maxHourlyChart = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: sizingData.histogramData.maxHourly.map(b => b.label),
                datasets: [{
                    label: "Number of Days",
                    data: sizingData.histogramData.maxHourly.map(b => b.count),
                    backgroundColor: "rgba(255, 159, 64, 0.6)"
                }]
            },
            options: { plugins: { title: { display: true, text: 'Maximum Hourly Load Histogram' } } }
        });
    }
}, 0); // A zero-millisecond delay is all that's needed.

    // --- 4. Make the Section Visible ---
    recommendationSection.style.display = 'block';
}

function renderFinancialSummary(financials, config) {
    let summaryHTML = "<h3>Return on Investment Summary</h3>";
    config.selectedProviders.forEach(pKey => {
        const providerDetails = config.providers.find(p => p.id === pKey);
		if (!providerDetails) return;
        const result = financials[pKey];
        if (!result) return;
        
        const systemCostForProvider = config.initialSystemCost - (providerDetails.rebate || 0);

        // CORRECTED NPV Calculation: Subtract the full initial system cost.
        const finalNPV = result.npv - systemCostForProvider;

        summaryHTML += `<p><strong>${providerDetails.name}</strong></p><ul><li>Payback Period: Year ${result.roiYear ? result.roiYear : `> ${config.numYears}`}</li>${config.discountRateEnabled ? `<li>Net Present Value (NPV): <strong>$${finalNPV.toFixed(2)}</strong></li>` : ''}</ul>`;
    });
    document.getElementById("roiSummary").innerHTML = summaryHTML;
}

function renderFinancialTable(financials, baselineCosts, config) {
    // --- FIX 1: Use .find() to get the baseline provider object first ---
    const baselineProviderDetails = config.providers.find(p => p.id === config.selectedProviders[0]);
    const baselineProviderName = baselineProviderDetails ? baselineProviderDetails.name : "Baseline";

    let tableHTML = `<h3>Financial Breakdown by Year</h3><table><thead><tr><th>Year</th><th>Baseline Cost (${baselineProviderName})</th>`;

    // --- FIX 2: Use .find() inside the header loop to get each provider's name ---
    config.selectedProviders.forEach(pKey => {
        const providerDetails = config.providers.find(p => p.id === pKey);
        if (providerDetails) { // Safety check
            tableHTML += `<th>${providerDetails.name} Cost w/ System</th><th>${providerDetails.name} Cumulative Savings</th>`;
        }
    });

    tableHTML += `</tr></thead><tbody>`;
    for (let y = 0; y < config.numYears; y++) {
        tableHTML += `<tr><td>${y + 1}</td><td>$${(baselineCosts[y + 1] || 0).toFixed(2)}</td>`;
        
        config.selectedProviders.forEach(pKey => {
            // --- FIX 3: Removed the unnecessary and incorrect 'if (providerId === ...)' check ---
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

function renderCharts(financials, config) {
    if (state.savingsChart) {
        state.savingsChart.destroy();
    }
    const ctx = document.getElementById("savingsChart")?.getContext("2d");
    if (!ctx) return;

    const datasets = config.selectedProviders.map(pKey => {
        // --- FIX 1: Use .find() to get the provider's details ---
        const providerDetails = config.providers.find(p => p.id === pKey);
        if (!providerDetails) return null; // Safety check

        return {
            label: `${providerDetails.name} Cumulative Savings`,
            data: financials[pKey]?.cumulativeSavingsPerYear || [],
            borderColor: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
            fill: false,
            yAxisID: 'y'
        };
    }).filter(Boolean); // Removes any null entries if a provider wasn't found

    const costDatasets = config.selectedProviders.map(pKey => {
        // --- FIX 2: Use .find() here as well ---
        const providerDetails = config.providers.find(p => p.id === pKey);
        if (!providerDetails) return null; // Safety check

        const systemCostForProvider = config.initialSystemCost - (providerDetails.rebate || 0);
        return {
            label: `${providerDetails.name} Capital Outlay`,
            data: Array(config.numYears).fill(systemCostForProvider),
            borderColor: datasets.find(ds => ds.label.startsWith(providerDetails.name))?.borderColor || '#ccc',
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
            yAxisID: 'y'
        };
    }).filter(Boolean); // Removes any null entries

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

// Replace your existing renderRawDataTables function with this one
function renderRawDataTables(rawData, config) {
    const container = document.getElementById('raw-data-tables-container');
    if (!container) return;

    let tablesHTML = '';

    // Handle the 'baseline' data first
    const baselineProviderDetails = config.providers.find(p => p.id === config.selectedProviders[0]);
    if (rawData.baseline?.year1 && baselineProviderDetails) {
        tablesHTML += `<h3>Baseline Performance (Year 1)</h3>`;
        // --- FIX: Call the helper to generate the table HTML ---
        tablesHTML += buildRawDataTable(rawData.baseline.year1);
    }
    
    // Then, loop through the actual providers in rawData.system
    Object.keys(rawData.system).forEach(providerId => {
        const providerDetails = config.providers.find(p => p.id === providerId);
        if (!providerDetails) return;

        const providerSystemData = rawData.system[providerId];
        if (providerSystemData?.year1) {
            tablesHTML += `<h3>${providerDetails.name} - System Performance (Year 1)</h3>`;
            // --- FIX: Call the helper here too ---
            tablesHTML += buildRawDataTable(providerSystemData.year1);
        }
    });

    container.innerHTML = tablesHTML;
}

export function renderResults(resultsObject) {
    const { financials, rawData, config } = resultsObject;
    if (!financials || !config) {
        console.error("Render Results called with invalid data.", resultsObject);
        return;
    }
    renderFinancialSummary(financials, config);
    renderFinancialTable(financials, financials.baselineCosts, config);
    renderCharts(financials, config);
	renderRawDataTables(rawData, config);

    const exportControls = document.getElementById("export-controls");
    if (exportControls) exportControls.style.display = 'flex';

    const debugElem = document.getElementById('showRawDataDebug');
    if (debugElem) debugElem.style.display = 'inline-block';
}