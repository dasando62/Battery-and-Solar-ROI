// js/uiRender.js
import { state } from './state.js';
import { createBreakdownTableHTML } from './debugTables.js';
import { getNumericInput } from './utils.js';
import { getDegradedFitRate } from './analysis.js';

function renderFinancialSummary(financials, config) {
    let summaryHTML = "<h3>Return on Investment Summary</h3>";
    config.selectedProviders.forEach(pKey => {
        const providerData = config.providers[pKey];
        const result = financials[pKey];
        if (!result) return;
        const systemCostForProvider = config.initialSystemCost - (providerData.rebate || 0);
        const finalNPV = result.npv - (systemCostForProvider - (config.loanEnabled ? config.loanAmount : 0));
        summaryHTML += `<p><strong>${providerData.name}</strong></p><ul><li>Payback Period: Year ${result.roiYear ? result.roiYear : `> ${config.numYears}`}</li>${config.discountRateEnabled ? `<li>Net Present Value (NPV): <strong>$${finalNPV.toFixed(2)}</strong></li>` : ''}</ul>`;
    });
    document.getElementById("roiSummary").innerHTML = summaryHTML;
}

function renderFinancialTable(financials, baselineCosts, config) {
    const baselineProviderName = config.providers[config.selectedProviders[0]].name;
    let tableHTML = `<h3>Financial Breakdown by Year</h3><table><thead><tr><th>Year</th><th>Baseline Cost (${baselineProviderName})</th>`;
    config.selectedProviders.forEach(pKey => {
        tableHTML += `<th>${config.providers[pKey].name} Cost w/ System</th><th>${config.providers[pKey].name} Cumulative Savings</th>`;
    });
    tableHTML += `</tr></thead><tbody>`;
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

function renderCharts(financials, config) {
    if (state.savingsChart) {
        state.savingsChart.destroy();
    }
    const ctx = document.getElementById("savingsChart")?.getContext("2d");
    if (!ctx) return;
    const datasets = config.selectedProviders.map(pKey => ({
        label: `${config.providers[pKey].name} Cumulative Savings`,
        data: financials[pKey]?.cumulativeSavingsPerYear || [],
        borderColor: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        fill: false,
        yAxisID: 'y'
    }));
    const costDatasets = config.selectedProviders.map(pKey => {
        const providerData = config.providers[pKey];
        const systemCostForProvider = config.initialSystemCost - (providerData.rebate || 0);
        return {
            label: `${providerData.name} Capital Outlay`,
            data: Array(config.numYears).fill(systemCostForProvider),
            borderColor: datasets.find(ds => ds.label.startsWith(providerData.name))?.borderColor || '#ccc',
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
            yAxisID: 'y'
        };
    });
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

function renderRawDataTables(rawData, config) {
    const container = document.getElementById('raw-data-tables-container');
    if (!container) return;

    let rawTablesHTML = '';
    const fitConfig = {
        startYear: getNumericInput("fitDegradationStartYear", 1),
        endYear: getNumericInput("fitDegradationEndYear", 10),
        minRate: getNumericInput("fitMinimumRate", -0.03)
    };
    
    const baselineProvider = config.providers[config.selectedProviders[0]];
    
    // Pass the function as the last argument
    rawTablesHTML += createBreakdownTableHTML(`Baseline - Year 1 (${baselineProvider.name})`, rawData.baseline.year1, baselineProvider, 1, config.tariffEscalation, fitConfig, getDegradedFitRate);
    rawTablesHTML += createBreakdownTableHTML(`Baseline - Year 2 (${baselineProvider.name})`, rawData.baseline.year2, baselineProvider, 2, config.tariffEscalation, fitConfig, getDegradedFitRate);

    config.selectedProviders.forEach(pKey => {
        const provider = config.providers[pKey];
        if (rawData.system[pKey]) {
            rawTablesHTML += createBreakdownTableHTML(`${provider.name} with System - Year 1`, rawData.system[pKey].year1, provider, 1, config.tariffEscalation, fitConfig, getDegradedFitRate);
            rawTablesHTML += createBreakdownTableHTML(`${provider.name} with System - Year 2`, rawData.system[pKey].year2, provider, 2, config.tariffEscalation, fitConfig, getDegradedFitRate);
        }
    });

    container.innerHTML = rawTablesHTML;
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