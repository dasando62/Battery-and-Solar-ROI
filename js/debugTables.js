// js/debugTables.js
// Version 1.0.8
import { 
	getNumericInput, 
	getSimulationData, 
	displayError, 
	clearError 
} from './utils.js';
import { 
	generateHourlyConsumptionProfileFromDailyTOU, 
	generateHourlySolarProfileFromDaily 
} from './profiles.js';
import { simulateDay, calculateSizingRecommendations } from './analysis.js';
import { state } from './state.js';
import { calculateQuarterlyAverages } from './dataParser.js';
import { gatherConfigFromUI } from './config.js'; 

export function hideAllDebugContainers() {
    document.querySelectorAll('[id$="DebugTableContainer"]').forEach(el => el.style.display = "none");
	
}

export function calculateAverageDailyGridCharge(provider, batteryConfig, state) {
    if (!provider.gridChargeEnabled || !state.electricityData) {
        return 0;
    }

    let totalGridChargeKWh = 0;
    let daysProcessed = 0;
    const solarDataMap = new Map((state.solarData || []).map(d => [d.date, d.hourly]));

    state.electricityData.forEach(day => {
        const hourlySolar = solarDataMap.get(day.date) || Array(24).fill(0);
        // We use the same "true consumption" logic as the main simulation
        const trueHourlyConsumption = Array(24).fill(0);
        for (let h = 0; h < 24; h++) {
            const gridImport = day.consumption[h] || 0;
            const gridExport = day.feedIn[h] || 0;
            const solarGeneration = hourlySolar[h] || 0;
            const selfConsumed = Math.max(0, solarGeneration - gridExport);
            trueHourlyConsumption[h] = gridImport + selfConsumed;
        }

        const simResults = simulateDay(trueHourlyConsumption, hourlySolar, provider, batteryConfig);
        totalGridChargeKWh += simResults.dailyBreakdown.gridChargeKWh;
        daysProcessed++;
    });

    return daysProcessed > 0 ? totalGridChargeKWh / daysProcessed : 0;
}

function calculateAverageSOCAt6am(provider, batteryConfig, state) {
    if (!batteryConfig || batteryConfig.capacity === 0 || !state.electricityData) {
        return 0;
    }

    let totalSocAt6am = 0;
    let daysProcessed = 0;
    let currentSOC = 0; // Carry over SOC day-to-day
    const solarDataMap = new Map((state.solarData || []).map(d => [d.date, d.hourly]));

    state.electricityData.forEach(day => {
        const hourlySolar = solarDataMap.get(day.date) || Array(24).fill(0);
        const trueHourlyConsumption = Array(24).fill(0);
        for (let h = 0; h < 24; h++) {
            const gridImport = day.consumption[h] || 0;
            const gridExport = day.feedIn[h] || 0;
            const solarGeneration = hourlySolar[h] || 0;
            const selfConsumed = Math.max(0, solarGeneration - gridExport);
            trueHourlyConsumption[h] = gridImport + selfConsumed;
        }
        
        const simResults = simulateDay(trueHourlyConsumption, hourlySolar, provider, batteryConfig, currentSOC);
        currentSOC = simResults.finalSOC; // Update SOC for the next day
        totalSocAt6am += simResults.socAt6am;
        daysProcessed++;
    });
    
    const avgSocKWh = daysProcessed > 0 ? totalSocAt6am / daysProcessed : 0;
    const avgSocPercent = (avgSocKWh / batteryConfig.capacity) * 100;
    return avgSocPercent;
}

