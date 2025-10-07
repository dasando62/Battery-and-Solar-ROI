// js/debugTables.js
// Version 1.4.0 (Final)

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

export function hideAllDebugContainers() {
    document.querySelectorAll('[id$="DebugTableContainer"], #sizing-recommendation-section').forEach(el => el.style.display = "none");
}

function calculateSeasonalAverages(provider, batteryConfig, state) {
    const seasonalData = {
        Summer: { totalGridCharge: 0, totalSocAt6am: 0, days: 0 },
        Autumn: { totalGridCharge: 0, totalSocAt6am: 0, days: 0 },
        Winter: { totalGridCharge: 0, totalSocAt6am: 0, days: 0 },
        Spring: { totalGridCharge: 0, totalSocAt6am: 0, days: 0 },
    };

    if (!state.electricityData || state.electricityData.length === 0) {
        return seasonalData;
    }

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
        const trueHourlyConsumption = Array(24).fill(0);
        for (let h = 0; h < 24; h++) {
            const selfConsumed = Math.max(0, (hourlySolar[h] || 0) - (day.feedIn[h] || 0));
            trueHourlyConsumption[h] = (day.consumption[h] || 0) + selfConsumed;
        }

        const simResults = simulateDay(trueHourlyConsumption, hourlySolar, provider, batteryConfig, currentSOC);
        currentSOC = simResults.finalSOC;

        if (seasonalData[season]) {
            seasonalData[season].totalGridCharge += simResults.dailyBreakdown.gridChargeKWh;
            seasonalData[season].totalSocAt6am += simResults.socAt6am;
            seasonalData[season].days++;
        }
    });

    for (const season in seasonalData) {
        const data = seasonalData[season];
        data.avgGridCharge = data.days > 0 ? data.totalGridCharge / data.days : 0;
        const avgSocKWh = data.days > 0 ? data.totalSocAt6am / data.days : 0;
        data.avgSocPercent = batteryConfig.capacity > 0 ? (avgSocKWh / batteryConfig.capacity) * 100 : 0;
    }

    return seasonalData;
}