export function renderDebugDataTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
    const useManual = document.getElementById("manualInputToggle")?.checked;
    
    if (!useManual && (!state.electricityData || state.electricityData.length === 0)) {
        displayError("Please upload an electricity CSV file with data first.", "data-input-error");
        return;
    }

    hideAllDebugContainers();
    const debugContainer = document.getElementById("dataDebugTableContainer");
    
    // 1. Add "Feed In" to the table header
    let tableHTML = "<h3>Debug Data</h3><table><thead><tr><th>Date</th><th>Hour</th><th>Consumption (kWh)</th><th>Feed In (kWh)</th><th>Solar (kWh)</th></tr></thead><tbody>";
    
    if (useManual) {
        // ... (manual mode logic remains the same, you can add a column of zeros for Feed In if you like) ...
        const dailyPeak = (getNumericInput("summerDailyPeak") + getNumericInput("autumnDailyPeak") + getNumericInput("winterDailyPeak") + getNumericInput("springDailyPeak")) / 4;
        const dailyShoulder = (getNumericInput("summerDailyShoulder") + getNumericInput("autumnDailyShoulder") + getNumericInput("winterShoulder") + getNumericInput("springShoulder")) / 4;
        const dailyOffPeak = (getNumericInput("summerDailyOffPeak") + getNumericInput("autumnDailyOffPeak") + getNumericInput("winterOffPeak") + getNumericInput("springOffPeak")) / 4;
        const dailySolar = (getNumericInput("summerDailySolar") + getNumericInput("autumnDailySolar") + getNumericInput("winterDailySolar") + getNumericInput("springDailySolar")) / 4;

        const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(dailyPeak, dailyShoulder, dailyOffPeak);
        const hourlySolar = generateHourlySolarProfileFromDaily(dailySolar);

        for (let h = 0; h < 24; h++) {
            tableHTML += `<tr>
                            <td>Manual Average</td>
                            <td>${(h<10?'0':'')+h}:00</td>
                            <td>${(hourlyConsumption[h] || 0).toFixed(3)}</td>
                            <td>0.000</td>
                            <td>${(hourlySolar[h] || 0).toFixed(3)}</td>
                          </tr>`;
        }
    } else {
        // This is the main part to change for CSV mode
        const numEntries = Math.min(state.electricityData.length, 100);
        const solarDataMap = new Map((state.solarData || []).map(d => [d.date, d.hourly]));
        for (let d = 0; d < numEntries; d++) {
            const dayData = state.electricityData[d];
            const hourlySolar = solarDataMap.get(dayData.date) || Array(24).fill(0);
            for (let h = 0; h < 24; h++) {
                // 2. Add the dayData.feedIn value to the table row
                tableHTML += `<tr>
                                <td>${dayData.date}</td>
                                <td>${(h<10?'0':'')+h}:00</td>
                                <td>${(dayData.consumption[h] || 0).toFixed(3)}</td>
                                <td>${(dayData.feedIn[h] || 0).toFixed(3)}</td>
                                <td>${(hourlySolar[h] || 0).toFixed(3)}</td>
                              </tr>`;
            }
        }
    }

    tableHTML += "</tbody></table>";
    if (debugContainer) debugContainer.innerHTML = tableHTML;
    if (debugContainer) debugContainer.style.display = "block";
}

export function renderExistingSystemDebugTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
    
    // Use the new, specific ID for clearing and displaying errors
    const errorId = "existing-system-error";
    clearError(errorId);
    
    // Check for manual mode first
    if (document.getElementById("manualInputToggle")?.checked) {
        displayError("This debug table is not available in manual mode as it requires CSV data.", errorId);
        return;
    }

    // Then check for the required data
    if (!state.electricityData || !state.solarData || state.electricityData.length === 0) {
        displayError("This debug table requires uploaded CSV data.", errorId);
        return;
    }
    
    hideAllDebugContainers();
    const debugContainer = document.getElementById("existingSystemDebugTableContainer");

    let totalGridImports = 0,
        totalGridExports = 0,
        totalSolarGeneration = 0;
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
    if (debugContainer) debugContainer.style.display = "block";
}

export function renderNewSystemDebugTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
	clearError();
    hideAllDebugContainers();
    const debugContainer = document.getElementById("newSystemDebugTableContainer");
    const recommendationContainer = document.getElementById("recommendationContainer");
    if (!recommendationContainer) return;

    const useManual = document.getElementById("manualInputToggle")?.checked;
    const config = gatherConfigFromUI();

    if (useManual) {
        // --- MANUAL MODE PATH ---
        // 1. Gather the seasonal averages from the UI, as the old function did.
        const simulationData = {
            'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
            'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
            'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
            'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
        };

        // 2. Call only the heuristic sizing calculation.
        const heuristicRecs = calculateSizingRecommendations(config.recommendationCoverageTarget, simulationData);
        
        // 3. Render ONLY the heuristic results.
        let recommendationHTML = `<div class="recommendation-section">`;
        if (heuristicRecs) {
            recommendationHTML += `
                <h4>Heuristic Sizing (based on ${heuristicRecs.coverageTarget}% annual coverage)</h4>
                <p>
                    <strong>Recommended Solar: ${heuristicRecs.solar.toFixed(1)} kW</strong><br>
                    <strong>Recommended Battery: ${heuristicRecs.battery.toFixed(1)} kWh</strong><br>
                    <strong>Recommended Inverter: ${heuristicRecs.inverter.toFixed(1)} kW</strong>
                </p>`;
        }
        recommendationHTML += `</div>`;
        recommendationContainer.innerHTML = recommendationHTML;
        
        // 4. Clear the chart area as it's not applicable for manual mode.
        const newSystemEstimatesTable = document.getElementById("newSystemEstimatesTable");
        if (newSystemEstimatesTable) {
            newSystemEstimatesTable.innerHTML = '<p><em>Detailed sizing charts require CSV data.</em></p>';
        }

    } else {
        // --- CSV MODE PATH ---
        if (!state.electricityData || !state.solarData || state.electricityData.length === 0) {
            displayError("Please upload both electricity and solar CSV files to use this debug tool.");
            return;
        }

        // This path works as before, running the full detailed calculation.
        const sizingResults = calculateDetailedSizing(state.electricityData, state.solarData, config, state.quarterlyAverages);

        if (sizingResults) {
            renderSizingResults(sizingResults, state);
            setTimeout(() => {
                drawDistributionCharts(sizingResults.distributions, state);
            }, 0);
        } else {
            displayError("Sizing calculation failed for debug table.", "sizing-error-message");
        }
    }

    if (debugContainer) debugContainer.style.display = "block";
}
export function renderProvidersDebugTable(state) {
    if (!document.getElementById("debugToggle")?.checked) return;
    hideAllDebugContainers();
    const debugContainer = document.getElementById("providersDebugTableContainer");
    let tableHTML = "<h3>Provider & Tariff Inputs</h3><table><tbody>";

    if (!state.analysisConfig || !state.quarterlyAverages) {
        tableHTML += `<tr><td>Please run a successful analysis first to see provider debug info.</td></tr>`;
        tableHTML += "</tbody></table>";
        if (debugContainer) debugContainer.innerHTML = tableHTML;
        if (debugContainer) debugContainer.style.display = "block";
        return;
    }

    const simulationData = state.quarterlyAverages;

    tableHTML += `<tr><td colspan="2" class="provider-header-cell"><strong>Total Household Consumption Quarterly Averages (Daily)</strong></td></tr>`;
    for (const quarter in simulationData) {
        const q = simulationData[quarter];
        tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Peak</td><td>${(q.avgPeak).toFixed(2)} kWh</td></tr>`;
        tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Shoulder</td><td>${(q.avgShoulder).toFixed(2)} kWh</td></tr>`;
        tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Off-Peak</td><td>${(q.avgOffPeak).toFixed(2)} kWh</td></tr>`;
        tableHTML += `<tr><td>${quarter.replace(/_/g, ' ')} Avg Solar</td><td>${(q.avgSolar).toFixed(2)} kWh</td></tr>`;
    }

    state.analysisConfig.selectedProviders.forEach(pKey => {
        const providerConfig = state.analysisConfig.providers.find(p => p.id === pKey);
        if (!providerConfig) return;

        tableHTML += `<tr><td colspan="2" class="provider-header-cell"><strong>${providerConfig.name}</strong></td></tr>`;
        
        // --- ADDED THIS BLOCK BACK ---
        const batteryConfig = {
            capacity: getNumericInput("newBattery"),
            inverterKW: getNumericInput("newBatteryInverter"),
            gridChargeThreshold: getNumericInput("gridChargeThreshold"),
            socChargeTrigger: getNumericInput("socChargeTrigger")
        };
        const avgCharge = calculateAverageDailyGridCharge(providerConfig, batteryConfig, state);
        tableHTML += `<tr><td><strong>Average Daily Grid Charge</strong></td><td><strong>${avgCharge.toFixed(2)} kWh</strong></td></tr>`;
		const avgSocAt6am = calculateAverageSOCAt6am(providerConfig, batteryConfig, state);
		tableHTML += `<tr><td><strong>Average SOC at 6am</strong></td><td><strong>${avgSocAt6am.toFixed(1)}%</strong></td></tr>`;
        // --- END OF ADDED BLOCK ---
    });

    tableHTML += "</tbody></table>";
    if (debugContainer) debugContainer.innerHTML = tableHTML;
    if (debugContainer) debugContainer.style.display = "block";
}

export function renderAnalysisPeriodDebugTable() {
    if (!document.getElementById("debugToggle")?.checked) return;
    hideAllDebugContainers();
    const debugContainer = document.getElementById("analysisPeriodDebugTableContainer");

    // Get all necessary values from the UI
    const numYears = getNumericInput("numYears", 15);
    const solarDegradation = getNumericInput("solarDegradation", 0.5) / 100;
    const batteryDegradation = getNumericInput("batteryDegradation", 2) / 100;

    const replaceExisting = document.getElementById("replaceExistingSystem")?.checked;
    const initialSolarKW = getNumericInput("newSolarKW") + (replaceExisting ? 0 : getNumericInput("existingSolarKW"));
    const initialBatteryKWH = getNumericInput("newBattery") + (replaceExisting ? 0 : getNumericInput("existingBattery"));
    const initialInverterKW = getNumericInput("newBatteryInverter") + (replaceExisting ? 0 : getNumericInput("existingBatteryInverter"));


    // --- Table 1: Original Inputs ---
    let tableHTML = "<h3>Analysis Period Inputs</h3><table><tbody>";
    tableHTML += `<tr><td>Analysis Years (System Lifespan)</td><td>${numYears}</td></tr>`;
    tableHTML += `<tr><td>Solar Degradation (% per year)</td><td>${(solarDegradation * 100).toFixed(1)}</td></tr>`;
    tableHTML += `<tr><td>Battery Degradation (% per year)</td><td>${(batteryDegradation * 100).toFixed(1)}</td></tr>`;
    tableHTML += "</tbody></table>";

    // --- Table 2: New Degradation Schedule ---
    tableHTML += "<h3 style='margin-top: 20px;'>Component Performance Schedule</h3>";
    tableHTML += `<table>
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Solar Efficiency</th>
                            <th>Solar kW</th>
                            <th>Battery Efficiency</th>
                            <th>Battery kWh</th>
                            <th>Inverter kW</th>
                        </tr>
                    </thead>
                    <tbody>`;

    for (let year = 1; year <= numYears; year++) {
        // Calculate the efficiency factor for the start of the given year
        const solarEfficiencyFactor = Math.pow(1 - solarDegradation, year - 1);
        const batteryEfficiencyFactor = Math.pow(1 - batteryDegradation, year - 1);

        // Calculate the effective size/capacity for that year
        const degradedSolarKW = initialSolarKW * solarEfficiencyFactor;
        const degradedBatteryKWH = initialBatteryKWH * batteryEfficiencyFactor;

        tableHTML += `<tr>
                        <td>${year}</td>
                        <td>${(solarEfficiencyFactor * 100).toFixed(2)}%</td>
                        <td>${degradedSolarKW.toFixed(2)} kW</td>
                        <td>${(batteryEfficiencyFactor * 100).toFixed(2)}%</td>
                        <td>${degradedBatteryKWH.toFixed(2)} kWh</td>
                        <td>${initialInverterKW.toFixed(2)} kW</td>
                      </tr>`;
    }
    tableHTML += "</tbody></table>";
    
    // Note about Inverter Degradation
    tableHTML += `<p style="font-size: 0.9em; font-style: italic; margin-top: 10px;">
                    <strong>Note:</strong> Inverter degradation is not currently modeled in the simulation. The inverter's power is treated as constant.
                 </p>`;


    if (debugContainer) {
        debugContainer.innerHTML = tableHTML;
        debugContainer.style.display = "block";
    }
}

export function renderLoanDebugTable() {
    if (!document.getElementById("debugToggle")?.checked) return;
    hideAllDebugContainers();
    const debugContainer = document.getElementById("loanDebugTableContainer");
    const P = getNumericInput("loanAmount");
    const annualRate = getNumericInput("loanInterestRate");
    const termYears = getNumericInput("loanTerm");

    if (P === 0 || annualRate === 0 || termYears === 0) {
        if(debugContainer) debugContainer.innerHTML = "<p>Please enter valid loan details (Amount, Rate, and Term > 0).</p>";
        if(debugContainer) debugContainer.style.display = "block";
        return;
    }

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
    if(debugContainer) debugContainer.style.display = "block";
}

export function renderOpportunityCostDebugTable() {
    if (!document.getElementById("debugToggle")?.checked) return;
    hideAllDebugContainers();
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
    if(debugContainer) debugContainer.style.display = "block";
}