export function renderDebugDataTable(state, shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;
    const useManual = document.getElementById("manualInputToggle")?.checked;
    
    if (!useManual && (!state.electricityData || state.electricityData.length === 0)) {
        displayError("Please upload an electricity CSV file with data first.", "data-input-error");
        return;
    }
    
    const debugContainer = document.getElementById("dataDebugTableContainer");
    let tableHTML = "<h3>Debug Data</h3><table><thead><tr><th>Date</th><th>Hour</th><th>Consumption (kWh)</th><th>Feed In (kWh)</th><th>Solar (kWh)</th></tr></thead><tbody>";
    
    if (useManual) {
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
    
    if (shouldShow) {
        hideAllDebugContainers();
        if (debugContainer) debugContainer.style.display = "block";
    }
}

export function renderExistingSystemDebugTable(state, shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;
    
    const errorId = "existing-system-error";
    clearError(errorId);
    
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
    
    let totalGridImports = 0, totalGridExports = 0, totalSolarGeneration = 0;
    let totalDays = 0;
    const solarDataMap = new Map(state.solarData.map(day => [day.date, day.hourly]));
    state.electricityData.forEach(day => {
        const dateKey = day.date;
        const hourlySolar = solarDataMap.get(dateKey);
        if (hourlySolar) {
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
    const totalSelfConsumed = totalSolarGeneration - totalGridExports;
    const totalConsumption = totalSelfConsumed + totalGridImports;
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
        if (!state.electricityData || !state.solarData || state.electricityData.length === 0) {
            displayError("Please upload both electricity and solar CSV files to use this debug tool.");
            return;
        }
        const sizingResults = calculateDetailedSizing(state.electricityData, state.solarData, config, state.quarterlyAverages);
        if (sizingResults) {
            // --- FINAL FIX: Temporarily show the container to allow charts to render with correct dimensions ---
            const originalDisplay = debugContainer.style.display;
            const originalVisibility = debugContainer.style.visibility;

            // Make container part of the layout but keep it invisible to prevent flicker
            debugContainer.style.visibility = 'hidden';
            debugContainer.style.display = 'block';

            // Now render the content and draw the charts
            renderSizingResults(sizingResults, state);
            drawDistributionCharts(sizingResults.distributions, state);

            // Restore the original styles
            debugContainer.style.display = originalDisplay;
            debugContainer.style.visibility = originalVisibility;
            // --- END FINAL FIX ---
        } else {
            displayError("Sizing calculation failed for debug table.", "sizing-error-message");
        }
    }
    
    if (shouldShow) {
        hideAllDebugContainers();
        debugContainer.style.display = "block";
    }
}

export function renderProvidersDebugTable(state, shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;
    
    const debugContainer = document.getElementById("providersDebugTableContainer");
    let tableHTML = "<h3>Provider & Tariff Inputs</h3>";

    const useManual = document.getElementById("manualInputToggle")?.checked;
    if (!useManual && (!state.electricityData || state.electricityData.length === 0)) {
        displayError("This debug table requires uploaded CSV data to calculate seasonal averages.", "provider-selection-error");
        return;
    }
    clearError("provider-selection-error");
    
    const config = state.analysisConfig;
    if (!config) return;

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
    config.selectedProviders.forEach(pKey => {
        const providerConfig = config.providers.find(p => p.id === pKey);
        if (!providerConfig) return;
        tableHTML += `<h4 style="margin-top:20px;">${providerConfig.name}</h4>`;
        if (!useManual) {
            const batteryConfig = {
                capacity: (config.replaceExistingSystem ? 0 : config.existingBattery) + config.newBatteryKWH,
                inverterKW: (config.replaceExistingSystem ? 0 : config.existingBatteryInverter) + config.newBatteryInverterKW,
                gridChargeThreshold: config.gridChargeThreshold,
                socChargeTrigger: config.socChargeTrigger
            };
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

export function renderAnalysisPeriodDebugTable(shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;

    const debugContainer = document.getElementById("analysisPeriodDebugTableContainer");
    
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
    
    let tableHTML = "<h3>Analysis Period Inputs</h3><table><tbody>";
    tableHTML += `<tr><td>Analysis Years (System Lifespan)</td><td>${numYears}</td></tr>`;
    tableHTML += `<tr><td>Solar Degradation (% per year)</td><td>${(solarDegradation * 100).toFixed(1)}</td></tr>`;
    tableHTML += `<tr><td>Battery Degradation (% per year)</td><td>${(batteryDegradation * 100).toFixed(1)}</td></tr>`;
    tableHTML += `<tr><td>Existing System Age (Years)</td><td>${existingSystemAge}</td></tr>`;
    tableHTML += "</tbody></table>";
    
    tableHTML += "<h3 style='margin-top: 20px;'>Component Performance Schedule</h3>";
    tableHTML += `<table><thead><tr><th>Year</th><th>Total Solar kW</th><th>Total Battery kWh</th><th>Inverter kW</th></tr></thead><tbody>`;
    
    for (let year = 1; year <= numYears; year++) {
        const currentExistingAge = existingSystemAge + year - 1;
        const currentNewAge = year - 1;
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

export function renderLoanDebugTable(shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;

    const debugContainer = document.getElementById("loanDebugTableContainer");
    const P = getNumericInput("loanAmount");
    const annualRate = getNumericInput("loanInterestRate");
    const termYears = getNumericInput("loanTerm");

    if (P === 0 || annualRate === 0 || termYears === 0) {
        if(debugContainer) debugContainer.innerHTML = "<p>Please enter valid loan details (Amount, Rate, and Term > 0).</p>";
    } else {
        const i = (annualRate / 100) / 12;
        const n = termYears * 12;
        const monthlyPayment = P * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
        const annualPayment = monthlyPayment * 12;
        let tableHTML = "<h3>Loan Amortization Schedule</h3><table><thead><tr><th>Year</th><th>Annual Repayment</th><th>Cumulative Repayments</th><th>Remaining Balance</th></tr></thead><tbody>";
        for (let y = 1; y <= termYears; y++) {
            let cumulativeRepayments = annualPayment * y;
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

export function renderOpportunityCostDebugTable(shouldShow = true) {
    if (shouldShow && !document.getElementById("debugToggle")?.checked) return;

    const debugContainer = document.getElementById("opportunityCostDebugTableContainer");
    const costSolar = getNumericInput("costSolar");
    const costBattery = getNumericInput("costBattery");
    const systemCost = costSolar + costBattery;
    const discountRate = getNumericInput("discountRate") / 100;
    const numYears = getNumericInput("numYears", 15);

    let tableHTML = `<h3>Opportunity Cost: Future Value of Initial Capital ($${systemCost.toFixed(2)})</h3><table><thead><tr><th>Year</th><th>Invested Capital Value</th></tr></thead><tbody>`;
    for (let y = 1; y <= numYears; y++) {
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